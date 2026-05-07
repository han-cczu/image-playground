import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../store'
import { DEFAULT_PARAMS } from '../../types'
import { getOutputImageLimitForSettings } from '../../lib/api/paramCompatibility'
import { normalizeImageSize } from '../../lib/image/size'
import Select from '../Select'
import ViewportTooltip from '../ViewportTooltip'

function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  return (
    <ViewportTooltip visible={visible} className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

const SELECT_CLASS =
  'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm'

const QUALITY_OPTIONS = [
  { label: 'auto', value: 'auto' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
]

interface Props {
  cols: string
  onOpenSizePicker: () => void
}

export default function ParamRow({ cols, onOpenSizePicker }: Props) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)

  const moderationDisabled = settings.apiMode === 'responses'
  const compressionDisabled = params.output_format === 'png'
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nLimitHintText = `OpenAI 最大请求数量为 ${outputImageLimit}`
  const displaySize = normalizeImageSize(params.size) || DEFAULT_PARAMS.size

  const [outputCompressionInput, setOutputCompressionInput] = useState(
    params.output_compression == null ? '' : String(params.output_compression),
  )
  const [nInput, setNInput] = useState(String(params.n))
  const [nInputFocused, setNInputFocused] = useState(false)
  const [nLimitHintVisible, setNLimitHintVisible] = useState(false)
  const [compressionHintVisible, setCompressionHintVisible] = useState(false)
  const [moderationHintVisible, setModerationHintVisible] = useState(false)
  const [qualityHintVisible, setQualityHintVisible] = useState(false)
  const compressionHintTimerRef = useRef<number | null>(null)
  const moderationHintTimerRef = useRef<number | null>(null)
  const qualityHintTimerRef = useRef<number | null>(null)
  const nLimitHintTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setOutputCompressionInput(
      params.output_compression == null ? '' : String(params.output_compression),
    )
  }, [params.output_compression])

  useEffect(() => {
    setNInput(String(params.n))
  }, [params.n])

  useEffect(
    () => () => {
      if (compressionHintTimerRef.current != null) window.clearTimeout(compressionHintTimerRef.current)
      if (moderationHintTimerRef.current != null) window.clearTimeout(moderationHintTimerRef.current)
      if (qualityHintTimerRef.current != null) window.clearTimeout(qualityHintTimerRef.current)
      if (nLimitHintTimerRef.current != null) window.clearTimeout(nLimitHintTimerRef.current)
    },
    [],
  )

  const commitOutputCompression = useCallback(() => {
    if (outputCompressionInput.trim() === '') {
      setOutputCompressionInput('')
      setParams({ output_compression: null })
      return
    }
    const nextValue = Number(outputCompressionInput)
    if (Number.isNaN(nextValue)) {
      setOutputCompressionInput(params.output_compression == null ? '' : String(params.output_compression))
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

  const showModerationHint = () => {
    if (moderationDisabled) setModerationHintVisible(true)
  }
  const hideModerationHint = () => {
    setModerationHintVisible(false)
    clearModerationHintTimer()
  }
  const clearModerationHintTimer = () => {
    if (moderationHintTimerRef.current != null) {
      window.clearTimeout(moderationHintTimerRef.current)
      moderationHintTimerRef.current = null
    }
  }
  const startModerationHintTouch = () => {
    if (!moderationDisabled) return
    moderationHintTimerRef.current = window.setTimeout(() => {
      setModerationHintVisible(true)
      moderationHintTimerRef.current = null
    }, 450)
  }

  const showCompressionHint = () => setCompressionHintVisible(true)
  const hideCompressionHint = () => {
    setCompressionHintVisible(false)
    clearCompressionHintTimer()
  }
  const clearCompressionHintTimer = () => {
    if (compressionHintTimerRef.current != null) {
      window.clearTimeout(compressionHintTimerRef.current)
      compressionHintTimerRef.current = null
    }
  }
  const startCompressionHintTouch = () => {
    compressionHintTimerRef.current = window.setTimeout(() => {
      setCompressionHintVisible(true)
      compressionHintTimerRef.current = null
    }, 450)
  }

  const showQualityHint = () => {
    if (settings.codexCli) setQualityHintVisible(true)
  }
  const hideQualityHint = () => {
    setQualityHintVisible(false)
    clearQualityHintTimer()
  }
  const clearQualityHintTimer = () => {
    if (qualityHintTimerRef.current != null) {
      window.clearTimeout(qualityHintTimerRef.current)
      qualityHintTimerRef.current = null
    }
  }
  const startQualityHintTouch = () => {
    if (!settings.codexCli) return
    qualityHintTimerRef.current = window.setTimeout(() => {
      setQualityHintVisible(true)
      qualityHintTimerRef.current = null
    }, 450)
  }

  return (
    <div className={`grid ${cols} gap-2 text-xs flex-1`}>
      <label className="relative flex flex-col gap-0.5">
        <span className="text-gray-400 dark:text-gray-500 ml-1">尺寸</span>
        <button
          type="button"
          onClick={onOpenSizePicker}
          className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] focus:outline-none text-xs text-left transition-all duration-200 shadow-sm font-mono"
          title="选择尺寸"
        >
          {displaySize}
        </button>
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={showQualityHint}
        onMouseLeave={hideQualityHint}
        onTouchStart={startQualityHintTouch}
        onTouchEnd={clearQualityHintTimer}
        onTouchCancel={hideQualityHint}
        onClick={showQualityHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">质量</span>
        <Select
          value={settings.codexCli ? 'auto' : params.quality}
          onChange={(val) => {
            if (!settings.codexCli) setParams({ quality: val as any })
          }}
          options={QUALITY_OPTIONS}
          disabled={settings.codexCli}
          className={
            settings.codexCli
              ? 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-xs transition-all duration-200 shadow-sm'
              : SELECT_CLASS
          }
        />
        <ButtonTooltip visible={settings.codexCli && qualityHintVisible} text="Codex CLI 不支持质量参数" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-gray-400 dark:text-gray-500 ml-1">格式</span>
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
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={showCompressionHint}
        onMouseLeave={hideCompressionHint}
        onTouchStart={startCompressionHintTouch}
        onTouchEnd={clearCompressionHintTimer}
        onTouchCancel={hideCompressionHint}
        onClick={showCompressionHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">压缩率</span>
        <input
          value={outputCompressionInput}
          onChange={(e) => setOutputCompressionInput(e.target.value)}
          onBlur={commitOutputCompression}
          disabled={compressionDisabled}
          type="number"
          min={0}
          max={100}
          placeholder="0-100"
          className={`px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] focus:outline-none text-xs transition-all duration-200 shadow-sm ${
            compressionDisabled
              ? 'bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed'
              : 'bg-white/50 dark:bg-white/[0.03]'
          }`}
        />
        <ButtonTooltip visible={compressionHintVisible} text="仅 JPEG 和 WebP 支持压缩率" />
      </label>
      <label
        className="relative flex flex-col gap-0.5"
        onMouseEnter={showModerationHint}
        onMouseLeave={hideModerationHint}
        onTouchStart={startModerationHintTouch}
        onTouchEnd={clearModerationHintTimer}
        onTouchCancel={hideModerationHint}
        onClick={showModerationHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">审核</span>
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
              ? 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-xs transition-all duration-200 shadow-sm'
              : SELECT_CLASS
          }
        />
        <ButtonTooltip visible={moderationDisabled && moderationHintVisible} text="Responses API 不支持审核参数" />
      </label>
      <label className="relative flex flex-col gap-0.5">
        <span className="text-gray-400 dark:text-gray-500 ml-1">数量</span>
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
          className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] focus:outline-none text-xs transition-all duration-200 shadow-sm"
        />
        <ButtonTooltip visible={nLimitHintVisible} text={nLimitHintText} />
      </label>
    </div>
  )
}
