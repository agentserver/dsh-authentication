/** OIDC Authorization Code + PKCE authentication for the Web Connection carrier. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {
  AuthenticationIndexRequest,
  AuthenticationIndexResponse,
  AuthenticationProvider,
  AuthenticationRequest,
  AuthenticationResult,
} from '@agentserver/dsh-authentication'
import type {} from '@agentserver/dsh-authentication'
import {
  credentialKey,
  credentialRef,
  type CredentialProvider,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/** Authenticated OIDC identity available to future tenant-scoped consumers. */
export interface OidcPrincipal {
  /** Authentication provider id. */
  readonly provider: 'oidc'
  /** Stable provider subject for the signed-in user. */
  readonly subject: string
  /** Request authority the browser session is bound to. */
  readonly authority: string
}

const SECRET_KEY = credentialKey('authentication-oidc', 'browser-session')
const SECRET_BYTES = 32
const COOKIE_VERSION = 1
const STORED_SECRET_VERSION = 1
const COOKIE_PREFIX = 'dsh-auth-oidc-'
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** OIDC provider configuration. */
export interface Config {
  /** OIDC issuer origin. Discovery is fetched from this origin. */
  readonly issuer: string
  /** Public OIDC client id registered for the configured redirect URI. */
  readonly clientId: string
  /** Optional reference to a confidential-client secret. */
  readonly clientSecretRef?: string
  /** Redirect URI registered at the OIDC provider. Defaults to the request authority plus callbackPath. */
  readonly redirectUri?: string
  /** Callback route registered on the dsh Web server. @default /oidc/callback */
  readonly callbackPath?: string
  /** Scopes sent to the provider. @default ['openid', 'profile', 'email'] */
  readonly scopes?: string[]
  /** Absolute browser-session lifetime in days. @default 30 */
  readonly cookieMaxAgeDays?: number
  /** OIDC request deadline in milliseconds. @default 15000 */
  readonly requestTimeoutMs?: number
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  issuer: z.string().required(),
  clientId: z.string().required(),
  clientSecretRef: z.string(),
  redirectUri: z.string(),
  callbackPath: z.string().default('/oidc/callback'),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  requestTimeoutMs: z.natural().min(1).default(15_000),
})

interface Discovery {
  readonly issuer: string
  readonly authorization_endpoint: string
  readonly token_endpoint: string
  readonly jwks_uri: string
}

interface PendingLogin {
  readonly verifier: string
  readonly nonce: string
  readonly redirectUri: string
  readonly returnPath: string
  readonly authority: string
  readonly createdAt: number
}

interface CookiePayload {
  readonly version: typeof COOKIE_VERSION
  readonly authority: string
  readonly subject: string
  readonly issuedAt: number
  readonly expiresAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function decode(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const decoded = Buffer.from(value, 'base64url')
  return encode(decoded) === value ? decoded : undefined
}

function authority(request: AuthenticationRequest): string | undefined {
  const headers = request.headers instanceof Headers ? request.headers : new Headers(
    Object.entries(request.headers).flatMap(([key, value]): [string, string][] => value === undefined
      ? []
      : [[key, typeof value === 'string' ? value : value.join(',')]]),
  )
  const host = headers.get('host')
  if (host === null) return undefined
  try { return new URL(`http://${host}`).host } catch { return undefined }
}

function cookieName(host: string): string {
  return COOKIE_PREFIX + encode(createHash('sha256').update(host).digest())
}

function headerValue(request: AuthenticationRequest, name: string): string | undefined {
  if (request.headers instanceof Headers) return request.headers.get(name) ?? undefined
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

function cookieValue(value: string, name: string): string | undefined {
  for (const part of value.split(';')) {
    const at = part.indexOf('=')
    if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

function sign(secret: Buffer, body: string): string {
  return encode(createHmac('sha256', secret).update(body).digest())
}

function encodeCookie(payload: CookiePayload, secret: Buffer): string {
  const body = encode(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v1.${body}.${sign(secret, body)}`
}

function decodeCookie(value: string, secret: Buffer): CookiePayload | undefined {
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] === undefined || parts[2] === undefined) return undefined
  const actual = decode(parts[2])
  const expected = Buffer.from(sign(secret, parts[1]), 'base64url')
  if (actual === undefined || actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined
  const body = decode(parts[1])
  if (body === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!isRecord(parsed) || parsed.version !== COOKIE_VERSION || typeof parsed.authority !== 'string'
      || typeof parsed.subject !== 'string' || typeof parsed.issuedAt !== 'number'
      || typeof parsed.expiresAt !== 'number' || !Number.isSafeInteger(parsed.issuedAt)
      || !Number.isSafeInteger(parsed.expiresAt)) return undefined
    return {
      version: COOKIE_VERSION,
      authority: parsed.authority,
      subject: parsed.subject,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
    }
  } catch { return undefined }
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload) || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('authentication-oidc: browser-session credential record has an unsupported format')
  }
  const value = record.payload.secret
  if (typeof value !== 'string') throw new Error('authentication-oidc: browser-session credential record has no secret')
  const decoded = decode(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) throw new Error('authentication-oidc: browser-session credential record has an invalid secret')
  return decoded
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const record = await credentials.modifyRecord(SECRET_KEY, (current: CredentialRecord | undefined) => Promise.resolve(
    current === undefined ? { kind: 'grant', payload: { version: STORED_SECRET_VERSION, secret: encode(randomBytes(SECRET_BYTES)) } } : undefined,
  ))
  const secret = storedSecret(record)
  if (secret === undefined) throw new Error('authentication-oidc: browser-session credential record was not created')
  return secret
}

function issuerUrl(value: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('authentication-oidc: issuer must be an HTTPS URL without credentials, query, or fragment')
  }
  return parsed.href.replace(/\/$/u, '')
}

function singleQuery(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key)
  return values.length === 1 ? values[0] : undefined
}

function redirectResponse(response: AuthenticationIndexResponse, location: string): void {
  response.writeHead(302, { location, 'cache-control': 'no-store' })
  response.end()
}

/** OIDC browser authenticator implementing the authentication provider contract. */
export class OidcAuthenticator implements AuthenticationProvider {
  readonly id = 'oidc'
  readonly priority = 100
  private readonly pending = new Map<string, PendingLogin>()

  constructor(
    private readonly discovery: Discovery,
    private readonly jwks: ReturnType<typeof createRemoteJWKSet>,
    private readonly secret: Buffer,
    private readonly config: Required<Pick<Config, 'clientId' | 'callbackPath' | 'scopes' | 'cookieMaxAgeDays' | 'requestTimeoutMs'>> & Pick<Config, 'clientSecretRef' | 'redirectUri'>,
    private readonly credentials: CredentialProvider,
  ) {}

  authenticate(request: AuthenticationRequest): AuthenticationResult {
    const principal = this.principal(request)
    return principal === undefined
      ? { kind: 'anonymous' }
      : { kind: 'authenticated', principal }
  }

  start(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): void {
    const host = authority(request)
    if (host === undefined || request.method !== 'GET') {
      response.writeHead(401, { 'cache-control': 'no-store' }); response.end(); return
    }
    const now = Date.now()
    for (const [candidate, pending] of this.pending) {
      if (now - pending.createdAt > this.config.cookieMaxAgeDays * 86_400_000) this.pending.delete(candidate)
    }
    if (this.pending.size >= 1024) {
      const oldest = this.pending.keys().next().value
      if (oldest !== undefined) this.pending.delete(oldest)
    }
    const returnPath = new URL(request.url ?? '/', 'http://dsh.invalid').pathname
    const redirectUri = this.config.redirectUri ?? `${this.requestOrigin(request)}${this.config.callbackPath}`
    const state = encode(randomBytes(32))
    const verifier = encode(randomBytes(32))
    const nonce = encode(randomBytes(32))
    this.pending.set(state, { verifier, nonce, redirectUri, returnPath, authority: host, createdAt: now })
    const authorization = new URL(this.discovery.authorization_endpoint)
    authorization.searchParams.set('client_id', this.config.clientId)
    authorization.searchParams.set('response_type', 'code')
    authorization.searchParams.set('redirect_uri', redirectUri)
    authorization.searchParams.set('scope', this.config.scopes.join(' '))
    authorization.searchParams.set('state', state)
    authorization.searchParams.set('nonce', nonce)
    authorization.searchParams.set('code_challenge', encode(createHash('sha256').update(verifier).digest()))
    authorization.searchParams.set('code_challenge_method', 'S256')
    redirectResponse(response, authorization.href)
  }

  principal(request: AuthenticationRequest): OidcPrincipal | undefined {
    const host = authority(request)
    const raw = headerValue(request, 'cookie')
    if (host === undefined || raw === undefined) return undefined
    const payload = decodeCookie(cookieValue(raw, cookieName(host)) ?? '', this.secret)
    const now = Date.now()
    if (payload === undefined || payload.authority !== host || payload.issuedAt > now || payload.expiresAt <= now
      || payload.expiresAt - payload.issuedAt > this.config.cookieMaxAgeDays * 86_400_000) return undefined
    return { provider: 'oidc', subject: payload.subject, authority: host }
  }

  authenticatedUrl(baseUrl: string): string {
    return new URL(baseUrl).href
  }

  async handleCallback(request: AuthenticationIndexRequest, response: AuthenticationIndexResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://dsh.invalid')
    const state = singleQuery(url, 'state')
    const code = singleQuery(url, 'code')
    const pending = state === undefined ? undefined : this.pending.get(state)
    if (request.method !== 'GET' || url.pathname !== this.config.callbackPath || state === undefined || code === undefined
      || pending === undefined || authority(request) !== pending.authority) {
      response.writeHead(400, { 'cache-control': 'no-store' }); response.end(); return
    }
    this.pending.delete(state)
    if (Date.now() - pending.createdAt > this.config.cookieMaxAgeDays * 86_400_000) {
      response.writeHead(410, { 'cache-control': 'no-store' }); response.end(); return
    }
    try {
      const token = await this.exchange(code, pending.verifier, pending.redirectUri)
      const verified = await jwtVerify(token.idToken, this.jwks, { issuer: this.discovery.issuer, audience: this.config.clientId })
      if (verified.payload.nonce !== pending.nonce || typeof verified.payload.sub !== 'string') throw new Error('OIDC token claims rejected')
      const now = Date.now()
      const expiresAt = now + this.config.cookieMaxAgeDays * 86_400_000
      const value = encodeCookie({
        version: COOKIE_VERSION,
        authority: pending.authority,
        subject: verified.payload.sub,
        issuedAt: now,
        expiresAt,
      }, this.secret)
      response.writeHead(302, {
        location: pending.returnPath,
        'cache-control': 'no-store',
        'set-cookie': `${cookieName(pending.authority)}=${value}; Max-Age=${String(Math.floor((expiresAt - now) / 1000))}; Path=/; HttpOnly; SameSite=Lax`,
      })
      response.end()
    } catch {
      response.writeHead(502, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      response.end('OIDC sign-in failed. Close this tab and try again.\n')
    }
  }

  private requestOrigin(request: AuthenticationRequest): string {
    const protocol = headerValue(request, 'x-forwarded-proto') === 'https' ? 'https' : 'http'
    return `${protocol}://${authority(request)}`
  }

  private async exchange(code: string, verifier: string, redirectUri: string): Promise<{ idToken: string }> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: this.config.clientId, redirect_uri: redirectUri, code_verifier: verifier })
    if (this.config.clientSecretRef !== undefined) {
      const secret = await this.credentials.resolve(credentialRef(this.config.clientSecretRef))
      if (secret?.value === undefined) throw new Error('OIDC client secret is not configured')
      body.set('client_secret', secret.value)
    }
    const response = await fetch(this.discovery.token_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      signal: AbortSignal.timeout(this.config.requestTimeoutMs), redirect: 'error',
    })
    if (!response.ok) throw new Error(`OIDC token endpoint returned ${String(response.status)}`)
    const payload: unknown = await response.json()
    if (!isRecord(payload) || typeof payload.id_token !== 'string') throw new Error('OIDC token response has no id_token')
    return { idToken: payload.id_token }
  }
}

async function discover(issuer: string, timeoutMs: number): Promise<{ discovery: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> }> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  if (!response.ok) throw new Error(`OIDC discovery returned ${String(response.status)}`)
  const payload: unknown = await response.json()
  if (!isRecord(payload) || typeof payload.issuer !== 'string' || typeof payload.authorization_endpoint !== 'string'
    || typeof payload.token_endpoint !== 'string' || typeof payload.jwks_uri !== 'string') throw new Error('OIDC discovery response is incomplete')
  if (issuerUrl(payload.issuer) !== issuer) throw new Error('OIDC discovery issuer does not match configuration')
  for (const endpoint of [payload.authorization_endpoint, payload.token_endpoint, payload.jwks_uri]) {
    if (new URL(endpoint).protocol !== 'https:') throw new Error('OIDC discovery contains a non-HTTPS endpoint')
  }
  const discovery: Discovery = {
    issuer: payload.issuer,
    authorization_endpoint: payload.authorization_endpoint,
    token_endpoint: payload.token_endpoint,
    jwks_uri: payload.jwks_uri,
  }
  return { discovery, jwks: createRemoteJWKSet(new URL(payload.jwks_uri)) }
}

/** Cordis plugin name. */
export const name = 'authentication-oidc'
/** Services required by the OIDC provider. */
export const inject = ['authentication', 'webServer', 'credentials']

/** Register OIDC alongside the other authentication providers. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = Config(config) as Config & {
    readonly callbackPath: string
    readonly scopes: string[]
    readonly cookieMaxAgeDays: number
    readonly requestTimeoutMs: number
  }
  const issuer = issuerUrl(resolved.issuer)
  if (!resolved.callbackPath.startsWith('/') || resolved.callbackPath.includes('?') || resolved.callbackPath.includes('#')) {
  throw new Error('authentication-oidc: callbackPath must be an absolute path without query or fragment')
  }
  if (resolved.redirectUri !== undefined) {
    const redirect = new URL(resolved.redirectUri)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)
    if (!['https:', 'http:'].includes(redirect.protocol) || (redirect.protocol === 'http:' && !loopback)
      || redirect.username || redirect.password || redirect.hash || redirect.pathname !== resolved.callbackPath) {
      throw new Error('authentication-oidc: redirectUri must use HTTPS (or loopback HTTP) and match callbackPath')
    }
  }
  if (resolved.clientSecretRef !== undefined && !REF_PATTERN.test(resolved.clientSecretRef)) throw new Error('authentication-oidc: invalid clientSecretRef')
  const { discovery, jwks } = await discover(issuer, resolved.requestTimeoutMs)
  const secret = await initializeSecret(ctx.credentials)
  const authenticator = new OidcAuthenticator(discovery, jwks, secret, {
    clientId: resolved.clientId,
    callbackPath: resolved.callbackPath,
    scopes: resolved.scopes,
    cookieMaxAgeDays: resolved.cookieMaxAgeDays,
    requestTimeoutMs: resolved.requestTimeoutMs,
    ...(resolved.clientSecretRef === undefined ? {} : { clientSecretRef: resolved.clientSecretRef }),
    ...(resolved.redirectUri === undefined ? {} : { redirectUri: resolved.redirectUri }),
  }, ctx.credentials)
  const route: WebRoute = {
    kind: 'exact', path: resolved.callbackPath,
    handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) =>
      authenticator.handleCallback(request, response),
  }
  const unregister = ctx.webServer.register(route)
  const dispose = ctx.authentication.register(authenticator)
  ctx.effect(() => () => { unregister(); dispose() }, 'authentication-oidc: provider')
}

export default { name, inject, Config, apply }
