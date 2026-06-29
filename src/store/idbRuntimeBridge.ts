import type { TaskRecord } from '../types'

let terminateRunningTasks: ((tasks: TaskRecord[]) => void) | null = null

export function registerIndexedDbSyncRuntimeTerminator(
  terminator: (tasks: TaskRecord[]) => void,
): void {
  terminateRunningTasks = terminator
}

export function terminateIndexedDbSyncRunningTasks(tasks: TaskRecord[]): void {
  terminateRunningTasks?.(tasks)
}
