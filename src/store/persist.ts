import { normalizeSettings } from '../lib/api/apiProfiles'
import {
  createDefaultFavoriteCategory,
  normalizeFavoriteCategories,
} from '../lib/favoriteCategories'
import { normalizeSnippets } from '../lib/promptSnippets'
import { normalizeBatchNotes } from '../lib/gridSheet'
import type { AppState } from './index'

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
    snippets: normalizeSnippets(persisted?.snippets),
    batchNotes: normalizeBatchNotes(persisted?.batchNotes),
    filterFavoriteCategoryId: null,
    filterFavorite: false,
    // conversations 列表跟 tasks 一致走 IDB，不进 zustand-persist
    conversations: currentState.conversations,
    activeConversationId:
      typeof persisted?.activeConversationId === 'string' ? persisted.activeConversationId : null,
    sidebarCollapsed: persisted?.sidebarCollapsed === true,
    dismissedInsecureContextBanner: persisted?.dismissedInsecureContextBanner === true,
    dismissedPlaintextKeyNotice: persisted?.dismissedPlaintextKeyNotice === true,
    // 旧用户持久化数据没有 galleryView 字段；显式 normalize 为 boolean，避免 undefined 渗透到组件
    galleryView: persisted?.galleryView === true,
  }
}

export function partialize(state: AppState) {
  return {
    settings: state.settings,
    favoriteCategories: state.favoriteCategories,
    favoriteCategoriesInitialized: state.favoriteCategoriesInitialized,
    snippets: state.snippets,
    batchNotes: state.batchNotes,
    params: state.params,
    prompt: state.prompt,
    inputImages: state.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
    dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
    activeConversationId: state.activeConversationId,
    sidebarCollapsed: state.sidebarCollapsed,
    dismissedInsecureContextBanner: state.dismissedInsecureContextBanner,
    dismissedPlaintextKeyNotice: state.dismissedPlaintextKeyNotice,
    galleryView: state.galleryView,
  }
}
