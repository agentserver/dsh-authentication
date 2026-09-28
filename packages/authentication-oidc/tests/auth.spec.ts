import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { OidcAuthenticator } from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-credentials', () => ({
  credentialKey: (scope: string, id: string) => `${scope}/${id}`,
  credentialRef: (value: string) => value,
}))

interface ResponseState {
  status: number | undefined
  headers: Readonly<Record<string, string>> | undefined
  body: string | undefined
}

type ResponseRecorder = ResponseState & {
  writeHead: (status: number, headers?: Readonly<Record<string, string>>) => void
  end: (body?: string) => void
}

function response(): { readonly value: ResponseRecorder } {
  const value: ResponseRecorder = {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status: number, headers?: Readonly<Record<string, string>>): void { value.status = status; value.headers = headers },
    end(body?: string): void { value.body = body },
  }
  return { value }
}

function request(url: string, headers: Record<string, string> = {}): { method: string; url: string; headers: Record<string, string> } {
  return { method: 'GET', url, headers }
}

describe('OidcAuthenticator', () => {
  it('redirects an unauthenticated index request to Authorization Code + PKCE', () => {
    const auth = new OidcAuthenticator(
      {
        issuer: 'https://issuer.example',
        authorization_endpoint: 'https://issuer.example/authorize',
        token_endpoint: 'https://issuer.example/token',
        jwks_uri: 'https://issuer.example/jwks',
      },
      createRemoteJWKSet(new URL('https://issuer.example/jwks')),
      Buffer.alloc(32, 1),
      { clientId: 'dsh', callbackPath: '/oidc/callback', scopes: ['openid'], cookieMaxAgeDays: 30, requestTimeoutMs: 1000 },
      {} as never,
    )
    const output = response()
    auth.start(request('/', { host: '127.0.0.1:3080' }), output.value)
    expect(output.value.status).toBe(302)
    const location = new URL(output.value.headers?.location ?? '')
    expect(location.origin).toBe('https://issuer.example')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('exchanges a callback code, verifies the ID token, and mints a cookie', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    let expectedNonce = ''
    const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.url === '/jwks') {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'test', alg: 'RS256', use: 'sig' }] })); return
      }
      if (req.url === '/token') {
        const idToken = await new SignJWT({ nonce: expectedNonce, sub: 'user-1' }).setProtectedHeader({ alg: 'RS256', kid: 'test' })
          .setIssuer('https://issuer.example').setAudience('dsh').setIssuedAt().setExpirationTime('5m').sign(privateKey)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id_token: idToken })); return
      }
      res.statusCode = 404; res.end()
    }
    const server = createServer((req, res) => { void handle(req, res) }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const auth = new OidcAuthenticator(
      {
        issuer: 'https://issuer.example',
        authorization_endpoint: 'https://issuer.example/authorize',
        token_endpoint: `http://127.0.0.1:${String(port)}/token`,
        jwks_uri: `http://127.0.0.1:${String(port)}/jwks`,
      },
      createRemoteJWKSet(new URL(`http://127.0.0.1:${String(port)}/jwks`)),
      Buffer.alloc(32, 2),
      { clientId: 'dsh', callbackPath: '/oidc/callback', scopes: ['openid'], cookieMaxAgeDays: 30, requestTimeoutMs: 5000, redirectUri: `http://127.0.0.1:${String(port)}/oidc/callback` },
      {} as never,
    )
    try {
      const start = response()
      auth.start(request('/', { host: `127.0.0.1:${String(port)}` }), start.value)
      const authorization = new URL(start.value.headers?.location ?? '')
      expectedNonce = authorization.searchParams.get('nonce') ?? ''
      const callback = response()
      await auth.handleCallback(request(`/oidc/callback?state=${encodeURIComponent(authorization.searchParams.get('state') ?? '')}&code=abc`, { host: `127.0.0.1:${String(port)}` }), callback.value)
      expect(callback.value.status).toBe(302)
      expect(callback.value.headers?.['set-cookie']).toContain('dsh-auth-oidc-')
      expect(auth.authenticate({ headers: { host: `127.0.0.1:${String(port)}`, cookie: callback.value.headers?.['set-cookie'] ?? '' } })).toMatchObject({
        kind: 'authenticated',
        principal: { provider: 'oidc', subject: 'user-1' },
      })
    } finally {
      server.close()
      await once(server, 'close')
    }
  })
})
