import {nip19, nip05} from 'nostr-tools'
import {ProfilePointer} from 'nostr-tools/nip19'

import {ProfileRelays} from './client'

export async function fetchProfile(
  stuff: string
): Promise<nip19.ProfilePointer> {
  if (stuff.match(/^[a-fA-F0-9]{64}$/)) {
    // it is a hex key
    return {pubkey: stuff}
  }

  let {type, data} = nip19.decode(stuff)
  switch (type) {
    case 'npub':
      return {pubkey: data as string}
    case 'nprofile':
      return data as ProfilePointer
    default:
      break
  }

  let profile = await nip05.queryProfile(stuff)
  if (profile === null)
    throw new Error(`cannot resolve '${stuff}' as a nostr profile`)

  return profile
}

export function getTopRelaysForProfile(
  relays: ProfileRelays,
  fallback: Set<string>
): string[] {
  let urls = []

  let impliedSorted = [...relays.hinted, ...relays.seen]
  impliedSorted.sort((a, b) => a.score - b.score)

  for (let i = 0; i < 5; i++) {
    if (relays.manual.length > i) {
      urls.push(relays.manual[i])
    }
    if (relays.explicit.length > i) {
      urls.push(relays.manual[i])
    }
    if (impliedSorted.length > i) {
      urls.push(impliedSorted[i].url)
    }

    if (urls.length > 5) return urls
  }

  // fill in with fallback if necessary
  let fb = Array.from(fallback)
  while (urls.length < 5 && fb.length > 0) {
    let url = fb.shift() as string
    urls.push(url)
  }

  return urls
}
