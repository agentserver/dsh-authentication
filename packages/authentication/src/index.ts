/** Browser authentication service definition and provider registry. */

import { Context, Service } from '@deepseek-ai/cordis'

/** Incoming request facts used by authentication providers. */
export interface AuthenticationRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>
  readonly signal?: AbortSignal | undefined
}

/** Frontend index request accepted by the authentication entry flow. */
export type AuthenticationIndexRequest = AuthenticationRequest

/** Minimal response writer owned by an authentication provider. */
export interface AuthenticationIndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** Identity established by one authentication provider. */
export interface AuthenticationPrincipal {
  /** Provider that established the identity. */
  readonly provider: string
  /** Stable provider subject, when the provider has one. */
  readonly subject?: string
  /** Request authority to which the browser session is bound. */
  readonly authority?: string
}

/** Result returned by one authentication provider. */
export type AuthenticationResult =
  | { readonly kind: 'authenticated'; readonly principal: AuthenticationPrincipal }
  | { readonly kind: 'anonymous' }

/** Result of an unauthenticated frontend entry request. */
export type AuthenticationDecision = 'allow' | 'handled' | 'decline'

/** One independently installable browser authentication provider. */
export interface AuthenticationProvider {
  /** Stable provider id used for selection and diagnostics. */
  readonly id: string
  /** Provider precedence when more than one provider can start a login. @default 0 */
  readonly priority?: number
  /** Validate this provider's request credential. */
  authenticate(request: AuthenticationRequest): AuthenticationResult | Promise<AuthenticationResult>
  /** Start this provider's browser login flow for an anonymous request. */
  start(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): AuthenticationDecision | Promise<AuthenticationDecision>
  /** Build the URL that starts this provider's login flow. */
  authenticatedUrl(baseUrl: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser authentication provider registry. */
    authentication: AuthenticationService
  }
}

/** Registry consumed by the Connection carrier. */
export class AuthenticationService extends Service {
  private readonly providers = new Map<string, AuthenticationProvider>()

  constructor(ctx: Context) {
    super(ctx, 'authentication')
  }

  /**
   * Register one provider and return its disposer.
   * @param provider - provider implementation.
   * @returns disposer that removes the provider when its plugin unloads.
   */
  register(provider: AuthenticationProvider): () => void {
    if (this.providers.has(provider.id)) throw new Error(`authentication provider "${provider.id}" is already registered`)
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  /**
   * Authenticate a request through the registered providers.
   * @param request - incoming request facts.
   * @returns the first authenticated principal, or an anonymous result.
   */
  async authenticate(request: AuthenticationRequest): Promise<AuthenticationResult> {
    for (const provider of this.ordered()) {
      const result = await provider.authenticate(request)
      if (result.kind === 'authenticated') return result
    }
    return { kind: 'anonymous' }
  }

  /**
   * Authenticate a frontend index request, then start one registered login flow.
   * @param request - incoming index request.
   * @param response - response owned when no provider allows the request.
   * @returns true when the frontend may serve the index.
   */
  async authorizeIndex(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): Promise<boolean> {
    if ((await this.authenticate(request)).kind === 'authenticated') return true
    for (const provider of this.ordered()) {
      const decision = await provider.start(request, response)
      if (decision === 'allow') return true
      if (decision === 'handled') return false
    }
    response.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
    response.end(request.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
    return false
  }

  /**
   * Build an initial login URL using the highest-priority provider.
   * @param baseUrl - clean Web URL preserving the deployment authority and mount.
   * @returns the provider-selected login URL.
   */
  authenticatedUrl(baseUrl: string): string {
    const provider = this.ordered()[0]
    if (provider === undefined) throw new Error('authentication has no registered provider')
    return provider.authenticatedUrl(baseUrl)
  }

  private ordered(): AuthenticationProvider[] {
    return [...this.providers.values()].sort((left, right) =>
      (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))
  }
}

export default AuthenticationService
