import type { TaskRecord } from '../types'
import { ARCHIVE_CONVERSATION_ID, normalizeConversations } from '../lib/conversations'
import { getAllConversations, getAllTasks, getImage, storedImageToDataUrl } from '../lib/db'
import { setCachedImage } from '../lib/imageCache'
import { collectReferencedImageIds } from '../lib/storageStats'
import { normalizeStoredTasks } from '../lib/tasks'
import { useStore } from './index'
import { terminateIndexedDbSyncRunningTasks } from './idbRuntimeBridge'
import {
  isPendingIndexedDbConversationDelete,
  isPendingIndexedDbConversationWrite,
  isPendingIndexedDbTaskDelete,
  isPendingIndexedDbTaskWrite,
} from './idbSyncState'
import type { Conversation } from '../types'

let refreshToken = 0
let inputImageRestoreToken = 0

function chooseActiveConversationId(
  currentId: string | null,
  conversations: ReturnType<typeof normalizeConversations>,
): string | null {
  if (currentId && conversations.some((conversation) => conversation.id === currentId)) {
    return currentId
  }
  return (
    conversations.find((conversation) => conversation.id !== ARCHIVE_CONVERSATION_ID)?.id ??
    conversations[0]?.id ??
    null
  )
}

function clearStaleUiReferences(tasks: TaskRecord[]) {
  const taskIds = new Set(tasks.map((task) => task.id))
  const imageIds = collectReferencedImageIds(tasks, useStore.getState().inputImages)

  useStore.setState((state) => {
    const compareTaskIds = state.compareTaskIds?.filter((id) => taskIds.has(id)) ?? null
    const captionBatchImageIds =
      state.captionBatchImageIds?.filter((id) => imageIds.has(id)) ?? null
    const maskDraft =
      state.maskDraft && imageIds.has(state.maskDraft.targetImageId) ? state.maskDraft : null
    return {
      selectedTaskIds: state.selectedTaskIds.filter((id) => taskIds.has(id)),
      detailTaskId:
        state.detailTaskId && !taskIds.has(state.detailTaskId) ? null : state.detailTaskId,
      lineageTaskId:
        state.lineageTaskId && !taskIds.has(state.lineageTaskId) ? null : state.lineageTaskId,
      compareTaskIds: compareTaskIds && compareTaskIds.length >= 2 ? compareTaskIds : null,
      lightboxImageId:
        state.lightboxImageId && !imageIds.has(state.lightboxImageId)
          ? null
          : state.lightboxImageId,
      lightboxImageList: state.lightboxImageList.filter((id) => imageIds.has(id)),
      maskEditorImageId:
        state.maskEditorImageId && !imageIds.has(state.maskEditorImageId)
          ? null
          : state.maskEditorImageId,
      maskDraft,
      captionBatchImageIds:
        captionBatchImageIds && captionBatchImageIds.length > 0 ? captionBatchImageIds : null,
    }
  })
}

/**
 * 快照与本地未落盘变更合并(总账见 idbSyncState.ts):
 * - 本地正在写(pending write)的 id 以本地版本为准——快照可能读在本页落盘之前,直接采纳会把 done 打回 running;
 * - 快照里没有、本地正在写的记录保留(刚入队的任务);
 * - 本地正在删的 id 从快照剔除,不能借快照复活。
 * 不在总账里的记录一律以库为准:另一标签页的取消/删除仍要生效(getStoppedRunningTasks 据此 terminate)。
 */
function mergeLocalPendingTasks(snapshotTasks: TaskRecord[], currentTasks: TaskRecord[]) {
  const localById = new Map(currentTasks.map((task) => [task.id, task]))
  const snapshotIds = new Set(snapshotTasks.map((task) => task.id))
  const merged = snapshotTasks
    .filter((task) => !isPendingIndexedDbTaskDelete(task.id))
    .map((task) => {
      const local = localById.get(task.id)
      return local && isPendingIndexedDbTaskWrite(task.id) ? local : task
    })
  const localOnly = currentTasks.filter(
    (task) => !snapshotIds.has(task.id) && isPendingIndexedDbTaskWrite(task.id),
  )
  return localOnly.length ? [...localOnly, ...merged] : merged
}

function mergeLocalPendingConversations(
  snapshot: Conversation[],
  current: Conversation[],
): Conversation[] {
  const localById = new Map(current.map((conversation) => [conversation.id, conversation]))
  const snapshotIds = new Set(snapshot.map((conversation) => conversation.id))
  const merged = snapshot
    .filter((conversation) => !isPendingIndexedDbConversationDelete(conversation.id))
    .map((conversation) => {
      const local = localById.get(conversation.id)
      return local && isPendingIndexedDbConversationWrite(conversation.id) ? local : conversation
    })
  const localOnly = current.filter(
    (conversation) =>
      !snapshotIds.has(conversation.id) && isPendingIndexedDbConversationWrite(conversation.id),
  )
  return localOnly.length ? [...localOnly, ...merged] : merged
}

function getStoppedRunningTasks(currentTasks: TaskRecord[], nextTasks: TaskRecord[]): TaskRecord[] {
  const nextTaskById = new Map(nextTasks.map((task) => [task.id, task]))
  return currentTasks.filter((task) => {
    if (task.status !== 'running') return false
    const nextTask = nextTaskById.get(task.id)
    return !nextTask || nextTask.status !== 'running'
  })
}

export async function refreshIndexedDbBackedStoreState(): Promise<void> {
  const token = ++refreshToken
  const [conversations, tasks] = await Promise.all([getAllConversations(), getAllTasks()])
  if (token !== refreshToken) return

  // 自家库快照不截断:被截掉的最新任务会从 UI「消失」,且 clearStaleUiReferences 会连带清掉它们的引用
  const normalizedTasks = normalizeStoredTasks(tasks)
  let stoppedRunningTasks: TaskRecord[] = []
  useStore.setState((state) => {
    const normalizedConversations = normalizeConversations(
      mergeLocalPendingConversations(conversations, state.conversations),
    )
    const nextTasks = mergeLocalPendingTasks(normalizedTasks, state.tasks)
    stoppedRunningTasks = getStoppedRunningTasks(state.tasks, nextTasks)
    return {
      conversations: normalizedConversations,
      tasks: nextTasks,
      activeConversationId: chooseActiveConversationId(
        state.activeConversationId,
        normalizedConversations,
      ),
    }
  })
  terminateIndexedDbSyncRunningTasks(stoppedRunningTasks)
  clearStaleUiReferences(useStore.getState().tasks)
}

export async function restorePersistedInputImageDataUrls(): Promise<void> {
  const token = ++inputImageRestoreToken
  const inputImages = useStore.getState().inputImages
  const missingImages = inputImages.filter((image) => !image.dataUrl)
  if (!missingImages.length) return

  const failures: Error[] = []
  const restoredImages = (
    await Promise.all(
      missingImages.map(async (image) => {
        let dataUrl = ''
        try {
          const storedImage = await getImage(image.id)
          dataUrl = storedImage ? ((await storedImageToDataUrl(storedImage)) ?? '') : ''
        } catch (err) {
          failures.push(err instanceof Error ? err : new Error(String(err)))
        }
        return dataUrl ? { ...image, dataUrl } : null
      }),
    )
  ).filter((image): image is (typeof missingImages)[number] => image !== null)
  const throwIfRestoreFailed = () => {
    if (token !== inputImageRestoreToken) return
    const failure = failures[0]
    if (failure) throw failure
  }
  if (token !== inputImageRestoreToken) return
  if (!restoredImages.length) {
    const missingIds = new Set(missingImages.map((image) => image.id))
    useStore
      .getState()
      .setInputImages(
        useStore
          .getState()
          .inputImages.filter((image) => image.dataUrl || !missingIds.has(image.id)),
      )
    clearStaleUiReferences(useStore.getState().tasks)
    throwIfRestoreFailed()
    return
  }

  for (const image of restoredImages) setCachedImage(image.id, image.dataUrl)
  const restoredById = new Map(restoredImages.map((image) => [image.id, image]))
  const missingIds = new Set(missingImages.map((image) => image.id))
  useStore.getState().setInputImages(
    useStore.getState().inputImages.flatMap((image) => {
      if (image.dataUrl) return [image]
      const restored = restoredById.get(image.id)
      if (restored) return [restored]
      if (missingIds.has(image.id)) return []
      return [image]
    }),
  )
  clearStaleUiReferences(useStore.getState().tasks)
  throwIfRestoreFailed()
}
