import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createFiltersSlice, type FiltersSlice } from './slices/filters'
import { createSettingsSlice, type SettingsSlice } from './slices/settings'
import { createUiSlice, type UiSlice } from './slices/ui'
import { createTasksSlice, type TasksSlice } from './slices/tasks'
import { mergePersistedStoreState, partialize } from './persist'

// ===== Store 类型 =====

export type AppState = FiltersSlice & SettingsSlice & UiSlice & TasksSlice

export const useStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ...createSettingsSlice(set, get, store),

      ...createTasksSlice(set, get, store),

      ...createUiSlice(set, get, store),

      ...createFiltersSlice(set, get, store),
    }),
    {
      name: 'image-playground',
      merge: mergePersistedStoreState,
      partialize,
    },
  ),
)

export { mergePersistedStoreState } from './persist'

// ===== Re-exports（保持原有调用方 import 路径不变） =====

export {
  getCachedImage,
  ensureImageCached,
} from '../lib/imageCache'

export {
  getCodexCliPromptKey,
  getTaskSortKey,
  markInterruptedSyncHttpTasks,
  showCodexCliPrompt,
  initStore,
  submitTask,
  retryTask,
  setTaskFavoriteCategory,
  clearTaskFavorite,
  reuseConfig,
  editOutputs,
  removeTask,
  removeMultipleTasks,
  cancelTask,
  reorderTask,
  updateTaskInStore,
  addImageFromFile,
  addImageFromUrl,
} from '../lib/taskRuntime'

export {
  exportData,
  importData,
  clearAllData,
} from '../lib/exportImport'
