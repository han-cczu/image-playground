import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relativeTime'

const NOW = new Date('2026-05-21T12:00:00Z').getTime()

describe('formatRelativeTime', () => {
  it('returns 刚刚 when within 30 seconds', () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe('刚刚')
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('刚刚')
  })

  it('returns minute-level relative for less than 1 hour', () => {
    const out = formatRelativeTime(NOW - 5 * 60_000, NOW)
    expect(out).toMatch(/分钟/)
  })

  it('returns hour-level relative for less than 1 day', () => {
    const out = formatRelativeTime(NOW - 3 * 3_600_000, NOW)
    expect(out).toMatch(/小时|h/i)
  })

  it('returns absolute date for older than 30 days', () => {
    const out = formatRelativeTime(NOW - 60 * 86_400_000, NOW)
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
