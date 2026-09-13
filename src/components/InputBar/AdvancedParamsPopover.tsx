import PopoverSurface from './PopoverSurface'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { DEFAULT_PARAMS, type TaskParams } from '../../types'
import { getOutputImageLimitForSettings } from '../../lib/api/paramCompatibility'
import ButtonTooltip from './ButtonTooltip'

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-lg border border-line  bg-surface  focus:outline-none text-sm transition-all duration-200 shadow-sm'

// 浏览器原生选项不受浮层 overflow 裁切，也不会与父层竞争 Escape 关闭事件。
const SELECT_CLASS =
  'w-full px-3 py-2 rounded-lg border border-line  bg-surface  hover:bg-surface  text-sm transition-all duration-200 shadow-sm'

const QUALITY_OPTIONS: Array<{ label: string; value: TaskParams['quality'] }> = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
]

const OUTPUT_FORMAT_OPTIONS: Array<{ label: string; value: TaskParams['output_format'] }> = [
  { label: 'PNG', value: 'png' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'WebP', value: 'webp' },
]

const MODERATION_OPTIONS: Array<{ label: string; value: TaskParams['moderation'] }> = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
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

  const [outputCompressionDraft, setOutputCompressionDraft] = useState<string | null>(null)
  const [nDraft, setNDraft] = useState<string | null>(null)
  const [nInputFocused, setNInputFocused] = useState(false)
  const [nLimitHintVisible, setNLimitHintVisible] = useState(false)
  const nLimitHintTimerRef = useRef<number | null>(null)

  const outputCompressionInput =
    outputCompressionDraft ??
    (params.output_compression == null ? '' : String(params.output_compression))
  const nInput = nDraft ?? String(params.n)

  useEffect(
    () => () => {
      if (nLimitHintTimerRef.current != null) window.clearTimeout(nLimitHintTimerRef.current)
    },
    [],
  )

  usePopoverDismiss(true, anchorRef, popoverRef, onClose)

  const commitOutputCompression = useCallback(() => {
    if (outputCompressionInput.trim() === '') {
      setOutputCompressionDraft(null)
      setParams({ output_compression: null })
      return
    }
    const nextValue = Number(outputCompressionInput)
    if (Number.isNaN(nextValue)) {
      setOutputCompressionDraft(null)
      return
    }
    setOutputCompressionDraft(null)
    setParams({ output_compression: nextValue })
  }, [outputCompressionInput, setParams])

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
    setNDraft(null)
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
      setNDraft(value)
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
    <PopoverSurface anchorRef={anchorRef} panelRef={popoverRef} label="高级参数" width={340}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-content ">高级参数</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-content-subtle transition hover:bg-surface-muted hover:text-content-muted  "
          aria-label="关闭高级参数"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* 质量 */}
        <label className="relative flex flex-col gap-1">
          <span className="ml-1 text-content-muted ">质量</span>
          <select
            value={qualityDisabled ? 'auto' : params.quality}
            onChange={(event) => {
              if (!qualityDisabled)
                setParams({ quality: event.target.value as TaskParams['quality'] })
            }}
            disabled={qualityDisabled}
            className={
              qualityDisabled
                ? 'w-full px-3 py-2 rounded-lg border border-line  bg-surface-muted  opacity-50 cursor-not-allowed text-sm shadow-sm'
                : SELECT_CLASS
            }
          >
            {QUALITY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {qualityDisabled && (
            <span className="ml-1 text-[10px] text-content-muted ">Codex CLI 不支持质量参数</span>
          )}
        </label>

        {/* 格式 */}
        <label className="flex flex-col gap-1">
          <span className="ml-1 text-content-muted ">格式</span>
          <select
            value={params.output_format}
            onChange={(event) =>
              setParams({ output_format: event.target.value as TaskParams['output_format'] })
            }
            className={SELECT_CLASS}
          >
            {OUTPUT_FORMAT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {/* 压缩率 */}
        <label className="flex flex-col gap-1">
          <span className="ml-1 text-content-muted ">压缩率</span>
          <input
            value={outputCompressionInput}
            onChange={(e) => setOutputCompressionDraft(e.target.value)}
            onBlur={commitOutputCompression}
            onFocus={() => setOutputCompressionDraft(outputCompressionInput)}
            disabled={compressionDisabled}
            type="number"
            min={0}
            max={100}
            placeholder="0-100"
            className={
              compressionDisabled
                ? 'w-full px-3 py-2 rounded-lg border border-line  bg-surface-muted  opacity-50 cursor-not-allowed text-sm shadow-sm'
                : INPUT_CLASS
            }
          />
          {compressionDisabled && (
            <span className="ml-1 text-[10px] text-content-muted ">仅 JPEG 和 WebP 支持</span>
          )}
        </label>

        {/* 审核 */}
        <label className="flex flex-col gap-1">
          <span className="ml-1 text-content-muted ">审核</span>
          <select
            value={moderationDisabled ? 'auto' : params.moderation}
            onChange={(event) => {
              if (!moderationDisabled)
                setParams({ moderation: event.target.value as TaskParams['moderation'] })
            }}
            disabled={moderationDisabled}
            className={
              moderationDisabled
                ? 'w-full px-3 py-2 rounded-lg border border-line  bg-surface-muted  opacity-50 cursor-not-allowed text-sm shadow-sm'
                : SELECT_CLASS
            }
          >
            {MODERATION_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {moderationDisabled && (
            <span className="ml-1 text-[10px] text-content-muted ">Responses API 不支持</span>
          )}
        </label>

        {/* 数量 */}
        <label className="relative col-span-2 flex flex-col gap-1">
          <span className="ml-1 text-content-muted ">数量</span>
          <input
            value={nInput}
            onChange={(e) => handleNInputChange(e.target.value)}
            onFocus={() => {
              setNInputFocused(true)
              setNDraft(nInput)
            }}
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
    </PopoverSurface>
  )
}
