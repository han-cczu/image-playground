import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import Modal, { ModalCloseButton, ModalTitle } from './Modal'
import { captionImageStream } from '../lib/api/captionImageApi'
import { useLatestRef } from '../hooks/useLatestRef'

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
  const sourceRef = useLatestRef(captionSource)
  const configRef = useLatestRef(settings.captioner)
  const promptRef = useLatestRef(prompt)

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
  }, [configRef, sourceRef])

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

  if (!captionSource) return null

  const isStreaming = phase === 'streaming'
  const isDone = phase === 'done'
  const isError = phase === 'error'
  const canAdopt = isDone && Boolean(caption.trim())

  return (
    <Modal
      onClose={handleClose}
      ariaLabel="反推提示词"
      containerClassName="z-[80] items-center"
      panelClassName="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden p-5"
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
        <ModalTitle>
          <svg
            className="w-5 h-5 text-brand-ink"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          反推提示词
        </ModalTitle>
        <ModalCloseButton onClick={handleClose} />
      </div>

      <div className="custom-scrollbar grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
        <div className="flex flex-col min-h-0">
          <div className="mb-2 text-xs font-medium text-content-muted dark:text-content-muted">
            源图
          </div>
          <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-hidden rounded-2xl border border-line bg-surface p-3 flex items-center justify-center dark:border-line dark:bg-surface-raised">
            <img
              src={captionSource}
              alt="源图"
              className="max-h-full max-w-full object-contain rounded-lg"
            />
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-content-muted dark:text-content-muted">
            <span>反推结果</span>
            {isStreaming && (
              <span className="flex items-center gap-1 text-brand-ink dark:text-brand-ink">
                <svg
                  className="w-3 h-3 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" strokeWidth={3} className="opacity-25" />
                  <path strokeWidth={3} strokeLinecap="round" d="M22 12a10 10 0 00-10-10" />
                </svg>
                生成中…
              </span>
            )}
          </div>
          <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-y-auto rounded-2xl border border-brand bg-brand-soft p-3 text-sm text-content whitespace-pre-wrap break-words dark:border-brand dark:bg-brand-soft dark:text-content custom-scrollbar">
            {isError ? (
              <div className="text-red-500 dark:text-red-400 break-words">
                {errorMessage || '反推失败'}
              </div>
            ) : (
              <>
                {caption}
                {isStreaming && (
                  <span
                    className="inline-block w-[2px] h-[1em] -mb-[2px] bg-brand dark:bg-brand animate-pulse ml-0.5"
                    aria-hidden
                  >
                    ▍
                  </span>
                )}
                {!caption && !isStreaming && !isError && (
                  <span className="text-content-subtle">（等待反推结果）</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {isError && (
          <button
            type="button"
            onClick={runCaption}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-brand-ink transition hover:bg-brand-soft dark:text-brand-ink dark:hover:bg-brand-soft"
          >
            重试
          </button>
        )}
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg px-4 py-2.5 text-sm text-content transition hover:bg-surface-muted dark:text-content dark:hover:bg-surface-raised"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleAppend}
          disabled={!canAdopt}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-brand-ink transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40 dark:text-brand-ink dark:hover:bg-brand-soft"
        >
          追加
        </button>
        <button
          type="button"
          onClick={handleReplace}
          disabled={!canAdopt}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand dark:hover:bg-brand-hover"
        >
          采用
        </button>
      </div>
    </Modal>
  )
}
