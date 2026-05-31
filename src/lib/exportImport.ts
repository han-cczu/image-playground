import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { AppSettings, Conversation, ExportData, StoredImage, TaskRecord } from '../types'
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
import { normalizeTasks } from './tasks'

export type ImportMode = 'merge' | 'replace'

interface ImportDataOptions {
  mode?: ImportMode
}

/** 导入 ZIP 文件总大小上限:unzipSync 会把全部条目一次性解压进内存,无上限时 zip bomb / 超大备份可 OOM。 */
const MAX_IMPORT_FILE_BYTES = 400 * 1024 * 1024

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

/** 校验图片条目 path:必须形如 images/<id>.<ext> 且 id 与 manifest key 一致,否则返回 null 跳过(防 ZIP 路径穿越 / id 错配)。 */
function resolveImageEntry(id: string, filePath: string): string | null {
  if (filePath.includes('..')) return null
  const match = /^images\/(.+)\.(png|jpg|jpeg|webp)$/.exec(filePath)
  if (!match || match[1] !== id) return null
  return getMimeFromPath(filePath)
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`导入文件过大:超过 ${Math.round(MAX_IMPORT_FILE_BYTES / 1024 / 1024)}MB 上限`)
    }
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error('无效的数据格式')

    const isReplaceMode = (options.mode ?? 'merge') === 'replace'
    // 既有 id 在清空之前读取(replace 模式短路为空集,不触达活库;merge 模式无清空):供下方去重。
    const existingTaskIds = isReplaceMode ? new Set<string>() : new Set((await getAllTasks()).map((task) => task.id))
    const existingImageIds = isReplaceMode ? new Set<string>() : new Set((await getAllImages()).map((image) => image.id))
    const hasFavoriteCategoryMetadata = Array.isArray(data.favoriteCategories)
    const importedCategories = hasFavoriteCategoryMetadata
      ? normalizeFavoriteCategories(data.favoriteCategories)
      : []
    const importedCategoryIds = new Set(importedCategories.map((category) => category.id))
    // 对不可信 task 做字段级白名单归一化(防缺字段 / 类型错误 / __proto__ 污染直入 IndexedDB)
    const normalizedImportedTasks = normalizeTasks(data.tasks)
    const importedTasks = sanitizeImportedTasksForFavoriteCategories(normalizedImportedTasks, importedCategoryIds)

    // 先把全部待写图片解码 + 校验到内存(路径穿越 / id 错配 / 字节缺失在此 continue 跳过),全部就绪后才清空,
    // 把 replace 模式的不可恢复窗口从「清空 → 解码 → 写回」收敛为「清空 → 纯写回」。
    const imagesToWrite: StoredImage[] = []
    for (const [id, info] of Object.entries(data.imageFiles)) {
      if (existingImageIds.has(id)) continue
      // 校验 path 严格形如 images/<id>.<ext> 且与 id 一致,拒绝路径穿越 / id 错配的条目
      const mime = resolveImageEntry(id, info.path)
      if (!mime) continue
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const blob = new Blob([copyBytesToArrayBuffer(bytes)], { type: mime })
      imagesToWrite.push({ id, blob, mime, createdAt: info.createdAt, source: info.source })
    }
    const tasksToWrite = importedTasks.filter((task) => !existingTaskIds.has(task.id))

    // 全部待写记录就绪后才清空旧库(replace 模式),最大限度缩小数据丢失窗口。
    if (isReplaceMode) {
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

    // 纯写回(已无解码 / 校验,清空后失败概率最低)
    for (const image of imagesToWrite) {
      await putImage(image)
    }
    for (const task of tasksToWrite) {
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
      .showToast(`已导入 ${normalizedImportedTasks.length} 条记录`, 'success')
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const isReplace = (options.mode ?? 'merge') === 'replace'
    useStore
      .getState()
      .showToast(
        isReplace
          ? `替换导入失败：${message}。数据可能不完整,请重新导入或清空后重试。`
          : `导入失败：${message}`,
        'error',
      )
    return false
  }
}
