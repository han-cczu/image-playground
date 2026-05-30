// 任务排序相关的纯逻辑(无副作用、无外部依赖),便于单测复用。

/** 首/尾插入与整数重排的步长(大步长降低 gap 排序浮点精度坍缩) */
export const SORT_STEP = 65536
/** 中点与相邻 sortOrder 之差小于此值时视为精度逼近,触发整数重排自愈 */
export const SORT_EPSILON = 1e-6

/**
 * 计算把 taskId 移到 prevTaskId 之后 / nextTaskId 之前后,对全量任务整数化的新 sortOrder。
 * 降序语义:显示越靠前 sortOrder 越大。`orderedIds` 为当前显示顺序(降序)的全部任务 id。
 * 返回 id→新 sortOrder 的映射(均为正、互异、按 SORT_STEP 均匀间隔)。
 */
export function computeReorderedSortOrders(
  orderedIds: string[],
  taskId: string,
  prevTaskId: string | null,
  nextTaskId: string | null,
): Map<string, number> {
  const without = orderedIds.filter((id) => id !== taskId)
  let insertAt = without.length
  if (nextTaskId && without.includes(nextTaskId)) {
    insertAt = without.indexOf(nextTaskId)
  } else if (prevTaskId && without.includes(prevTaskId)) {
    insertAt = without.indexOf(prevTaskId) + 1
  }
  const finalIds = [...without.slice(0, insertAt), taskId, ...without.slice(insertAt)]
  const orders = new Map<string, number>()
  finalIds.forEach((id, index) => orders.set(id, (finalIds.length - index) * SORT_STEP))
  return orders
}
