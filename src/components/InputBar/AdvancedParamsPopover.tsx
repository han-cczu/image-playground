import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store'
import { DEFAULT_PARAMS } from '../../types'
import { getOutputImageLimitForSettings } from '../../lib/api/paramCompatibility'
import Select from '../Select'
import ViewportTooltip from '../ViewportTooltip'

function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  return (
    <ViewportTooltip visible={visible} className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/60 dark:bg-white/[0.03] focus:outline-none text-sm transition-all duration-200 shadow-sm'

const SELECT_CLASS =
  'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/60 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-sm transition-all duration-200 shadow-sm'

const QUALITY_OPTIONS = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
]

interface Props {
  /** 锚点（齿轮按钮）的元素引用，用于定位与点击外部检测 */
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * 高级参数 popover：承载 quality / output_format / output_compression / moderation / n。
 *
 * 复用 ParamRow 的输入逻辑，但作为弹出层呈现。原 ParamRow 在 pill 化的底栏里不再渲染。
 */
export default function AdvancedParamsPopover({ anchorRef, onClose }: Props) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)

  const popoverRef = useRef<HTMLDivElement>(null)

  const moderationDisabled = settings.apiMode === 'responses'
  const compressionDisabled = params.output_format === 'png'
  const qualityDisabled = settings.codexCli
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nLimitHintText = `OpenAI 最大请求数量为 ${outputImageLimit}`

  const [outputCompressionInput, setOutputCompressionInput] = useState(
    params.output_compression == null ? '' : String(params.output_compression),
  )
  const [nInput, setNInput] = useState(String(params.n))
  const [nInputFocused, setNInputFocused] = useState(false)
  const [nLimitHintVisible, setNLimitHintVisible] = useState(false)
  const nLimitHintTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setOutputCompressionInput(
      params.output_compression == null ? '' : String(params.output_compression),
    )
  }, [params.output_compression])

  useEffect(() => {
    setNInput(String(params.n))
  }, [params.n])

  useEffect(() => () => {
    if (nLimitHintTimerRef.current != null) window.clearTimeout(nLimitHintTimerRef.current)
  }, [])

  /** Esc 关闭、点击外部关闭 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [anchorRef, onClose])

  const commitOutputCompression = useCallback(() => {
    if (outputCompressionInput.trim() === '') {
      setOutputCompressionInput('')
      setParams({ output_compression: null })
      return
    }
    const nextValue = Number(outputCompressionInput)
    if (Number.isNaN(nextValue)) {
      setOutputCompressionInput(
        params.output_compression == null ? '' : String(params.output_compression),
      )
      return
    }
    setOutputCompressionInput(String(nextValue))
    setParams({ output_compression: nextValue })
  }, [outputCompressionInput, params.output_compression, setParams])

  const commitN = useCallback(() => {
    setNLimitHintVisible(false)
    if (nLimitHintTimerRef.current != null) {
      window.clearTimeout(nLimitHintTimerRef.current)
      nLimitHintTimerRef.current = null
    }
    const nextValue = Number(nInput)
    const normalizedValue =
      nInput.trim() === '' ? DEFAULT_PARAMS.n : Number.isNaN(nextValue) ? params.n : nextValue
    const clampedValue = Math.min(outputImageLimit, Math.max(1, normalizedValue))
    setNInput(String(clampedValue))
    setParams({ n: clampedValue })
  }, [nInput, outputImageLimit, params.n, setParams])

  const showNLimitHint = useCallback(() => {
    setNLimitHintVisible(true)
    if (nLimitHintTimerRef.current != null) window.clearTimeout(nLimitHintTimerRef.current)
    nLimitHintTimerRef.current = window.setTimeout(() => {
      setNLimitHintVisible(false)
      nLimitHintTimerRef.current = null
    }, 2000)
  }, [])

  const hideNLimitHint = useCallback(() => {
    setNLimitHintVisible(false)
    if (nLimitHintTimerRef.current != null) {
      window.clearTimeout(nLimitHintTimerRef.current)
      nLimitHintTimerRef.current = null
    }
  }, [])

  const handleNInputChange = useCallback(
    (value: string) => {
      setNInput(value)
      const nextValue = Number(value)
      if (!Number.isNaN(nextValue) && nextValue > outputImageLimit) showNLimitHint()
      else hideNLimitHint()
    },
    [hideNLimitHint, outputImageLimit, showNLimitHint],
  )

  const handleNLimitIncreaseAttempt = useCallback(
    (preventDefault: () => void) => {
      const currentValue = Number(nInput)
      const effectiveValue = Number.isNaN(currentValue) ? params.n : currentValue
      if (!nInputFocused || effectiveValue < outputImageLimit) return
      preventDefault()
      showNLimitHint()
    },
    [nInput, nInputFocused, outputImageLimit, params.n, showNLimitHint],
  )

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-label="高级参数"
      className="absolute bottom-full right-0 mb-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200/70 bg-white/95 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 z-40"
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">高级参数</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
          aria-label="关闭高级参数"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* 质量 */}
        <label className="relative flex flex-col gap-1">
          <span className="ml-1 text-gray-500 dark:text-gray-400">质量</span>
          <Select
            value={qualityDisabled ? 'auto' : params.quality}
            onChange={(val) => {
              if (!qualityDisabled) setParams({ quality: val as any })
            }}
            options={QUALITY_OPTIONS}
            disabled={qualityDisabled}
            className={
              qualityDisabled
                ? 'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-sm shadow-sm'
                : SELECT_CLASS
            }
          />
          {qualityDisabled && (
            <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
              Codex CLI 不支持质量参数
            </span>
          )}
        </label>

        {/* 格式 */}
        <label className="flex flex-col gap-1">
          <span className="ml-1 text-gray-500 dark:text-gray-400">格式</span>
          <Select
            value={params.output_format}
            onChange={(val) => setParams({ output_format: val as any })}
            options={[
              { label: 'PNG', value: 'png' },
              { label: 'JPEG', value: 'jpeg' },
              { label: 'WebP', value: 'webp' },
            ]}
            className={SELECT_CLASS}
          />
        </label>

        {/* 压缩率 */}
        <label className="flex flex-col gap-1">
          <span className="ml-1 text-gray-500 dark:text-gray-400">压缩率</span>
          <input
            value={outputCompressionInput}
            onChange={(e) => setOutputCompressionInput(e.target.value)}
            onBlur={commitOutputCompression}
            disabled={compressionDisabled}
            type="number"
            min={0}
            max={100}
            placeholder="0-100"
            className={
              compressionDisabled
                ? 'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-sm shadow-sm'
                : INPUT_CLASS
            }
          />
          {compressionDisabled && (
            <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
              仅 JPEG 和 WebP 支持
            </span>
          )}
        </label>

        {/* 审核 */}
        <label className="flex flex-col gap-1">
          <span className="ml-1 text-gray-500 dark:text-gray-400">审核</span>
          <Select
            value={moderationDisabled ? 'auto' : params.moderation}
            onChange={(val) => {
              if (!moderationDisabled) setParams({ moderation: val as any })
            }}
            options={[
              { label: 'auto', value: 'auto' },
              { label: 'low', value: 'low' },
            ]}
            disabled={moderationDisabled}
            className={
              moderationDisabled
                ? 'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-sm shadow-sm'
                : SELECT_CLASS
            }
          />
          {moderationDisabled && (
            <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
              Responses API 不支持
            </span>
          )}
        </label>

        {/* 数量 */}
        <label className="relative col-span-2 flex flex-col gap-1">
          <span className="ml-1 text-gray-500 dark:text-gray-400">数量</span>
          <input
            value={nInput}
            onChange={(e) => handleNInputChange(e.target.value)}
            onFocus={() => setNInputFocused(true)}
            onBlur={() => {
              setNInputFocused(false)
              commitN()
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') handleNLimitIncreaseAttempt(() => e.preventDefault())
            }}
            onWheel={(e) => {
              if (e.deltaY < 0) handleNLimitIncreaseAttempt(() => e.preventDefault())
            }}
            type="number"
            min={1}
            max={outputImageLimit}
            className={INPUT_CLASS}
          />
          <ButtonTooltip visible={nLimitHintVisible} text={nLimitHintText} />
        </label>
      </div>
    </div>
  )
}
