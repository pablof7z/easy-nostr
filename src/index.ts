import {Client, Options} from './client'

const nostr = {
  client: (opts: Options) => new Client(opts)
}

export default nostr
