import type { StateCreator } from 'zustand'
import type { AppState } from '../index'
import { MAX_TASK_TEXT_LEN } from '../../lib/tasks'

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
  /** 提交流程在途(submitTask / submitGridTask 从校验到全部入队之间),瞬态不持久化;由 taskRuntime 维护 */
  submitting: boolean
  setSubmitting: (v: boolean) => void
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
  dismissToast: () => void

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
    action: () => void | Promise<void>
    /** 「取消」按钮、Esc、点遮罩三条关闭路径都会触发(只有「确认」不会);showCancel=false 时 Esc/遮罩仍会触发 */
    cancelAction?: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

// toast 自增序号:用 id(而非 message 文本)判定计时器是否应清除当前 toast,避免并发同文案误清
let toastSeq = 0

function normalizeUiId(id: string | null): string | null {
  return id === null ? null : id.slice(0, MAX_TASK_TEXT_LEN)
}

function normalizeUiIds(ids: string[] | null, maxItems?: number): string[] | null {
  if (!ids) return null
  const seen = new Set<string>()
  const result: string[] = []
  for (const rawId of ids) {
    if (typeof rawId !== 'string') continue
    const id = rawId.slice(0, MAX_TASK_TEXT_LEN)
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (maxItems !== undefined && result.length >= maxItems) break
  }
  return result
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
  setDetailTaskId: (id) => set({ detailTaskId: normalizeUiId(id) }),
  lightboxImageId: null,
  lightboxImageList: [],
  setLightboxImageId: (lightboxImageId, list) =>
    set(() => ({
      lightboxImageId: normalizeUiId(lightboxImageId),
      ...(list !== undefined ? { lightboxImageList: normalizeUiIds(list) ?? [] } : {}),
    })),
  showSettings: false,
  setShowSettings: (showSettings) => set({ showSettings }),
  submitting: false,
  setSubmitting: (submitting) => set({ submitting }),
  showPromptOptimizer: false,
  setShowPromptOptimizer: (showPromptOptimizer) => set({ showPromptOptimizer }),
  showCommandPalette: false,
  setShowCommandPalette: (showCommandPalette) => set({ showCommandPalette }),
  compareTaskIds: null,
  setCompareTaskIds: (compareTaskIds) => set({ compareTaskIds: normalizeUiIds(compareTaskIds, 4) }),
  lineageTaskId: null,
  setLineageTaskId: (lineageTaskId) => set({ lineageTaskId: normalizeUiId(lineageTaskId) }),
  captionBatchImageIds: null,
  setCaptionBatchImageIds: (captionBatchImageIds) =>
    set({ captionBatchImageIds: normalizeUiIds(captionBatchImageIds) }),
  captionSource: null,
  setCaptionSource: (captionSource) => set({ captionSource }),

  // Toast
  toast: null,
  showToast: (message, type = 'info') => {
    const id = ++toastSeq
    set({ toast: { id, message: message.slice(0, MAX_TASK_TEXT_LEN), type } })
    // 错误停留更久:错误文案常含需要读完/复制的关键信息,3 秒来不及
    setTimeout(
      () => {
        if (get().toast?.id === id) set({ toast: null })
      },
      type === 'error' ? 6000 : 3000,
    )
  },
  dismissToast: () => set({ toast: null }),

  // Confirm
  confirmDialog: null,
  setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
})
