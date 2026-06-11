import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import Modal, { ModalCloseButton, ModalTitle } from './Modal'
import { optimizePromptStream } from '../lib/api/optimizePromptApi'

type Phase = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled'

export default function PromptOptimizerModal() {
  const showPromptOptimizer = useStore((s) => s.showPromptOptimizer)
  const setShowPromptOptimizer = useStore((s) => s.setShowPromptOptimizer)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const settings = useStore((s) => s.settings)
  const showToast = useStore((s) => s.showToast)

  const [optimized, setOptimized] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 在 useEffect 中读取最新的 prompt / config 时需要稳定引用，避免依赖变化重新触发优化
  const promptRef = useRef(prompt)
  promptRef.current = prompt
  const optimizerRef = useRef(settings.promptOptimizer)
  optimizerRef.current = settings.promptOptimizer

  const runOptimize = useCallback(() => {
    // 中止任何尚未完成的请求
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setOptimized('')
    setErrorMessage(null)
    setPhase('streaming')

    const currentPrompt = promptRef.current
    const config = optimizerRef.current

    optimizePromptStream(config, currentPrompt, {
      signal: controller.signal,
      onDelta: (chunk) => {
        // 旧流被 abort 后已入队的 delta 不应污染新一轮文本
        if (controller.signal.aborted) return
        setOptimized((s) => s + chunk)
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
    if (!showPromptOptimizer) return
    runOptimize()
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [showPromptOptimizer, runOptimize])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setShowPromptOptimizer(false)
    // 关闭后重置内部状态，下次打开重新开始
    setOptimized('')
    setPhase('idle')
    setErrorMessage(null)
  }, [setShowPromptOptimizer])

  const handleRetry = () => {
    runOptimize()
  }

  const handleAdopt = () => {
    const trimmed = optimized.trim()
    if (!trimmed) return
    setPrompt(trimmed)
    showToast('已采用优化后的提示词', 'success')
    handleClose()
  }

  if (!showPromptOptimizer) return null

  const isStreaming = phase === 'streaming'
  const isDone = phase === 'done'
  const isError = phase === 'error'

  return (
    <Modal
      onClose={handleClose}
      ariaLabel="提示词优化"
      containerClassName="z-[80] items-center"
      panelClassName="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-5"
    >
        <div className="mb-4 flex items-center justify-between gap-4">
          <ModalTitle>
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            提示词优化
          </ModalTitle>
          <ModalCloseButton onClick={handleClose} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 min-h-0">
          <div className="flex flex-col min-h-0">
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">原提示词</div>
            <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-y-auto rounded-2xl border border-gray-200/70 bg-white/50 p-3 text-sm text-gray-700 whitespace-pre-wrap break-words dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 custom-scrollbar">
              {prompt || <span className="text-gray-400">（空）</span>}
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span>优化后</span>
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
                <div className="space-y-2">
                  <div className="text-red-500 dark:text-red-400 break-words">
                    {errorMessage || '优化失败'}
                  </div>
                </div>
              ) : (
                <>
                  {optimized}
                  {isStreaming && (
                    <span className="inline-block w-[2px] h-[1em] -mb-[2px] bg-blue-500 dark:bg-blue-400 animate-pulse ml-0.5" aria-hidden>
                      ▍
                    </span>
                  )}
                  {!optimized && !isStreaming && !isError && (
                    <span className="text-gray-400">（等待优化结果）</span>
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
              onClick={handleRetry}
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
            onClick={handleAdopt}
            disabled={!isDone || !optimized.trim()}
            className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            采用
          </button>
        </div>
    </Modal>
  )
}
