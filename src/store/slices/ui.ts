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

  // 明文密钥存储一次性提示(设置页 API key 区域)
  dismissedPlaintextKeyNotice: boolean
  setDismissedPlaintextKeyNotice: (v: boolean) => void

  // 新手引导(聚光灯分步导览)
  /** 引导进行中;瞬态不持久化 */
  tourActive: boolean
  setTourActive: (v: boolean) => void
  /** 当前步下标(指向 buildTourSteps 过滤后的数组);瞬态不持久化 */
  tourStep: number
  setTourStep: (step: number) => void
  /** 已看过/跳过引导(自动触发只认它);持久化 */
  hasSeenTour: boolean
  setHasSeenTour: (v: boolean) => void

  /** InputBar 移动端折叠态;提升入 store 使引导(进阶 pill 步)可驱动展开。瞬态不持久化 */
  mobileInputCollapsed: boolean
  setMobileInputCollapsed: (v: boolean) => void

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
  /** 命令面板（Ctrl/⌘+K），瞬态不持久化 */
  showCommandPalette: boolean
  setShowCommandPalette: (v: boolean) => void
  /** A/B 并排对比：选中的 2~4 个 task id；null=关闭。瞬态不持久化 */
  compareTaskIds: string[] | null
  setCompareTaskIds: (ids: string[] | null) => void
  /** 创作谱系树：锚定的中心 task id；null=关闭。瞬态不持久化 */
  lineageTaskId: string | null
  setLineageTaskId: (id: string | null) => void
  /** 批量反推：待反推的图片 id 列表；null=关闭。瞬态不持久化 */
  captionBatchImageIds: string[] | null
  setCaptionBatchImageIds: (ids: string[] | null) => void
  /** 反推源图（base64 data URL）；非 null 即打开反推 modal */
  captionSource: string | null
  setCaptionSource: (src: string | null) => void

  // Toast
  toast: { id: number; message: string; type: 'info' | 'success' | 'error' } | null
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

// toast 自增序号:用 id(而非 message 文本)判定计时器是否应清除当前 toast,避免并发同文案误清
let toastSeq = 0

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  // Insecure context banner
  dismissedInsecureContextBanner: false,
  setDismissedInsecureContextBanner: (dismissedInsecureContextBanner) =>
    set({ dismissedInsecureContextBanner }),

  // 明文密钥存储一次性提示
  dismissedPlaintextKeyNotice: false,
  setDismissedPlaintextKeyNotice: (dismissedPlaintextKeyNotice) =>
    set({ dismissedPlaintextKeyNotice }),

  // 新手引导
  tourActive: false,
  setTourActive: (tourActive) => set({ tourActive }),
  tourStep: 0,
  setTourStep: (tourStep) => set({ tourStep }),
  hasSeenTour: false,
  setHasSeenTour: (hasSeenTour) => set({ hasSeenTour }),

  mobileInputCollapsed: false,
  setMobileInputCollapsed: (mobileInputCollapsed) => set({ mobileInputCollapsed }),

  // Gallery view
  // 切换视图同时清空多选(与 setActiveConversation 同口径):图库→对话视图时可见域收窄,
  // 图库里跨对话选中的任务会变成「看不见但仍被批量操作命中」的残留选择。
  galleryView: false,
  setGalleryView: (galleryView) =>
    set((state) =>
      state.galleryView === galleryView ? { galleryView } : { galleryView, selectedTaskIds: [] },
    ),

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
  showCommandPalette: false,
  setShowCommandPalette: (showCommandPalette) => set({ showCommandPalette }),
  compareTaskIds: null,
  setCompareTaskIds: (compareTaskIds) => set({ compareTaskIds }),
  lineageTaskId: null,
  setLineageTaskId: (lineageTaskId) => set({ lineageTaskId }),
  captionBatchImageIds: null,
  setCaptionBatchImageIds: (captionBatchImageIds) => set({ captionBatchImageIds }),
  captionSource: null,
  setCaptionSource: (captionSource) => set({ captionSource }),

  // Toast
  toast: null,
  showToast: (message, type = 'info') => {
    const id = ++toastSeq
    set({ toast: { id, message, type } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 3000)
  },

  // Confirm
  confirmDialog: null,
  setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
})
