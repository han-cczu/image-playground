import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './api/apiProfiles'
import type { ExportData, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'
import { importData, redactSettingsForExport } from './exportImport'
import {
  clearImages,
  clearTasks,
  getAllImages,
  getAllTasks,
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
      tasks: [],
      toast: null,
      showToast: vi.fn(),
    })
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
    })

    expect(JSON.stringify(redacted)).not.toContain('legacy-secret')
    expect(JSON.stringify(redacted)).not.toContain('profile-secret')
    expect(JSON.stringify(redacted)).not.toContain('gemini-secret')
    expect(redacted.apiKey).toBe('')
    expect(redacted.profiles.every((profile) => profile.apiKey === '')).toBe(true)
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

    expect(dbCalls).toEqual([])
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

    expect(dbCalls).toEqual(['clearTasks', 'clearImages', 'putTask'])
  })
})
