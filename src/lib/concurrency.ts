/**
 * 以并发上限 `limit` 对 `items` 逐个执行 `fn`，返回与 `items` **同序**的 settled 结果数组。
 *
 * 语义保证：
 * - 任意时刻在执行（in-flight）的任务数 ≤ `limit`（固定大小 worker 池滑动消费）。
 * - 全部 item 最终都会被执行。
 * - 单个 `fn` reject **不中断**其余任务，其结果记为 `{ status: 'rejected', reason }`。
 *
 * 纯调度工具，不依赖任何全局态。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  // worker 数取 min(limit, item 数)，至少 1（item 为空时该 worker 立即返回）。
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
