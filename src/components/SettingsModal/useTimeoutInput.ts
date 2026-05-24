import { useState } from 'react'

/**
 * Normalize a raw timeout input string to a valid positive integer.
 * Returns `fallback` for empty, non-numeric, or non-positive values.
 */
export function normalizeTimeout(input: string, fallback: number): number {
  const trimmed = input.trim()
  if (trimmed === '') return fallback
  const n = Number(trimmed)
  if (Number.isNaN(n) || n <= 0) return fallback
  return Math.trunc(n)
}

/**
 * Hook for a controlled timeout number input with blur-commit behavior.
 *
 * IMPORTANT: The `value` returned by this hook is owned here and must be
 * accessed in the same component scope so that `buildFlushedDraft`/`isDirty`
 * can read the un-blurred (un-committed) input string — preserving dirty
 * detection while the user is mid-edit.
 */
export function useTimeoutInput(
  initial: number,
  onCommit: (v: number) => void,
): { value: string; setValue: (s: string) => void; commit: () => void } {
  const [value, setValue] = useState(String(initial))

  const commit = () => {
    const normalized = normalizeTimeout(value, initial)
    setValue(String(normalized))
    onCommit(normalized)
  }

  return { value, setValue, commit }
}
