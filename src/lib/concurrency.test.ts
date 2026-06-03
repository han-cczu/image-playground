import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency'

/** 受控延迟：用微任务队列推进，避免依赖真实计时器。 */
function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('mapWithConcurrency', () => {
  it('executes every item and preserves input order in results', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10)
    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
      { status: 'fulfilled', value: 40 },
    ])
  })

  it('never exceeds the concurrency limit of in-flight tasks', async () => {
    const limit = 3
    let inFlight = 0
    let peak = 0
    const gates = Array.from({ length: 10 }, () => defer())

    const run = mapWithConcurrency(gates, limit, async (gate) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await gate.promise
      inFlight--
    })

    // 逐个放行，期间峰值并发不得超过 limit。
    for (const gate of gates) {
      await Promise.resolve() // 让已启动的 worker 跑到 await
      gate.resolve()
    }
    await run
    expect(peak).toBeLessThanOrEqual(limit)
    expect(peak).toBeGreaterThan(0)
  })

  it('does not let a single rejection abort the rest', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 3, async (n) => n)).toEqual([])
  })

  it('handles limit greater than item count', async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (n) => n)
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2])
  })
})
