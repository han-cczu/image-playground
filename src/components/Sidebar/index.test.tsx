// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './index'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useStore } from '../../store'
import { DEFAULT_PARAMS } from '../../types'

const originalWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')!

function resizeTo(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  fireEvent.resize(window)
}

function seedCreationContext() {
  const preserved = {
    prompt: '保留这段正在编辑的提示词',
    inputImages: [{ id: 'reference-a', dataUrl: 'data:image/png;base64,reference' }],
    params: { ...DEFAULT_PARAMS, n: 3, size: '1024x1536' },
    searchQuery: '已输入搜索条件',
    filterStatus: 'running' as const,
    activeConversationId: 'conv-a',
  }
  useStore.setState({
    ...preserved,
    conversations: [{ id: 'conv-a', title: '产品摄影', createdAt: 1, updatedAt: 1 }],
    favoriteCategories: [
      { id: 'category-a', name: '产品', color: '#00a76f', sortOrder: 0, createdAt: 1 },
    ],
    selectedTaskIds: ['selected-a'],
  })
  return preserved
}

function ExtraBodyLock({ active }: { active: boolean }) {
  useLockBodyScroll(active)
  return null
}

describe('Sidebar', () => {
  beforeEach(() => resizeTo(1440))

  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
    useStore.setState(useStore.getInitialState(), true)
    Object.defineProperty(window, 'innerWidth', originalWidthDescriptor)
  })

  it.each([
    {
      name: '全部作品（从分类进入）',
      button: '打开图库（全部任务）',
      initialFavorite: false,
      initialCategory: 'category-a',
      nextFavorite: false,
    },
    {
      name: '全部作品（从收藏进入）',
      button: '打开图库（全部任务）',
      initialFavorite: true,
      initialCategory: null,
      nextFavorite: false,
    },
    {
      name: '我的收藏',
      button: '打开我的收藏',
      initialFavorite: false,
      initialCategory: 'category-a',
      nextFavorite: true,
    },
  ])(
    '$name 只切换展示和收藏范围，保留创作目标、全局输入与搜索状态',
    ({ button, initialFavorite, initialCategory, nextFavorite }) => {
      const preserved = seedCreationContext()
      const onMobileClose = vi.fn()
      useStore.setState({
        galleryView: false,
        filterFavorite: initialFavorite,
        filterFavoriteCategoryId: initialCategory,
      })
      render(<Sidebar mobileOpen={false} onMobileClose={onMobileClose} />)

      fireEvent.click(screen.getByRole('button', { name: button }))

      expect(useStore.getState()).toMatchObject({
        ...preserved,
        galleryView: true,
        filterFavorite: nextFavorite,
        filterFavoriteCategoryId: null,
        selectedTaskIds: [],
      })
      expect(useStore.getState().inputImages).toBe(preserved.inputImages)
      expect(useStore.getState().params).toBe(preserved.params)
      expect(screen.getByRole('button', { name: button }).getAttribute('aria-current')).toBe('page')
      expect(onMobileClose).toHaveBeenCalledOnce()
    },
  )

  it.each([
    { button: '打开图库（全部任务）', favorite: false },
    { button: '打开我的收藏', favorite: true },
  ])('重复点击 $button 不会清空选择或全局输入', ({ button, favorite }) => {
    const preserved = seedCreationContext()
    useStore.setState({
      galleryView: true,
      filterFavorite: favorite,
      filterFavoriteCategoryId: null,
    })
    render(<Sidebar mobileOpen={false} onMobileClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: button }))
    fireEvent.click(screen.getByRole('button', { name: button }))

    expect(useStore.getState()).toMatchObject({ ...preserved, selectedTaskIds: ['selected-a'] })
  })

  it.each([false, true])('平板自动紧凑和临时展开不会覆盖桌面折叠偏好 %s', (sidebarCollapsed) => {
    useStore.setState({ sidebarCollapsed })
    const { container } = render(<Sidebar mobileOpen={false} onMobileClose={vi.fn()} />)
    const sidebar = container.querySelector('aside')!
    expect(sidebar.getAttribute('data-collapsed')).toBe(String(sidebarCollapsed))

    resizeTo(900)
    expect(sidebar.getAttribute('data-collapsed')).toBe('true')
    expect(useStore.getState().sidebarCollapsed).toBe(sidebarCollapsed)
    fireEvent.click(screen.getByRole('button', { name: '展开 sidebar' }))
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    expect(useStore.getState().sidebarCollapsed).toBe(sidebarCollapsed)

    resizeTo(600)
    resizeTo(900)
    expect(sidebar.getAttribute('data-collapsed')).toBe('false')
    resizeTo(1440)
    expect(sidebar.getAttribute('data-collapsed')).toBe(String(sidebarCollapsed))
    expect(useStore.getState().sidebarCollapsed).toBe(sidebarCollapsed)

    fireEvent.click(
      screen.getByRole('button', { name: sidebarCollapsed ? '展开 sidebar' : '折叠 sidebar' }),
    )
    expect(useStore.getState().sidebarCollapsed).toBe(!sidebarCollapsed)
    resizeTo(900)
    resizeTo(1440)
    expect(sidebar.getAttribute('data-collapsed')).toBe(String(!sidebarCollapsed))
  })

  it('keeps body scrolling locked when the mobile drawer closes under another active overlay', () => {
    const onMobileClose = vi.fn()

    function Harness({ mobileOpen, overlayOpen }: { mobileOpen: boolean; overlayOpen: boolean }) {
      return (
        <>
          <Sidebar mobileOpen={mobileOpen} onMobileClose={onMobileClose} />
          <ExtraBodyLock active={overlayOpen} />
        </>
      )
    }

    const { rerender } = render(<Harness mobileOpen overlayOpen />)
    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Harness mobileOpen={false} overlayOpen />)

    expect(document.body.style.overflow).toBe('hidden')
  })
})
