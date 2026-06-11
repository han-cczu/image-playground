import { useEffect, useRef, useState } from 'react'
import { useStore, retryTask, cancelTask } from '../../store'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/image/clipboard'
import type { TaskRecord } from '../../types'

interface ImagePanelProps {
  task: TaskRecord
  imageIndex: number
  setImageIndex: (index: number) => void
  currentOutputImageSrc: string
  /** 当前输出图的宽高比文案,尺寸检测完成前为空 */
  currentImageRatio: string
  /** 当前输出图的像素尺寸文案,尺寸检测完成前为空 */
  currentImageSize: string
  /** 耗时文案(running 态实时走表);无 elapsed 记录时为 null */
  durationText: string | null
}

/** 左侧图片面板:输出图展示、比例/尺寸标签、多图切换圆点,以及运行/错误态占位 */
export default function ImagePanel({
  task,
  imageIndex,
  setImageIndex,
  currentOutputImageSrc,
  currentImageRatio,
  currentImageSize,
  durationText,
}: ImagePanelProps) {
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)

  const imagePanelRef = useRef<HTMLDivElement>(null)
  const mainImageRef = useRef<HTMLImageElement>(null)
  const [imageLabelLeft, setImageLabelLeft] = useState(8)

  const outputLen = task.outputImages?.length || 0

  // 读屏命名:截断 prompt 作主图描述;无提示词时回退到序号。按码点截断,slice 按 code unit 会切裂 emoji 代理对
  const trimmedPrompt = task.prompt.trim()
  const promptCodePoints = Array.from(trimmedPrompt)
  const promptSnippet =
    promptCodePoints.length > 50 ? `${promptCodePoints.slice(0, 50).join('')}…` : trimmedPrompt
  const imageAlt = promptSnippet ? `生成结果：${promptSnippet}` : `生成图片 ${imageIndex + 1}/${outputLen}`

  // 比例标签对齐图片左缘(object-contain 留白时不能贴面板),resize 时重算
  useEffect(() => {
    const updateImageLabelLeft = () => {
      const panel = imagePanelRef.current
      const image = mainImageRef.current
      if (!panel || !image) return

      const panelRect = panel.getBoundingClientRect()
      const imageRect = image.getBoundingClientRect()
      setImageLabelLeft(Math.max(8, imageRect.left - panelRect.left))
    }

    updateImageLabelLeft()
    window.addEventListener('resize', updateImageLabelLeft)
    return () => window.removeEventListener('resize', updateImageLabelLeft)
  }, [currentOutputImageSrc])

  const handleCopyError = async () => {
    const errorText = task.error || '生成失败'
    try {
      await copyTextToClipboard(errorText)
      showToast('完整报错已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制报错失败', err), 'error')
    }
  }

  const handleRetry = () => {
    retryTask(task)
    setDetailTaskId(null)
  }

  return (
    <div ref={imagePanelRef} className="md:w-1/2 w-full h-64 md:h-auto bg-gray-100 dark:bg-black/20 relative flex items-center justify-center flex-shrink-0 min-h-[16rem]">
      {task.status === 'done' && outputLen > 0 && currentOutputImageSrc && (
        <>
          {/* 包一层真按钮让放大操作键盘可达;原图片上的尺寸约束移到按钮,图片在按钮内等比缩放,渲染盒与原先一致 */}
          <button
            type="button"
            onClick={() =>
              setLightboxImageId(task.outputImages[imageIndex], task.outputImages)
            }
            className="flex h-[calc(100%-2rem)] w-[calc(100%-2rem)] cursor-pointer items-center justify-center"
            // aria-label 优先于内容命名,会把 img alt 整体遮蔽——把描述并入按钮名称,img 改装饰
            aria-label={`放大查看 ${imageAlt}`}
            title="点击放大"
          >
            <img
              ref={mainImageRef}
              src={currentOutputImageSrc}
              className="saveable-image max-w-full max-h-full object-contain"
              onLoad={() => {
                const panel = imagePanelRef.current
                const image = mainImageRef.current
                if (!panel || !image) return

                const panelRect = panel.getBoundingClientRect()
                const imageRect = image.getBoundingClientRect()
                setImageLabelLeft(Math.max(8, imageRect.left - panelRect.left))
              }}
              alt=""
            />
          </button>
          <div data-selectable-text className="absolute top-[15px] flex items-center gap-1.5" style={{ left: imageLabelLeft }}>
            {currentImageRatio && currentImageSize ? (
              <>
                <span className="bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                  {currentImageRatio}
                </span>
                <span className="bg-black/50 text-white/90 text-xs px-2 py-0.5 rounded backdrop-blur-sm font-medium">
                  {currentImageSize}
                </span>
              </>
            ) : (
              durationText && (
                <span className="flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {durationText}
                </span>
              )
            )}
          </div>
          {outputLen > 1 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setImageIndex(
                    (imageIndex - 1 + outputLen) % outputLen,
                  )
                }
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                aria-label="上一张"
                title="上一张"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() =>
                  setImageIndex((imageIndex + 1) % outputLen)
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                aria-label="下一张"
                title="下一张"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                {imageIndex + 1} / {outputLen}
              </span>
            </>
          )}
        </>
      )}
      {task.status === 'running' && (
        <>
          <div className="absolute left-4 top-4 flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {durationText}
          </div>
          <svg className="w-10 h-10 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <button
            type="button"
            onClick={() => cancelTask(task.id)}
            className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/50 px-3 py-1 text-xs text-white backdrop-blur-sm transition hover:bg-red-500/80"
          >
            取消生成
          </button>
        </>
      )}
      {task.status === 'error' && (
        <div className="w-full max-w-md px-4 text-center">
          <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p
            className="overflow-hidden text-sm leading-6 text-red-500 break-all"
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 4,
            }}
          >
            {task.error || '生成失败'}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleCopyError}
              className="inline-flex items-center justify-center rounded-full border border-red-200/80 bg-white/80 px-3 py-1.5 text-red-500 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-white/[0.04] dark:hover:bg-red-500/10"
              aria-label="复制完整报错"
              title="复制完整报错"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center justify-center rounded-full border border-blue-200/80 bg-white/80 px-3 py-1.5 text-blue-500 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:hover:bg-blue-500/10"
              aria-label="重试任务"
              title="重试任务"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
