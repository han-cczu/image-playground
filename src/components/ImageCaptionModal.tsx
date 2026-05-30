import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { captionImageStream } from '../lib/api/captionImageApi'

type Phase = 'idle' | 'streaming' | 'done' | 'error'

export default function ImageCaptionModal() {
  const captionSource = useStore((s) => s.captionSource)
  const setCaptionSource = useStore((s) => s.setCaptionSource)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const settings = useStore((s) => s.settings)
  const showToast = useStore((s) => s.showToast)

  const [caption, setCaption] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<string | null>(null)
  sourceRef.current = captionSource
  const configRef = useRef(settings.captioner)
  configRef.current = settings.captioner
  const promptRef = useRef(prompt)
  promptRef.current = prompt

  const runCaption = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const source = sourceRef.current
    if (!source) {
      setPhase('error')
      setErrorMessage('未选择图片')
      return
    }
    setCaption('')
    setErrorMessage(null)
    setPhase('streaming')
    captionImageStream(configRef.current, source, {
      signal: controller.signal,
      onDelta: (chunk) => {
        // 旧流被 abort 后已入队的 delta 不应污染新一轮文本
        if (controller.signal.aborted) return
        setCaption((s) => s + chunk)
      },
    })
      .then(() => {
        if (controller.signal.aborted) return
        setPhase('done')
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setPhase('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(() => {
    if (!captionSource) return
    runCaption()
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [captionSource, runCaption])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setCaptionSource(null)
    setCaption('')
    setPhase('idle')
    setErrorMessage(null)
  }, [setCaptionSource])

  const handleReplace = () => {
    const trimmed = caption.trim()
    if (!trimmed) return
    setPrompt(trimmed)
    showToast('已替换为反推提示词', 'success')
    handleClose()
  }

  const handleAppend = () => {
    const trimmed = caption.trim()
    if (!trimmed) return
    const cur = promptRef.current.trim()
    setPrompt(cur ? `${cur}\n${trimmed}` : trimmed)
    showToast('已追加反推提示词', 'success')
    handleClose()
  }

  useCloseOnEscape(Boolean(captionSource), handleClose)
  useLockBodyScroll(Boolean(captionSource))
  useFocusTrap(Boolean(captionSource), panelRef)

  if (!captionSource) return null

  const isStreaming = phase === 'streaming'
  const isDone = phase === 'done'
  const isError = phase === 'error'
  const canAdopt = isDone && Boolean(caption.trim())

  return (
    <div data-no-drag-select className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={handleClose} />
      <div ref={panelRef} tabIndex={-1} className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            反推提示词
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 min-h-0">
          <div className="flex flex-col min-h-0">
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">源图</div>
            <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-hidden rounded-2xl border border-gray-200/70 bg-white/50 p-3 flex items-center justify-center dark:border-white/[0.08] dark:bg-white/[0.03]">
              <img src={captionSource} alt="源图" className="max-h-full max-w-full object-contain rounded-lg" />
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>反推结果</span>
              {isStreaming && (
                <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                  <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" strokeWidth={3} className="opacity-25" />
                    <path strokeWidth={3} strokeLinecap="round" d="M22 12a10 10 0 00-10-10" />
                  </svg>
                  生成中…
                </span>
              )}
            </div>
            <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-y-auto rounded-2xl border border-blue-200/70 bg-blue-50/30 p-3 text-sm text-gray-700 whitespace-pre-wrap break-words dark:border-blue-500/20 dark:bg-blue-500/[0.04] dark:text-gray-200 custom-scrollbar">
              {isError ? (
                <div className="text-red-500 dark:text-red-400 break-words">{errorMessage || '反推失败'}</div>
              ) : (
                <>
                  {caption}
                  {isStreaming && (
                    <span className="inline-block w-[2px] h-[1em] -mb-[2px] bg-blue-500 dark:bg-blue-400 animate-pulse ml-0.5" aria-hidden>▍</span>
                  )}
                  {!caption && !isStreaming && !isError && (
                    <span className="text-gray-400">（等待反推结果）</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {isError && (
            <button
              type="button"
              onClick={runCaption}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleAppend}
            disabled={!canAdopt}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-500/10"
          >
            追加
          </button>
          <button
            type="button"
            onClick={handleReplace}
            disabled={!canAdopt}
            className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            采用
          </button>
        </div>
      </div>
    </div>
  )
}
