/**
 * 瞬时失败自动重试的判定与退避纯函数(spec: docs/superpowers/specs/2026-08-31-auto-retry-design.md)。
 * 纯函数先行:不触 store/网络,注入 random 便于单测。
 */
import { ApiHttpError } from '../api/imageApiShared'

const BASE_DELAY_MS = 2_000
const MAX_DELAY_MS = 30_000

/**
 * 分类白名单(D2,宁可漏重试不可误重试):
 * - watchdog 超时标记 → 重试(标记优先:此时底层错误是 abort 出来的 AbortError);
 * - AbortError(用户取消/删除)→ 绝不重试;
 * - ApiHttpError 429 / 5xx → 重试;其余 4xx(参数错/鉴权/内容策略)→ 不重试;
 * - TypeError → 重试(fetch 网络层失败的标准形态:DNS/断网/连接被拒);
 * - 其余业务错误(「接口未返回图片数据」「Gemini 安全拦截」等)→ 不重试,重试只会烧配额。
 */
export function isTransientTaskError(err: unknown, hasTimeoutRetryFlag = false): boolean {
  if (hasTimeoutRetryFlag) return true
  if (err instanceof DOMException && err.name === 'AbortError') return false
  if (err instanceof ApiHttpError) return err.status === 429 || err.status >= 500
  if (err instanceof TypeError) return true
  return false
}

/** 从错误中取 Retry-After(仅 ApiHttpError 携带)。 */
export function getRetryAfterMs(err: unknown): number | undefined {
  return err instanceof ApiHttpError ? err.retryAfterMs : undefined
}

/**
 * 第 attempt 次重试(从 1 起)的退避延迟:min(2s × 4^(attempt-1), 30s) × jitter(0.5~1.5),
 * 即约 2s / 8s / 30s 三档;服务端给了 Retry-After 时取两者较大值(尊重服务端配额窗口)。
 */
export function computeRetryDelayMs(
  attempt: number,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(BASE_DELAY_MS * Math.pow(4, Math.max(0, attempt - 1)), MAX_DELAY_MS)
  const jitter = 0.5 + random()
  const computed = Math.round(exponential * jitter)
  return retryAfterMs !== undefined ? Math.max(computed, retryAfterMs) : computed
}
