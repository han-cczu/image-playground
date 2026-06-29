import { normalizeSettings } from '../lib/api/apiProfiles'
import {
  createDefaultFavoriteCategory,
  normalizeFavoriteCategories,
} from '../lib/favoriteCategories'
import { MAX_CONVERSATION_ID_LEN } from '../lib/conversations'
import { normalizeSnippets } from '../lib/promptSnippets'
import { normalizeBatchNotes } from '../lib/gridSheet'
import { collectReferencedImageIds } from '../lib/storageStats'
import {
  MAX_INPUT_IMAGES_PER_SUBMISSION,
  MAX_TASK_TEXT_LEN,
  normalizeTaskParams,
} from '../lib/tasks'
import { MAX_CONFIG_FIELD_LEN } from '../lib/api/apiProfiles'
import type { AppState } from './index'

type PersistedStoreState = Partial<AppState> & {
  favoriteCategoriesInitialized?: boolean
}

export const MAX_DISMISSED_CODEX_CLI_PROMPTS = 50
export const MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN = MAX_CONFIG_FIELD_LEN * 2 + 1

function normalizePersistedPrompt(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_TASK_TEXT_LEN) : ''
}

function normalizePersistedInputImages(value: unknown): AppState['inputImages'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim()) return []
    const id = record.id.slice(0, MAX_TASK_TEXT_LEN)
    if (seen.has(id)) return []
    seen.add(id)
    return [{ id, dataUrl: '' }]
  }).slice(0, MAX_INPUT_IMAGES_PER_SUBMISSION)
}

function mergePersistedInputImages(
  value: unknown,
  currentImages: AppState['inputImages'],
  options: { preserveWhenMissing?: boolean } = {},
): AppState['inputImages'] {
  if (value === undefined) return options.preserveWhenMissing ? currentImages : []
  const currentDataUrlById = new Map(currentImages.map((image) => [image.id, image.dataUrl]))
  return normalizePersistedInputImages(value).map((image) => ({
    ...image,
    dataUrl: currentDataUrlById.get(image.id) ?? image.dataUrl,
  }))
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim().slice(0, MAX_DISMISSED_CODEX_CLI_PROMPT_KEY_LEN)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= MAX_DISMISSED_CODEX_CLI_PROMPTS) break
  }
  return result
}

export function mergePersistedStoreState(
  persistedState: unknown,
  currentState: AppState,
): AppState {
  const persisted = persistedState as PersistedStoreState | undefined
  const normalizedCategories = normalizeFavoriteCategories(persisted?.favoriteCategories)
  const shouldSeedDefaultCategory =
    persisted?.favoriteCategoriesInitialized !== true && normalizedCategories.length === 0
  const activeConversationId =
    typeof persisted?.activeConversationId === 'string'
      ? persisted.activeConversationId.slice(0, MAX_CONVERSATION_ID_LEN)
      : null
  const galleryView = persisted?.galleryView === true
  const selectionDomainChanged =
    currentState.activeConversationId !== activeConversationId ||
    currentState.galleryView !== galleryView
  const hasPersistedState = persisted !== undefined && persisted !== null
  const inputImages = mergePersistedInputImages(persisted?.inputImages, currentState.inputImages, {
    preserveWhenMissing:
      hasPersistedState && !Object.prototype.hasOwnProperty.call(persisted, 'inputImages'),
  })
  const referencedImageIds = collectReferencedImageIds(currentState.tasks, inputImages)
  const lightboxImageId =
    currentState.lightboxImageId && !referencedImageIds.has(currentState.lightboxImageId)
      ? null
      : currentState.lightboxImageId
  const lightboxImageList = currentState.lightboxImageList.filter((id) =>
    referencedImageIds.has(id),
  )
  const captionBatchImageIds =
    currentState.captionBatchImageIds?.filter((id) => referencedImageIds.has(id)) ?? null
  const maskEditorImageId =
    currentState.maskEditorImageId && !referencedImageIds.has(currentState.maskEditorImageId)
      ? null
      : currentState.maskEditorImageId
  const maskDraft =
    currentState.maskDraft &&
    inputImages.some((image) => image.id === currentState.maskDraft?.targetImageId)
      ? currentState.maskDraft
      : null

  return {
    ...currentState,
    settings: normalizeSettings(persisted?.settings),
    params: normalizeTaskParams(persisted?.params),
    prompt: normalizePersistedPrompt(persisted?.prompt),
    inputImages,
    dismissedCodexCliPrompts: normalizeStringArray(persisted?.dismissedCodexCliPrompts),
    favoriteCategories: shouldSeedDefaultCategory
      ? [createDefaultFavoriteCategory()]
      : normalizedCategories,
    favoriteCategoriesInitialized: true,
    snippets: normalizeSnippets(persisted?.snippets),
    batchNotes: normalizeBatchNotes(persisted?.batchNotes),
    // conversations 列表跟 tasks 一致走 IDB，不进 zustand-persist
    conversations: currentState.conversations,
    activeConversationId,
    sidebarCollapsed: persisted?.sidebarCollapsed === true,
    dismissedInsecureContextBanner: persisted?.dismissedInsecureContextBanner === true,
    dismissedPlaintextKeyNotice: persisted?.dismissedPlaintextKeyNotice === true,
    hasSeenTour: persisted?.hasSeenTour === true,
    // 瞬态字段不读 persisted:启动 hydrate 时 currentState 是安全默认值,可清洗被污染的
    // localStorage;跨 tab storage rehydrate 时 currentState 是本 tab 正在操作的 UI,不能误清。
    tourActive: currentState.tourActive,
    tourStep: currentState.tourStep,
    mobileInputCollapsed: currentState.mobileInputCollapsed,
    detailTaskId: currentState.detailTaskId,
    lightboxImageId,
    lightboxImageList,
    showSettings: currentState.showSettings,
    showPromptOptimizer: currentState.showPromptOptimizer,
    showCommandPalette: currentState.showCommandPalette,
    compareTaskIds: currentState.compareTaskIds,
    lineageTaskId: currentState.lineageTaskId,
    captionBatchImageIds:
      captionBatchImageIds && captionBatchImageIds.length > 0 ? captionBatchImageIds : null,
    captionSource: currentState.captionSource,
    maskDraft,
    maskEditorImageId,
    confirmDialog: currentState.confirmDialog,
    toast: currentState.toast,
    searchQuery: currentState.searchQuery,
    searchQueryVersion: currentState.searchQueryVersion,
    filterStatus: currentState.filterStatus,
    filterFavorite: currentState.filterFavorite,
    filterFavoriteCategoryId: currentState.filterFavoriteCategoryId,
    selectedTaskIds: selectionDomainChanged ? [] : currentState.selectedTaskIds,
    // 旧用户持久化数据没有 galleryView 字段；显式 normalize 为 boolean，避免 undefined 渗透到组件
    galleryView,
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
    hasSeenTour: state.hasSeenTour,
  }
}
