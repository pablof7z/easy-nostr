import LRU from 'lru-cache'
import {getPublicKey} from 'nostr-tools/keys'
import {Event} from 'nostr-tools/event'
import {Relay, Sub, relayInit} from 'nostr-tools/relay'

import {fetchProfile, getTopRelaysForProfile} from './helpers'
import {insertEventIntoAscendingList} from './utils'

export type Options = {
  privateKey: string
  publicKey?: string
  write: string[]
  patience: number
}

export type ProfileRelays = {
  manual: string[] // relays manually assigned by the library user
  explicit: string[] // relays explicitly given to us via nip19 or nip35
  hinted: RelayEntry[] // hinted by other events through tags
  seen: RelayEntry[]
}

export type RelayEntry = {
  url: string
  score: number
}

export class Client {
  private privateKey
  readonly patience
  readonly publicKey

  private _write: Set<string> = new Set()
  private _fallback: Set<string> = new Set()
  private _follows: Set<string> = new Set()
  private _profiles: {[pubkey: string]: ProfileRelays} = {}
  private _cache = {
    kind0: new LRU({max: 500}),
    kind3: new LRU({max: 500}),
    kind1: new LRU({max: 500})
  }
  private _connections: {[url: string]: Relay} = {}
  private _homeFeed: {
    events: Event[]
    subs: {[url: string]: Sub}
    relay2pubkeys: {[url: string]: Set<string>}
    listeners: Array<() => void>
  } = {
    events: [],
    subs: {},
    relay2pubkeys: {},
    listeners: []
  }

  constructor({privateKey, publicKey, write, patience = 2}: Options) {
    this.privateKey = privateKey
    this.publicKey = privateKey ? getPublicKey(privateKey) : publicKey
    this.patience = patience
    this._write = new Set(write)
  }

  get follows() {
    let client = this

    return {
      async add(profileString: string, ...relays: string[]) {
        let profile = await fetchProfile(profileString)
        let profileRelays = client._profiles[profile.pubkey] || {
          manual: relays,
          explicit: [],
          hinted: [],
          seen: []
        }

        if (profile.relays) {
          for (let i = 0; profile.relays; i++) {
            let nu = profile.relays[i]
            if (!profileRelays.explicit.includes(nu)) {
              profileRelays.explicit.push(nu)
            }
          }
        }

        client._profiles[profile.pubkey] = profileRelays
        client._follows.add(profile.pubkey)
        client.homeFeed.addFollow(profile.pubkey)
      }
    }
  }

  get relays() {
    let client = this

    return {
      get() {
        let relays: {
          [url: string]: {
            writes: boolean
            reads: Array<string | 'fallback'>
          }
        } = {}

        const base = () => ({reads: [], writes: false})

        client._fallback.forEach(url => {
          relays[url] = base()
          relays[url].reads.push('fallback')
        })
        client._write.forEach(url => {
          relays[url] = relays[url] || base()
          relays[url].writes = true
        })
        Object.entries(client._profiles).forEach(([pubkey, data]) => {
          getTopRelaysForProfile(data, client._fallback).forEach(url => {
            relays[url] = relays[url] || base()
            relays[url].reads.push(pubkey)
          })
        })

        return relays
      },

      get fallback() {
        return {
          add(url: string) {
            client._fallback.add(url)
          },

          remove(url: string) {
            client._fallback.delete(url)
          },

          clear() {
            client._fallback.clear()
          }
        }
      }
    }
  }

  get homeFeed() {
    let client = this

    return {
      async events({
        offset = 0,
        limit = 50
      }: {offset?: number; limit?: number} = {}): Promise<Event[]> {
        if (offset === 0) {
          return client._homeFeed.events.slice(0, limit)
        }

        let slice = client._homeFeed.events.slice(offset, offset + limit)
        if (slice.length === 0) {
          // TODO fetch older events
        }

        return slice
      },

      onChange(cb: () => void) {
        // if the home feed subscriptions are not open, start them now
        client.maybeStartHomeFeedSubscriptions()

        // add this callback
        if (client._homeFeed.listeners.indexOf(cb) < 0)
          client._homeFeed.listeners.push(cb)
      },

      removeListener(cb: () => void) {
        let idx = client._homeFeed.listeners.indexOf(cb)
        if (idx >= 0) {
          client._homeFeed.listeners.splice(idx, 1)
          setTimeout(() => {
            client.maybeCleanupHomeFeedSubscriptions()
          }, 1000)
        }
      },

      addFollow(pubkey: string) {
        let profileRelays = client._profiles[pubkey]
        getTopRelaysForProfile(profileRelays, client._fallback).forEach(url => {
          let pubkeys = client._homeFeed.relay2pubkeys[url]
          if (!pubkeys.has(pubkey)) {
            pubkeys.add(pubkey)
            client._homeFeed.subs[url].sub(
              [
                {
                  kinds: [1],
                  authors: Array.from(pubkeys)
                }
              ],
              {}
            )
          }
        })
      },

      removeFollow(pubkey: string) {
        // TODO
      }
    }
  }

  private maybeStartHomeFeedSubscriptions() {
    if (Object.keys(this._homeFeed.subs).length === 0) {
      for (let pubkey of this._follows) {
        getTopRelaysForProfile(this._profiles[pubkey], this._fallback).forEach(
          url => {
            this._homeFeed.relay2pubkeys[url] =
              this._homeFeed.relay2pubkeys[url] || new Set()
            this._homeFeed.relay2pubkeys[url].add(pubkey)
          }
        )
      }
      Object.entries(this._homeFeed.relay2pubkeys).forEach(
        async ([url, pubkeys]) => {
          let connection = this._connections[url] || relayInit(url)
          await connection.connect()
          let sub = connection.sub(
            [
              {
                kinds: [1],
                authors: Array.from(pubkeys)
              }
            ],
            {
              skipVerification: true,
              id: 'home'
            }
          )
          this._homeFeed.subs[url] = sub

          sub.on('event', (event: Event) => {
            this._homeFeed.events = insertEventIntoAscendingList(
              this._homeFeed.events,
              event
            )
            this._homeFeed.listeners.forEach(cb => cb())
          })
        }
      )
    }
  }

  private maybeCleanupHomeFeedSubscriptions() {
    if (this._homeFeed.listeners.length === 0) {
      Object.values(this._homeFeed.subs).forEach(sub => sub.unsub())
      this._homeFeed.subs = {}

      setTimeout(() => {
        this.maybeCloseRelayConnections()
      }, 1000)
    }
  }

  private maybeCloseRelayConnections() {
    // TODO
  }
}
