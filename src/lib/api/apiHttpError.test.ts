import { describe, expect, it } from 'vitest'
import { ApiHttpError, createApiHttpError, parseRetryAfterMs } from './imageApiShared'

describe('parseRetryAfterMs', () => {
  it('非负秒数 → 毫秒并 clamp 到 [1s, 60s]', () => {
    expect(parseRetryAfterMs('5')).toBe(5_000)
    expect(parseRetryAfterMs('0')).toBe(1_000)
    expect(parseRetryAfterMs('120')).toBe(60_000)
  })

  it('负数/垃圾串/空值 → undefined(视作无头)', () => {
    expect(parseRetryAfterMs('-3')).toBeUndefined()
    expect(parseRetryAfterMs('soon')).toBeUndefined()
    expect(parseRetryAfterMs('  ')).toBeUndefined()
    expect(parseRetryAfterMs(null)).toBeUndefined()
  })

  it('HTTP 日期 → 相对现在的差值,过去的日期 clamp 到下限', () => {
    const now = Date.parse('2026-08-31T12:00:00Z')
    expect(parseRetryAfterMs('Mon, 31 Aug 2026 12:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfterMs('Mon, 31 Aug 2026 11:00:00 GMT', now)).toBe(1_000)
  })
})

describe('createApiHttpError', () => {
  it('保留 status 与 Retry-After,message 提炼行为与 getApiErrorMessage 一致', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'Retry-After': '7' },
    })
    const err = await createApiHttpError(response)
    expect(err).toBeInstanceOf(ApiHttpError)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(7_000)
    expect(err.message).toBe('rate limited')
  })

  it('无 headers 的极简响应 stub 不炸(status 兜底可用)', async () => {
    const response = { status: 500, body: null } as unknown as Response
    const err = await createApiHttpError(response)
    expect(err.status).toBe(500)
    expect(err.retryAfterMs).toBeUndefined()
    expect(err.message).toBe('HTTP 500')
  })
})
