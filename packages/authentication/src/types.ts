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

/** Independent verifier and browser flow. Callback/challenge routes are provider-owned Cordis effects. */
export interface AuthenticationProvider {
  readonly id: string
  /** Validate credentials without redirecting, consuming a body, or writing a response. */
  authenticate(request: AuthenticationRequest): AuthenticationResult | Promise<AuthenticationResult>
  /** Claim only this provider's explicit login input; ordinary navigation must not match. */
  matchesEntry?(request: AuthenticationRequest): boolean
  /** Own the entry response; never authorize index rendering. */
  start(request: AuthenticationRequest, response: AuthenticationIndexResponse): void | Promise<void>
  /** Construct the login URL preserving the application's public mount. */
  authenticatedUrl(baseUrl: string): string
}
