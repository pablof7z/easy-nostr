# easy-nostr

Nostr interface for building clients that abstracts all the complexity.

## Explanation

This library does a lot of internal magic, like caching and keeping hidden state.
It relies on [`nostr-tools`](https://github.com/fiatjaf/nostr-tools) for all its basic operations.

## Usage

```js
import nostr from 'easy-nostr'

// this will create a client, which is assumed to represent one user
const n = nostr.client({
  // names in lowercase are private keys, names in uppercase are public keys.
  // keys can be input in either `nsec`/`npub`/`nprofile` or as hex (NIP-19)
  privateKey: 'alice',

  // the public key will be derived automatically from the private key,
  // but you can also just pass the public key directly if you don't have
  // the public key
  publicKey: '...',

  // we need to specify the main relays used by the client user
  write: ['wss://nostr.alice.com', 'wss://relay.bananas.com']

  // this specifies how much we will block while waiting for a relay to return an event
  // patience: 2 // (in seconds)
})

// we can now try to fetch data for the client:
// this will try to fetch data from the two relays specified above.
// if nothing is found within `patience` time a mostly blank metadata event will be returned.
let metadataEvent = await n.getReplaceableEvent(0)

// we can now edit the metadata event:
metadataEvent.set('name', 'Alice')
metadataEvent.set('picture', 'https://alice.com/img/pic.jpg')
// or edit it all at once
metadataEvent.set({name: 'Alice', picture: 'https://alice.com/img/pic.jpg'})
// and then publish it

// when someone is added to a follow list, they can have zero or more relays specified
// for them.
// when passing an `nprofile` (NIP-19) or a NIP-05 identifier these will have relay
// information extracted from them automatically.
n.follows.add('BOB', 'wss://nostr.bob.com')
n.follows.add('CAROL', 'wss://relay.nostr.com')
n.follows.add('DAVE', 'wss://relay.nostr.com', 'wss://relay.dave.com')
n.follows.add('ERIN')

// fallback relays can be added so stuff without relay information can be searched on
n.relays.fallback.add('wss://relay.nostr.com')

// we can get information on the relays and keys we know so far
console.log(n.relays.get())
// prints: {
//   'wss://nostr.bob.com': { reads: ['BOB'], writes: false }
//   'wss://relay.nostr.com': { reads: ['CAROL', 'DAVE', 'ERIN'], writes: false }
//   'wss://relay.dave.com': { reads: ['DAVE'], writes: false }
//   'wss://relay.bananas.com': { reads: ['ALICE'], writes: true }
//   'wss://nostr.alice.com': { reads: ['ALICE'], writes: true }
// }

// after adding this information we can query the client's "home feed"
n.homeFeed.addListener((allEvents) => {
  console.log(allEvents)
})

// every time we get an event, internal magic will happen that keeps track of in which
// relay each thing is, such that we can query stuff correctly and without bloat.
console.log(n.profiles.get())
// prints: {
  'ALICE': { relays: ['wss://relay.bananas.com', 'wss://nostr.alice.com'] },
  'BOB': { relays: ['wss://nostr.bob.com'] },
  'CAROL': { relays: ['wss://relay.nostr.com'] },
  'DAVE': { relays: ['wss://relay.dave.com', 'relay.nostr.com'] },
  'ERIN': { relays: ['wss://relay.nostr.com', 'wss://r.nos.tr'] } // we found out that Erin was referenced in another relay
  'FRANK': { relays: ['wss://relay.nostr.com'] } // Frank was referenced in some of the events gotten from the home feed
}

// we can also just query events and other stuff from a random profile
// it will reuse information we have cached
let sub = n.subscribe.profile('GABRIEL', 'wss://optional.relay') // if you don't pass any relays it will try to use only the fallback ones
sub.on('events', (events) => {})
sub.on('metadata', (metadata) => {})
sub.on('events', () => {})

// or query an event and its replies and other context
// again, optional relays can be added, otherwise they will be inferred from data we had seen on a fallback will be used
let sub = n.subscribe.event('event_id')

sub.on('event', () => {})
sub.on('reply', () => {})
sub.on('in_reply_to', () => {})
sub.on('thread_root', () => {})

// finally, you can publish events, this will
```

## License

Public domain.
