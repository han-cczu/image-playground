import type { StateCreator } from 'zustand'
import type { AppState } from '../index'
import { MAX_TASK_TEXT_LEN } from '../../lib/tasks'

function dedupeIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.slice(0, MAX_TASK_TEXT_LEN))))
}

export interface FiltersSlice {
  // 搜索和筛选
  searchQuery: string
  searchQueryVersion: number
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
  searchQueryVersion: 0,
  setSearchQuery: (q) =>
    set((s) => ({
      searchQuery: q,
      searchQueryVersion: s.searchQueryVersion + 1,
      ...(q !== s.searchQuery ? { selectedTaskIds: [] } : {}),
    })),
  filterStatus: 'all',
  setFilterStatus: (status) =>
    set((state) => ({
      filterStatus: status,
      ...(status !== state.filterStatus ? { selectedTaskIds: [] } : {}),
    })),
  filterFavorite: false,
  setFilterFavorite: (f) =>
    set((state) => ({
      filterFavorite: f,
      ...(f ? { filterFavoriteCategoryId: null } : {}),
      ...(f !== state.filterFavorite ? { selectedTaskIds: [] } : {}),
    })),
  filterFavoriteCategoryId: null,
  setFilterFavoriteCategoryId: (id) =>
    set((state) => {
      const nextId = id ? id.slice(0, MAX_TASK_TEXT_LEN) : null
      return {
        filterFavoriteCategoryId: nextId,
        ...(nextId ? { filterFavorite: false } : {}),
        ...(nextId !== state.filterFavoriteCategoryId ? { selectedTaskIds: [] } : {}),
      }
    }),

  // Selection
  selectedTaskIds: [],
  setSelectedTaskIds: (ids) =>
    set((s) => {
      const next = dedupeIds(typeof ids === 'function' ? ids(s.selectedTaskIds) : ids)
      // 内容相等(含顺序)时原样返回旧 state,避免无谓换引用触发订阅方重渲染(兜底各调用方)。
      // 注意:persist 在 set() 后仍会无条件落盘,高频路径需调用方比较后跳过 set(见 TaskGrid 框选)
      if (
        next.length === s.selectedTaskIds.length &&
        next.every((id, i) => id === s.selectedTaskIds[i])
      ) {
        return s
      }
      return { selectedTaskIds: next }
    }),
  toggleTaskSelection: (id, force) =>
    set((s) => {
      const normalizedId = id.slice(0, MAX_TASK_TEXT_LEN)
      const isSelected = s.selectedTaskIds.includes(normalizedId)
      const shouldSelect = force === undefined ? !isSelected : force
      if (shouldSelect && !isSelected)
        return { selectedTaskIds: [...s.selectedTaskIds, normalizedId] }
      if (!shouldSelect && isSelected)
        return { selectedTaskIds: s.selectedTaskIds.filter((x) => x !== normalizedId) }
      return s
    }),
  clearSelection: () => set({ selectedTaskIds: [] }),
})
