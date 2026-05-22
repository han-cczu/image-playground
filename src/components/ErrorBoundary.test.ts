import { describe, expect, it } from 'vitest'
import { computeRetryState, hashString } from './ErrorBoundary'

describe('hashString', () => {
  it('produces a stable 6-character base36 id for a given input', () => {
    const a = hashString('TypeError: x is not a function')
    const b = hashString('TypeError: x is not a function')
    expect(a).toBe(b)
    expect(a).toHaveLength(6)
    expect(a).toMatch(/^[0-9a-z]{6}$/)
  })

  it('produces different ids for different inputs (basic distribution)', () => {
    const a = hashString('foo')
    const b = hashString('bar')
    const c = hashString('foo ')
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('handles empty input without throwing', () => {
    expect(hashString('')).toHaveLength(6)
  })
})

describe('computeRetryState', () => {
  it('retry moves into pending without bumping the failure count', () => {
    const next = computeRetryState(
      { retryFailedCount: 0, retryPending: false },
      { type: 'retry' },
    )
    expect(next).toEqual({ retryFailedCount: 0, retryPending: true })
  })

  it('an error during a pending retry increments retryFailedCount', () => {
    const next = computeRetryState(
      { retryFailedCount: 1, retryPending: true },
      { type: 'errorDuringRetry' },
    )
    expect(next).toEqual({ retryFailedCount: 2, retryPending: true })
  })

  it('a fresh error (no pending retry) does not bump retryFailedCount', () => {
    const next = computeRetryState(
      { retryFailedCount: 0, retryPending: false },
      { type: 'errorFresh' },
    )
    expect(next).toEqual({ retryFailedCount: 0, retryPending: false })
  })

  it('reaching MAX_RETRY_FAILED through sequential retry+error cycles disables retry', () => {
    let state = { retryFailedCount: 0, retryPending: false }

    // First error
    state = computeRetryState(state, { type: 'errorFresh' })
    expect(state.retryFailedCount).toBe(0)

    // Retry -> error  (1st failed retry)
    state = computeRetryState(state, { type: 'retry' })
    state = computeRetryState(state, { type: 'errorDuringRetry' })
    expect(state.retryFailedCount).toBe(1)

    // Retry -> error  (2nd)
    state = computeRetryState(state, { type: 'retry' })
    state = computeRetryState(state, { type: 'errorDuringRetry' })
    expect(state.retryFailedCount).toBe(2)

    // Retry -> error  (3rd) -> button should be disabled (>= 3)
    state = computeRetryState(state, { type: 'retry' })
    state = computeRetryState(state, { type: 'errorDuringRetry' })
    expect(state.retryFailedCount).toBe(3)
    expect(state.retryFailedCount >= 3).toBe(true)
  })

  it('recoverConfirmed resets both pending and failure count', () => {
    const next = computeRetryState(
      { retryFailedCount: 2, retryPending: true },
      { type: 'recoverConfirmed' },
    )
    expect(next).toEqual({ retryFailedCount: 0, retryPending: false })
  })
})
