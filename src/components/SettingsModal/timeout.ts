/**
 * Normalize a raw timeout input string to a valid positive number.
 * Returns `fallback` for empty, non-numeric, or non-positive values.
 */
export function normalizeTimeout(input: string, fallback: number): number {
  // raw value, matches the original optimizer blur (no Math.trunc)
  return normalizeTimeoutInput(input, fallback, { rejectNonPositive: true })
}

/**
 * buildFlushedDraft / 失焦提交共用的 timeout 输入 normalize 纯函数:
 * - 空串或非数字一律回退 fallback;
 * - 默认拒绝 0/负数,避免请求层 setTimeout(..., timeout * 1000) 立即触发超时;
 * - 极少数调用方若确实要保留非正数,可显式传 allowNonPositive。
 */
export function normalizeTimeoutInput(
  input: string,
  fallback: number,
  options: { rejectNonPositive?: boolean; allowNonPositive?: boolean } = {},
): number {
  const trimmed = input.trim()
  const value = Number(trimmed)
  if (trimmed === '' || !Number.isFinite(value)) return fallback
  if (!options.allowNonPositive && value <= 0) return fallback
  if (options.rejectNonPositive && value <= 0) return fallback
  return value
}
