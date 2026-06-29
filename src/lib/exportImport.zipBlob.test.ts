import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './api/apiProfiles'
import { exportData } from './exportImport'
import { getAllConversations, getAllImages, getAllTasks } from './db'
import { useStore } from '../store'

const fflateMocks = vi.hoisted(() => ({
  zip: vi.fn(),
}))

vi.mock('fflate', () => ({
  zip: fflateMocks.zip,
  unzip: vi.fn(),
  strToU8: (value: string) => new TextEncoder().encode(value),
  strFromU8: (value: Uint8Array) => new TextDecoder().decode(value),
}))

vi.mock('./db', () => ({
  getAllTasks: vi.fn(),
  getAllImages: vi.fn(),
  getAllConversations: vi.fn(),
  putImage: vi.fn(),
  clearTasks: vi.fn(),
  clearImages: vi.fn(),
  clearConversations: vi.fn(),
  storedImageToBytes: vi.fn(),
  persistConversationMigration: vi.fn(),
  deleteImage: vi.fn(),
}))

vi.mock('./imageCache', () => ({
  clearImageCache: vi.fn(),
  deleteCachedImage: vi.fn(),
}))

describe('exportData zip blob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(getAllTasks).mockResolvedValue([])
    vi.mocked(getAllImages).mockResolvedValue([])
    vi.mocked(getAllConversations).mockResolvedValue([])
    useStore.setState({
      settings: DEFAULT_SETTINGS,
      favoriteCategories: [],
      snippets: [],
      batchNotes: {},
      showToast: vi.fn(),
    })
  })

  it('downloads only the returned zip view bytes when fflate returns a subarray', async () => {
    const backing = new Uint8Array([9, 9, 80, 75, 3, 4, 8, 8])
    const zipView = backing.subarray(2, 6)
    fflateMocks.zip.mockImplementation((_files, _options, callback) => {
      callback(null, zipView)
      return vi.fn()
    })

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

    await exportData()

    expect(exportedBlob).not.toBeNull()
    const bytes = new Uint8Array(await exportedBlob!.arrayBuffer())
    expect([...bytes]).toEqual([...zipView])
  })
})
