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
  getAllConversations,
  getAllImages,
  getAllTasks,
  persistConversationMigration,
  putImage,
  putTask,
} from './db'

vi.mock('./db', () => ({
  getAllTasks: vi.fn(),
  putTask: vi.fn(),
  clearTasks: vi.fn(),
  getAllImages: vi.fn(),
  putImage: vi.fn(),
  clearImages: vi.fn(),
  storedImageToBytes: vi.fn(),
  getAllConversations: vi.fn(),
  persistConversationMigration: vi.fn(),
  clearConversations: vi.fn(),
}))

vi.mock('./imageCache', () => ({
  clearImageCache: vi.fn(),
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

describe('export/import reliability', () => {
  beforeEach(() => {
    dbCalls.length = 0
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getAllImages).mockResolvedValue([])
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
      toast: null,
      showToast: vi.fn(),
    })
  })

  afterEach(() => {
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
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          apiKey: 'imported-secret',
        }],
      },
      tasks: [],
      imageFiles: {},
    })

    await expect(importData(file)).resolves.toBe(true)

    expect(useStore.getState().settings.apiKey).toBe('imported-secret')
    expect(useStore.getState().settings.profiles[0].apiKey).toBe('imported-secret')
  })

  it('imports only missing records in merge mode', async () => {
    const task = createTask('imported-task')
    vi.mocked(getAllTasks)
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([task])
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

  it('imports favorite category metadata and task assignments', async () => {
    const task = createTask('categorized-task')
    task.isFavorite = true
    task.favoriteCategoryId = 'cat-a'
    const file = createImportFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      settings: DEFAULT_SETTINGS,
      favoriteCategories: [{
        id: 'cat-a',
        name: '角色',
        color: '#f59e0b',
        sortOrder: 0,
        createdAt: 1,
      }],
      tasks: [task],
      imageFiles: {},
    })

    await importData(file, { mode: 'merge' })

    expect(useStore.getState().favoriteCategories).toEqual([{
      id: 'cat-a',
      name: '角色',
      color: '#f59e0b',
      sortOrder: 0,
      createdAt: 1,
    }])
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'categorized-task',
      favoriteCategoryId: 'cat-a',
    }))
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

    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dangling-category-task',
      favoriteCategoryId: null,
    }))
  })

  it('does not use local category metadata to validate imported task assignments', async () => {
    const task = createTask('local-id-task')
    task.isFavorite = true
    task.favoriteCategoryId = 'cat-local'
    useStore.setState({
      favoriteCategories: [{
        id: 'cat-local',
        name: '本地分类',
        color: '#14b8a6',
        sortOrder: 0,
        createdAt: 1,
      }],
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

    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'local-id-task',
      favoriteCategoryId: null,
    }))
  })

  it('resets cleared app data with the default favorite category', async () => {
    await clearAllData()

    expect(useStore.getState().favoriteCategories).toEqual([
      expect.objectContaining({
        name: '默认分类',
        color: DEFAULT_FAVORITE_CATEGORY_COLOR,
        sortOrder: 0,
      }),
    ])
  })

  it('clears the conversations object store when resetting all data', async () => {
    await clearAllData()
    expect(dbCalls).toContain('clearConversations')
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
      favoriteCategories: [{
        id: 'cat-a',
        name: '角色',
        color: '#f59e0b',
        sortOrder: 0,
        createdAt: 1,
      }],
      showToast: vi.fn(),
    })

    await exportData()

    expect(click).toHaveBeenCalled()
    expect(exportedBlob).not.toBeNull()
    const unzipped = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as ExportData
    expect(manifest.favoriteCategories).toEqual([{
      id: 'cat-a',
      name: '角色',
      color: '#f59e0b',
      sortOrder: 0,
      createdAt: 1,
    }])
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
      'putTask',
      'persistConversationMigration',
    ])
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
    expect(conversations.map((c) => c.id).sort()).toEqual(
      ['cat-a', '__archive__'].sort(),
    )
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
})

describe('prompt snippets export/import', () => {
  const snippetA = {
    id: 'snip-a', name: '光线', content: '{晨光|黄昏}', createdAt: 1, updatedAt: 1, sortOrder: 0,
  }
  const snippetB = {
    id: 'snip-b', name: '镜头', content: '85mm lens', createdAt: 2, updatedAt: 2, sortOrder: 1,
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
