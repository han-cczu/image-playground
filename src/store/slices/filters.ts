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
  setSelectedTaskIds: (ids) => set((s) => {
    const next = typeof ids === 'function' ? ids(s.selectedTaskIds) : ids
    // 内容相等(含顺序)时原样返回旧 state,避免无谓换引用触发订阅方重渲染(兜底各调用方)。
    // 注意:persist 在 set() 后仍会无条件落盘,高频路径需调用方比较后跳过 set(见 TaskGrid 框选)
    if (next.length === s.selectedTaskIds.length && next.every((id, i) => id === s.selectedTaskIds[i])) {
      return s
    }
    return { selectedTaskIds: next }
  }),
  toggleTaskSelection: (id, force) => set((s) => {
    const isSelected = s.selectedTaskIds.includes(id)
    const shouldSelect = force === undefined ? !isSelected : force
    if (shouldSelect && !isSelected) return { selectedTaskIds: [...s.selectedTaskIds, id] }
    if (!shouldSelect && isSelected) return { selectedTaskIds: s.selectedTaskIds.filter((x) => x !== id) }
    return s
  }),
  clearSelection: () => set({ selectedTaskIds: [] }),
})
