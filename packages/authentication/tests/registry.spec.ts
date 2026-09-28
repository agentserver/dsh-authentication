import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AuthenticationService, { type AuthenticationProvider } from '../src/index.ts'

function provider(id: string, priority: number, decision: 'allow' | 'handled' | 'decline'): AuthenticationProvider {
  return {
    id,
    priority,
    authenticate: () => decision === 'allow'
      ? { kind: 'authenticated', principal: { provider: id } }
      : { kind: 'anonymous' },
    start: (_request, _response) => decision,
    authenticatedUrl: (baseUrl) => `${baseUrl}?provider=${id}`,
    principal: () => decision === 'allow' ? { provider: id } : undefined,
  }
}

describe('AuthenticationService', () => {
  it('selects the highest-priority login URL and resolves provider principals', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AuthenticationService)
    try {
      ctx.authentication.register(provider('low', 1, 'decline'))
      ctx.authentication.register(provider('high', 10, 'allow'))
      expect(ctx.authentication.authenticatedUrl('http://dsh.test/')).toBe('http://dsh.test/?provider=high')
      await expect(ctx.authentication.authenticate({ headers: {} })).resolves.toEqual({
        kind: 'authenticated',
        principal: { provider: 'high' },
      })
    } finally {
      await fiber.dispose()
    }
  })

  it('lets a provider handle an index response and removes it through its disposer', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AuthenticationService)
    const response = { status: undefined as number | undefined, body: undefined as string | undefined,
      writeHead(status: number) { response.status = status }, end(body?: string) { response.body = body } }
    try {
      const dispose = ctx.authentication.register(provider('login', 1, 'handled'))
      await expect(ctx.authentication.authorizeIndex({ method: 'GET', url: '/', headers: {} }, response)).resolves.toBe(false)
      expect(response.status).toBeUndefined()
      dispose()
      await expect(ctx.authentication.authorizeIndex({ method: 'GET', url: '/', headers: {} }, response)).resolves.toBe(false)
      expect(response.status).toBe(401)
      expect(response.body).toContain('authentication required')
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects duplicate provider ids', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AuthenticationService)
    try {
      ctx.authentication.register(provider('same', 0, 'decline'))
      expect(() => ctx.authentication.register(provider('same', 1, 'allow'))).toThrow(/already registered/)
    } finally {
      await fiber.dispose()
    }
  })
})
