import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createFiltersSlice, type FiltersSlice } from './slices/filters'
import { createSettingsSlice, type SettingsSlice } from './slices/settings'
import { createUiSlice, type UiSlice } from './slices/ui'
import { createTasksSlice, type TasksSlice } from './slices/tasks'
import { IDB_CHANGE_STORAGE_KEY } from '../lib/db'
import { mergePersistedStoreState, partialize } from './persist'
import { refreshIndexedDbBackedStoreState, restorePersistedInputImageDataUrls } from './idbSync'

// ===== Store 类型 =====

export type AppState = FiltersSlice & SettingsSlice & UiSlice & TasksSlice

export const PERSIST_STORAGE_KEY = 'image-playground'

export const useStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ...createSettingsSlice(set, get, store),

      ...createTasksSlice(set, get, store),

      ...createUiSlice(set, get, store),

      ...createFiltersSlice(set, get, store),
    }),
    {
      name: PERSIST_STORAGE_KEY,
      merge: mergePersistedStoreState,
      partialize,
    },
  ),
)

function isPersistStorageEvent(event: StorageEvent): boolean {
  if (typeof window === 'undefined') return false
  if (event.storageArea && event.storageArea !== window.localStorage) return false
  return event.key === PERSIST_STORAGE_KEY || event.key === null
}

function isIndexedDbStorageEvent(event: StorageEvent): boolean {
  if (typeof window === 'undefined') return false
  if (event.storageArea && event.storageArea !== window.localStorage) return false
  return event.key === IDB_CHANGE_STORAGE_KEY || event.key === null
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.storageArea && event.storageArea !== window.localStorage) return

    const syncIndexedDb = () =>
      refreshIndexedDbBackedStoreState().catch((err) => {
        useStore
          .getState()
          .showToast(
            `同步本地数据库变更失败：${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
      })
    const restoreInputImages = () =>
      restorePersistedInputImageDataUrls().catch((err) => {
        useStore
          .getState()
          .showToast(
            `恢复参考图失败：${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
      })
    const rehydratePersistedStore = () =>
      Promise.resolve(useStore.persist.rehydrate()).catch((err) => {
        useStore
          .getState()
          .showToast(
            `同步本地设置失败：${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
      })
    const resetPersistedStoreState = () => {
      useStore.setState(mergePersistedStoreState(undefined, useStore.getState()), true)
    }

    if (event.key === null) {
      void rehydratePersistedStore().then(resetPersistedStoreState).then(syncIndexedDb)
      return
    }

    if (event.key === PERSIST_STORAGE_KEY && event.newValue === null) {
      void rehydratePersistedStore().then(resetPersistedStoreState)
      return
    }

    if (isPersistStorageEvent(event))
      void rehydratePersistedStore().then(restoreInputImages)
    if (isIndexedDbStorageEvent(event)) void syncIndexedDb()
  })
}

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
  submitGridTask,
  retryGridCell,
  retryGridMissing,
  retryTask,
  setTaskFavoriteCategory,
  clearTaskFavorite,
  reuseConfig,
  editOutputs,
  removeTask,
  removeMultipleTasks,
  cancelTask,
  cancelBatch,
  cancelAllRunning,
  rollbackStoredImages,
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
