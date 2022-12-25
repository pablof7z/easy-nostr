import {getPublicKey} from 'nostr-tools'

export type Options = {
  privateKey: string
  publicKey: string
  relays: string[]
  patience: number
}

type Relay = {}
type Profile = {}

export class Client {
  private privateKey: string
  readonly publicKey: string
  readonly patience: number
  private relays: Relay[]

  constructor(opts: Options) {
    this.privateKey = opts.privateKey
    this.publicKey = opts.privateKey ? getPublicKey(opts.privateKey) : opts.publicKey
    this.patience = opts.patience
    this.relays = opts.relays.
  }
}
