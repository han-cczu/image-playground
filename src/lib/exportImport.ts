import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { AppSettings, Conversation, ExportData, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'
import { mergeImportedSettings, DEFAULT_SETTINGS, normalizeSettings } from './api/apiProfiles'
import { createDefaultFavoriteCategory, mergeFavoriteCategories, normalizeFavoriteCategories } from './favoriteCategories'
import {
  getAllTasks,
  putTask,
  clearTasks as dbClearTasks,
  getAllImages,
  putImage,
  clearImages,
  storedImageToBytes,
  getAllConversations,
  persistConversationMigration,
  clearConversations as dbClearConversations,
} from './db'
import { clearImageCache } from './imageCache'
import {
  ARCHIVE_CONVERSATION_ID,
  createArchiveConversation,
  normalizeConversations,
} from './conversations'
import { reseedConversationsFromFavoriteCategories } from './conversationMigration'

export type ImportMode = 'merge' | 'replace'

interface ImportDataOptions {
  mode?: ImportMode
}

function getImageExt(mime: string): string {
  const ext = mime.split('/')[1]?.toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  if (ext === 'png' || ext === 'jpg' || ext === 'webp') return ext
  return 'png'
}

function getMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  return mimeMap[ext] ?? 'image/png'
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export function redactSettingsForExport(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings)
  return {
    ...normalized,
    apiKey: '',
    profiles: normalized.profiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
    promptOptimizer: {
      ...normalized.promptOptimizer,
      apiKey: '',
    },
    optimizerProfiles: normalized.optimizerProfiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
    captioner: {
      ...normalized.captioner,
      apiKey: '',
    },
    captionerProfiles: normalized.captionerProfiles.map((profile) => ({
      ...profile,
      apiKey: '',
    })),
  }
}

function sanitizeImportedTasksForFavoriteCategories(
  tasks: TaskRecord[],
  validCategoryIds: Set<string>,
): TaskRecord[] {
  /*
   * ========================================================================
   * 步骤1：校验导入任务分类引用
   * ========================================================================
   * 数据源：
   *   1) 备份 manifest 中的任务记录
   *   2) 同一份备份 manifest 中的分类元数据 id
   * 操作要点：
   *   1) 保留能找到元数据的收藏分类 id
   *   2) 清理非收藏或缺失元数据的悬空分类引用
   */
  // 1.1 清理悬空分类引用
  return tasks.map((task) => {
    const categoryId = task.favoriteCategoryId?.trim() || null
    if (!categoryId) return task
    if (task.isFavorite && validCategoryIds.has(categoryId)) return task
    return { ...task, favoriteCategoryId: null }
  })
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  await dbClearTasks()
  await clearImages()
  await dbClearConversations()
  clearImageCache()
  const {
    setTasks,
    clearInputImages,
    clearMaskDraft,
    setSettings,
    setParams,
    setFavoriteCategories,
    setConversations,
    setActiveConversation,
    showToast,
  } = useStore.getState()
  setTasks([])
  setFavoriteCategories([createDefaultFavoriteCategory()])
  const archive = createArchiveConversation()
  await persistConversationMigration([archive], [])
  setConversations([archive])
  setActiveConversation(archive.id)
  clearInputImages()
  useStore.setState({ dismissedCodexCliPrompts: [] })
  clearMaskDraft()
  setSettings({ ...DEFAULT_SETTINGS })
  setParams({ ...DEFAULT_PARAMS })
  showToast('所有数据已清空', 'success')
}

/** 导出数据为 ZIP */
export async function exportData() {
  try {
    const tasks = await getAllTasks()
    const images = await getAllImages()
    const conversations = await getAllConversations()
    const { settings, favoriteCategories } = useStore.getState()
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    for (const task of tasks) {
      for (const id of [
        ...(task.inputImageIds || []),
        ...(task.maskImageId ? [task.maskImageId] : []),
        ...(task.outputImages || []),
      ]) {
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

    for (const img of images) {
      const imageBytes = await storedImageToBytes(img)
      if (!imageBytes) continue
      const { bytes, mime } = imageBytes
      const ext = getImageExt(mime)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = { path, createdAt, source: img.source }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }

    const manifest: ExportData = {
      version: 4,
      exportedAt: new Date(exportedAt).toISOString(),
      settings: redactSettingsForExport(settings),
      favoriteCategories: normalizeFavoriteCategories(favoriteCategories),
      conversations: normalizeConversations(conversations),
      tasks,
      imageFiles,
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `image-playground-${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导入 ZIP 数据 */
export async function importData(file: File, options: ImportDataOptions = {}): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error('无效的数据格式')

    if ((options.mode ?? 'merge') === 'replace') {
      await dbClearTasks()
      await clearImages()
      await dbClearConversations()
      clearImageCache()
      const state = useStore.getState()
      state.setTasks([])
      state.setConversations([])
      state.setActiveConversation(null)
      state.clearInputImages()
      state.clearMaskDraft()
    }

    const isReplaceMode = (options.mode ?? 'merge') === 'replace'
    const existingTaskIds = isReplaceMode ? new Set<string>() : new Set((await getAllTasks()).map((task) => task.id))
    const existingImageIds = isReplaceMode ? new Set<string>() : new Set((await getAllImages()).map((image) => image.id))
    const hasFavoriteCategoryMetadata = Array.isArray(data.favoriteCategories)
    const importedCategories = hasFavoriteCategoryMetadata
      ? normalizeFavoriteCategories(data.favoriteCategories)
      : []
    const importedCategoryIds = new Set(importedCategories.map((category) => category.id))
    const importedTasks = sanitizeImportedTasksForFavoriteCategories(data.tasks, importedCategoryIds)

    // 还原图片
    for (const [id, info] of Object.entries(data.imageFiles)) {
      if (existingImageIds.has(id)) continue
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const mime = getMimeFromPath(info.path)
      const blob = new Blob([copyBytesToArrayBuffer(bytes)], { type: mime })
      await putImage({ id, blob, mime, createdAt: info.createdAt, source: info.source })
    }

    for (const task of importedTasks) {
      if (existingTaskIds.has(task.id)) continue
      await putTask(task)
    }

    if (data.settings) {
      const state = useStore.getState()
      state.setSettings(mergeImportedSettings(state.settings, data.settings))
    }

    if (isReplaceMode) {
      useStore.getState().setFavoriteCategories(
        hasFavoriteCategoryMetadata ? importedCategories : [createDefaultFavoriteCategory()],
      )
    } else if (importedCategories.length) {
      const state = useStore.getState()
      state.setFavoriteCategories(mergeFavoriteCategories(state.favoriteCategories, importedCategories))
    }

    /*
     * ========================================================================
     * 步骤2：处理 conversations（兼容旧导出无 conversations 字段）
     * ========================================================================
     * 数据源：
     *   1) manifest 中可选的 conversations
     *   2) 当前已存在的 conversations（merge 模式时保留本地）
     * 操作要点：
     *   1) 有 conversations 字段 → 直接归一化写入
     *   2) 无 conversations 字段（旧导出）→ 跑一次 reseed migration
     */
    const hasConversationsMetadata = Array.isArray(data.conversations)
    const persistedTasksAfterImport = await getAllTasks()
    let finalConversations: Conversation[]
    if (hasConversationsMetadata) {
      const importedConversations = normalizeConversations(data.conversations)
      const existingConversations = isReplaceMode ? [] : await getAllConversations()
      const conversationById = new Map<string, Conversation>()
      for (const conv of existingConversations) conversationById.set(conv.id, conv)
      for (const conv of importedConversations) {
        if (!conversationById.has(conv.id)) conversationById.set(conv.id, conv)
      }
      if (!conversationById.has(ARCHIVE_CONVERSATION_ID)) {
        conversationById.set(ARCHIVE_CONVERSATION_ID, createArchiveConversation())
      }
      finalConversations = Array.from(conversationById.values())
      // 已写入 task 中无 conversationId 的兜底分配
      const orphanTasks = persistedTasksAfterImport.filter((task) => !task.conversationId)
      if (orphanTasks.length) {
        const reseed = reseedConversationsFromFavoriteCategories({
          tasks: orphanTasks,
          favoriteCategories: useStore.getState().favoriteCategories,
          existingConversations: finalConversations,
        })
        finalConversations = reseed.conversations
        await persistConversationMigration(finalConversations, reseed.dirtyTasks)
      } else {
        await persistConversationMigration(finalConversations, [])
      }
    } else {
      // 旧导出：跑同样的 reseed migration
      const existingConversations = isReplaceMode ? [] : await getAllConversations()
      const reseed = reseedConversationsFromFavoriteCategories({
        tasks: persistedTasksAfterImport,
        favoriteCategories: useStore.getState().favoriteCategories,
        existingConversations,
      })
      finalConversations = reseed.conversations
      await persistConversationMigration(finalConversations, reseed.dirtyTasks)
    }
    useStore.getState().setConversations(normalizeConversations(finalConversations))
    if (!useStore.getState().activeConversationId) {
      const nextActive =
        finalConversations.find((c) => c.id !== ARCHIVE_CONVERSATION_ID) ?? finalConversations[0]
      useStore.getState().setActiveConversation(nextActive?.id ?? null)
    }

    const tasks = await getAllTasks()
    useStore.getState().setTasks(tasks)
    useStore
      .getState()
      .showToast(`已导入 ${data.tasks.length} 条记录`, 'success')
    return true
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    return false
  }
}
