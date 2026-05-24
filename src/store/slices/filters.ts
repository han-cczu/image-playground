import type { StateCreator } from 'zustand'
import type { AppState } from '../index'

export interface FiltersSlice {
  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void
  filterFavoriteCategoryId: string | null
  setFilterFavoriteCategoryId: (id: string | null) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void
}

export const createFiltersSlice: StateCreator<AppState, [], [], FiltersSlice> = (set) => ({
  // Search & filter
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  filterStatus: 'all',
  setFilterStatus: (status) => set({ filterStatus: status }),
  filterFavorite: false,
  setFilterFavorite: (f) => set({
    filterFavorite: f,
    ...(f ? { filterFavoriteCategoryId: null } : {}),
  }),
  filterFavoriteCategoryId: null,
  setFilterFavoriteCategoryId: (id) => set({
    filterFavoriteCategoryId: id,
    ...(id ? { filterFavorite: false } : {}),
  }),

  // Selection
  selectedTaskIds: [],
  setSelectedTaskIds: (ids) => set((s) => ({
    selectedTaskIds: typeof ids === 'function' ? ids(s.selectedTaskIds) : ids,
  })),
  toggleTaskSelection: (id, force) => set((s) => {
    const isSelected = s.selectedTaskIds.includes(id)
    const shouldSelect = force === undefined ? !isSelected : force
    if (shouldSelect && !isSelected) return { selectedTaskIds: [...s.selectedTaskIds, id] }
    if (!shouldSelect && isSelected) return { selectedTaskIds: s.selectedTaskIds.filter((x) => x !== id) }
    return s
  }),
  clearSelection: () => set({ selectedTaskIds: [] }),
})
