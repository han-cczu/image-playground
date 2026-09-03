/**
 * 本标签页「已改内存、尚未落盘」的变更总账,供跨标签页 IndexedDB 刷新(idbSync)判定哪些记录以本地为准。
 *
 * 为什么需要:所有乐观写都是「先 setState 再 await putTask/deleteTask」。另一标签页每次写库都会让本页
 * 全量重读快照并整体替换 store——若快照恰好读在本页落盘之前,本页刚写成 done 的任务被打回 running
 *(没有 watchdog 永远转圈,再点取消会用这份陈旧记录覆写库里真实的 done,输出图沦为孤儿被 GC),
 * 刚删的记录借快照复活,刚建的对话消失并把 activeConversationId 挤走。
 * 登记按引用计数:同一 id 可能并发多次写(完成落 done 与用户改收藏几乎同时),任一在途即视为 pending。
 * 每个 mark 必须配 finally clear,漏清会让该 id 永远无视别的标签页的合法修改。
 */
const pendingTaskWrites = new Map<string, number>()
const pendingTaskDeletes = new Map<string, number>()
const pendingConversationWrites = new Map<string, number>()
const pendingConversationDeletes = new Map<string, number>()

function bump(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1)
}

function drop(map: Map<string, number>, id: string): void {
  const count = map.get(id) ?? 0
  if (count <= 1) map.delete(id)
  else map.set(id, count - 1)
}

export function markPendingIndexedDbTaskWrite(taskId: string): void {
  bump(pendingTaskWrites, taskId)
}

export function clearPendingIndexedDbTaskWrite(taskId: string): void {
  drop(pendingTaskWrites, taskId)
}

export function isPendingIndexedDbTaskWrite(taskId: string): boolean {
  return pendingTaskWrites.has(taskId)
}

export function markPendingIndexedDbTaskDelete(taskId: string): void {
  bump(pendingTaskDeletes, taskId)
}

export function clearPendingIndexedDbTaskDelete(taskId: string): void {
  drop(pendingTaskDeletes, taskId)
}

export function isPendingIndexedDbTaskDelete(taskId: string): boolean {
  return pendingTaskDeletes.has(taskId)
}

export function markPendingIndexedDbConversationWrite(conversationId: string): void {
  bump(pendingConversationWrites, conversationId)
}

export function clearPendingIndexedDbConversationWrite(conversationId: string): void {
  drop(pendingConversationWrites, conversationId)
}

export function isPendingIndexedDbConversationWrite(conversationId: string): boolean {
  return pendingConversationWrites.has(conversationId)
}

export function markPendingIndexedDbConversationDelete(conversationId: string): void {
  bump(pendingConversationDeletes, conversationId)
}

export function clearPendingIndexedDbConversationDelete(conversationId: string): void {
  drop(pendingConversationDeletes, conversationId)
}

export function isPendingIndexedDbConversationDelete(conversationId: string): boolean {
  return pendingConversationDeletes.has(conversationId)
}

/** 仅测试用 */
export function resetIndexedDbSyncStateForTest(): void {
  pendingTaskWrites.clear()
  pendingTaskDeletes.clear()
  pendingConversationWrites.clear()
  pendingConversationDeletes.clear()
}
