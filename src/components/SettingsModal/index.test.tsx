// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettingsModal from './index'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../lib/api/apiProfiles'
import { clearAllData, exportData, importData, useStore } from '../../store'
import { computeStorageStats, pruneOrphanImages } from '../../lib/storageStats'
import type { StorageStats } from '../../lib/storageStats'

vi.mock('../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store')>()
  return {
    ...actual,
    clearAllData: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
  }
})

vi.mock('../../lib/storageStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/storageStats')>()
  return {
    ...actual,
    computeStorageStats: vi.fn(),
    pruneOrphanImages: vi.fn(),
  }
})

function resetStore() {
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    inputImages: [],
    favoriteCategories: [],
    conversations: [],
    activeConversationId: null,
    showSettings: true,
    confirmDialog: null,
    toast: null,
    showToast: vi.fn(),
  })
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeStats(totalBytes: number, imageCount: number): StorageStats {
  return {
    totalBytes,
    imageCount,
    bySource: {
      upload: { count: imageCount, bytes: totalBytes },
      generated: { count: 0, bytes: 0 },
      mask: { count: 0, bytes: 0 },
      unknown: { count: 0, bytes: 0 },
    },
    orphanCount: 0,
    orphanBytes: 0,
    quota: null,
    persisted: null,
  }
}

function selectSettingsSection(section: string) {
  fireEvent.change(screen.getByRole('combobox', { name: '设置分类' }), {
    target: { value: section },
  })
}

describe('SettingsModal storage stats', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(exportData).mockReset()
    vi.mocked(exportData).mockResolvedValue(undefined)
    vi.mocked(clearAllData).mockReset()
    vi.mocked(clearAllData).mockResolvedValue(undefined)
    vi.mocked(importData).mockReset()
    vi.mocked(importData).mockResolvedValue(false)
    vi.mocked(computeStorageStats).mockResolvedValue({
      totalBytes: 0,
      imageCount: 0,
      bySource: {
        upload: { count: 0, bytes: 0 },
        generated: { count: 0, bytes: 0 },
        mask: { count: 0, bytes: 0 },
        unknown: { count: 0, bytes: 0 },
      },
      orphanCount: 0,
      orphanBytes: 0,
      quota: null,
      persisted: null,
    })
    vi.mocked(pruneOrphanImages).mockReset()
    vi.mocked(pruneOrphanImages).mockResolvedValue({ deletedCount: 0, deletedBytes: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('reports storage stat refresh failures when opening settings', async () => {
    vi.mocked(computeStorageStats).mockRejectedValue(new Error('stats failed'))
    const showToast = vi.fn()
    useStore.setState({ showToast })

    render(<SettingsModal />)
    selectSettingsSection('data')

    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('统计本地占用失败：stats failed'),
        'error',
      )
    })
  })

  it('syncs the draft after clear-all changes settings but rejects', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'old-key',
        profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiKey: 'old-key' }],
      }),
    })
    vi.mocked(clearAllData).mockImplementation(async () => {
      useStore.getState().setSettings({ ...DEFAULT_SETTINGS })
      throw new Error('archive failed')
    })

    render(<SettingsModal />)
    selectSettingsSection('data')

    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '清空所有数据' }))
    const action = useStore.getState().confirmDialog?.action
    expect(action).toBeTypeOf('function')

    let thrown: unknown
    await act(async () => {
      try {
        await action?.()
      } catch (err) {
        thrown = err
      }
    })

    expect(thrown).toBeInstanceOf(Error)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    })
  })

  it('ignores stale storage stat refreshes from a previous settings session', async () => {
    const first = createDeferred<StorageStats>()
    const second = createDeferred<StorageStats>()
    vi.mocked(computeStorageStats)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    render(<SettingsModal />)
    selectSettingsSection('data')
    expect(screen.getByText('正在统计本地占用…')).toBeTruthy()

    act(() => {
      useStore.getState().setShowSettings(false)
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull()
    })

    act(() => {
      useStore.getState().setShowSettings(true)
    })
    selectSettingsSection('data')
    expect(screen.getByText('正在统计本地占用…')).toBeTruthy()

    await act(async () => {
      first.resolve(makeStats(1024, 1))
      await Promise.resolve()
    })
    expect(screen.getByText('正在统计本地占用…')).toBeTruthy()
    expect(screen.queryByText('1.0 KB · 1 张')).toBeNull()

    await act(async () => {
      second.resolve(makeStats(2048, 2))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByText('2.0 KB · 2 张')).toBeTruthy()
    })
  })

  it('ignores storage stat failures after the settings panel closes', async () => {
    const stats = createDeferred<StorageStats>()
    const showToast = vi.fn()
    vi.mocked(computeStorageStats).mockReturnValueOnce(stats.promise)
    useStore.setState({ showToast })

    render(<SettingsModal />)
    selectSettingsSection('data')
    expect(screen.getByText('正在统计本地占用…')).toBeTruthy()

    act(() => {
      useStore.getState().setShowSettings(false)
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull()
    })

    await act(async () => {
      stats.reject(new Error('stats failed after close'))
      await stats.promise.catch(() => undefined)
    })

    expect(showToast).not.toHaveBeenCalled()
  })

  it('refreshes storage stats after clearing all data', async () => {
    vi.mocked(computeStorageStats)
      .mockResolvedValueOnce(makeStats(1024, 1))
      .mockResolvedValueOnce(makeStats(0, 0))

    render(<SettingsModal />)
    selectSettingsSection('data')

    await screen.findByText('1.0 KB · 1 张')
    fireEvent.click(screen.getByRole('button', { name: '清空所有数据' }))
    const action = useStore.getState().confirmDialog?.action
    expect(action).toBeTypeOf('function')

    await act(async () => {
      await action?.()
    })

    await waitFor(() => {
      expect(screen.getByText('0 B · 0 张')).toBeTruthy()
    })
  })

  it('refreshes storage stats after a successful import', async () => {
    vi.mocked(computeStorageStats)
      .mockResolvedValueOnce(makeStats(1024, 1))
      .mockResolvedValueOnce(makeStats(2048, 2))
    vi.mocked(importData).mockResolvedValueOnce(true)

    const { container } = render(<SettingsModal />)
    selectSettingsSection('data')

    await screen.findByText('1.0 KB · 1 张')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()

    fireEvent.change(input!, {
      target: { files: [new File(['backup'], 'backup.zip', { type: 'application/zip' })] },
    })

    await waitFor(() => {
      expect(screen.getByText('2.0 KB · 2 张')).toBeTruthy()
    })
    expect(importData).toHaveBeenCalledWith(expect.any(File), { mode: 'merge' })
  })

  it('reports delayed favorite-category deletion failures through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const deleteDone = createDeferred<void>()
    useStore.setState({
      showToast: oldToast,
      favoriteCategories: [
        {
          id: 'cat-a',
          name: 'Portraits',
          color: '#60a5fa',
          sortOrder: 0,
          createdAt: 1,
        },
      ],
      deleteFavoriteCategory: vi.fn(() => deleteDone.promise),
    })

    render(<SettingsModal />)
    selectSettingsSection('data')

    selectSettingsSection('favorites')
    fireEvent.click(screen.getByRole('button', { name: '删除分类' }))
    const action = useStore.getState().confirmDialog?.action
    expect(action).toBeTypeOf('function')

    useStore.setState({ showToast: latestToast })
    let result: unknown
    act(() => {
      result = action?.()
    })
    expect(result).toHaveProperty('then')

    await act(async () => {
      deleteDone.reject(new Error('db locked'))
      await result
    })

    expect(latestToast).toHaveBeenCalledWith('删除分类失败：db locked', 'error')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('returns the orphan-pruning promise from the confirmation action', async () => {
    const pruneDone = createDeferred<{ deletedCount: number; deletedBytes: number }>()
    vi.mocked(computeStorageStats).mockResolvedValueOnce({
      ...makeStats(4096, 2),
      orphanCount: 2,
      orphanBytes: 2048,
    })
    vi.mocked(pruneOrphanImages).mockReturnValueOnce(pruneDone.promise)

    render(<SettingsModal />)
    selectSettingsSection('data')

    await screen.findByText('2 张孤儿图 · 约 2.0 KB')
    fireEvent.click(screen.getByRole('button', { name: '清理' }))
    const action = useStore.getState().confirmDialog?.action
    expect(action).toBeTypeOf('function')

    let result: unknown
    act(() => {
      result = action?.()
    })
    expect(result).toHaveProperty('then')

    await act(async () => {
      pruneDone.resolve({ deletedCount: 1, deletedBytes: 1024 })
      await result
    })

    expect(pruneOrphanImages).toHaveBeenCalledOnce()
  })

  it('跨分类保留三套独立 API 草稿，并在保存时提交全部修改', async () => {
    render(<SettingsModal />)
    fireEvent.change(screen.getByLabelText('配置名称'), { target: { value: '图像配置草稿' } })
    fireEvent.change(screen.getByLabelText('请求超时 (秒)'), { target: { value: '111' } })

    selectSettingsSection('optimizer')
    fireEvent.change(screen.getByLabelText('配置名称'), { target: { value: '优化配置草稿' } })
    fireEvent.change(screen.getByLabelText('请求超时 (秒)'), { target: { value: '222' } })

    selectSettingsSection('captioner')
    fireEvent.change(screen.getByLabelText('配置名称'), { target: { value: '反推配置草稿' } })
    fireEvent.change(screen.getByLabelText('请求超时 (秒)'), { target: { value: '333' } })

    selectSettingsSection('api')
    expect(screen.getByLabelText('配置名称')).toHaveProperty('value', '图像配置草稿')
    expect(screen.getByLabelText('请求超时 (秒)')).toHaveProperty('value', '111')
    expect(useStore.getState().settings.profiles[0].name).not.toBe('图像配置草稿')

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const saved = useStore.getState().settings
    expect(saved.profiles[0]).toMatchObject({ name: '图像配置草稿', timeout: 111 })
    expect(saved.optimizerProfiles[0]).toMatchObject({ name: '优化配置草稿', timeout: 222 })
    expect(saved.captionerProfiles[0]).toMatchObject({ name: '反推配置草稿', timeout: 333 })
    expect(useStore.getState().showSettings).toBe(false)
  })

  it('取消跨分类修改时保留未保存确认，放弃后恢复原主题和运行参数', async () => {
    const before = useStore.getState().settings
    render(<SettingsModal />)
    selectSettingsSection('appearance')
    const nextTheme = before.theme === 'dark' ? '浅色' : '深色'
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(nextTheme) }))
    selectSettingsSection('runtime')
    fireEvent.change(screen.getByRole('combobox', { name: '批量并发上限' }), {
      target: { value: before.batchConcurrency === 2 ? '3' : '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(useStore.getState().showSettings).toBe(true)
    expect(useStore.getState().confirmDialog?.title).toBe('放弃未保存的改动?')
    await act(async () => {
      await useStore.getState().confirmDialog?.action()
    })
    expect(useStore.getState().showSettings).toBe(false)
    expect(useStore.getState().settings.theme).toBe(before.theme)
    expect(useStore.getState().settings.batchConcurrency).toBe(before.batchConcurrency)
  })

  it('保存外观使用现有主题设置且不改动其他 API 配置', () => {
    const before = useStore.getState().settings
    render(<SettingsModal />)
    selectSettingsSection('appearance')
    fireEvent.click(screen.getByRole('radio', { name: /深色/ }))
    expect(useStore.getState().settings.theme).toBe(before.theme)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(useStore.getState().settings.theme).toBe('dark')
    expect(useStore.getState().settings.profiles).toEqual(before.profiles)
    expect(useStore.getState().settings.optimizerProfiles).toEqual(before.optimizerProfiles)
    expect(useStore.getState().settings.captionerProfiles).toEqual(before.captionerProfiles)
  })

  it('导出期间切换分类不会重置忙碌状态或允许重复数据操作', async () => {
    const pendingExport = createDeferred<void>()
    vi.mocked(exportData).mockReturnValueOnce(pendingExport.promise)
    render(<SettingsModal />)
    selectSettingsSection('data')
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    selectSettingsSection('runtime')
    selectSettingsSection('data')
    expect(screen.getByRole('button', { name: '导出中…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '合并导入' })).toHaveProperty('disabled', true)
    expect(exportData).toHaveBeenCalledOnce()
    await act(async () => {
      pendingExport.resolve()
      await pendingExport.promise
    })
    expect(screen.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false)
  })
})
