/**
 * 任务记录的删除 / 收藏 / 排序等落库变更(taskRuntime 拆分轮,见 shared.ts 头注释)。
 */
import type { TaskRecord } from '../../types'
import { useStore } from '../../store'
import { deleteTask as dbDeleteTask, deleteImage } from '../db'
import { deleteCachedImage } from '../imageCache'
import { collectReferencedImageIds } from '../storageStats'
import { SORT_STEP, SORT_EPSILON, computeReorderedSortOrders } from '../taskSort'
import { terminateTaskRuntime } from './shared'
import { createCancelledTask } from './cancel'
import { persistTaskSilently, updateTaskInStore, updateTaskInStoreSilently } from './persistence'

function getTaskImageIds(task: TaskRecord): string[] {
  return [
    ...(task.inputImageIds || []),
    ...(task.maskTargetImageId ? [task.maskTargetImageId] : []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ]
}

/**
 * 删除任务后同步清理瞬态 UI 引用。否则任务/图片已从 store 移除,但 selection、detail、
 * compare 或 lightbox 仍指向旧 id,会让后续操作命中不可见任务,甚至出现空预览却锁 body 滚动。
 */
export function clearTransientUiReferencesForDeletedTasks(deletedTasks: TaskRecord[]): void {
  if (!deletedTasks.length) return

  const deletedTaskIds = new Set(deletedTasks.map((task) => task.id))
  const deletedImageIds = new Set<string>()
  for (const task of deletedTasks) {
    for (const imageId of getTaskImageIds(task)) deletedImageIds.add(imageId)
  }

  useStore.setState((state) => {
    const selectedTaskIds = state.selectedTaskIds.filter((id) => !deletedTaskIds.has(id))
    const nextCompareTaskIds = state.compareTaskIds?.filter((id) => !deletedTaskIds.has(id)) ?? null
    const compareTaskIds =
      nextCompareTaskIds && nextCompareTaskIds.length >= 2 ? nextCompareTaskIds : null
    const stillUsedImageIds = collectReferencedImageIds(state.tasks, state.inputImages)
    const orphanedImageIds = new Set(
      [...deletedImageIds].filter((imageId) => !stillUsedImageIds.has(imageId)),
    )
    const lightboxImageList = state.lightboxImageList.filter((id) => !orphanedImageIds.has(id))
    const nextCaptionBatchImageIds =
      state.captionBatchImageIds?.filter((id) => !orphanedImageIds.has(id)) ?? null
    const clearLightbox = state.lightboxImageId
      ? orphanedImageIds.has(state.lightboxImageId)
      : false
    const maskDraft =
      state.maskDraft && orphanedImageIds.has(state.maskDraft.targetImageId)
        ? null
        : state.maskDraft

    return {
      selectedTaskIds,
      detailTaskId:
        state.detailTaskId && deletedTaskIds.has(state.detailTaskId) ? null : state.detailTaskId,
      lineageTaskId:
        state.lineageTaskId && deletedTaskIds.has(state.lineageTaskId) ? null : state.lineageTaskId,
      compareTaskIds,
      lightboxImageId: clearLightbox ? null : state.lightboxImageId,
      lightboxImageList,
      maskEditorImageId:
        state.maskEditorImageId && orphanedImageIds.has(state.maskEditorImageId)
          ? null
          : state.maskEditorImageId,
      maskDraft,
      captionBatchImageIds:
        nextCaptionBatchImageIds && nextCaptionBatchImageIds.length > 0
          ? nextCaptionBatchImageIds
          : null,
    }
  })
}

export function setTaskFavoriteCategory(taskId: string, categoryId: string): Promise<void> {
  return updateTaskInStore(taskId, {
    isFavorite: true,
    favoriteCategoryId: categoryId,
  })
}

export function clearTaskFavorite(taskId: string): Promise<void> {
  return updateTaskInStore(taskId, {
    isFavorite: false,
    favoriteCategoryId: null,
  })
}

export function getTaskSortKey(task: TaskRecord): number {
  return task.sortOrder ?? task.createdAt
}

/**
 * 将 taskId 移到 prevTaskId 与 nextTaskId 之间。任一邻居为 null 表示拖到最前/最后。
 * 常规走 gap-based 中点(仅写被拖动任务);中点逼近浮点精度时,对全量任务整数化重排自愈。
 */
export function reorderTask(taskId: string, prevTaskId: string | null, nextTaskId: string | null) {
  const { tasks, setTasks } = useStore.getState()
  const prev = prevTaskId ? tasks.find((t) => t.id === prevTaskId) : null
  const next = nextTaskId ? tasks.find((t) => t.id === nextTaskId) : null

  // 中点与邻居差逼近浮点精度(反复同隙插入耗尽精度):对「被拖动任务所属对话」子集整数化重排自愈,再放置被拖动项。
  // 只在同对话子集内重排,避免一次普通拖拽就重写并落库其它所有对话的 sortOrder(整表写放大);
  // 拖拽本就限定在无筛选/同对话视图,prev/next 也来自当前对话,故子集已足够。
  if (prev && next && Math.abs(getTaskSortKey(prev) - getTaskSortKey(next)) < SORT_EPSILON) {
    const dragged = tasks.find((t) => t.id === taskId)
    const scoped = dragged
      ? tasks.filter((t) => t.conversationId === dragged.conversationId)
      : tasks
    const orderedIds = [...scoped]
      .sort((a, b) => {
        const ka = getTaskSortKey(a)
        const kb = getTaskSortKey(b)
        if (ka !== kb) return kb - ka
        if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
      })
      .map((t) => t.id)
    const newOrders = computeReorderedSortOrders(orderedIds, taskId, prevTaskId, nextTaskId)
    const changed: TaskRecord[] = []
    const updated = tasks.map((t) => {
      const order = newOrders.get(t.id)
      if (order != null && order !== t.sortOrder) {
        const updatedTask = { ...t, sortOrder: order }
        changed.push(updatedTask)
        return updatedTask
      }
      return t
    })
    setTasks(updated)
    void Promise.all(changed.map((t) => persistTaskSilently(t)))
    return
  }

  let newSortOrder: number
  if (prev && next) {
    newSortOrder = (getTaskSortKey(prev) + getTaskSortKey(next)) / 2
  } else if (prev) {
    newSortOrder = getTaskSortKey(prev) - SORT_STEP
  } else if (next) {
    newSortOrder = getTaskSortKey(next) + SORT_STEP
  } else {
    return
  }

  updateTaskInStoreSilently(taskId, { sortOrder: newSortOrder })
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks } = useStore.getState()

  const requestedIds = new Set(taskIds)
  const existingTaskIds = new Set(tasks.map((task) => task.id))
  const deleteTaskIds = taskIds.filter((id) => existingTaskIds.has(id))
  const toDelete = new Set(deleteTaskIds)
  if (!toDelete.size) {
    const newSelection = useStore.getState().selectedTaskIds.filter((id) => !requestedIds.has(id))
    useStore.getState().setSelectedTaskIds(newSelection)
    return
  }

  const remaining = tasks.filter((t) => !toDelete.has(t.id))
  const restoreAfterFailedDelete = new Map<string, TaskRecord>()
  const cancelledRestoreIds = new Set<string>()
  const deleteStartedAt = Date.now()

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      if (t.status === 'running') {
        terminateTaskRuntime(t.id)
        restoreAfterFailedDelete.set(t.id, createCancelledTask(t, deleteStartedAt))
        cancelledRestoreIds.add(t.id)
      } else {
        restoreAfterFailedDelete.set(t.id, t)
      }
      for (const id of getTaskImageIds(t)) deletedImageIds.add(id)
    }
  }

  setTasks(remaining)
  const confirmedDeletedIds = new Set<string>()
  try {
    for (const id of deleteTaskIds) {
      await dbDeleteTask(id)
      confirmedDeletedIds.add(id)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const latest = useStore.getState()
    const presentIds = new Set(latest.tasks.map((t) => t.id))
    const staleRequestedIds = [...requestedIds].filter((id) => !existingTaskIds.has(id))
    const unconfirmedTasks = tasks
      .filter((t) => toDelete.has(t.id) && !confirmedDeletedIds.has(t.id))
      .map((t) => restoreAfterFailedDelete.get(t.id) ?? t)
    const cancelledRestores = unconfirmedTasks.filter((t) => cancelledRestoreIds.has(t.id))
    latest.setTasks([...unconfirmedTasks.filter((t) => !presentIds.has(t.id)), ...latest.tasks])
    clearTransientUiReferencesForDeletedTasks(
      tasks.filter((task) => confirmedDeletedIds.has(task.id)),
    )
    const selectionWithoutStaleRequestedIds = useStore
      .getState()
      .selectedTaskIds.filter((id) => !staleRequestedIds.includes(id))
    useStore.getState().setSelectedTaskIds(selectionWithoutStaleRequestedIds)
    latest.showToast(`删除记录失败：${message}`, 'error')
    await Promise.all(cancelledRestores.map((t) => persistTaskSilently(t)))
    throw err
  }

  clearTransientUiReferencesForDeletedTasks(tasks.filter((task) => toDelete.has(task.id)))
  const afterConfirmedDelete = useStore.getState()
  const selectionWithoutRequestedIds = afterConfirmedDelete.selectedTaskIds.filter(
    (id) => !requestedIds.has(id),
  )
  if (selectionWithoutRequestedIds.length !== afterConfirmedDelete.selectedTaskIds.length) {
    afterConfirmedDelete.setSelectedTaskIds(selectionWithoutRequestedIds)
  }

  // 找出其他任务仍引用的图片
  const latestBeforeImagePrune = useStore.getState()
  const stillUsed = collectReferencedImageIds(
    latestBeforeImagePrune.tasks,
    latestBeforeImagePrune.inputImages,
  )

  // 删除孤立图片
  try {
    for (const imgId of deletedImageIds) {
      if (!stillUsed.has(imgId)) {
        await deleteImage(imgId)
        deleteCachedImage(imgId)
      }
    }
  } catch (err) {
    useStore
      .getState()
      .showToast(
        `记录已删除，但清理关联图片失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      )
    return
  }

  useStore.getState().showToast(`已删除 ${deleteTaskIds.length} 条记录`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks } = useStore.getState()
  const currentTask = tasks.find((item) => item.id === task.id)
  if (!currentTask) {
    clearTransientUiReferencesForDeletedTasks([task])
    return
  }

  const restoreAfterFailedDelete =
    currentTask.status === 'running' ? createCancelledTask(currentTask) : currentTask

  // 删除在途任务前先中止请求并清 watchdog/controller,避免请求继续跑、watchdog 误报、控制器残留
  if (currentTask.status === 'running') terminateTaskRuntime(currentTask.id)

  // 收集此任务关联的图片
  const taskImageIds = new Set(getTaskImageIds(currentTask))

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== currentTask.id)
  setTasks(remaining)
  try {
    await dbDeleteTask(currentTask.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const latest = useStore.getState()
    latest.setTasks(
      latest.tasks.some((t) => t.id === currentTask.id)
        ? latest.tasks
        : [restoreAfterFailedDelete, ...latest.tasks],
    )
    latest.showToast(`删除记录失败：${message}`, 'error')
    if (currentTask.status === 'running') await persistTaskSilently(restoreAfterFailedDelete)
    throw err
  }

  clearTransientUiReferencesForDeletedTasks([currentTask])

  // 找出其他任务仍引用的图片
  const latestBeforeImagePrune = useStore.getState()
  const stillUsed = collectReferencedImageIds(
    latestBeforeImagePrune.tasks,
    latestBeforeImagePrune.inputImages,
  )

  // 删除孤立图片
  try {
    for (const imgId of taskImageIds) {
      if (!stillUsed.has(imgId)) {
        await deleteImage(imgId)
        deleteCachedImage(imgId)
      }
    }
  } catch (err) {
    useStore
      .getState()
      .showToast(
        `记录已删除，但清理关联图片失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      )
    return
  }

  useStore.getState().showToast('记录已删除', 'success')
}
