import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { AppSettings, ExportData, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'
import { mergeImportedSettings, DEFAULT_SETTINGS, normalizeSettings } from './api/apiProfiles'
import { mergeFavoriteCategories, normalizeFavoriteCategories } from './favoriteCategories'
import {
  getAllTasks,
  putTask,
  clearTasks as dbClearTasks,
  getAllImages,
  putImage,
  clearImages,
  storedImageToBytes,
} from './db'
import { clearImageCache } from './imageCache'

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
   *   2) 本地已有分类和备份分类合并后的有效 id
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
  clearImageCache()
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, setFavoriteCategories, showToast } = useStore.getState()
  setTasks([])
  setFavoriteCategories([])
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
      version: 3,
      exportedAt: new Date(exportedAt).toISOString(),
      settings: redactSettingsForExport(settings),
      favoriteCategories: normalizeFavoriteCategories(favoriteCategories),
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
      clearImageCache()
      const state = useStore.getState()
      state.setTasks([])
      state.clearInputImages()
      state.clearMaskDraft()
    }

    const isReplaceMode = (options.mode ?? 'merge') === 'replace'
    const existingTaskIds = isReplaceMode ? new Set<string>() : new Set((await getAllTasks()).map((task) => task.id))
    const existingImageIds = isReplaceMode ? new Set<string>() : new Set((await getAllImages()).map((image) => image.id))
    const importedCategories = normalizeFavoriteCategories(data.favoriteCategories ?? [])
    const localCategoryIds = isReplaceMode
      ? new Set<string>()
      : new Set(useStore.getState().favoriteCategories.map((category) => category.id))
    const validCategoryIds = new Set([
      ...localCategoryIds,
      ...importedCategories.map((category) => category.id),
    ])
    const importedTasks = sanitizeImportedTasksForFavoriteCategories(data.tasks, validCategoryIds)

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
      useStore.getState().setFavoriteCategories(importedCategories)
    } else if (importedCategories.length) {
      const state = useStore.getState()
      state.setFavoriteCategories(mergeFavoriteCategories(state.favoriteCategories, importedCategories))
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
