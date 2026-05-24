import { useRef, useEffect, useState, useMemo, type ReactNode } from 'react'
import { useStore, submitTask, addImageFromFile } from '../../store'
import { getChangedParams, normalizeParamsForSettings } from '../../lib/api/paramCompatibility'
import { getActiveApiProfile } from '../../lib/api/apiProfiles'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import { filterAndSortTasks } from '../../lib/taskFilters'
import { normalizeImageSize, type SizeTier } from '../../lib/image/size'
import { DEFAULT_PARAMS } from '../../types'
import SelectionActionBar from './SelectionActionBar'
import AdvancedParamsPopover from './AdvancedParamsPopover'
import StylePickerPopover from './StylePickerPopover'
import { STYLE_PRESETS, isStylePresetKey } from '../../lib/stylePresets'
import SizePickerModal from '../SizePickerModal'
import ViewportTooltip from '../ViewportTooltip'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAutoResizeTextarea } from './hooks/useAutoResizeTextarea'
import { useDragDropFiles } from './hooks/useDragDropFiles'
import { useMobileGestures } from './hooks/useMobileGestures'
import ModelMenu from './ModelMenu'
import ResolutionMenu from './ResolutionMenu'
import ImageGrid from './ImageGrid'

/** 通用悬浮气泡提示 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  return (
    <ViewportTooltip visible={visible} className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

/** API 支持的最大参考图数量 */
const API_MAX_IMAGES = 16

/** 底栏 pill 通用样式 */
const PILL_BASE =
  'inline-flex items-center gap-1 rounded-full border border-gray-200/70 bg-white/60 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors shadow-sm hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]'
const PILL_DISABLED =
  'inline-flex items-center gap-1 rounded-full border border-gray-200/70 bg-gray-100/60 px-3 py-1.5 text-xs font-medium text-gray-400 shadow-sm cursor-not-allowed dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-gray-500'

/** 简易 chevron 图标 */
function Chevron({ disabled = false }: { disabled?: boolean }) {
  return (
    <svg
      className={`h-3 w-3 ${disabled ? 'opacity-40' : 'opacity-70'}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** 从 size 字符串推断当前 tier（1K/2K/4K/auto/custom） */
function detectTier(size: string): SizeTier | 'auto' | 'custom' {
  const trimmed = (size || '').trim()
  if (!trimmed || trimmed === 'auto') return 'auto'
  const m = trimmed.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!m) return 'custom'
  const w = Number(m[1])
  const h = Number(m[2])
  const longSide = Math.max(w, h)
  // 阈值在两档分辨率之间取中点
  if (longSide <= 1536) return '1K'
  if (longSide <= 2944) return '2K'
  return '4K'
}

/** 友好显示的比例标签（在底栏 pill 上显示） */
function formatRatioLabel(size: string): string {
  if (!size || size === 'auto') return '自动'
  const m = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!m) return '自定义'
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '自定义'
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(Math.round(w), Math.round(h))
  return `${Math.round(w) / d}:${Math.round(h) / d}`
}

/** 友好显示的分辨率档位标签 */
function formatTierLabel(size: string): string {
  const tier = detectTier(size)
  if (tier === 'auto') return '自动'
  if (tier === 'custom') return '自定义'
  return tier
}

export default function InputBar() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const inputImages = useStore((s) => s.inputImages)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setShowPromptOptimizer = useStore((s) => s.setShowPromptOptimizer)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const tasks = useStore((s) => s.tasks)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const searchQuery = useStore((s) => s.searchQuery)
  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)

  const filteredTasks = useMemo(() => {
    return filterAndSortTasks(tasks, {
      searchQuery,
      filterStatus,
      filterFavorite,
      filterFavoriteCategoryId,
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)

  // pill / popover 锚点
  const modelPillRef = useRef<HTMLButtonElement>(null)
  const stylePillRef = useRef<HTMLButtonElement>(null)
  const resolutionPillRef = useRef<HTMLButtonElement>(null)
  const advancedButtonRef = useRef<HTMLButtonElement>(null)

  const [submitHover, setSubmitHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)
  const [optimizeHover, setOptimizeHover] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')

  /** 顶部 pill 弹出层互斥 */
  type OpenMenu = 'model' | 'style' | 'resolution' | 'advanced' | null
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)

  const isMobile = useIsMobile()
  const { mobileCollapsed, setMobileCollapsed, dragHandleRef: handleRef } = useMobileGestures({ isMobile })
  const { adjustHeight: adjustTextareaHeight } = useAutoResizeTextarea({
    textareaRef,
    imagesRef,
    deps: { prompt, imageCount: inputImages.length, hasMask: Boolean(maskDraft), maskPreviewUrl },
  })

  const canSubmit = prompt.trim() && settings.apiKey
  const optimizerKeyConfigured = Boolean(settings.promptOptimizer.apiKey.trim())
  const optimizerPromptReady = Boolean(prompt.trim())
  const canOptimize = optimizerKeyConfigured && optimizerPromptReady
  const optimizeTooltipText = !optimizerKeyConfigured
    ? '提示词优化 API 尚未配置，点设置中"提示词优化 API"添加'
    : !optimizerPromptReady
      ? '请先输入提示词'
      : ''
  const atImageLimit = inputImages.length >= API_MAX_IMAGES
  const maskTargetImage = maskDraft
    ? inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null
    : null
  const referenceImages = maskTargetImage
    ? inputImages.filter((img) => img.id !== maskTargetImage.id)
    : inputImages

  const activeProfile = getActiveApiProfile(settings)
  const displaySize = normalizeImageSize(params.size) || DEFAULT_PARAMS.size
  const ratioLabel = formatRatioLabel(displaySize)
  const tierLabel = formatTierLabel(displaySize)

  useEffect(() => {
    const normalizedParams = normalizeParamsForSettings(params, settings)
    const patch = getChangedParams(params, normalizedParams)
    if (Object.keys(patch).length) {
      setParams(patch)
    }
  }, [params, settings, setParams])

  useEffect(() => {
    let cancelled = false
    if (!maskDraft || !maskTargetImage) {
      setMaskPreviewUrl('')
      return
    }

    createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl)
      .then((url) => {
        if (!cancelled) setMaskPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewUrl('')
      })

    return () => {
      cancelled = true
    }
  }, [maskDraft, maskTargetImage?.id, maskTargetImage?.dataUrl])

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const currentCount = useStore.getState().inputImages.length
      if (currentCount >= API_MAX_IMAGES) {
        useStore.getState().showToast(
          `参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加`,
          'error',
        )
        return
      }

      const remaining = API_MAX_IMAGES - currentCount
      const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
      const toAdd = accepted.slice(0, remaining)
      const discarded = accepted.length - toAdd.length

      for (const file of toAdd) {
        await addImageFromFile(file)
      }

      if (discarded > 0) {
        useStore.getState().showToast(
          `已达上限 ${API_MAX_IMAGES} 张，${discarded} 张图片被丢弃`,
          'error',
        )
      }
    } catch (err) {
      useStore.getState().showToast(
        `图片添加失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      )
    }
  }

  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  const { isDragging } = useDragDropFiles({
    onFiles: (files) => handleFilesRef.current(files),
    atImageLimit,
  })

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      submitTask()
    }
  }

  /** 顶部 pill 行（模型 / 风格 / 比例 / 分辨率 / 优化 + 上传 + 高级） */
  const renderPillRow = () => {
    const modelText = activeProfile.model || activeProfile.name || '未配置'
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 模型 pill */}
        <div className="relative">
          <button
            ref={modelPillRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'model' ? null : 'model'))}
            className={PILL_BASE}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'model'}
            title={`当前模型：${modelText}`}
          >
            <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
            <span className="max-w-[140px] truncate">{modelText}</span>
            <Chevron />
          </button>
          {openMenu === 'model' && (
            <ModelMenu anchorRef={modelPillRef} onClose={() => setOpenMenu(null)} />
          )}
        </div>

        {/* 风格 pill */}
        <div className="relative">
          <button
            ref={stylePillRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'style' ? null : 'style'))}
            className={PILL_BASE}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'style'}
            title={`风格预设：${
              params.stylePreset && isStylePresetKey(params.stylePreset)
                ? STYLE_PRESETS[params.stylePreset].label
                : '无风格'
            }`}
          >
            <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19l9-7-9-7-9 7 9 7z" />
              <path d="M12 12v7" />
            </svg>
            <span>
              {params.stylePreset && isStylePresetKey(params.stylePreset)
                ? STYLE_PRESETS[params.stylePreset].label
                : '无风格'}
            </span>
            <Chevron />
          </button>
          {openMenu === 'style' && (
            <StylePickerPopover anchorRef={stylePillRef} onClose={() => setOpenMenu(null)} />
          )}
        </div>

        {/* 比例 pill */}
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null)
            setShowSizePicker(true)
          }}
          className={PILL_BASE}
          title={`图像比例：${ratioLabel}`}
        >
          <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="2" />
          </svg>
          <span>{ratioLabel}</span>
          <Chevron />
        </button>

        {/* 分辨率 pill */}
        <div className="relative">
          <button
            ref={resolutionPillRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'resolution' ? null : 'resolution'))}
            className={PILL_BASE}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'resolution'}
            title={`输出分辨率：${tierLabel}`}
          >
            <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 4h6v6H4z" />
              <path d="M14 4h6v6h-6z" />
              <path d="M4 14h6v6H4z" />
              <path d="M14 14h6v6h-6z" />
            </svg>
            <span>{tierLabel}</span>
            <Chevron />
          </button>
          {openMenu === 'resolution' && (
            <ResolutionMenu anchorRef={resolutionPillRef} onClose={() => setOpenMenu(null)} />
          )}
        </div>

        {/* 优化 pill */}
        <div
          className="relative"
          onMouseEnter={() => setOptimizeHover(true)}
          onMouseLeave={() => setOptimizeHover(false)}
        >
          <ButtonTooltip visible={Boolean(optimizeTooltipText) && optimizeHover} text={optimizeTooltipText} />
          <button
            type="button"
            onClick={() => canOptimize && setShowPromptOptimizer(true)}
            disabled={!canOptimize}
            className={canOptimize ? PILL_BASE : PILL_DISABLED}
            title="AI 提示词优化"
            aria-label="AI 提示词优化"
          >
            <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <span>优化</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* 重置全部输入 */}
          {(() => {
            const promptLen = prompt.trim().length
            const canReset = promptLen > 0 || inputImages.length > 0 || maskDraft != null
            const parts: string[] = []
            if (promptLen > 0) parts.push(`文字（${promptLen} 字符）`)
            if (inputImages.length > 0) parts.push(`${inputImages.length} 张参考图`)
            if (maskDraft) parts.push('1 个遮罩')
            const resetMessage = `将清空：${parts.join('、')}。继续？`
            return (
              <button
                type="button"
                disabled={!canReset}
                onClick={() =>
                  setConfirmDialog({
                    title: '重置全部输入',
                    message: resetMessage,
                    action: () => {
                      setPrompt('')
                      clearInputImages()
                      clearMaskDraft()
                    },
                  })
                }
                className={
                  canReset
                    ? `${PILL_BASE} hover:bg-red-50/50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400`
                    : PILL_DISABLED
                }
                aria-label="重置全部输入"
                title={canReset ? '清空文字、参考图与遮罩' : '当前没有可重置的内容'}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                <span>重置</span>
              </button>
            )
          })()}

          {/* 上传 */}
          <div
            className="relative"
            onMouseEnter={() => setAttachHover(true)}
            onMouseLeave={() => setAttachHover(false)}
          >
            <ButtonTooltip visible={atImageLimit && attachHover} text={`参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加`} />
            <button
              type="button"
              onClick={() => !atImageLimit && fileInputRef.current?.click()}
              className={atImageLimit ? PILL_DISABLED : PILL_BASE}
              title={atImageLimit ? `已达上限 ${API_MAX_IMAGES} 张` : '上传参考图'}
              aria-label="上传参考图"
            >
              <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
              <span>上传</span>
            </button>
          </div>

          {/* 高级参数 */}
          <div className="relative">
            <button
              ref={advancedButtonRef}
              type="button"
              onClick={() => setOpenMenu((v) => (v === 'advanced' ? null : 'advanced'))}
              className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-gray-200/70 bg-white/60 text-gray-500 shadow-sm transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08] ${
                openMenu === 'advanced' ? 'ring-1 ring-blue-300 dark:ring-blue-500/40' : ''
              }`}
              aria-haspopup="dialog"
              aria-expanded={openMenu === 'advanced'}
              aria-label="高级参数"
              title="高级参数（quality / format / 数量 等）"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="21" x2="14" y1="4" y2="4" />
                <line x1="10" x2="3" y1="4" y2="4" />
                <line x1="21" x2="12" y1="12" y2="12" />
                <line x1="8" x2="3" y1="12" y2="12" />
                <line x1="21" x2="16" y1="20" y2="20" />
                <line x1="12" x2="3" y1="20" y2="20" />
                <line x1="14" x2="14" y1="2" y2="6" />
                <line x1="8" x2="8" y1="10" y2="14" />
                <line x1="16" x2="16" y1="18" y2="22" />
              </svg>
            </button>
            {openMenu === 'advanced' && (
              <AdvancedParamsPopover
                anchorRef={advancedButtonRef}
                onClose={() => setOpenMenu(null)}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  const imageGridElement = (
    <ImageGrid
      inputImages={inputImages}
      maskTargetImage={maskTargetImage}
      maskDraft={maskDraft}
      maskPreviewUrl={maskPreviewUrl}
      referenceImages={referenceImages}
      isMobile={isMobile}
      imagesRef={imagesRef}
      onMove={moveInputImage}
      onRemove={removeInputImage}
      onClearAll={clearInputImages}
      onClickImage={setLightboxImageId}
      onEditMask={setMaskEditorImageId}
      onConfirmClearAll={setConfirmDialog}
      onMaskConflictNotice={(message) => showToast(message, 'info')}
    />
  )

  /**
   * 底栏在桌面端 sidebar 占位时的水平偏移：
   *   - 展开态 sidebar 宽 256px (md:w-64)，把 InputBar 中线右移一半 = 128px
   *   - 折叠态 sidebar 宽 56px (md:w-14)，右移 28px
   *
   * 移动端（< md）sidebar 是抽屉，不占位，保持原中线。
   */
  const desktopOffsetClass = sidebarCollapsed
    ? 'md:left-[calc(50%+28px)]'
    : 'md:left-[calc(50%+128px)]'

  return (
    <>
      {/* 全屏拖拽遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-white/60 dark:bg-gray-900/60 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-3xl">
            <div className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
              atImageLimit ? 'bg-red-50 dark:bg-red-500/10 border-red-300' : 'bg-blue-50 dark:bg-blue-500/10 border-blue-400'
            }`}>
              {atImageLimit ? (
                <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <div className="text-center">
              {atImageLimit ? (
                <>
                  <p className="text-lg font-semibold text-red-500">已达上限 {API_MAX_IMAGES} 张</p>
                  <p className="text-sm text-gray-400 mt-1">请先移除部分参考图后再添加</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">释放以添加参考图</p>
                  <p className="text-sm text-gray-400 mt-1">支持 JPG、PNG、WebP 等格式</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSizePicker && (
        <SizePickerModal
          currentSize={params.size}
          onSelect={(size) => setParams({ size })}
          onClose={() => setShowSizePicker(false)}
          allowAuto={true}
        />
      )}

      <div
        data-input-bar
        className={`fixed bottom-4 sm:bottom-6 left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3 transition-[left] duration-200 sm:px-4 ${desktopOffsetClass}`}
      >
        <SelectionActionBar filteredTasks={filteredTasks} />
        <div ref={cardRef} className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-2xl border border-white/50 dark:border-white/[0.08] shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] rounded-2xl sm:rounded-3xl p-3 sm:p-4 ring-1 ring-black/5 dark:ring-white/10">
          {/* 移动端拖动条 */}
          <div
            ref={handleRef}
            className="sm:hidden flex justify-center pt-0.5 pb-2 -mt-1 cursor-pointer touch-none"
            onClick={() => setMobileCollapsed((v) => !v)}
          >
            <div className={`w-10 h-1 rounded-full bg-gray-300 dark:bg-white/[0.06] transition-transform duration-200 ${mobileCollapsed ? 'scale-x-75' : ''}`} />
          </div>

          {/* Pill 行（参数 + 上传 + 高级）：移动端通过折叠面板隐藏 */}
          {isMobile ? (
            <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
              <div className="collapse-inner">
                <div className="mb-3">{renderPillRow()}</div>
              </div>
            </div>
          ) : (
            <div className="mb-3">{renderPillRow()}</div>
          )}

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 && (
            isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">
                    {imageGridElement}
                  </div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 ml-1">
                    {maskDraft ? `1 张遮罩主图 · ${referenceImages.length} 张参考图` : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              imageGridElement
            )
          )}

          {/* 输入框 + 发送 */}
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="描述你想要的图片，支持粘贴图片..."
                aria-label="描述图片"
                className="w-full px-4 py-3 rounded-2xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm focus:outline-none leading-relaxed resize-none shadow-sm transition-[border-color,box-shadow] duration-200"
              />
              {prompt.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPrompt('')
                    requestAnimationFrame(() => adjustTextareaHeight())
                    textareaRef.current?.focus()
                  }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 transition-colors"
                  aria-label="清空输入"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div
              className="relative flex shrink-0 items-end pb-0.5"
              onMouseEnter={() => setSubmitHover(true)}
              onMouseLeave={() => setSubmitHover(false)}
            >
              <ButtonTooltip visible={!settings.apiKey && submitHover} text="尚未完成 API 配置，请点 sidebar 底部齿轮按钮打开设置" />
              <button
                type="button"
                onClick={() => settings.apiKey ? submitTask() : setShowSettings(true)}
                disabled={settings.apiKey ? !canSubmit : false}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm transition-all hover:shadow ${
                  !settings.apiKey
                    ? 'bg-gray-300 dark:bg-white/[0.06] text-white cursor-pointer'
                    : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
                title={settings.apiKey ? (maskDraft ? '遮罩编辑 (Ctrl+Enter)' : '生成 (Ctrl+Enter)') : '请先配置 API'}
                aria-label={maskDraft ? '提交遮罩编辑' : '提交生成'}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12l14-7-3 7 3 7-14-7z" />
                </svg>
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      </div>
    </>
  )
}
