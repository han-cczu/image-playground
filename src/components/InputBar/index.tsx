import { useRef, useEffect, useState, useMemo } from 'react'
import { useStore, submitTask, addImageFromFile } from '../../store'
import { assertImagePixelLimit, MAX_INPUT_IMAGE_BYTES } from '../../lib/taskRuntime'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from '../../lib/tasks'
import { getChangedParams, normalizeParamsForSettings } from '../../lib/api/paramCompatibility'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import { filterAndSortTasks } from '../../lib/taskFilters'
import { normalizeImageSize, detectTier } from '../../lib/image/size'
import { fileToImageDataUrl, isImageFile } from '../../lib/image/fileMime'
import { insertAtCursor } from '../../lib/promptSnippets'
import { DEFAULT_PARAMS } from '../../types'
import SelectionActionBar from './SelectionActionBar'
import SizePickerModal from '../SizePickerModal'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAutoResizeTextarea } from './hooks/useAutoResizeTextarea'
import { useDragDropFiles } from './hooks/useDragDropFiles'
import { useMobileGestures } from './hooks/useMobileGestures'
import { useLatestRef } from '../../hooks/useLatestRef'
import ImageGrid from './ImageGrid'
import PillRow from './PillRow'
import TextareaInput from './TextareaInput'
import SubmitButton from './SubmitButton'

/** API 支持的最大参考图数量 */
const API_MAX_IMAGES = MAX_INPUT_IMAGES_PER_SUBMISSION

interface MaskPreviewState {
  key: string
  url: string
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
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setShowPromptOptimizer = useStore((s) => s.setShowPromptOptimizer)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const tasks = useStore((s) => s.tasks)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const searchQuery = useStore((s) => s.searchQuery)
  const galleryView = useStore((s) => s.galleryView)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const submitting = useStore((s) => s.submitting)
  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)

  // 「当前可见」口径必须与 TaskGrid 完全一致(含对话过滤):漏传 filterConversationId 时,
  // 对话视图下「全选当前可见」会圈进其它对话里不可见的任务,批量删除会误删用户从未看到的记录。
  const filteredTasks = useMemo(() => {
    return filterAndSortTasks(tasks, {
      searchQuery,
      filterStatus,
      filterFavorite,
      filterFavoriteCategoryId,
      filterConversationId: galleryView ? null : activeConversationId,
    })
  }, [
    tasks,
    searchQuery,
    filterStatus,
    filterFavorite,
    filterFavoriteCategoryId,
    galleryView,
    activeConversationId,
  ])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const captionFileInputRef = useRef<HTMLInputElement>(null)
  const captionPickSeqRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)
  /** textarea 是否被聚焦过:未聚焦时 selectionStart 恒为 0(Chrome),不能当光标位用 */
  const textareaTouchedRef = useRef(false)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const markTouched = () => {
      textareaTouchedRef.current = true
    }
    el.addEventListener('focus', markTouched)
    return () => el.removeEventListener('focus', markTouched)
  }, [])

  const [showSizePicker, setShowSizePicker] = useState(false)
  const [maskPreview, setMaskPreview] = useState<MaskPreviewState>({ key: '', url: '' })

  const isMobile = useIsMobile()
  const { mobileCollapsed, setMobileCollapsed, dragHandleRef: handleRef } = useMobileGestures()
  const atImageLimit = inputImages.length >= API_MAX_IMAGES
  const maskTargetImage = maskDraft
    ? (inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null)
    : null
  const maskPreviewKey =
    maskDraft && maskTargetImage ? `${maskTargetImage.id}:${maskDraft.maskDataUrl}` : ''
  const maskPreviewUrl = maskPreview.key === maskPreviewKey ? maskPreview.url : ''
  const { adjustHeight: adjustTextareaHeight } = useAutoResizeTextarea({
    textareaRef,
    imagesRef,
    deps: { prompt, imageCount: inputImages.length, hasMask: Boolean(maskDraft), maskPreviewUrl },
  })

  // 在途期间禁用:submitTask 内部也有互斥,这里只是让按钮态与快捷键跟着变灰,不让用户以为没点上
  const canSubmit = prompt.trim() && settings.apiKey && !submitting
  const optimizerKeyConfigured = Boolean(settings.promptOptimizer.apiKey.trim())
  const optimizerPromptReady = Boolean(prompt.trim())
  const canOptimize = optimizerKeyConfigured && optimizerPromptReady
  const optimizeTooltipText = !optimizerKeyConfigured
    ? '提示词优化 API 尚未配置，点设置中"提示词优化 API"添加'
    : !optimizerPromptReady
      ? '请先输入提示词'
      : ''
  const captionerKeyConfigured = Boolean(settings.captioner.apiKey.trim())
  const captionTooltipText = !captionerKeyConfigured
    ? '反推提示词 API 尚未配置，点设置中"反推提示词 API"添加'
    : ''
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
    if (!maskDraft || !maskTargetImage) return

    createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl)
      .then((url) => {
        if (!cancelled) setMaskPreview({ key: maskPreviewKey, url })
      })
      .catch(() => {
        if (!cancelled) setMaskPreview({ key: maskPreviewKey, url: '' })
      })

    return () => {
      cancelled = true
      setMaskPreview((current) => (current.key === maskPreviewKey ? { key: '', url: '' } : current))
    }
  }, [maskDraft, maskPreviewKey, maskTargetImage])

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const currentCount = useStore.getState().inputImages.length
      if (currentCount >= API_MAX_IMAGES) {
        useStore
          .getState()
          .showToast(`参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加`, 'error')
        return
      }

      const all = Array.from(files)
      const accepted = all.filter(isImageFile)
      const skippedNonImage = all.length - accepted.length
      let discarded = 0
      // 单个文件失败(解码失败 / 过大 / 尺寸非法)不中止其余文件:串行继续,最后汇总一条提示;
      // 保持串行——addImageFromFile 内部按 inputImages.length 判上限与去重,并发会破坏该判定
      const failures: string[] = []

      for (const file of accepted) {
        if (useStore.getState().inputImages.length >= API_MAX_IMAGES) {
          discarded++
          continue
        }
        try {
          await addImageFromFile(file)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message === '图片已在参考图中') {
            continue
          }
          if (message.includes('参考图数量已达上限')) {
            discarded++
            continue
          }
          failures.push(`${file.name || '未命名'}：${message}`)
        }
      }

      const notices: string[] = []
      if (discarded > 0) notices.push(`已达上限 ${API_MAX_IMAGES} 张，${discarded} 张图片被丢弃`)
      if (skippedNonImage > 0) notices.push(`${skippedNonImage} 个非图片文件已跳过`)
      if (failures.length > 0) {
        const shown = failures.slice(0, 3).join('；')
        notices.push(
          `${failures.length} 张图片添加失败：${shown}${failures.length > 3 ? ' 等' : ''}`,
        )
      }
      if (notices.length) useStore.getState().showToast(notices.join('。'), 'error')
    } catch (err) {
      useStore
        .getState()
        .showToast(`图片添加失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleFilesRef = useLatestRef(handleFiles)

  const { isDragging } = useDragDropFiles({
    onFiles: (files) => handleFilesRef.current(files),
  })

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const handleCaptionFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const pickSeq = ++captionPickSeqRef.current
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!isImageFile(file)) {
      useStore.getState().showToast('请选择图片文件', 'error')
      return
    }
    if (file.size > MAX_INPUT_IMAGE_BYTES) {
      useStore
        .getState()
        .showToast(
          `图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`,
          'error',
        )
      return
    }
    try {
      const dataUrl = await fileToImageDataUrl(file)
      if (pickSeq !== captionPickSeqRef.current) return
      await assertImagePixelLimit(dataUrl)
      if (pickSeq !== captionPickSeqRef.current) return
      useStore.getState().setCaptionSource(dataUrl)
    } catch (err) {
      if (pickSeq !== captionPickSeqRef.current) return
      useStore
        .getState()
        .showToast(`读取图片失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      // 组字中按 Enter 是上屏/取消候选,不能当提交(React 合成事件无 isComposing,须走 nativeEvent;
      // keyCode 229 兜底旧版 Safari/Android 不给 isComposing 的情况,写法对齐 FavoriteCategoryMenu)
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      // 长按 Enter 的自动重复(e.repeat)与在途期间的重复触发都忽略,避免同一提示词入队多次
      if (e.repeat || useStore.getState().submitting) return
      void submitTask().catch(() => {
        /* submitTask surfaces recoverable errors via toast */
      })
    }
  }

  /**
   * 片段插入：基于 textarea 光标位（失焦后浏览器保留 selectionStart），插入后恢复焦点与光标。
   * 从未聚焦过时 selectionStart 是 0 而非 null（?? 兜不住），靠 touched 标记落到「追加到末尾」。
   */
  const handleInsertSnippet = (content: string) => {
    const el = textareaTouchedRef.current ? textareaRef.current : null
    const { next, caret } = insertAtCursor(
      prompt,
      el ? el.selectionStart : prompt.length,
      el ? el.selectionEnd : prompt.length,
      content,
    )
    setPrompt(next)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (node) {
        node.focus()
        node.setSelectionRange(caret, caret)
      }
      adjustTextareaHeight()
    })
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
      canCaption={captionerKeyConfigured}
      captionTooltipText={captionTooltipText}
      onCaption={() => captionFileInputRef.current?.click()}
      onAttach={() => fileInputRef.current?.click()}
      onInsertSnippet={handleInsertSnippet}
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
      onMaskConflictNotice={(message) => useStore.getState().showToast(message, 'info')}
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
            <div
              className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
                atImageLimit
                  ? 'bg-red-50 dark:bg-red-500/10 border-red-300'
                  : 'bg-blue-50 dark:bg-blue-500/10 border-blue-400'
              }`}
            >
              {atImageLimit ? (
                <svg
                  className="w-10 h-10 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              ) : (
                <svg
                  className="w-10 h-10 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
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
                  <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">
                    释放以添加参考图
                  </p>
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
        className={`app-enter-inputbar fixed bottom-4 sm:bottom-6 left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3 transition-[left] duration-200 sm:px-4 ${desktopOffsetClass}`}
      >
        <SelectionActionBar filteredTasks={filteredTasks} />
        <div
          ref={cardRef}
          className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-2xl border border-white/50 dark:border-white/[0.08] shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] rounded-2xl sm:rounded-3xl p-3 sm:p-4 ring-1 ring-black/5 dark:ring-white/10"
        >
          {/* 移动端拖动条 */}
          <div
            ref={handleRef}
            className="sm:hidden flex justify-center pt-0.5 pb-2 -mt-1 cursor-pointer touch-none"
            onClick={() => setMobileCollapsed((v) => !v)}
          >
            <div
              className={`w-10 h-1 rounded-full bg-gray-300 dark:bg-white/[0.06] transition-transform duration-200 ${mobileCollapsed ? 'scale-x-75' : ''}`}
            />
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
          {inputImages.length > 0 &&
            (isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">{imageGridElement}</div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 ml-1">
                    {maskDraft
                      ? `1 张遮罩主图 · ${referenceImages.length} 张参考图`
                      : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              imageGridElement
            ))}

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
          <input
            ref={captionFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCaptionFilePick}
          />
        </div>
      </div>
    </>
  )
}
