declare module '@deepseek-ai/dsh-credentials' {
  export type CredentialKey = string & { readonly __credentialKey: unique symbol }
  export type CredentialRef = string & { readonly __credentialRef: unique symbol }
  export type CredentialRecord = {
    readonly kind: 'api-key'
    readonly key: string
  } | {
    readonly kind: 'grant'
    readonly payload: object
  }
  export interface ResolvedCredential {
    readonly value: string
    readonly source: string
  }
  export abstract class CredentialProvider {
    abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
    abstract modifyRecord(
      key: CredentialKey,
      mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ): Promise<CredentialRecord | undefined>
  }
  export function credentialKey(scope: string, id: string): CredentialKey
  export function credentialRef(value: string): CredentialRef
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly credentials: import('@deepseek-ai/dsh-credentials').CredentialProvider
    readonly root: object
    provide(key: string, value: unknown): unknown
    effect(setup: () => void | (() => void), name?: string): unknown
  }
}
