/** Static launch-token authentication provider. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AuthenticationDecision, AuthenticationProvider, AuthenticationService } from '@agentserver/dsh-authentication'
import type {} from '@agentserver/dsh-authentication'
import type {} from '@deepseek-ai/dsh-credentials'
import { BrowserAuth } from './browser-auth.ts'
import type { AuthenticationIndexRequest, AuthenticationIndexResponse, AuthenticationRequest } from '@agentserver/dsh-authentication'

export { BrowserAuth } from './browser-auth.ts'

/** Token provider configuration. */
export interface Config {
  /** Absolute browser-session lifetime in days. @default 30 */
  readonly cookieMaxAgeDays?: number
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  cookieMaxAgeDays: z.natural().min(1).default(30),
})

class TokenProvider implements AuthenticationProvider {
  readonly id = 'token'
  readonly priority = 10

  constructor(private readonly auth: BrowserAuth) {}

  authorizeIndex(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): AuthenticationDecision {
    if (this.auth.isAuthenticated(request)) return 'allow'
    const url = new URL(request.url ?? '/', 'http://dsh.invalid')
    return url.searchParams.has('token') ? (this.auth.authorizeIndex(request, response), 'handled') : 'decline'
  }

  isAuthenticated(request: AuthenticationRequest): boolean { return this.auth.isAuthenticated(request) }

  authenticatedUrl(baseUrl: string): string { return this.auth.authenticatedUrl(baseUrl) }

  principal(request: AuthenticationRequest) {
    return this.isAuthenticated(request) ? { provider: this.id } : undefined
  }
}

/** Cordis plugin name. */
export const name = 'authentication-token'
/** Services required by the token provider. */
export const inject = ['authentication', 'credentials']

/** Register the legacy launch-token provider. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = Config(config) as Required<Config>
  const provider = new TokenProvider(await BrowserAuth.create(ctx.root, ctx.credentials, resolved.cookieMaxAgeDays))
  const dispose = (ctx.authentication as AuthenticationService).register(provider)
  ctx.effect(() => dispose, 'authentication-token: provider')
}

export default { name, inject, Config, apply }
