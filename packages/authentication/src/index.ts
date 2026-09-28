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

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'authentication')
  }

  /** Register a provider; the caller attaches the returned disposer to its fiber. */
  register(provider: AuthenticationProvider): () => void {
    if (this.registered.has(provider.id)) throw new Error('authentication: duplicate provider ' + provider.id)
    this.registered.set(provider.id, provider)
    return () => {
      if (this.registered.get(provider.id) === provider) this.registered.delete(provider.id)
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
    let accepted: AuthenticationResult = { kind: 'anonymous' }
    const checked: AuthenticationProvider[] = []
    for (const id of this.providers()) {
      const provider = this.requireProvider(id)
      const result = await provider.authenticate(request)
      checked.push(provider)
      request.signal?.throwIfAborted()
      if (checked.some(item => this.registered.get(item.id) !== item)) return { kind: 'rejected', status: 401 }
      if (result.kind === 'rejected') return result
      if (result.kind === 'authenticated') {
        if (accepted.kind === 'authenticated') return { kind: 'rejected', status: 401 }
        accepted = { kind: 'authenticated', principal: Object.freeze({ ...result.principal, provider: id }) }
      }
    }
    return accepted
  }

  /** Authenticate the index or hand its response to one explicit login entry. */
  async authorizeIndex(request: AuthenticationRequest, response: AuthenticationIndexResponse): Promise<boolean> {
    const result = await this.authenticate(request)
    if (result.kind === 'authenticated') return true
    if (result.kind === 'rejected') {
      response.writeHead(result.status, { 'cache-control': 'no-store' })
      response.end(request.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
      return false
    }
    const entries = [...this.registered.values()].filter(provider => provider.matchesEntry?.(request))
    if (entries.length > 1) throw new Error('authentication: multiple providers claimed the login entry')
    const entry = entries[0]
    if (entry !== undefined) {
      await this.start(entry.id, request, response)
      return false
    }
    if (this.registered.size === 0) {
      response.writeHead(401, { 'cache-control': 'no-store' })
      response.end(request.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
      return false
    }
    await this.start(this.defaultProvider().id, request, response)
    return false
  }

  /** Start an explicitly selected provider's flow; the provider owns the response. */
  async start(providerId: string, request: AuthenticationRequest, response: AuthenticationIndexResponse): Promise<void> {
    request.signal?.throwIfAborted()
    await this.requireProvider(providerId).start(request, response)
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

  private requireProvider(id: string): AuthenticationProvider {
    const provider = this.registered.get(id)
    if (provider === undefined) throw new Error('authentication: provider not registered: ' + id)
    return provider
  }
}
export default AuthenticationService
