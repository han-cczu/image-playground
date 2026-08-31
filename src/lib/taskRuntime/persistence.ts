/**
 * 任务/图片的持久化写入与回滚原语(taskRuntime 拆分轮,见 shared.ts 头注释)。
 * updateTaskInStore 是唯一「内存 + IDB 双写」入口;*Silently 变体供 fire-and-forget
 * 调用方使用(内部已 toast + 标 persistenceError 并吞错,避免逃逸成未捕获 rejection)。
 */
import type { TaskRecord } from '../../types'
import { useStore } from '../../store'
import { putTask, deleteImage } from '../db'
import { deleteCachedImage } from '../imageCache'
import { collectReferencedImageIds } from '../storageStats'

/**
 * 回滚一组刚 storeImage 的图片(成对删 DB + 内存缓存),但只删当前没有任何 task / inputImage 引用的,
 * 避免误删内容寻址去重命中的在用图。供 executeTask 写图后早退、蒙版保存竞态复用。
 */
export async function rollbackStoredImages(imageIds: string[]): Promise<void> {
  if (!imageIds.length) return
  const { tasks, inputImages } = useStore.getState()
  const stillUsed = collectReferencedImageIds(tasks, inputImages)
  for (const id of imageIds) {
    if (!stillUsed.has(id)) {
      await deleteImage(id)
      deleteCachedImage(id)
    }
  }
}

export async function rollbackStoredImagesSilently(imageIds: string[]): Promise<void> {
  try {
    await rollbackStoredImages(imageIds)
  } catch (err) {
    useStore
      .getState()
      .showToast(`清理临时图片失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

export function updateTaskInStoreSilently(taskId: string, patch: Partial<TaskRecord>) {
  void updateTaskInStore(taskId, patch).catch(() => {
    /* updateTaskInStore already surfaced the persistence error */
  })
}

export async function persistTaskSilently(task: TaskRecord) {
  try {
    await putTask(task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(
      state.tasks.map((item) =>
        item.id === task.id ? { ...item, persistenceError: message } : item,
      ),
    )
    state.showToast(`保存任务失败：${message}`, 'error')
  }
}

export async function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>): Promise<void> {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
  setTasks(updated)
  const task = updated.find((t) => t.id === taskId)
  if (!task) return

  try {
    await putTask(task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const state = useStore.getState()
    state.setTasks(
      state.tasks.map((item) =>
        item.id === taskId ? { ...item, persistenceError: message } : item,
      ),
    )
    state.showToast(`保存任务失败：${message}`, 'error')
    throw err
  }
}
