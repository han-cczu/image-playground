import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  FavoriteCategory,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
} from './types'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, normalizeSettings } from './lib/api/apiProfiles'
import {
  DEFAULT_FAVORITE_CATEGORY_COLOR,
  DEFAULT_FAVORITE_CATEGORY_ID,
  createDefaultFavoriteCategory,
  normalizeFavoriteCategories,
} from './lib/favoriteCategories'
import { putTask } from './lib/db'

type PersistedStoreState = Partial<AppState> & {
  favoriteCategoriesInitialized?: boolean
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

let categoryUid = 0
function genCategoryId(): string {
  return `cat-${Date.now().toString(36)}-${(++categoryUid).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function reorderCategories(categories: FavoriteCategory[]): FavoriteCategory[] {
  return normalizeFavoriteCategories(categories)
}

function createCategoryStatePatch(
  categories: FavoriteCategory[],
  filterFavoriteCategoryId: string | null,
) {
  /*
   * ========================================================================
   * 步骤1：归一化分类状态
   * ========================================================================
   * 目标：
   *   1) 保持分类顺序连续，避免删除或导入后 sortOrder 断档
   *   2) 清理已经不存在的分类筛选条件
   */
  // 1.1 归一化分类排序
  const favoriteCategories = reorderCategories(categories)

  // 1.2 校验当前筛选分类是否仍存在
  const categoryIds = new Set(favoriteCategories.map((category) => category.id))
  return {
    favoriteCategories,
    filterFavoriteCategoryId: filterFavoriteCategoryId && categoryIds.has(filterFavoriteCategoryId)
      ? filterFavoriteCategoryId
      : null,
  }
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
    favoriteCategories: shouldSeedDefaultCategory ? [createDefaultFavoriteCategory()] : normalizedCategories,
    favoriteCategoriesInitialized: true,
    filterFavoriteCategoryId: null,
    filterFavorite: false,
  }
}

// ===== Store 类型 =====

export interface AppState {
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void

  // 收藏分类
  favoriteCategories: FavoriteCategory[]
  favoriteCategoriesInitialized: boolean
  setFavoriteCategories: (categories: FavoriteCategory[]) => void
  createFavoriteCategory: (input: { name: string; color?: string }) => string
  ensureDefaultFavoriteCategory: () => string
  updateFavoriteCategory: (id: string, patch: Partial<Pick<FavoriteCategory, 'name' | 'color'>>) => void
  deleteFavoriteCategory: (id: string) => Promise<void>
  moveFavoriteCategory: (id: string, direction: -1 | 1) => void

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

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  showPromptOptimizer: boolean
  setShowPromptOptimizer: (v: boolean) => void

  // Toast
  toast: { message: string; type: 'info' | 'success' | 'error' } | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    confirmText?: string
    showCancel?: boolean
    icon?: 'info'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action: () => void
    cancelAction?: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) => set((st) => {
        const previous = normalizeSettings(st.settings)
        const incoming = s as Partial<AppSettings>
        const hasLegacyOverrides =
          incoming.baseUrl !== undefined ||
          incoming.apiKey !== undefined ||
          incoming.model !== undefined ||
          incoming.timeout !== undefined ||
          incoming.apiMode !== undefined ||
          incoming.codexCli !== undefined ||
          incoming.apiProxy !== undefined
        const merged = normalizeSettings({ ...previous, ...incoming })
        if (hasLegacyOverrides && incoming.profiles === undefined) {
          merged.profiles = merged.profiles.map((profile) => {
            if (profile.id !== merged.activeProfileId) return profile
            const baseOverrides = {
              baseUrl: incoming.baseUrl ?? profile.baseUrl,
              apiKey: incoming.apiKey ?? profile.apiKey,
              model: incoming.model ?? profile.model,
              timeout: incoming.timeout ?? profile.timeout,
            }
            if (profile.provider === 'openai') {
              return {
                ...profile,
                ...baseOverrides,
                apiMode:
                  incoming.apiMode === 'images' || incoming.apiMode === 'responses'
                    ? incoming.apiMode
                    : profile.apiMode,
                codexCli: incoming.codexCli ?? profile.codexCli,
                apiProxy: incoming.apiProxy ?? profile.apiProxy,
              }
            }
            return { ...profile, ...baseOverrides }
          })
        }
        return { settings: normalizeSettings(merged) }
      }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set({ prompt }),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return { inputImages: [...s.inputImages, img] }
        }),
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return {
            inputImages: s.inputImages.filter((_, i) => i !== idx),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      clearInputImages: () =>
        set(() => ({ inputImages: [], maskDraft: null, maskEditorImageId: null })),
      setInputImages: (imgs) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return {
            inputImages,
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          if (fromIdx === toIdx) return s
          const next = [...s.inputImages]
          const [moved] = next.splice(fromIdx, 1)
          if (!moved) return s
          next.splice(toIdx, 0, moved)
          const reordered = orderImagesWithMaskFirst(next, s.maskDraft?.targetImageId)
          return { inputImages: reordered }
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => {
          if (!maskDraft) return { maskDraft: null }
          const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft.targetImageId)
          return { maskDraft, inputImages }
        }),
      clearMaskDraft: () => set({ maskDraft: null, maskEditorImageId: null }),
      maskEditorImageId: null,
      setMaskEditorImageId: (id) => set({ maskEditorImageId: id }),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),

      // Favorite categories
      favoriteCategories: [createDefaultFavoriteCategory()],
      favoriteCategoriesInitialized: true,
      setFavoriteCategories: (favoriteCategories) =>
        set((state) => createCategoryStatePatch(favoriteCategories, state.filterFavoriteCategoryId)),
      createFavoriteCategory: ({ name, color }) => {
        const id = genCategoryId()
        set((state) => createCategoryStatePatch([
          ...state.favoriteCategories,
          {
            id,
            name: name.trim() || '未命名分类',
            color: color || DEFAULT_FAVORITE_CATEGORY_COLOR,
            sortOrder: state.favoriteCategories.length,
            createdAt: Date.now(),
          },
        ], state.filterFavoriteCategoryId))
        return id
      },
      ensureDefaultFavoriteCategory: () => {
        const existing = get().favoriteCategories.find((category) => category.id === DEFAULT_FAVORITE_CATEGORY_ID)
        if (existing) return existing.id

        set((state) => createCategoryStatePatch([
          ...state.favoriteCategories,
          {
            ...createDefaultFavoriteCategory(Date.now()),
            sortOrder: -1,
          },
        ], state.filterFavoriteCategoryId))
        return DEFAULT_FAVORITE_CATEGORY_ID
      },
      updateFavoriteCategory: (id, patch) =>
        set((state) => createCategoryStatePatch(state.favoriteCategories.map((category) =>
          category.id === id
            ? {
                ...category,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
              }
            : category,
        ), state.filterFavoriteCategoryId)),
      deleteFavoriteCategory: async (id) => {
        const state = get()

        /*
         * ========================================================================
         * 步骤1：清理分类引用
         * ========================================================================
         * 数据源：
         *   1) 当前 Zustand 任务列表
         *   2) 待删除的收藏分类 id
         * 操作要点：
         *   1) UI 状态先同步清空引用
         *   2) 只持久化实际受影响的任务
         */
        // 1.1 清空使用该分类的任务引用
        const nextTasks = state.tasks.map((task) =>
          task.favoriteCategoryId === id ? { ...task, favoriteCategoryId: null } : task,
        )

        // 1.2 更新分类列表、筛选条件和任务列表
        set({
          ...createCategoryStatePatch(
            state.favoriteCategories.filter((category) => category.id !== id),
            state.filterFavoriteCategoryId,
          ),
          tasks: nextTasks,
        })

        // 1.3 持久化受影响任务（基于原 categoryId 直接定位 dirty，去掉对列表同序的依赖）
        const dirtyTasks = state.tasks
          .filter((task) => task.favoriteCategoryId === id)
          .map((task) => ({ ...task, favoriteCategoryId: null }))
        await Promise.all(dirtyTasks.map((task) => putTask(task)))
      },
      moveFavoriteCategory: (id, direction) =>
        set((state) => {
          const categories = reorderCategories(state.favoriteCategories)
          const index = categories.findIndex((category) => category.id === id)
          const nextIndex = index + direction
          if (index < 0 || nextIndex < 0 || nextIndex >= categories.length) return state

          const next = [...categories]
          const [moved] = next.splice(index, 1)
          next.splice(nextIndex, 0, moved)
          return { favoriteCategories: next.map((category, sortOrder) => ({ ...category, sortOrder })) }
        }),

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

      // UI
      detailTaskId: null,
      setDetailTaskId: (id) => set({ detailTaskId: id }),
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) =>
        set(() => ({
          lightboxImageId,
          ...(list !== undefined ? { lightboxImageList: list } : {}),
        })),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),
      showPromptOptimizer: false,
      setShowPromptOptimizer: (showPromptOptimizer) => set({ showPromptOptimizer }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        set({ toast: { message, type } })
        setTimeout(() => {
          if (get().toast?.message === message) set({ toast: null })
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
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
      }),
    },
  ),
)

// ===== Re-exports（保持原有调用方 import 路径不变） =====

export {
  getCachedImage,
  ensureImageCached,
} from './lib/imageCache'

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
} from './lib/taskRuntime'

export {
  exportData,
  importData,
  clearAllData,
} from './lib/exportImport'
