/** Browser authentication service definition and provider registry. */

import { Context, Service } from '@deepseek-ai/cordis'

/** Request headers accepted by the authentication provider registry. */
export interface AuthenticationRequest {
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>
}

/** Frontend index request accepted by the authentication provider registry. */
export interface AuthenticationIndexRequest extends AuthenticationRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
}

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

/** Result of an unauthenticated frontend request. */
export type AuthenticationDecision = 'allow' | 'handled' | 'decline'

/** One independently installable browser authentication provider. */
export interface AuthenticationProvider {
  /** Stable provider id used for selection and diagnostics. */
  readonly id: string
  /** Provider precedence when more than one provider can start a login. @default 0 */
  readonly priority?: number
  /** Authenticate or start this provider's frontend login flow. */
  authorizeIndex(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): AuthenticationDecision
  /** Check this provider's request credential. */
  isAuthenticated(request: AuthenticationRequest): boolean
  /** Build the URL that starts this provider's login flow. */
  authenticatedUrl(baseUrl: string): string
  /** Resolve the identity carried by this provider's request credential. */
  principal(request: AuthenticationRequest): AuthenticationPrincipal | undefined
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
   * Authenticate a frontend index request through the registered providers.
   * @param request - incoming index request.
   * @param response - response owned when no provider allows the request.
   * @returns true when the frontend may serve the index.
   */
  authorizeIndex(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): boolean {
    for (const provider of this.ordered()) {
      const decision = provider.authorizeIndex(request, response)
      if (decision === 'allow') return true
      if (decision === 'handled') return false
    }
    response.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
    response.end(request.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
    return false
  }

  /**
   * Return true when any provider authenticates the request.
   * @param request - request headers carrying provider credentials.
   * @returns true when one provider accepts the request.
   */
  isAuthenticated(request: AuthenticationRequest): boolean {
    return this.ordered().some(provider => provider.isAuthenticated(request))
  }

  /**
   * Resolve the first provider identity carried by the request.
   * @param request - request headers carrying provider credentials.
   * @returns the authenticated principal, or undefined when no provider accepts it.
   */
  principal(request: AuthenticationRequest): AuthenticationPrincipal | undefined {
    for (const provider of this.ordered()) {
      const principal = provider.principal(request)
      if (principal !== undefined) return principal
    }
    return undefined
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
