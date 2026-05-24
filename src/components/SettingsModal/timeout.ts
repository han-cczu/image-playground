/**
 * Normalize a raw timeout input string to a valid positive number.
 * Returns `fallback` for empty, non-numeric, or non-positive values.
 */
export function normalizeTimeout(input: string, fallback: number): number {
  const trimmed = input.trim()
  const n = Number(trimmed)
  if (trimmed === '' || Number.isNaN(n) || n <= 0) return fallback
  return n // raw value, matches the original optimizer blur (no Math.trunc)
}
