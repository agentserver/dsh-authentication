/** Authentication dispatch and explicit browser login selection. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AuthenticationProvider, AuthenticationRequest, AuthenticationIndexResponse, AuthenticationResult } from './types.ts'
export type * from './types.ts'

/** Deployment-selected login entry; it does not change credential acceptance. */
export interface Config {
  readonly defaultProvider?: string
}

/** Configuration schema. */
export const Config: z<Config> = z.object({ defaultProvider: z.string() })

declare module '@deepseek-ai/cordis' {
  interface Context {
    authentication: AuthenticationService
  }
}

/** Authentication registry; tenant and resource permissions are consumer policy. */
export class AuthenticationService extends Service {
  static Config = Config
  private readonly registered = new Map<string, AuthenticationProvider>()
  private revision = 0

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'authentication')
  }

  /** Register a provider; the caller attaches the returned disposer to its fiber. */
  register(provider: AuthenticationProvider): () => void {
    if (this.registered.has(provider.id)) throw new Error('authentication: duplicate provider ' + provider.id)
    this.registered.set(provider.id, provider)
    this.revision++
    return () => {
      if (this.registered.get(provider.id) === provider) {
        this.registered.delete(provider.id)
        this.revision++
      }
    }
  }

  /** List installed provider ids without selecting a login method. */
  providers(): readonly string[] {
    return [...this.registered.keys()].sort()
  }

  /**
   * Authenticate once per provider. Conflicting accepted credentials and explicit rejections fail closed.
   * Provider failures reject the operation, never fall back to another method.
   * Cancellation and provider withdrawal during verification prevent admission.
   */
  async authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
    request.signal?.throwIfAborted()
    const revision = this.revision
    let accepted: AuthenticationResult = { kind: 'anonymous' }
    const checked: AuthenticationProvider[] = []
    for (const provider of this.ordered()) {
      if (this.revision !== revision || this.registered.get(provider.id) !== provider) {
        return { kind: 'rejected', status: 401 }
      }
      const result = await provider.authenticate(request)
      checked.push(provider)
      request.signal?.throwIfAborted()
      if (this.revision !== revision || checked.some(item => this.registered.get(item.id) !== item)) {
        return { kind: 'rejected', status: 401 }
      }
      if (result.kind === 'rejected') return result
      if (result.kind === 'authenticated') {
        if (accepted.kind === 'authenticated') return { kind: 'rejected', status: 401 }
        accepted = { kind: 'authenticated', principal: Object.freeze({ ...result.principal, provider: provider.id }) }
      }
    }
    return accepted
  }

  /** Authenticate the index request, then let one provider own an anonymous entry response. */
  async authorizeIndex(request: AuthenticationRequest, response: AuthenticationIndexResponse): Promise<boolean> {
    const result = await this.authenticate(request)
    if (result.kind === 'authenticated') return true
    if (result.kind === 'rejected') {
      this.rejectIndex(response, request, result.status)
      return false
    }
    for (const provider of this.ordered()) {
      const decision = await provider.start(request, response)
      if (decision === 'handled') return false
    }
    this.rejectIndex(response, request, 401)
    return false
  }

  /** Build the selected login URL; multiple providers require an explicit deployment default. */
  authenticatedUrl(baseUrl: string, providerId?: string): string {
    return (providerId === undefined ? this.defaultProvider() : this.requireProvider(providerId)).authenticatedUrl(baseUrl)
  }

  private defaultProvider(): AuthenticationProvider {
    if (this.config.defaultProvider !== undefined) return this.requireProvider(this.config.defaultProvider)
    const ids = this.providers()
    if (ids.length !== 1 || ids[0] === undefined) throw new Error('authentication: configure defaultProvider when not exactly one provider is installed')
    return this.requireProvider(ids[0])
  }

  private ordered(): AuthenticationProvider[] {
    return [...this.registered.values()].sort((left, right) =>
      (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))
  }

  private requireProvider(id: string): AuthenticationProvider {
    const provider = this.registered.get(id)
    if (provider === undefined) throw new Error('authentication: provider not registered: ' + id)
    return provider
  }

  private rejectIndex(response: AuthenticationIndexResponse, request: AuthenticationRequest, status: 401 | 403): void {
    response.writeHead(status, { 'cache-control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh.\n')
  }
}
export default AuthenticationService
