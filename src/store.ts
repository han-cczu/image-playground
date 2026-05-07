import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
} from './types'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, normalizeSettings } from './lib/api/apiProfiles'

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

// ===== Store 类型 =====

interface AppState {
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

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

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

      // Search & filter
      searchQuery: '',
      setSearchQuery: (q) => set({ searchQuery: q }),
      filterStatus: 'all',
      setFilterStatus: (status) => set({ filterStatus: status }),
      filterFavorite: false,
      setFilterFavorite: (f) => set({ filterFavorite: f }),

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
      partialize: (state) => ({
        settings: state.settings,
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
