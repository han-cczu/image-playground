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
 * - rejectNonPositive 为 true 时,0/负数也回退(优化器/图说器语义);
 * - API 配置历史行为放行 0/负数,故默认不拦截,保持行为不变。
 */
export function normalizeTimeoutInput(
  input: string,
  fallback: number,
  options: { rejectNonPositive?: boolean } = {},
): number {
  const trimmed = input.trim()
  const value = Number(trimmed)
  if (trimmed === '' || Number.isNaN(value)) return fallback
  if (options.rejectNonPositive && value <= 0) return fallback
  return value
}
