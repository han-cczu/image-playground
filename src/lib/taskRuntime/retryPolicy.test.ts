import { describe, expect, it } from 'vitest'
import { ApiHttpError } from '../api/imageApiShared'
import { computeRetryDelayMs, getRetryAfterMs, isTransientTaskError } from './retryPolicy'

describe('isTransientTaskError(D2 分类白名单)', () => {
  it('429 与 5xx 可重试', () => {
    expect(isTransientTaskError(new ApiHttpError('限流', 429))).toBe(true)
    expect(isTransientTaskError(new ApiHttpError('boom', 500))).toBe(true)
    expect(isTransientTaskError(new ApiHttpError('unavailable', 503))).toBe(true)
    expect(isTransientTaskError(new ApiHttpError('gateway', 599))).toBe(true)
  })

  it('其余 4xx 不可重试(参数错/鉴权/内容策略,重试只烧配额)', () => {
    expect(isTransientTaskError(new ApiHttpError('bad request', 400))).toBe(false)
    expect(isTransientTaskError(new ApiHttpError('unauthorized', 401))).toBe(false)
    expect(isTransientTaskError(new ApiHttpError('not found', 404))).toBe(false)
    expect(isTransientTaskError(new ApiHttpError('too large', 413))).toBe(false)
  })

  it('TypeError(fetch 网络层失败)可重试', () => {
    expect(isTransientTaskError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('结果图下载阶段降级后的普通 Error 不可重试(cause 是 TypeError 也不放行)', () => {
    // fetchImageUrlAsDataUrl 把下载阶段的 TypeError 包成普通 Error 正是为了绕开上一条分支:
    // 上游已计费出图,重跑整轮生成只会再烧配额;这里守住分类器不会顺着 cause 链把它翻回瞬时错误。
    expect(
      isTransientTaskError(
        new Error('图片 URL 下载失败：网络或跨域错误', { cause: new TypeError('Failed to fetch') }),
      ),
    ).toBe(false)
  })

  it('AbortError(用户取消)绝不重试', () => {
    expect(isTransientTaskError(new DOMException('aborted', 'AbortError'))).toBe(false)
  })

  it('watchdog 超时标记优先:即便底层是 AbortError 也判可重试', () => {
    expect(isTransientTaskError(new DOMException('aborted', 'AbortError'), true)).toBe(true)
  })

  it('业务错误(普通 Error)不可重试', () => {
    expect(isTransientTaskError(new Error('接口未返回图片数据'))).toBe(false)
    expect(isTransientTaskError('字符串错误')).toBe(false)
    expect(isTransientTaskError(undefined)).toBe(false)
  })
})

describe('computeRetryDelayMs(D5 退避曲线)', () => {
  // random=0.5 → jitter=1.0,曲线裸值可断言
  const noJitter = () => 0.5

  it('指数曲线 2s → 8s → 封顶 30s', () => {
    expect(computeRetryDelayMs(1, undefined, noJitter)).toBe(2_000)
    expect(computeRetryDelayMs(2, undefined, noJitter)).toBe(8_000)
    expect(computeRetryDelayMs(3, undefined, noJitter)).toBe(30_000)
  })

  it('jitter 在 0.5~1.5 之间缩放', () => {
    expect(computeRetryDelayMs(1, undefined, () => 0)).toBe(1_000)
    expect(computeRetryDelayMs(1, undefined, () => 1)).toBe(3_000)
  })

  it('Retry-After 更大时以服务端为准,更小时不缩短退避', () => {
    expect(computeRetryDelayMs(1, 10_000, noJitter)).toBe(10_000)
    expect(computeRetryDelayMs(2, 1_000, noJitter)).toBe(8_000)
  })
})

describe('getRetryAfterMs', () => {
  it('仅从 ApiHttpError 提取', () => {
    expect(getRetryAfterMs(new ApiHttpError('限流', 429, 7_000))).toBe(7_000)
    expect(getRetryAfterMs(new ApiHttpError('限流', 429))).toBeUndefined()
    expect(getRetryAfterMs(new Error('x'))).toBeUndefined()
  })
})
