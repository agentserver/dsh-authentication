import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AuthenticationService, { type AuthenticationProvider } from '../src/index.ts'

function provider(id: string, priority: number, decision: 'allow' | 'handled' | 'decline'): AuthenticationProvider {
  return {
    id,
    priority,
    authorizeIndex: (_request, _response) => decision,
    isAuthenticated: () => decision === 'allow',
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
      expect(ctx.authentication.isAuthenticated({ headers: {} })).toBe(true)
      expect(ctx.authentication.principal({ headers: {} })).toEqual({ provider: 'high' })
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
      expect(ctx.authentication.authorizeIndex({ method: 'GET', url: '/', headers: {} }, response)).toBe(false)
      expect(response.status).toBeUndefined()
      dispose()
      expect(ctx.authentication.authorizeIndex({ method: 'GET', url: '/', headers: {} }, response)).toBe(false)
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
