// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DataManagementSection } from './DataManagementSection'
import type { StorageStats } from '../../lib/storageStats'

// 项目未开启 vitest globals,RTL 的自动 cleanup 不生效,需显式清理避免多次 render 在 document 累积。
// unstubAllGlobals 必须在 afterEach 而非测试体末尾:断言失败抛出时残缺 stub 会泄漏到后续用例。
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function makeStats(overrides: Partial<StorageStats> = {}): StorageStats {
  return {
    totalBytes: 1024,
    imageCount: 1,
    bySource: {
      upload: { count: 1, bytes: 1024 },
      generated: { count: 0, bytes: 0 },
      mask: { count: 0, bytes: 0 },
      unknown: { count: 0, bytes: 0 },
    },
    orphanCount: 0,
    orphanBytes: 0,
    quota: { usage: 2048, quota: 1024 * 1024 },
    persisted: false,
    ...overrides,
  }
}

function renderSection(stats: StorageStats | null, props: Partial<Parameters<typeof DataManagementSection>[0]> = {}) {
  return render(
    <DataManagementSection
      storageStats={stats}
      storageLoading={false}
      onPruneOrphans={vi.fn()}
      onExport={vi.fn()}
      onImport={vi.fn(async () => {})}
      onClearAll={vi.fn()}
      onConfirmReplaceImport={vi.fn()}
      onConfirmClearAll={vi.fn()}
      {...props}
    />,
  )
}

describe('DataManagementSection 持久化徽标(H4)', () => {
  it('persisted=false 显示风险提示与「申请持久化」按钮', () => {
    renderSection(makeStats({ persisted: false }))
    expect(screen.getByText(/未持久化/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '申请持久化' })).toBeTruthy()
  })

  it('persisted=true 显示已授权徽标,不出现申请按钮', () => {
    renderSection(makeStats({ persisted: true }))
    expect(screen.getByText(/已获持久化授权/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '申请持久化' })).toBeNull()
  })

  it('persisted=null(API 不支持)整行不渲染', () => {
    renderSection(makeStats({ persisted: null }))
    expect(screen.queryByText(/未持久化/)).toBeNull()
    expect(screen.queryByText(/已获持久化授权/)).toBeNull()
  })

  it('申请被浏览器拒绝时给出显式反馈而非静默(按钮变「重试」)', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, storage: { persist: vi.fn(async () => false) } })
    renderSection(makeStats({ persisted: false }))
    fireEvent.click(screen.getByRole('button', { name: '申请持久化' }))
    await waitFor(() => {
      expect(screen.getByText(/浏览器未授予持久化/)).toBeTruthy()
      expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    })
  })

  it('申请成功后切换为已授权徽标', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, storage: { persist: vi.fn(async () => true) } })
    renderSection(makeStats({ persisted: false }))
    fireEvent.click(screen.getByRole('button', { name: '申请持久化' }))
    await waitFor(() => {
      expect(screen.getByText(/已获持久化授权/)).toBeTruthy()
    })
  })
})

describe('DataManagementSection 导出/导入忙碌态(M13)', () => {
  it('导出进行中按钮禁用并显示「导出中…」,完成后恢复', async () => {
    let release!: () => void
    const onExport = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    renderSection(makeStats(), { onExport })

    fireEvent.click(screen.getByRole('button', { name: /导出/ }))
    expect(screen.getByRole('button', { name: /导出中/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /合并导入/ })).toHaveProperty('disabled', true)

    release()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '导出' })).toHaveProperty('disabled', false)
    })
    expect(onExport).toHaveBeenCalledOnce()
  })

  it('忙碌期间重复点击导出不重入', () => {
    const onExport = vi.fn(() => new Promise<void>(() => {}))
    renderSection(makeStats(), { onExport })
    const button = screen.getByRole('button', { name: /导出/ })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onExport).toHaveBeenCalledOnce()
  })
})
