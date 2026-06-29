const pendingTaskWriteIds = new Set<string>()

export function markPendingIndexedDbTaskWrite(taskId: string): void {
  pendingTaskWriteIds.add(taskId)
}

export function clearPendingIndexedDbTaskWrite(taskId: string): void {
  pendingTaskWriteIds.delete(taskId)
}

export function isPendingIndexedDbTaskWrite(taskId: string): boolean {
  return pendingTaskWriteIds.has(taskId)
}
