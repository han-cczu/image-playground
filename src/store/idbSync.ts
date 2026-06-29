import type { TaskRecord } from '../types'
import { ARCHIVE_CONVERSATION_ID, normalizeConversations } from '../lib/conversations'
import { getAllConversations, getAllTasks, getImage, storedImageToDataUrl } from '../lib/db'
import { setCachedImage } from '../lib/imageCache'
import { collectReferencedImageIds } from '../lib/storageStats'
import { normalizeTasks } from '../lib/tasks'
import { useStore } from './index'
import { terminateIndexedDbSyncRunningTasks } from './idbRuntimeBridge'
import { isPendingIndexedDbTaskWrite } from './idbSyncState'

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

function mergeLocalRunningTasks(snapshotTasks: TaskRecord[], currentTasks: TaskRecord[]) {
  const snapshotIds = new Set(snapshotTasks.map((task) => task.id))
  const localPending = currentTasks.filter(
    (task) =>
      task.status === 'running' &&
      !snapshotIds.has(task.id) &&
      isPendingIndexedDbTaskWrite(task.id),
  )
  return localPending.length ? [...localPending, ...snapshotTasks] : snapshotTasks
}

function getStoppedRunningTasks(
  currentTasks: TaskRecord[],
  nextTasks: TaskRecord[],
): TaskRecord[] {
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

  const normalizedConversations = normalizeConversations(conversations)
  const normalizedTasks = normalizeTasks(tasks)
  let stoppedRunningTasks: TaskRecord[] = []
  useStore.setState((state) => {
    const nextTasks = mergeLocalRunningTasks(normalizedTasks, state.tasks)
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
          dataUrl = storedImage ? (await storedImageToDataUrl(storedImage)) ?? '' : ''
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
    useStore.getState().setInputImages(
      useStore.getState().inputImages.filter((image) => image.dataUrl || !missingIds.has(image.id)),
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
