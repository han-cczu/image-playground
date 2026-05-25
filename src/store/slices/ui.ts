import type { StateCreator } from 'zustand'
import type { AppState } from '../index'

export interface UiSlice {
  // Sidebar
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void

  // Insecure context banner（HTTP + IP 模式提示）
  dismissedInsecureContextBanner: boolean
  setDismissedInsecureContextBanner: (v: boolean) => void

  // 图库视图：跨对话查看全部 task
  galleryView: boolean
  setGalleryView: (view: boolean) => void

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
  /** 反推源图（base64 data URL）；非 null 即打开反推 modal */
  captionSource: string | null
  setCaptionSource: (src: string | null) => void

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

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  // Insecure context banner
  dismissedInsecureContextBanner: false,
  setDismissedInsecureContextBanner: (dismissedInsecureContextBanner) =>
    set({ dismissedInsecureContextBanner }),

  // Gallery view
  galleryView: false,
  setGalleryView: (galleryView) => set({ galleryView }),

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
  captionSource: null,
  setCaptionSource: (captionSource) => set({ captionSource }),

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
})
