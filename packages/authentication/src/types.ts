/** Transport data shared by providers and consumers; no Cordis runtime imports. */

/** HTTP request facts. Login endpoints own challenge bodies and protocol-specific state. */
export interface AuthenticationRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>
  readonly signal?: AbortSignal | undefined
}

/** Browser entry request; URL may be relative to the transport's public origin. */
export type AuthenticationIndexRequest = AuthenticationRequest

/** Response owned by a login flow, never by credential verification. */
export interface AuthenticationIndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** Verified identity; issuer and subject identify the external account, not resource permissions. */
export interface AuthenticationPrincipal {
  readonly provider: string
  readonly issuer?: string
  readonly subject?: string
  readonly authority?: string
}

/** Anonymous means no accepted identity; rejected forbids falling back to weaker credentials. */
export type AuthenticationResult =
  | { readonly kind: 'authenticated'; readonly principal: AuthenticationPrincipal }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'rejected'; readonly status: 401 | 403 }

/** Entry-flow response ownership after credential authentication returned anonymous. */
export type AuthenticationDecision = 'handled' | 'decline'

/** Independent verifier and browser flow. Callback/challenge routes are provider-owned Cordis effects. */
export interface AuthenticationProvider {
  readonly id: string
  readonly priority?: number
  /** Validate credentials without redirecting, consuming a body, or writing a response. */
  authenticate(request: AuthenticationRequest): AuthenticationResult | Promise<AuthenticationResult>
  /** Start or continue the entry flow and claim the response when handled. */
  start(request: AuthenticationRequest, response: AuthenticationIndexResponse): AuthenticationDecision | Promise<AuthenticationDecision>
  /** Construct the login URL preserving the application's public mount. */
  authenticatedUrl(baseUrl: string): string
}
