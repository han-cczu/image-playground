// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SearchBar from './SearchBar'
import { useStore } from '../store'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  const initial = useStore.getInitialState()
  useStore.setState({
    searchQuery: initial.searchQuery,
    searchQueryVersion: initial.searchQueryVersion,
    filterStatus: initial.filterStatus,
    filterFavorite: initial.filterFavorite,
    filterFavoriteCategoryId: initial.filterFavoriteCategoryId,
    favoriteCategories: initial.favoriteCategories,
  })
})

describe('SearchBar', () => {
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
