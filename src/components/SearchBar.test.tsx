// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SearchBar from './SearchBar'
import { useStore } from '../store'
import { DEFAULT_PARAMS } from '../types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useStore.setState(useStore.getInitialState(), true)
})

describe('SearchBar', () => {
  it.each([
    { searchQuery: '', filterFavorite: true, filterFavoriteCategoryId: null },
    { searchQuery: '原搜索', filterFavorite: false, filterFavoriteCategoryId: 'category-a' },
  ])('清除筛选会丢弃尚未提交的搜索草稿，原搜索为 $searchQuery', (filters) => {
    vi.useFakeTimers()
    const creation = {
      prompt: '正在编辑的创作提示词',
      inputImages: [{ id: 'reference-a', dataUrl: 'data:image/png;base64,reference' }],
      params: { ...DEFAULT_PARAMS, n: 2 },
      activeConversationId: 'conv-a',
      galleryView: true,
    }
    useStore.setState({
      ...creation,
      ...filters,
      searchQueryVersion: 0,
      filterStatus: 'running',
      selectedTaskIds: ['selected-a'],
      favoriteCategories: [
        { id: 'category-a', name: '产品', color: '#00a76f', sortOrder: 0, createdAt: 1 },
      ],
    })
    render(<SearchBar />)
    const input = screen.getByRole('textbox', { name: '搜索提示词和参数' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '尚未防抖写入的搜索词' } })
    expect(useStore.getState().searchQuery).toBe(filters.searchQuery)

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(input.value).toBe('')
    act(() => vi.advanceTimersByTime(500))

    expect(useStore.getState()).toMatchObject({
      ...creation,
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterFavoriteCategoryId: null,
      selectedTaskIds: [],
    })
    expect(input.value).toBe('')
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
  })

  it('drops a pending debounce draft after an external search change', () => {
    vi.useFakeTimers()
    useStore.setState({ searchQuery: '', searchQueryVersion: 0 })

    render(<SearchBar />)
    const input = screen.getByPlaceholderText('搜索提示词、参数...') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'draft' } })
    expect(input.value).toBe('draft')

    act(() => useStore.getState().setSearchQuery('external'))
    expect(input.value).toBe('external')

    act(() => useStore.getState().setSearchQuery(''))
    expect(input.value).toBe('')

    act(() => vi.advanceTimersByTime(250))

    expect(useStore.getState().searchQuery).toBe('')
    expect(input.value).toBe('')
  })
})
