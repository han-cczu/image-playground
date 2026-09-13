import { useRef, useEffect, useState } from 'react'
import { useStore, submitTask, addImageFromFile } from '../../store'
import { assertImagePixelLimit, MAX_INPUT_IMAGE_BYTES } from '../../lib/taskRuntime'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from '../../lib/tasks'
import { getChangedParams, normalizeParamsForSettings } from '../../lib/api/paramCompatibility'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import { normalizeImageSize, detectTier } from '../../lib/image/size'
import { fileToImageDataUrl, isImageFile } from '../../lib/image/fileMime'
import { insertAtCursor } from '../../lib/promptSnippets'
import { DEFAULT_PARAMS } from '../../types'
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
  const activeConversationId = useStore((s) => s.activeConversationId)
  const conversations = useStore((s) => s.conversations)
  const setActiveConversation = useStore((s) => s.setActiveConversation)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const submitting = useStore((s) => s.submitting)
  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)
  // 图库只改变浏览范围；任务始终写入真实激活对话，不另建一份导航/草稿状态。
  const targetConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  )

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

  const isMobile = useIsMobile(768)
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

  return (
    <>
      {/* 全屏拖拽遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-surface  backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-3xl">
            <div
              className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
                atImageLimit ? 'bg-red-50  border-red-300' : 'bg-brand-soft  border-brand'
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
                  className="w-10 h-10 text-brand-ink"
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
                  <p className="text-sm text-content-subtle mt-1">请先移除部分参考图后再添加</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-content ">释放以添加参考图</p>
                  <p className="text-sm text-content-subtle mt-1">支持 JPG、PNG、WebP 等格式</p>
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
        className="relative z-30 max-h-[calc(100dvh-112px)] w-full shrink-0 overflow-y-auto bg-canvas px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] md:px-6 md:pb-5 custom-scrollbar"
      >
        <div
          ref={cardRef}
          className="mx-auto max-w-[1040px] rounded-[20px] border border-line bg-surface p-3 shadow-sm md:p-4"
        >
          {/* 手势仍绑定原 handle；文字按钮补齐键盘与辅助技术的展开入口。 */}
          <div
            ref={handleRef}
            className="md:hidden flex justify-center pt-0.5 pb-1 -mt-1 touch-none"
            aria-hidden="true"
          >
            <div
              className={`w-10 h-1 rounded-full bg-line transition-transform duration-200 ${mobileCollapsed ? 'scale-x-75' : ''}`}
            />
          </div>
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-content-muted">
            {targetConversation ? (
              <button
                type="button"
                className="min-w-0 max-w-full truncate rounded-lg py-1 text-left hover:text-brand-ink"
                onClick={() => {
                  setActiveConversation(targetConversation.id)
                  setGalleryView(false)
                }}
                title={`回到对话：${targetConversation.title}`}
              >
                生成到：{targetConversation.title}
              </button>
            ) : (
              <span>提交后创建新对话</span>
            )}
            <div className="flex max-w-full flex-wrap items-center gap-2">
              {inputImages.length > 0 && <span>{referenceImages.length} 张参考图</span>}
              {maskDraft && (
                <span className="rounded-md bg-brand-soft px-2 py-1 text-brand-ink">
                  遮罩已启用
                </span>
              )}
              {isMobile && (
                <button
                  type="button"
                  className="ui-button min-h-9 px-2 text-xs"
                  aria-expanded={!mobileCollapsed}
                  aria-controls="inputbar-parameters"
                  onClick={() => setMobileCollapsed((value) => !value)}
                >
                  {mobileCollapsed ? '展开创作面板' : '收起创作面板'}
                </button>
              )}
            </div>
          </div>

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 &&
            (isMobile ? (
              <>
                <div
                  className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}
                  inert={mobileCollapsed || undefined}
                  aria-hidden={mobileCollapsed || undefined}
                >
                  <div className="collapse-inner">{imageGridElement}</div>
                </div>
              </>
            ) : (
              imageGridElement
            ))}

          {/* 输入框始终挂载；折叠、切换对话和多选不会丢失光标或全局草稿。 */}
          <div className="mb-2">
            <TextareaInput
              value={prompt}
              onChange={setPrompt}
              onKeyDown={handleKeyDown}
              onClear={() => setPrompt('')}
              textareaRef={textareaRef}
              adjustHeight={adjustTextareaHeight}
            />
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2 border-t border-line pt-3">
            <div
              id="inputbar-parameters"
              className="min-w-0 flex-1"
              hidden={isMobile && mobileCollapsed}
            >
              {(!isMobile || !mobileCollapsed) && pillRowElement}
            </div>
            {isMobile && mobileCollapsed && (
              <button
                type="button"
                className="ui-button mr-auto text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={atImageLimit}
                aria-label="上传参考图"
              >
                添加参考图
              </button>
            )}
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
