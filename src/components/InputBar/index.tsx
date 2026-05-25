import { useRef, useEffect, useState, useMemo } from 'react'
import { useStore, submitTask, addImageFromFile } from '../../store'
import { getChangedParams, normalizeParamsForSettings } from '../../lib/api/paramCompatibility'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import { filterAndSortTasks } from '../../lib/taskFilters'
import { normalizeImageSize, detectTier } from '../../lib/image/size'
import { DEFAULT_PARAMS } from '../../types'
import SelectionActionBar from './SelectionActionBar'
import SizePickerModal from '../SizePickerModal'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAutoResizeTextarea } from './hooks/useAutoResizeTextarea'
import { useDragDropFiles } from './hooks/useDragDropFiles'
import { useMobileGestures } from './hooks/useMobileGestures'
import ImageGrid from './ImageGrid'
import PillRow from './PillRow'
import TextareaInput from './TextareaInput'
import SubmitButton from './SubmitButton'

/** API 支持的最大参考图数量 */
const API_MAX_IMAGES = 16

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

  const [submitHover, setSubmitHover] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')

  const isMobile = useIsMobile()
  const { mobileCollapsed, setMobileCollapsed, dragHandleRef: handleRef } = useMobileGestures()
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

  const pillRowElement = (
    <PillRow
      ratioLabel={ratioLabel}
      tierLabel={tierLabel}
      canOptimize={canOptimize}
      optimizeTooltipText={optimizeTooltipText}
      atImageLimit={atImageLimit}
      apiMaxImages={API_MAX_IMAGES}
      onOpenSizePicker={() => setShowSizePicker(true)}
      onOptimize={() => setShowPromptOptimizer(true)}
      onAttach={() => fileInputRef.current?.click()}
    />
  )

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
                <div className="mb-3">{pillRowElement}</div>
              </div>
            </div>
          ) : (
            <div className="mb-3">{pillRowElement}</div>
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
            <TextareaInput
              value={prompt}
              onChange={setPrompt}
              onKeyDown={handleKeyDown}
              onClear={() => setPrompt('')}
              textareaRef={textareaRef}
              adjustHeight={adjustTextareaHeight}
            />
            <SubmitButton
              canSubmit={Boolean(canSubmit)}
              hasMask={Boolean(maskDraft)}
              hover={submitHover}
              onHoverChange={setSubmitHover}
              onSubmit={submitTask}
              onOpenSettings={() => setShowSettings(true)}
              needsConfig={!settings.apiKey}
            />
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
