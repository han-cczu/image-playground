/**
 * 创作血缘:基于内容寻址 id 的集合求交，读时推断任务间的「派生自 / 衍生出」关系。
 *
 * 不依赖任何持久化字段——`inputImageIds`/`outputImages` 是 SHA-256 内容寻址 id，
 * 共享的图 id 本身就是父子之间的边。对全部历史数据立即生效。
 */

import type { TaskRecord } from '../types'

export interface LineageLink {
  task: TaskRecord
  /** 连接两个 task 的共享图 id（取自当前 task 的 input 或 output），用作缩略图与跳转锚点 */
  sharedImageIds: string[]
}

function byCreatedAtAsc(a: LineageLink, b: LineageLink): number {
  return a.task.createdAt - b.task.createdAt
}

/** 当前 task 的输入图由哪些其它 task 生成 → 父任务（其 outputImages ∩ 本 inputImageIds 非空）。按 createdAt 升序。 */
export function findParentTasks(task: TaskRecord, allTasks: TaskRecord[]): LineageLink[] {
  const inputSet = new Set(task.inputImageIds ?? [])
  if (inputSet.size === 0) return []
  const links: LineageLink[] = []
  for (const candidate of allTasks) {
    if (candidate.id === task.id) continue
    const shared = (candidate.outputImages ?? []).filter((id) => inputSet.has(id))
    if (shared.length) links.push({ task: candidate, sharedImageIds: shared })
  }
  return links.sort(byCreatedAtAsc)
}

/** 当前 task 的输出图被哪些其它 task 当作输入 → 子任务（其 inputImageIds ∩ 本 outputImages 非空）。按 createdAt 升序。 */
export function findChildTasks(task: TaskRecord, allTasks: TaskRecord[]): LineageLink[] {
  const outputSet = new Set(task.outputImages ?? [])
  if (outputSet.size === 0) return []
  const links: LineageLink[] = []
  for (const candidate of allTasks) {
    if (candidate.id === task.id) continue
    const shared = (candidate.inputImageIds ?? []).filter((id) => outputSet.has(id))
    if (shared.length) links.push({ task: candidate, sharedImageIds: shared })
  }
  return links.sort(byCreatedAtAsc)
}
