import { describe, it, expect } from 'vitest'
import { normalizeTimeout } from './timeout'

describe('normalizeTimeout', () => {
  const fallback = 60

  it('returns fallback for empty string', () => {
    expect(normalizeTimeout('', fallback)).toBe(fallback)
  })

  it('returns fallback for whitespace-only string', () => {
    expect(normalizeTimeout('   ', fallback)).toBe(fallback)
  })

  it('returns fallback for non-numeric string', () => {
    expect(normalizeTimeout('abc', fallback)).toBe(fallback)
  })

  it('returns fallback for zero', () => {
    expect(normalizeTimeout('0', fallback)).toBe(fallback)
  })

  it('returns fallback for negative number', () => {
    expect(normalizeTimeout('-5', fallback)).toBe(fallback)
  })

  it('returns 30 for "30"', () => {
    expect(normalizeTimeout('30', fallback)).toBe(30)
  })

  it('returns 45 for " 45 " (trims whitespace)', () => {
    expect(normalizeTimeout(' 45 ', fallback)).toBe(45)
  })

  it('preserves decimal (no truncation)', () => {
    expect(normalizeTimeout('30.9', fallback)).toBe(30.9)
  })
})
