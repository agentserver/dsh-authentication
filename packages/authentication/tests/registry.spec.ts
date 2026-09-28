import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AuthenticationService, { type AuthenticationDecision, type AuthenticationProvider, type AuthenticationResult } from '../src/index.ts'

function provider(id: string, priority: number, decision: AuthenticationDecision, result: AuthenticationResult = { kind: 'anonymous' }): AuthenticationProvider {
  return {
    id,
    priority,
    authenticate: () => result,
    start: (_request, _response) => decision,
    authenticatedUrl: (baseUrl) => `${baseUrl}?provider=${id}`,
  }
}

describe('AuthenticationService', () => {
  it('selects the highest-priority login URL and resolves provider principals', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AuthenticationService, { defaultProvider: 'high' })
    try {
      ctx.authentication.register(provider('low', 1, 'decline'))
      ctx.authentication.register(provider('high', 10, 'decline', { kind: 'authenticated', principal: { provider: 'high' } }))
      expect(ctx.authentication.authenticatedUrl('http://dsh.test/', 'high')).toBe('http://dsh.test/?provider=high')
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
    const fiber = await ctx.plugin(AuthenticationService, { defaultProvider: 'login' })
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
      expect(() => ctx.authentication.register(provider('same', 1, 'decline'))).toThrow(/duplicate provider/)
    } finally {
      await fiber.dispose()
    }
  })

  it('waits for remote verification and refuses conflicting identities', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AuthenticationService)
    try {
      let release!: () => void
      const ready = new Promise<void>(resolve => { release = resolve })
      ctx.authentication.register({
        ...provider('slow', 10, 'decline'),
        authenticate: async () => {
          await ready
          return { kind: 'authenticated', principal: { provider: 'slow', subject: 'one' } }
        },
      })
      const pending = ctx.authentication.authenticate({ headers: {} })
      let settled = false
      void pending.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)
      release()
      await expect(pending).resolves.toEqual({
        kind: 'authenticated',
        principal: { provider: 'slow', subject: 'one' },
      })
      ctx.authentication.register({
        ...provider('second', 0, 'decline'),
        authenticate: () => ({ kind: 'authenticated', principal: { provider: 'second', subject: 'two' } }),
      })
      await expect(ctx.authentication.authenticate({ headers: {} })).resolves.toEqual({ kind: 'rejected', status: 401 })
    } finally {
      await fiber.dispose()
    }
  })

  it('turns an explicit provider rejection into an index response without starting a login flow', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AuthenticationService)
    const response = { status: undefined as number | undefined, body: undefined as string | undefined,
      writeHead(status: number) { response.status = status }, end(body?: string) { response.body = body } }
    try {
      let started = false
      ctx.authentication.register({
        ...provider('rejecting', 1, 'handled', { kind: 'rejected', status: 403 }),
        start: () => { started = true; return 'handled' },
      })
      await expect(ctx.authentication.authorizeIndex({ method: 'GET', url: '/', headers: {} }, response)).resolves.toBe(false)
      expect(response.status).toBe(403)
      expect(started).toBe(false)
    } finally {
      await fiber.dispose()
    }
  })
})
