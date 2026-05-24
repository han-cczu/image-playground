import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { normalizeSettings } from '../lib/api/apiProfiles'
import {
  createDefaultFavoriteCategory,
  normalizeFavoriteCategories,
} from '../lib/favoriteCategories'
import { createFiltersSlice, type FiltersSlice } from './slices/filters'
import { createSettingsSlice, type SettingsSlice } from './slices/settings'
import { createUiSlice, type UiSlice } from './slices/ui'
import { createTasksSlice, type TasksSlice } from './slices/tasks'

type PersistedStoreState = Partial<AppState> & {
  favoriteCategoriesInitialized?: boolean
}

export function mergePersistedStoreState(
  persistedState: unknown,
  currentState: AppState,
): AppState {
  const persisted = persistedState as PersistedStoreState | undefined
  const normalizedCategories = normalizeFavoriteCategories(persisted?.favoriteCategories)
  const shouldSeedDefaultCategory =
    persisted?.favoriteCategoriesInitialized !== true &&
    normalizedCategories.length === 0

  return {
    ...currentState,
    ...persisted,
    settings: normalizeSettings(persisted?.settings),
    favoriteCategories: shouldSeedDefaultCategory ? [createDefaultFavoriteCategory()] : normalizedCategories,
    favoriteCategoriesInitialized: true,
    filterFavoriteCategoryId: null,
    filterFavorite: false,
    // conversations 列表跟 tasks 一致走 IDB，不进 zustand-persist
    conversations: currentState.conversations,
    activeConversationId:
      typeof persisted?.activeConversationId === 'string' ? persisted.activeConversationId : null,
    sidebarCollapsed: persisted?.sidebarCollapsed === true,
    dismissedInsecureContextBanner: persisted?.dismissedInsecureContextBanner === true,
    // 旧用户持久化数据没有 galleryView 字段；显式 normalize 为 boolean，避免 undefined 渗透到组件
    galleryView: persisted?.galleryView === true,
  }
}

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
      partialize: (state) => ({
        settings: state.settings,
        favoriteCategories: state.favoriteCategories,
        favoriteCategoriesInitialized: state.favoriteCategoriesInitialized,
        params: state.params,
        prompt: state.prompt,
        inputImages: state.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
        dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
        activeConversationId: state.activeConversationId,
        sidebarCollapsed: state.sidebarCollapsed,
        dismissedInsecureContextBanner: state.dismissedInsecureContextBanner,
        galleryView: state.galleryView,
      }),
    },
  ),
)

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
