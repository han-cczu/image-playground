import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './api/apiProfiles'
import type { ExportData, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'
import { clearAllData, exportData, importData, redactSettingsForExport } from './exportImport'
import { DEFAULT_FAVORITE_CATEGORY_COLOR } from './favoriteCategories'
import {
  clearConversations,
  clearImages,
  clearTasks,
  blobToDataUrl,
  deleteImage,
  getAllConversations,
  getAllImages,
  getAllTasks,
  persistConversationMigration,
  putImage,
  putTask,
  storedImageToBytes,
} from './db'
import { collectReferencedImageIds } from './storageStats'

vi.mock('./db', () => ({
  getAllTasks: vi.fn(),
  putTask: vi.fn(),
  clearTasks: vi.fn(),
  getAllImages: vi.fn(),
  putImage: vi.fn(),
  deleteImage: vi.fn(),
  clearImages: vi.fn(),
  blobToDataUrl: vi.fn(),
  storedImageToBytes: vi.fn(),
  getAllConversations: vi.fn(),
  persistConversationMigration: vi.fn(),
  clearConversations: vi.fn(),
}))

vi.mock('./storageStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storageStats')>()
  return {
    ...actual,
    collectReferencedImageIds: vi.fn(actual.collectReferencedImageIds),
  }
})

vi.mock('./imageCache', () => ({
  clearImageCache: vi.fn(),
  deleteCachedImage: vi.fn(),
}))

const dbCalls: string[] = []

function createTask(id: string): TaskRecord {
  return {
    id,
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

function createImportFile(data: ExportData) {
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(data)),
  })
  const buffer = new ArrayBuffer(zipped.byteLength)
  new Uint8Array(buffer).set(zipped)
  return new File([buffer], 'backup.zip', { type: 'application/zip' })
}

function createImportFileWithImages(data: ExportData, images: Record<string, Uint8Array>) {
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(data)),
    ...images,
  })
  const buffer = new ArrayBuffer(zipped.byteLength)
  new Uint8Array(buffer).set(zipped)
  return new File([buffer], 'backup.zip', { type: 'application/zip' })
}

function patchCentralDirectoryOriginalSize(
  zipped: Uint8Array,
  fileName: string,
  originalSize: number,
): Uint8Array {
  const copy = new Uint8Array(zipped)
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  let eocdOffset = -1
  for (let i = copy.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('EOCD not found')

  const entryCount = view.getUint16(eocdOffset + 10, true)
  let offset = view.getUint32(eocdOffset + 16, true)
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('central directory entry not found')
    }
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const name = strFromU8(copy.subarray(offset + 46, offset + 46 + nameLen))
    if (name === fileName) {
      view.setUint32(offset + 24, originalSize, true)
      return copy
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`central directory entry not found: ${fileName}`)
}

function createImportFileWithPatchedOriginalSize(
  data: ExportData,
  images: Record<string, Uint8Array>,
  fileName: string,
  originalSize: number,
) {
  const zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(data)),
    ...images,
  })
  const patched = patchCentralDirectoryOriginalSize(zipped, fileName, originalSize)
  const buffer = new ArrayBuffer(patched.byteLength)
  new Uint8Array(buffer).set(patched)
  return new File([buffer], 'backup.zip', { type: 'application/zip' })
}

function createImportFileWithPatchedOriginalSizes(
  data: ExportData,
  images: Record<string, Uint8Array>,
  sizes: Record<string, number>,
) {
  let zipped = zipSync({
    'manifest.json': strToU8(JSON.stringify(data)),
    ...images,
  })
  for (const [fileName, originalSize] of Object.entries(sizes)) {
    zipped = patchCentralDirectoryOriginalSize(zipped, fileName, originalSize)
  }
  const buffer = new ArrayBuffer(zipped.byteLength)
  new Uint8Array(buffer).set(zipped)
  return new File([buffer], 'backup.zip', { type: 'application/zip' })
}

function expectPersistedTask(id: string) {
  const taskArgs = vi.mocked(persistConversationMigration).mock.calls.flatMap((call) => call[1])
  const task = taskArgs.find((item) => item.id === id)
  expect(task).toBeTruthy()
  return expect(task)
}

describe('export/import reliability', () => {
  beforeEach(() => {
    dbCalls.length = 0
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getAllImages).mockResolvedValue([])
    vi.mocked(storedImageToBytes).mockReset()
    vi.mocked(blobToDataUrl).mockImplementation(async (blob, fallbackMime) => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return `data:${blob.type || fallbackMime || 'application/octet-stream'};base64,${btoa(binary)}`
    })
    vi.mocked(collectReferencedImageIds).mockClear()
    vi.mocked(putTask).mockImplementation(async () => {
      dbCalls.push('putTask')
      return 'task-id'
    })
    vi.mocked(clearTasks).mockImplementation(async () => {
      dbCalls.push('clearTasks')
      return undefined
    })
    vi.mocked(putImage).mockImplementation(async () => {
      dbCalls.push('putImage')
      return 'image-id'
    })
    vi.mocked(deleteImage).mockReset()
    vi.mocked(deleteImage).mockResolvedValue(undefined)
    vi.mocked(clearImages).mockImplementation(async () => {
      dbCalls.push('clearImages')
      return undefined
    })
    vi.mocked(getAllConversations).mockResolvedValue([])
    vi.mocked(persistConversationMigration).mockImplementation(async () => {
      dbCalls.push('persistConversationMigration')
      return undefined
    })
    vi.mocked(clearConversations).mockImplementation(async () => {
      dbCalls.push('clearConversations')
      return undefined
    })
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'current-key',
        profiles: [
          {
            ...DEFAULT_SETTINGS.profiles[0],
            apiKey: 'current-key',
          },
        ],
      },
      favoriteCategories: [],
      tasks: [],
      prompt: '',
      params: { ...DEFAULT_PARAMS },
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      toast: null,
      showToast: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('redacts every API key from exported settings', () => {
    const redacted = redactSettingsForExport({
      ...DEFAULT_SETTINGS,
      apiKey: 'legacy-secret',
      profiles: [
        {
          ...DEFAULT_SETTINGS.profiles[0],
          apiKey: 'profile-secret',
        },
        {
          id: 'gemini-imported',
          name: 'Gemini',
          provider: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-secret',
          model: 'gemini-2.5-flash-image',
          timeout: 600,
        },
      ],
      promptOptimizer: {
        ...DEFAULT_SETTINGS.promptOptimizer,
        apiKey: 'optimizer-secret',
      },
      optimizerProfiles: [
        {
          ...DEFAULT_SETTINGS.optimizerProfiles[0],
          apiKey: 'optimizer-profile-secret',
        },
      ],
      captionerProfiles: [
        {
          ...DEFAULT_SETTINGS.captionerProfiles[0],
          apiKey: 'captioner-profile-secret',
        },
      ],
    })

    expect(JSON.stringify(redacted)).not.toContain('legacy-secret')
    expect(JSON.stringify(redacted)).not.toContain('profile-secret')
    expect(JSON.stringify(redacted)).not.toContain('gemini-secret')
    expect(JSON.stringify(redacted)).not.toContain('optimizer-secret')
    expect(redacted.apiKey).toBe('')
    expect(redacted.profiles.every((profile) => profile.apiKey === '')).toBe(true)
    expect(redacted.promptOptimizer.apiKey).toBe('')
    expect(JSON.stringify(redacted)).not.toContain('optimizer-profile-secret')
    expect(redacted.optimizerProfiles.every((p) => p.apiKey === '')).toBe(true)
    expect(JSON.stringify(redacted)).not.toContain('captioner-profile-secret')
    expect(redacted.captionerProfiles.every((p) => p.apiKey === '')).toBe(true)
  })

  it('rejects malformed manifest shapes before touching the database', async () => {
    const file = createImportFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      tasks: {},
      imageFiles: [],
    } as unknown as ExportData)

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(false)

    expect(putTask).not.toHaveBeenCalled()
    expect(putImage).not.toHaveBeenCalled()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(
      expect.stringContaining('无效的数据格式'),
      'error',
    )
  })

  it('imports legacy backups with API keys through the existing settings merge path', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'imported-secret',
        profiles: [
          {
            ...DEFAULT_SETTINGS.profiles[0],
            apiKey: 'imported-secret',
          },
        ],
      },
      tasks: [],
      imageFiles: {},
    })

    await expect(importData(file)).resolves.toBe(true)

    expect(useStore.getState().settings.apiKey).toBe('imported-secret')
    expect(useStore.getState().settings.profiles[0].apiKey).toBe('imported-secret')
  })

  it('ignores malformed imported settings instead of replacing current settings with defaults', async () => {
    useStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'current-secret',
        profiles: [
          {
            ...DEFAULT_SETTINGS.profiles[0],
            apiKey: 'current-secret',
          },
        ],
      },
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      settings: [],
      tasks: [],
      imageFiles: {},
    } as unknown as ExportData)

    await expect(importData(file)).resolves.toBe(true)

    expect(useStore.getState().settings.apiKey).toBe('current-secret')
    expect(useStore.getState().settings.profiles[0].apiKey).toBe('current-secret')
    expect(useStore.getState().settings.profiles).toHaveLength(1)
  })

  it('imports only missing records in merge mode', async () => {
    const task = createTask('imported-task')
    vi.mocked(getAllTasks).mockResolvedValueOnce([task]).mockResolvedValueOnce([task])
    const file = createImportFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    // merge 时旧导出（无 conversations）会跑一次 conversation reseed migration 写入
    expect(dbCalls).toEqual(['persistConversationMigration'])
  })

  it('export/import jobs are mutually exclusive: export during in-flight import is rejected with a toast (M13)', async () => {
    let releaseBuffer!: (b: ArrayBuffer) => void
    const hangingFile = {
      size: 10,
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) => {
          releaseBuffer = resolve
        }),
    } as unknown as File
    const importPromise = importData(hangingFile)

    const showToast = vi.fn()
    useStore.setState({ showToast })
    await exportData()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('正在进行中'), 'error')

    // 释放挂起的导入(非法 zip → 失败收场),互斥位应随 finally 归还
    releaseBuffer(new ArrayBuffer(2))
    await importPromise
    const showToast2 = vi.fn()
    useStore.setState({ showToast: showToast2 })
    await importData({ size: 10, arrayBuffer: async () => new ArrayBuffer(2) } as unknown as File)
    expect(showToast2).toHaveBeenCalledWith(expect.stringContaining('导入失败'), 'error')
  })

  it('marks imported running tasks as interrupted (no executor exists on the importing side)', async () => {
    // L2(2026-06-10 审查修复):备份里 status:'running' 的任务导入后曾成为无请求、无 watchdog 的
    // 幽灵 running 卡片;统一落「请求中断」错误态,耗时未知不伪造。
    const running = {
      ...createTask('ghost-running'),
      status: 'running' as const,
      error: null,
      finishedAt: null,
      elapsed: null,
      createdAt: 1234,
    }
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [running],
      imageFiles: {},
    })

    const ok = await importData(file, { mode: 'merge' })

    expect(ok).toBe(true)
    expectPersistedTask('ghost-running').toMatchObject({
      status: 'error',
      error: '请求中断',
      finishedAt: 1234,
      elapsed: null,
    })
  })

  it('imports only image files referenced by imported tasks', async () => {
    const task = { ...createTask('task-live'), outputImages: ['live-image'] }
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'live-image': { path: 'images/live-image.png' },
          'orphan-image': { path: 'images/orphan-image.png' },
        },
      },
      {
        'images/live-image.png': new Uint8Array([1]),
        'images/orphan-image.png': new Uint8Array([2]),
      },
    )

    await importData(file, { mode: 'merge' })

    expect(putImage).toHaveBeenCalledTimes(1)
    expect(putImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'live-image' }))
    expect(putImage).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'orphan-image' }))
  })

  it('rolls back images already written when merge import later fails to persist a task', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-with-image'), outputImages: ['live-image'] }
    vi.mocked(persistConversationMigration).mockRejectedValueOnce(new Error('task write failed'))
    useStore.setState({ showToast })
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'live-image': { path: 'images/live-image.png' },
        },
      },
      {
        'images/live-image.png': new Uint8Array([1]),
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(false)

    expect(putImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'live-image' }))
    expect(deleteImage).toHaveBeenCalledWith('live-image')
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入失败：task write failed'),
      'error',
    )
  })

  it('keeps the original merge import error when image rollback cleanup also fails', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-with-image'), outputImages: ['live-image'] }
    vi.mocked(persistConversationMigration).mockRejectedValueOnce(new Error('task write failed'))
    vi.mocked(deleteImage).mockRejectedValueOnce(new Error('image cleanup failed'))
    useStore.setState({ showToast })
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'live-image': { path: 'images/live-image.png' },
        },
      },
      {
        'images/live-image.png': new Uint8Array([1]),
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(false)

    expect(deleteImage).toHaveBeenCalledWith('live-image')
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入失败：task write failed'),
      'error',
    )
  })

  it('rolls back every image from a failed transactional merge import', async () => {
    const showToast = vi.fn()
    const taskA = { ...createTask('task-a'), outputImages: ['image-a'] }
    const taskB = { ...createTask('task-b'), outputImages: ['image-b'] }
    vi.mocked(persistConversationMigration).mockRejectedValueOnce(
      new Error('task transaction failed'),
    )
    useStore.setState({ showToast })
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [taskA, taskB],
        imageFiles: {
          'image-a': { path: 'images/image-a.png' },
          'image-b': { path: 'images/image-b.png' },
        },
      },
      {
        'images/image-a.png': new Uint8Array([1]),
        'images/image-b.png': new Uint8Array([2]),
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(false)

    expect(deleteImage).toHaveBeenCalledWith('image-a')
    expect(deleteImage).toHaveBeenCalledWith('image-b')
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入失败：task transaction failed'),
      'error',
    )
  })

  it('does not leave merge-import side effects when conversation migration persistence fails', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-with-image'), outputImages: ['live-image'] }
    vi.mocked(persistConversationMigration).mockRejectedValueOnce(new Error('migration failed'))
    useStore.setState({
      showToast,
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'current-key',
        profiles: [
          {
            ...DEFAULT_SETTINGS.profiles[0],
            apiKey: 'current-key',
          },
        ],
      },
    })
    vi.mocked(putTask).mockClear()
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: {
          ...DEFAULT_SETTINGS,
          apiKey: 'imported-key',
          profiles: [
            {
              ...DEFAULT_SETTINGS.profiles[0],
              apiKey: 'imported-key',
            },
          ],
        },
        tasks: [task],
        imageFiles: {
          'live-image': { path: 'images/live-image.png' },
        },
      },
      {
        'images/live-image.png': new Uint8Array([1]),
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(false)

    expect(putTask).not.toHaveBeenCalled()
    expect(deleteImage).toHaveBeenCalledWith('live-image')
    expect(useStore.getState().settings.apiKey).toBe('current-key')
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入失败：migration failed'),
      'error',
    )
  })

  it('warns when imported tasks reference missing image files', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-missing-image'), outputImages: ['missing-image'] }
    useStore.setState({ showToast })
    vi.mocked(putImage).mockClear()
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expectPersistedTask('task-missing-image')
    expect(putImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入完成，但 1 张图片缺失或无效'),
      'error',
    )
  })

  it('does not warn when a merge import references images already stored locally', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-existing-image'), outputImages: ['shared-image'] }
    useStore.setState({ showToast })
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'shared-image', blob: new Blob(['local']), mime: 'image/png' },
    ])
    vi.mocked(putImage).mockClear()
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expectPersistedTask('task-existing-image')
    expect(putImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('已导入 1 条记录', 'success')
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('图片缺失或无效'), 'error')
  })

  it('skips malformed imported image entries without failing the whole import', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-bad-image'), outputImages: ['bad-image'] }
    useStore.setState({ showToast })
    vi.mocked(putImage).mockClear()
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {
        'bad-image': null,
      },
    } as unknown as ExportData)

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expectPersistedTask('task-bad-image')
    expect(putImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入完成，但 1 张图片缺失或无效'),
      'error',
    )
  })

  it('skips imported image paths that escape the images directory or mismatch the image id', async () => {
    const showToast = vi.fn()
    const task = {
      ...createTask('task-bad-paths'),
      outputImages: ['traversal-image', 'mismatch-image'],
    }
    useStore.setState({ showToast })
    vi.mocked(putImage).mockClear()
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'traversal-image': { path: 'images/../traversal-image.png' },
          'mismatch-image': { path: 'images/other-id.png' },
        },
      },
      {
        'images/../traversal-image.png': new Uint8Array([1]),
        'images/other-id.png': new Uint8Array([2]),
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expectPersistedTask('task-bad-paths')
    expect(putImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入完成，但 2 张图片缺失或无效'),
      'error',
    )
  })

  it('skips imported image entries whose declared uncompressed size is too large', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-huge-image'), outputImages: ['huge-image'] }
    useStore.setState({ showToast })
    vi.mocked(putImage).mockClear()
    const file = createImportFileWithPatchedOriginalSize(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'huge-image': { path: 'images/huge-image.png' },
        },
      },
      {
        'images/huge-image.png': new Uint8Array([1]),
      },
      'images/huge-image.png',
      401 * 1024 * 1024,
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expectPersistedTask('task-huge-image')
    expect(putImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入完成，但 1 张图片缺失或无效'),
      'error',
    )
  })

  it('skips imported image entries once the declared total uncompressed size exceeds the import budget', async () => {
    const showToast = vi.fn()
    const task = { ...createTask('task-many-images'), outputImages: ['image-a', 'image-b'] }
    useStore.setState({ showToast })
    vi.mocked(putImage).mockClear()
    const file = createImportFileWithPatchedOriginalSizes(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'image-a': { path: 'images/image-a.png' },
          'image-b': { path: 'images/image-b.png' },
        },
      },
      {
        'images/image-a.png': new Uint8Array([1]),
        'images/image-b.png': new Uint8Array([2]),
      },
      {
        'images/image-a.png': 300 * 1024 * 1024,
        'images/image-b.png': 300 * 1024 * 1024,
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expectPersistedTask('task-many-images')
    expect(putImage).toHaveBeenCalledTimes(1)
    expect(putImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'image-a' }))
    expect(putImage).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'image-b' }))
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('导入完成，但 1 张图片缺失或无效'),
      'error',
    )
  })

  it('does not warn about missing images from duplicate tasks skipped in merge mode', async () => {
    const showToast = vi.fn()
    const existingTask = { ...createTask('duplicate-task'), outputImages: ['local-image'] }
    const skippedImportTask = { ...createTask('duplicate-task'), outputImages: ['missing-image'] }
    useStore.setState({ showToast })
    vi.mocked(getAllTasks)
      .mockResolvedValueOnce([existingTask])
      .mockResolvedValueOnce([existingTask])
    vi.mocked(putTask).mockClear()
    vi.mocked(putImage).mockClear()
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [skippedImportTask],
      imageFiles: {},
      conversations: [{ id: '__archive__', title: '历史记录', createdAt: 1, updatedAt: 1 }],
    })

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expect(putTask).not.toHaveBeenCalled()
    expect(putImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('已导入 0 条记录', 'success')
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('图片缺失或无效'), 'error')
  })

  it('imports favorite category metadata and task assignments', async () => {
    const task = createTask('categorized-task')
    task.isFavorite = true
    task.favoriteCategoryId = 'cat-a'
    const file = createImportFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      favoriteCategories: [
        {
          id: 'cat-a',
          name: '角色',
          color: '#f59e0b',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    expect(useStore.getState().favoriteCategories).toEqual([
      {
        id: 'cat-a',
        name: '角色',
        color: '#f59e0b',
        sortOrder: 0,
        createdAt: 1,
      },
    ])
    expectPersistedTask('categorized-task').toMatchObject({
      favoriteCategoryId: 'cat-a',
    })
  })

  it('clears imported task assignments when category metadata is missing', async () => {
    const task = createTask('dangling-category-task')
    task.isFavorite = true
    task.favoriteCategoryId = 'missing-category'
    const file = createImportFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    expectPersistedTask('dangling-category-task').toMatchObject({
      favoriteCategoryId: null,
    })
  })

  it('does not use local category metadata to validate imported task assignments', async () => {
    const task = createTask('local-id-task')
    task.isFavorite = true
    task.favoriteCategoryId = 'cat-local'
    useStore.setState({
      favoriteCategories: [
        {
          id: 'cat-local',
          name: '本地分类',
          color: '#14b8a6',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    expectPersistedTask('local-id-task').toMatchObject({
      favoriteCategoryId: null,
    })
  })

  it('resets cleared app data with the default favorite category', async () => {
    useStore.setState({
      prompt: 'old prompt',
      params: { ...DEFAULT_PARAMS, stylePreset: 'film' },
      favoriteCategoriesInitialized: false,
    })

    await clearAllData()

    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
    expect(useStore.getState().favoriteCategoriesInitialized).toBe(true)
    expect(useStore.getState().prompt).toBe('')
    expect(useStore.getState().params).toEqual(DEFAULT_PARAMS)
  })

  it('clears the conversations object store when resetting all data', async () => {
    await clearAllData()
    expect(dbCalls).toContain('clearConversations')
  })

  it('clears transient UI references when resetting all data succeeds', async () => {
    useStore.setState({
      tasks: [createTask('old-task')],
      inputImages: [{ id: 'old-image', dataUrl: 'data:image/png;base64,a' }],
      selectedTaskIds: ['old-task'],
      detailTaskId: 'old-task',
      lineageTaskId: 'old-task',
      compareTaskIds: ['old-task', 'other-task'],
      lightboxImageId: 'old-image',
      lightboxImageList: ['old-image'],
      captionBatchImageIds: ['old-image'],
      captionSource: 'data:image/png;base64,a',
      maskDraft: {
        targetImageId: 'old-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'old-image',
      showToast: vi.fn(),
    })

    await clearAllData()

    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: [],
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: [],
      captionBatchImageIds: null,
      captionSource: null,
      maskDraft: null,
      maskEditorImageId: null,
    })
  })

  it('uses the latest toast handler after async clearAllData succeeds', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    let resolveClearTasks!: () => void
    vi.mocked(clearTasks).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClearTasks = () => {
          dbCalls.push('clearTasks')
          resolve(undefined)
        }
      }),
    )
    useStore.setState({
      tasks: [createTask('old-task')],
      showToast: oldToast,
    })

    const pendingClear = clearAllData()
    await Promise.resolve()
    useStore.setState({ showToast: latestToast })

    resolveClearTasks()
    await pendingClear

    expect(latestToast).toHaveBeenCalledWith('所有数据已清空', 'success')
    expect(oldToast).not.toHaveBeenCalledWith('所有数据已清空', 'success')
  })

  it('clears the mask editor image reference synchronously when resetting all data starts', async () => {
    let resolveClearTasks!: () => void
    vi.mocked(clearTasks).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClearTasks = () => {
          dbCalls.push('clearTasks')
          resolve(undefined)
        }
      }),
    )
    useStore.setState({
      tasks: [createTask('old-task')],
      inputImages: [{ id: 'old-image', dataUrl: 'data:image/png;base64,a' }],
      maskDraft: {
        targetImageId: 'old-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'old-image',
      showToast: vi.fn(),
    })

    const pendingClear = clearAllData()
    await Promise.resolve()

    expect(useStore.getState().maskEditorImageId).toBeNull()
    expect(useStore.getState().maskDraft).toBeNull()

    resolveClearTasks()
    await pendingClear
  })

  it('reports clear-all failures before rejecting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.mocked(clearTasks).mockRejectedValue(new Error('clear failed'))
    const showToast = vi.fn()
    const existingTask = createTask('existing-task')
    const runningTask = {
      ...createTask('running-task'),
      status: 'running' as const,
      createdAt: 4_000,
      finishedAt: null,
      elapsed: null,
    }
    useStore.setState({
      tasks: [existingTask, runningTask],
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,a' }],
      conversations: [{ id: 'conv-a', title: '会话', createdAt: 1, updatedAt: 1 }],
      activeConversationId: 'conv-a',
      favoriteCategories: [],
      snippets: [
        {
          id: 'snippet-a',
          name: '片段',
          content: 'text',
          createdAt: 1,
          updatedAt: 1,
          sortOrder: 0,
        },
      ],
      batchNotes: { batchA: { text: 'note', updatedAt: 1 } },
      selectedTaskIds: ['existing-task'],
      detailTaskId: 'existing-task',
      lineageTaskId: 'existing-task',
      compareTaskIds: ['existing-task', 'running-task'],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      captionSource: 'data:image/png;base64,a',
      showToast,
    })

    await expect(clearAllData()).rejects.toThrow('clear failed')

    expect(useStore.getState().tasks).toEqual([
      existingTask,
      expect.objectContaining({
        id: 'running-task',
        status: 'error',
        error: '已取消生成',
        finishedAt: 10_000,
        elapsed: 6_000,
      }),
    ])
    expect(useStore.getState().inputImages).toEqual([
      { id: 'input-a', dataUrl: 'data:image/png;base64,a' },
    ])
    expect(useStore.getState().conversations).toEqual([
      { id: 'conv-a', title: '会话', createdAt: 1, updatedAt: 1 },
    ])
    expect(useStore.getState().activeConversationId).toBe('conv-a')
    expect(useStore.getState().snippets).toEqual([
      { id: 'snippet-a', name: '片段', content: 'text', createdAt: 1, updatedAt: 1, sortOrder: 0 },
    ])
    expect(useStore.getState().batchNotes).toEqual({ batchA: { text: 'note', updatedAt: 1 } })
    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: ['existing-task'],
      detailTaskId: 'existing-task',
      lineageTaskId: 'existing-task',
      compareTaskIds: ['existing-task', 'running-task'],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      captionSource: 'data:image/png;base64,a',
    })
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('清空数据失败：clear failed'),
      'error',
    )
  })

  it('keeps the visible app state cleared when archive persistence fails after clearing stores', async () => {
    vi.mocked(clearTasks).mockResolvedValue(undefined)
    vi.mocked(clearImages).mockResolvedValue(undefined)
    vi.mocked(clearConversations).mockResolvedValue(undefined)
    vi.mocked(persistConversationMigration).mockRejectedValue(new Error('archive failed'))
    const showToast = vi.fn()
    const oldConversation = { id: 'conv-old', title: '旧会话', createdAt: 1, updatedAt: 1 }
    useStore.setState({
      tasks: [createTask('old-task')],
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,a' }],
      prompt: 'old prompt',
      conversations: [oldConversation],
      activeConversationId: oldConversation.id,
      favoriteCategories: [
        {
          id: 'cat-old',
          name: '旧分类',
          color: '#14b8a6',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      favoriteCategoriesInitialized: false,
      snippets: [
        {
          id: 'snippet-a',
          name: '片段',
          content: 'text',
          createdAt: 1,
          updatedAt: 1,
          sortOrder: 0,
        },
      ],
      batchNotes: { batchA: { text: 'note', updatedAt: 1 } },
      settings: { ...DEFAULT_SETTINGS, apiKey: 'old-key' },
      params: { ...DEFAULT_PARAMS, n: 4 },
      dismissedCodexCliPrompts: ['codex-cli'],
      showToast,
    })

    await expect(clearAllData()).rejects.toThrow('archive failed')

    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().inputImages).toEqual([])
    expect(useStore.getState().conversations).toEqual([
      expect.objectContaining({ id: '__archive__', title: '历史记录' }),
    ])
    expect(useStore.getState().activeConversationId).toBe('__archive__')
    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
    expect(useStore.getState().favoriteCategoriesInitialized).toBe(true)
    expect(useStore.getState().snippets).toEqual([])
    expect(useStore.getState().batchNotes).toEqual({})
    expect(useStore.getState().settings.apiKey).toBe('')
    expect(useStore.getState().prompt).toBe('')
    expect(useStore.getState().params).toEqual(DEFAULT_PARAMS)
    expect(useStore.getState().dismissedCodexCliPrompts).toEqual([])
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('清空数据失败：archive failed'),
      'error',
    )
  })

  it('exports favorite category metadata in the manifest', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    useStore.setState({
      favoriteCategories: [
        {
          id: 'cat-a',
          name: '角色',
          color: '#f59e0b',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      showToast: vi.fn(),
    })

    await exportData()

    expect(click).toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.favoriteCategories).toEqual([
      {
        id: 'cat-a',
        name: '角色',
        color: '#f59e0b',
        sortOrder: 0,
        createdAt: 1,
      },
    ])
  })

  it('revokes the export object URL even when the browser download click fails', async () => {
    const clickError = new Error('click blocked')
    const click = vi.fn(() => {
      throw clickError
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL,
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    const showToast = vi.fn()
    useStore.setState({ showToast })

    await exportData()

    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('导出失败'), 'error')
  })

  it('uses collectReferencedImageIds when deriving exported image fallback timestamps', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    const exportedTask = createTask('task-a')
    const showToast = vi.fn()
    useStore.setState({ showToast })
    vi.mocked(getAllTasks).mockResolvedValue([exportedTask])
    vi.mocked(collectReferencedImageIds).mockReturnValue(new Set(['image-a']))
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'image-a', blob: new Blob(['x']), mime: 'image/png' },
    ])
    const { storedImageToBytes } = await import('./db')
    vi.mocked(storedImageToBytes).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
    })

    await exportData()

    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('导出失败'), 'error')
    expect(click).toHaveBeenCalled()
    expect(collectReferencedImageIds).toHaveBeenCalledWith([exportedTask], [])
    expect(exportedBlob).not.toBeNull()
    const manifest = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))['manifest.json']),
    ) as ExportData
    expect(manifest.imageFiles['image-a']?.createdAt).toBe(exportedTask.createdAt)
  })

  it('exports only images referenced by exported tasks', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    vi.mocked(collectReferencedImageIds).mockImplementation((tasks, inputImages) => {
      const ids = new Set(inputImages.map((image) => image.id))
      for (const task of tasks) {
        for (const id of task.inputImageIds ?? []) ids.add(id)
        if (task.maskImageId) ids.add(task.maskImageId)
        for (const id of task.outputImages ?? []) ids.add(id)
      }
      return ids
    })
    const exportedTask = { ...createTask('task-live'), outputImages: ['live-image'] }
    vi.mocked(getAllTasks).mockResolvedValue([exportedTask])
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'live-image', blob: new Blob(['live']), mime: 'image/png' },
      { id: 'orphan-image', blob: new Blob(['orphan']), mime: 'image/png' },
    ])
    vi.mocked(storedImageToBytes).mockImplementation(async (image) => ({
      bytes: new TextEncoder().encode(image.id),
      mime: 'image/png',
    }))

    await exportData()

    expect(click).toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(Object.keys(manifest.imageFiles).sort()).toEqual(['live-image'])
    expect(unzipped['images/live-image.png']).toBeDefined()
    expect(unzipped['images/orphan-image.png']).toBeUndefined()
    expect(storedImageToBytes).toHaveBeenCalledTimes(1)
  })

  it('exports the current input draft and its reference images', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    vi.mocked(collectReferencedImageIds).mockImplementation((tasks, inputImages) => {
      const ids = new Set(inputImages.map((image) => image.id))
      for (const task of tasks) {
        for (const id of task.inputImageIds ?? []) ids.add(id)
        if (task.maskImageId) ids.add(task.maskImageId)
        for (const id of task.outputImages ?? []) ids.add(id)
      }
      return ids
    })
    useStore.setState({
      prompt: 'draft prompt',
      params: { ...DEFAULT_PARAMS, n: 2, stylePreset: 'film' },
      inputImages: [{ id: 'draft-image', dataUrl: 'data:image/png;base64,ZHJhZnQ=' }],
      showToast: vi.fn(),
    })
    vi.mocked(getAllImages).mockResolvedValue([
      {
        id: 'draft-image',
        blob: new Blob(['draft']),
        mime: 'image/png',
        createdAt: 12,
        source: 'upload',
      },
      { id: 'orphan-image', blob: new Blob(['orphan']), mime: 'image/png' },
    ])
    vi.mocked(storedImageToBytes).mockImplementation(async (image) => ({
      bytes: new TextEncoder().encode(image.id),
      mime: 'image/png',
    }))

    await exportData()

    expect(click).toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.prompt).toBe('draft prompt')
    expect(manifest.params).toMatchObject({ n: 2, stylePreset: 'film' })
    expect(manifest.inputImages).toEqual([{ id: 'draft-image', dataUrl: '' }])
    expect(Object.keys(manifest.imageFiles)).toEqual(['draft-image'])
    expect(unzipped['images/draft-image.png']).toBeDefined()
    expect(unzipped['images/orphan-image.png']).toBeUndefined()
  })

  it('preserves non-raster image MIME types when exporting referenced images', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    const exportedTask = { ...createTask('task-svg'), outputImages: ['svg-image'] }
    vi.mocked(getAllTasks).mockResolvedValue([exportedTask])
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'svg-image', blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }), mime: 'image/svg+xml' },
    ])
    vi.mocked(storedImageToBytes).mockResolvedValue({
      bytes: new TextEncoder().encode('<svg/>'),
      mime: 'image/svg+xml',
    })

    await exportData()

    expect(click).toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.imageFiles['svg-image']).toMatchObject({
      path: 'images/svg-image.svg',
      mime: 'image/svg+xml',
    })
    expect(unzipped['images/svg-image.svg']).toBeDefined()
    expect(unzipped['images/svg-image.png']).toBeUndefined()
  })

  it('preserves imported image MIME from the backup manifest', async () => {
    const task = { ...createTask('task-svg'), outputImages: ['svg-image'] }
    const file = createImportFileWithImages(
      {
        version: 4,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        tasks: [task],
        imageFiles: {
          'svg-image': { path: 'images/svg-image.svg', mime: 'image/svg+xml' },
        },
      } as ExportData,
      {
        'images/svg-image.svg': new TextEncoder().encode('<svg/>'),
      },
    )

    await expect(importData(file, { mode: 'merge' })).resolves.toBe(true)

    expect(putImage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'svg-image',
        mime: 'image/svg+xml',
        blob: expect.objectContaining({ type: 'image/svg+xml' }),
      }),
    )
  })

  it('warns when unreadable referenced images are skipped from the export', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        click,
      })),
    })
    const showToast = vi.fn()
    const exportedTask = { ...createTask('task-live'), outputImages: ['bad-image'] }
    useStore.setState({ showToast })
    vi.mocked(getAllTasks).mockResolvedValue([exportedTask])
    vi.mocked(getAllImages).mockResolvedValue([
      { id: 'bad-image', dataUrl: 'data:image/png;base64,not-valid' },
    ])
    vi.mocked(storedImageToBytes).mockRejectedValue(new Error('decode failed'))

    await exportData()

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('备份不完整：1 张图片无法读取'),
      'error',
    )
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('导出失败'), 'error')
    expect(click).toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    const manifest = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))['manifest.json']),
    ) as ExportData
    expect(manifest.tasks.map((task) => task.id)).toEqual(['task-live'])
    expect(manifest.imageFiles).toEqual({})
  })

  it('clears local records before importing in replace mode', async () => {
    const task = createTask('imported-task')
    const file = createImportFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'replace' })

    // replace 时旧导出会在导入完成后跑一次 conversation reseed migration
    expect(dbCalls).toEqual([
      'clearTasks',
      'clearImages',
      'clearConversations',
      'persistConversationMigration',
    ])
  })

  it('clears transient UI references for replaced local data after replace import succeeds', async () => {
    const task = createTask('imported-task')
    useStore.setState({
      tasks: [createTask('old-task')],
      inputImages: [{ id: 'old-image', dataUrl: 'data:image/png;base64,a' }],
      selectedTaskIds: ['old-task'],
      detailTaskId: 'old-task',
      lineageTaskId: 'old-task',
      compareTaskIds: ['old-task', 'other-task'],
      lightboxImageId: 'old-image',
      lightboxImageList: ['old-image'],
      captionBatchImageIds: ['old-image'],
      captionSource: 'data:image/png;base64,a',
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
      conversations: [{ id: 'conv-imported', title: '导入', createdAt: 2, updatedAt: 2 }],
    })

    await importData(file, { mode: 'replace' })

    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: [],
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: [],
      captionBatchImageIds: null,
      captionSource: null,
    })
  })

  it('activates an imported non-archive conversation after replace import succeeds', async () => {
    const task = { ...createTask('imported-task'), conversationId: 'conv-imported' }
    useStore.setState({
      conversations: [{ id: 'old-conv', title: '旧会话', createdAt: 1, updatedAt: 1 }],
      activeConversationId: 'old-conv',
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
      conversations: [
        { id: '__archive__', title: '历史记录', createdAt: 1, updatedAt: 1 },
        { id: 'conv-imported', title: '导入', createdAt: 2, updatedAt: 2 },
      ],
    })

    await importData(file, { mode: 'replace' })

    expect(useStore.getState().activeConversationId).toBe('conv-imported')
  })

  it('restores the current input draft from replace backups', async () => {
    vi.mocked(collectReferencedImageIds).mockImplementation((tasks, inputImages) => {
      const ids = new Set(inputImages.map((image) => image.id))
      for (const task of tasks) {
        for (const id of task.inputImageIds ?? []) ids.add(id)
        if (task.maskImageId) ids.add(task.maskImageId)
        for (const id of task.outputImages ?? []) ids.add(id)
      }
      return ids
    })
    useStore.setState({
      prompt: 'old prompt',
      params: { ...DEFAULT_PARAMS, n: 4 },
      inputImages: [{ id: 'old-image', dataUrl: 'data:image/png;base64,b2xk' }],
      showToast: vi.fn(),
    })
    const file = createImportFileWithImages(
      {
        version: 5,
        exportedAt: new Date(0).toISOString(),
        settings: DEFAULT_SETTINGS,
        prompt: 'restored prompt',
        params: { ...DEFAULT_PARAMS, n: 2, stylePreset: 'film' },
        inputImages: [
          { id: 'draft-image', dataUrl: '' },
          { id: 'missing-image', dataUrl: '' },
        ],
        tasks: [],
        imageFiles: {
          'draft-image': {
            path: 'images/draft-image.png',
            mime: 'image/png',
            createdAt: 12,
            source: 'upload',
          },
        },
      },
      {
        'images/draft-image.png': new TextEncoder().encode('draft'),
      },
    )

    await expect(importData(file, { mode: 'replace' })).resolves.toBe(true)

    expect(useStore.getState().prompt).toBe('restored prompt')
    expect(useStore.getState().params).toMatchObject({ n: 2, stylePreset: 'film' })
    expect(useStore.getState().inputImages).toEqual([
      { id: 'draft-image', dataUrl: 'data:image/png;base64,ZHJhZnQ=' },
    ])
    expect(putImage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'draft-image',
        mime: 'image/png',
      }),
    )
  })

  it('restores visible data when replace import fails while clearing the database', async () => {
    vi.mocked(clearTasks).mockRejectedValue(new Error('clear failed'))
    const showToast = vi.fn()
    const existingTask = createTask('existing-task')
    useStore.setState({
      tasks: [existingTask],
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,a' }],
      conversations: [{ id: 'conv-a', title: '会话', createdAt: 1, updatedAt: 1 }],
      activeConversationId: 'conv-a',
      selectedTaskIds: ['existing-task'],
      detailTaskId: 'existing-task',
      lineageTaskId: 'existing-task',
      compareTaskIds: ['existing-task', 'other-task'],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      captionSource: 'data:image/png;base64,a',
      showToast,
    })
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [createTask('imported-task')],
      imageFiles: {},
      conversations: [{ id: 'conv-imported', title: '导入', createdAt: 2, updatedAt: 2 }],
    })

    await expect(importData(file, { mode: 'replace' })).resolves.toBe(false)

    expect(useStore.getState().tasks).toEqual([existingTask])
    expect(useStore.getState().inputImages).toEqual([
      { id: 'input-a', dataUrl: 'data:image/png;base64,a' },
    ])
    expect(useStore.getState().conversations).toEqual([
      { id: 'conv-a', title: '会话', createdAt: 1, updatedAt: 1 },
    ])
    expect(useStore.getState().activeConversationId).toBe('conv-a')
    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: ['existing-task'],
      detailTaskId: 'existing-task',
      lineageTaskId: 'existing-task',
      compareTaskIds: ['existing-task', 'other-task'],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      captionSource: 'data:image/png;base64,a',
    })
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('替换导入失败：clear failed'),
      'error',
    )
  })

  it('leaves replace import in a cleared default state when persistence fails after clearing stores', async () => {
    vi.mocked(persistConversationMigration).mockRejectedValueOnce(
      new Error('task transaction failed'),
    )
    const showToast = vi.fn()
    const existingTask = createTask('existing-task')
    useStore.setState({
      tasks: [existingTask],
      inputImages: [{ id: 'input-a', dataUrl: 'data:image/png;base64,a' }],
      conversations: [{ id: 'conv-a', title: '会话', createdAt: 1, updatedAt: 1 }],
      activeConversationId: 'conv-a',
      favoriteCategories: [
        {
          id: 'cat-old',
          name: '旧分类',
          color: '#14b8a6',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      snippets: [
        {
          id: 'snippet-a',
          name: '片段',
          content: 'text',
          createdAt: 1,
          updatedAt: 1,
          sortOrder: 0,
        },
      ],
      batchNotes: { batchA: { text: 'note', updatedAt: 1 } },
      settings: { ...DEFAULT_SETTINGS, apiKey: 'old-key' },
      params: { ...DEFAULT_PARAMS, n: 4, stylePreset: 'film' },
      dismissedCodexCliPrompts: ['codex-cli'],
      selectedTaskIds: ['existing-task'],
      detailTaskId: 'existing-task',
      lineageTaskId: 'existing-task',
      compareTaskIds: ['existing-task', 'other-task'],
      lightboxImageId: 'input-a',
      lightboxImageList: ['input-a'],
      captionBatchImageIds: ['input-a'],
      captionSource: 'data:image/png;base64,a',
      showToast,
    })
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [createTask('imported-task')],
      imageFiles: {},
      conversations: [{ id: 'conv-imported', title: '导入', createdAt: 2, updatedAt: 2 }],
    })

    await expect(importData(file, { mode: 'replace' })).resolves.toBe(false)

    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().inputImages).toEqual([])
    expect(useStore.getState().conversations).toEqual([
      expect.objectContaining({ id: '__archive__', title: '历史记录' }),
    ])
    expect(useStore.getState().activeConversationId).toBe('__archive__')
    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
    expect(useStore.getState().snippets).toEqual([])
    expect(useStore.getState().batchNotes).toEqual({})
    expect(useStore.getState().settings.apiKey).toBe('')
    expect(useStore.getState().params).toEqual(DEFAULT_PARAMS)
    expect(useStore.getState().dismissedCodexCliPrompts).toEqual([])
    expect(useStore.getState()).toMatchObject({
      selectedTaskIds: [],
      detailTaskId: null,
      lineageTaskId: null,
      compareTaskIds: null,
      lightboxImageId: null,
      lightboxImageList: [],
      captionBatchImageIds: null,
      captionSource: null,
    })
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('替换导入失败：task transaction failed'),
      'error',
    )
  })

  it('keeps the default favorite category after replacing with a legacy backup', async () => {
    const task = createTask('legacy-task')
    const file = createImportFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'replace' })

    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
  })

  it('runs conversation reseed migration for legacy backups without conversations field', async () => {
    const taskWithCategory: TaskRecord = {
      ...createTask('legacy-task'),
      isFavorite: true,
      favoriteCategoryId: 'cat-a',
    }
    const taskWithoutCategory = createTask('legacy-archive-task')
    // 导入后 getAllTasks 返回这两个任务，迁移读到它们
    vi.mocked(getAllTasks).mockResolvedValue([taskWithCategory, taskWithoutCategory])
    useStore.setState({
      favoriteCategories: [
        {
          id: 'cat-a',
          name: '角色',
          color: '#f59e0b',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      conversations: [],
      activeConversationId: null,
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      favoriteCategories: [
        {
          id: 'cat-a',
          name: '角色',
          color: '#f59e0b',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      tasks: [taskWithCategory, taskWithoutCategory],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    // conversation reseed migration 应被调用，conversations 里应包含 cat-a + archive
    expect(persistConversationMigration).toHaveBeenCalled()
    const conversations = useStore.getState().conversations
    expect(conversations.map((c) => c.id).sort()).toEqual(['cat-a', '__archive__'].sort())
    // activeConversationId 自动激活非 archive 的对话
    expect(useStore.getState().activeConversationId).not.toBe('__archive__')
    expect(useStore.getState().activeConversationId).not.toBeNull()
  })

  it('uses imported conversations metadata directly when present', async () => {
    const taskWithConversation: TaskRecord = {
      ...createTask('with-conv'),
      conversationId: 'conv-imported',
    }
    vi.mocked(getAllTasks).mockResolvedValue([taskWithConversation])
    useStore.setState({
      favoriteCategories: [],
      conversations: [],
      activeConversationId: null,
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      conversations: [
        {
          id: 'conv-imported',
          title: '导入的对话',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      tasks: [taskWithConversation],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    const conversations = useStore.getState().conversations
    expect(conversations.some((c) => c.id === 'conv-imported')).toBe(true)
    expect(conversations.some((c) => c.id === '__archive__')).toBe(true)
  })

  it('routes imported tasks with missing conversation metadata to archive', async () => {
    const taskWithMissingConversation: TaskRecord = {
      ...createTask('missing-conv-task'),
      conversationId: 'missing-conv',
    }
    useStore.setState({
      favoriteCategories: [],
      conversations: [],
      activeConversationId: null,
      showToast: vi.fn(),
    })
    const file = createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      conversations: [
        {
          id: 'conv-imported',
          title: '导入的对话',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      tasks: [taskWithMissingConversation],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    expectPersistedTask('missing-conv-task').toMatchObject({
      conversationId: '__archive__',
    })
    expect(useStore.getState().tasks.find((task) => task.id === 'missing-conv-task')).toMatchObject(
      {
        conversationId: '__archive__',
      },
    )
  })
})

describe('prompt snippets export/import', () => {
  const snippetA = {
    id: 'snip-a',
    name: '光线',
    content: '{晨光|黄昏}',
    createdAt: 1,
    updatedAt: 1,
    sortOrder: 0,
  }
  const snippetB = {
    id: 'snip-b',
    name: '镜头',
    content: '85mm lens',
    createdAt: 2,
    updatedAt: 2,
    sortOrder: 1,
  }

  beforeEach(() => {
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getAllImages).mockResolvedValue([])
    vi.mocked(getAllConversations).mockResolvedValue([])
    vi.mocked(persistConversationMigration).mockResolvedValue(undefined)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      snippets: [],
      favoriteCategories: [],
      tasks: [],
      showToast: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeBackup(extra: Partial<ExportData>): File {
    return createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [],
      imageFiles: {},
      ...extra,
    })
  }

  it('exports snippets in the manifest', async () => {
    let exportedBlob: Blob | null = null
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ href: '', download: '', click })),
    })
    useStore.setState({ snippets: [snippetA] })

    await exportData()

    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.snippets).toEqual([snippetA])
  })

  it('merges imported snippets keeping local on id conflict', async () => {
    useStore.setState({ snippets: [{ ...snippetA, content: 'local-content' }] })
    const file = makeBackup({ snippets: [snippetA, snippetB] })

    await importData(file, { mode: 'merge' })

    expect(useStore.getState().snippets).toEqual([
      expect.objectContaining({ id: 'snip-a', content: 'local-content' }),
      expect.objectContaining({ id: 'snip-b', content: '85mm lens' }),
    ])
  })

  it('replaces local snippets in replace mode and clears them for legacy backups', async () => {
    useStore.setState({ snippets: [snippetA] })

    await importData(makeBackup({ snippets: [snippetB] }), { mode: 'replace' })
    expect(useStore.getState().snippets).toEqual([
      expect.objectContaining({ id: 'snip-b', sortOrder: 0 }),
    ])

    useStore.setState({ snippets: [snippetA] })
    // 旧备份:无 snippets 字段 → replace 清空
    await importData(makeBackup({}), { mode: 'replace' })
    expect(useStore.getState().snippets).toEqual([])
  })

  it('keeps local snippets when merging a legacy backup without snippets field', async () => {
    useStore.setState({ snippets: [snippetA] })

    await importData(makeBackup({}), { mode: 'merge' })

    expect(useStore.getState().snippets).toEqual([snippetA])
  })

  it('clears snippets on clearAllData', async () => {
    vi.mocked(clearTasks).mockResolvedValue(undefined)
    vi.mocked(clearImages).mockResolvedValue(undefined)
    vi.mocked(clearConversations).mockResolvedValue(undefined)
    useStore.setState({ snippets: [snippetA] })

    await clearAllData()

    expect(useStore.getState().snippets).toEqual([])
  })
})

describe('batch notes export/import', () => {
  beforeEach(() => {
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getAllImages).mockResolvedValue([])
    vi.mocked(getAllConversations).mockResolvedValue([])
    vi.mocked(persistConversationMigration).mockResolvedValue(undefined)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      batchNotes: {},
      snippets: [],
      favoriteCategories: [],
      tasks: [],
      showToast: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeBackup(extra: Partial<ExportData>): File {
    return createImportFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      tasks: [],
      imageFiles: {},
      ...extra,
    })
  }

  it('exports only notes whose batchId is referenced by tasks (orphans filtered)', async () => {
    const batchTask = { ...createTask('t1'), batchId: 'batch-live' }
    vi.mocked(getAllTasks).mockResolvedValue([batchTask])
    let exportedBlob: Blob | null = null
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn() })),
    })
    useStore.setState({
      batchNotes: {
        'batch-live': { text: '在用', updatedAt: 1 },
        'batch-orphan': { text: '孤儿', updatedAt: 1 },
      },
    })

    await exportData()

    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.batchNotes).toEqual({ 'batch-live': { text: '在用', updatedAt: 1 } })
  })

  it('merges notes keeping local on batchId conflict', async () => {
    useStore.setState({ batchNotes: { b1: { text: 'local', updatedAt: 1 } } })
    await importData(
      makeBackup({
        batchNotes: { b1: { text: 'imported', updatedAt: 2 }, b2: { text: 'new', updatedAt: 2 } },
      }),
      { mode: 'merge' },
    )

    expect(useStore.getState().batchNotes).toEqual({
      b1: { text: 'local', updatedAt: 1 },
      b2: { text: 'new', updatedAt: 2 },
    })
  })

  it('replaces notes in replace mode and clears for legacy backups', async () => {
    useStore.setState({ batchNotes: { b1: { text: 'local', updatedAt: 1 } } })
    await importData(makeBackup({ batchNotes: { b9: { text: 'only', updatedAt: 9 } } }), {
      mode: 'replace',
    })
    expect(useStore.getState().batchNotes).toEqual({ b9: { text: 'only', updatedAt: 9 } })

    useStore.setState({ batchNotes: { b1: { text: 'local', updatedAt: 1 } } })
    await importData(makeBackup({}), { mode: 'replace' })
    expect(useStore.getState().batchNotes).toEqual({})
  })

  it('clears batch notes on clearAllData', async () => {
    vi.mocked(clearTasks).mockResolvedValue(undefined)
    vi.mocked(clearImages).mockResolvedValue(undefined)
    vi.mocked(clearConversations).mockResolvedValue(undefined)
    useStore.setState({ batchNotes: { b1: { text: 'x', updatedAt: 1 } } })

    await clearAllData()

    expect(useStore.getState().batchNotes).toEqual({})
  })
})
