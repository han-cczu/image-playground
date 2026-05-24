import { useRef, useEffect, useCallback, useState, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, submitTask, addImageFromFile } from '../../store'
import { getChangedParams, normalizeParamsForSettings } from '../../lib/api/paramCompatibility'
import { getActiveApiProfile } from '../../lib/api/apiProfiles'
import { listModels } from '../../lib/api/listModels'
import { isOpenAIProfile } from '../../types'
import { createMaskPreviewDataUrl } from '../../lib/image/canvasImage'
import { filterAndSortTasks } from '../../lib/taskFilters'
import { calculateImageSize, normalizeImageSize, type SizeTier } from '../../lib/image/size'
import { DEFAULT_PARAMS } from '../../types'
import SelectionActionBar from './SelectionActionBar'
import AdvancedParamsPopover from './AdvancedParamsPopover'
import StylePickerPopover from './StylePickerPopover'
import { STYLE_PRESETS, isStylePresetKey } from '../../lib/stylePresets'
import SizePickerModal from '../SizePickerModal'
import ViewportTooltip from '../ViewportTooltip'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useImageHintTimer } from './hooks/useImageHintTimer'
import { useAutoResizeTextarea } from './hooks/useAutoResizeTextarea'

/** 通用悬浮气泡提示 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  return (
    <ViewportTooltip visible={visible} className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

/** API 支持的最大参考图数量 */
const API_MAX_IMAGES = 16

/** 底栏 pill 通用样式 */
const PILL_BASE =
  'inline-flex items-center gap-1 rounded-full border border-gray-200/70 bg-white/60 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors shadow-sm hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]'
const PILL_DISABLED =
  'inline-flex items-center gap-1 rounded-full border border-gray-200/70 bg-gray-100/60 px-3 py-1.5 text-xs font-medium text-gray-400 shadow-sm cursor-not-allowed dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-gray-500'

/** 简易 chevron 图标 */
function Chevron({ disabled = false }: { disabled?: boolean }) {
  return (
    <svg
      className={`h-3 w-3 ${disabled ? 'opacity-40' : 'opacity-70'}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** 从 size 字符串推断当前 tier（1K/2K/4K/auto/custom） */
function detectTier(size: string): SizeTier | 'auto' | 'custom' {
  const trimmed = (size || '').trim()
  if (!trimmed || trimmed === 'auto') return 'auto'
  const m = trimmed.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!m) return 'custom'
  const w = Number(m[1])
  const h = Number(m[2])
  const longSide = Math.max(w, h)
  // 阈值在两档分辨率之间取中点
  if (longSide <= 1536) return '1K'
  if (longSide <= 2944) return '2K'
  return '4K'
}

/** 从 size 字符串推断比例字符串（保留简化形式以便复用 calculateImageSize） */
function detectRatioFromSize(size: string): string | null {
  const trimmed = (size || '').trim()
  if (!trimmed || trimmed === 'auto') return null
  const m = trimmed.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return `${w}:${h}`
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

/** 模型列表加载状态机 */
type ModelListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; list: string[] }
  | { kind: 'error'; msg: string }

/** 旋转加载指示 */
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-gray-400 dark:text-gray-500"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * 模型 pill 弹出菜单（两段式）：
 *   上半段：当前 active profile 的可选 model（API 拉取 + 会话内缓存）
 *   下半段：切换其它 profile
 *   底部：打开设置进行更多配置
 */
function ModelMenu({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const ref = useRef<HTMLDivElement>(null)
  /** profileId -> model id list */
  const cacheRef = useRef<Map<string, string[]>>(new Map())
  const [modelState, setModelState] = useState<ModelListState>({ kind: 'idle' })

  const activeProfile = settings.profiles.find((p) => p.id === settings.activeProfileId) ?? settings.profiles[0]

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
      if (ref.current?.contains(target)) return
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

  const doFetch = useCallback(
    async (force: boolean) => {
      if (!activeProfile || !isOpenAIProfile(activeProfile) || !activeProfile.apiKey.trim()) return
      const profileId = activeProfile.id
      if (!force) {
        const cached = cacheRef.current.get(profileId)
        if (cached) {
          setModelState({ kind: 'success', list: cached })
          return
        }
      }
      setModelState({ kind: 'loading' })
      try {
        const ids = await listModels(activeProfile)
        // 仅在 active profile 未变化时写入状态
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        cacheRef.current.set(profileId, ids)
        if (stillActive) setModelState({ kind: 'success', list: ids })
      } catch (err) {
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        if (stillActive) {
          setModelState({ kind: 'error', msg: err instanceof Error ? err.message : String(err) })
        }
      }
    },
    [activeProfile],
  )

  // 菜单打开 / active profile 切换时：检查缓存，未命中且条件满足则拉取
  useEffect(() => {
    if (!activeProfile) return
    if (!isOpenAIProfile(activeProfile)) {
      setModelState({ kind: 'idle' })
      return
    }
    if (!activeProfile.apiKey.trim()) {
      setModelState({ kind: 'idle' })
      return
    }
    const cached = cacheRef.current.get(activeProfile.id)
    if (cached) {
      setModelState({ kind: 'success', list: cached })
      return
    }
    void doFetch(false)
  }, [activeProfile, doFetch])

  const handlePickModel = (model: string) => {
    if (!activeProfile) return
    const nextProfiles = settings.profiles.map((p) =>
      p.id === settings.activeProfileId ? { ...p, model } : p,
    )
    setSettings({ profiles: nextProfiles })
    onClose()
  }

  const renderUpperSection = () => {
    if (!activeProfile) return null

    // Gemini：占位提示，不拉 API
    if (!isOpenAIProfile(activeProfile)) {
      return (
        <div className="px-2 py-2 text-[11px] text-gray-400 dark:text-gray-500">
          Gemini 暂不支持自动拉取模型列表，请在设置中手填 model
        </div>
      )
    }

    // OpenAI 但缺 apiKey：引导去设置
    if (!activeProfile.apiKey.trim()) {
      return (
        <div className="flex flex-col gap-1.5 px-2 py-2">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">请先在设置中补全 API Key</span>
          <button
            type="button"
            onClick={() => {
              setShowSettings(true)
              onClose()
            }}
            className="self-start rounded-md border border-gray-200/70 bg-white/60 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
            aria-label="打开设置"
          >
            打开设置
          </button>
        </div>
      )
    }

    // OpenAI 状态机
    const currentModel = activeProfile.model

    return (
      <div>
        <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1.5">
          <span className="truncate text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            当前 profile 可用模型 · {activeProfile.name}
          </span>
          {modelState.kind === 'success' && (
            <button
              type="button"
              onClick={() => void doFetch(true)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
              aria-label="刷新模型列表"
              title="刷新模型列表"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
          )}
        </div>

        {modelState.kind === 'loading' && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-gray-500 dark:text-gray-400">
            <Spinner />
            <span>正在加载…</span>
          </div>
        )}

        {modelState.kind === 'error' && (
          <div className="flex flex-col gap-1.5 px-2 py-1.5">
            <span
              className="text-[11px] text-red-500 dark:text-red-400"
              title={modelState.msg}
            >
              {modelState.msg.length > 120 ? `${modelState.msg.slice(0, 120)}…` : modelState.msg}
            </span>
            <button
              type="button"
              onClick={() => void doFetch(true)}
              className="self-start rounded-md border border-gray-200/70 bg-white/60 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              aria-label="重试"
            >
              重试
            </button>
          </div>
        )}

        {modelState.kind === 'success' && (() => {
          const currentInList = currentModel ? modelState.list.includes(currentModel) : false
          const extraTop = !currentInList && currentModel ? currentModel : null
          return (
            <ul className="flex max-h-[200px] flex-col gap-0.5 overflow-y-auto">
              {extraTop && (
                <li key={`__current_${extraTop}`}>
                  <button
                    type="button"
                    onClick={() => handlePickModel(extraTop)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200"
                  >
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium" title={extraTop}>{extraTop}</span>
                      <span className="truncate text-[10px] text-blue-500/80 dark:text-blue-300/80">
                        当前 · 不在 API 列表
                      </span>
                    </span>
                  </button>
                </li>
              )}
              {modelState.list.length === 0 && !extraTop && (
                <li className="px-2 py-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  API 返回模型列表为空
                </li>
              )}
              {modelState.list.map((id) => {
                const active = id === currentModel
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => handlePickModel(id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="truncate font-medium" title={id}>{id}</span>
                      {active && (
                        <svg
                          className="h-4 w-4 shrink-0 text-blue-500"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        })()}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="选择当前模型或切换配置"
      className="absolute bottom-full left-0 mb-2 min-w-[240px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200/70 bg-white/95 p-2 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 z-40"
    >
      {renderUpperSection()}

      <div className="mt-2 border-t border-gray-100 pt-2 dark:border-white/[0.06]">
        <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
          切换其他配置
        </div>
        <ul className="flex max-h-[200px] flex-col gap-0.5 overflow-y-auto">
          {settings.profiles.map((profile) => {
            const active = profile.id === settings.activeProfileId
            return (
              <li key={profile.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!active) setSettings({ activeProfileId: profile.id })
                    onClose()
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium" title={profile.name}>
                      {profile.name}
                    </span>
                    <span className="truncate text-[11px] text-gray-400 dark:text-gray-500" title={profile.model}>
                      {profile.provider === 'openai' ? 'OpenAI · ' : 'Gemini · '}
                      {profile.model || '未配置模型'}
                    </span>
                  </span>
                  {active && (
                    <svg
                      className="h-4 w-4 shrink-0 text-blue-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="mt-2 border-t border-gray-100 pt-2 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={() => {
            setShowSettings(true)
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.16.39.5.69.92.86H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          打开设置进行更多配置
        </button>
      </div>
    </div>
  )
}

/**
 * 分辨率 pill 弹出菜单：自动 / 1K / 2K / 4K。
 * 切换分辨率时保留当前 ratio：从 params.size 还原比例后乘上新的 tier 再写回 params。
 */
function ResolutionMenu({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const ref = useRef<HTMLDivElement>(null)

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
      if (ref.current?.contains(target)) return
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

  const currentTier = detectTier(params.size)
  const apply = (tier: SizeTier | 'auto') => {
    if (tier === 'auto') {
      setParams({ size: 'auto' })
      onClose()
      return
    }
    const ratio = detectRatioFromSize(params.size) ?? '1:1'
    const nextSize = calculateImageSize(tier, ratio)
    if (nextSize) setParams({ size: normalizeImageSize(nextSize) })
    onClose()
  }

  const items: Array<{ value: SizeTier | 'auto'; label: string; hint: string }> = [
    { value: 'auto', label: '自动', hint: '由模型决定' },
    { value: '1K', label: '1K', hint: '约 1024px 短边' },
    { value: '2K', label: '2K', hint: '约 2048px 长边' },
    { value: '4K', label: '4K', hint: '约 3840px 长边' },
  ]

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="选择输出分辨率"
      className="absolute bottom-full left-0 mb-2 min-w-[180px] rounded-2xl border border-gray-200/70 bg-white/95 p-2 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 z-40"
    >
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = currentTier === item.value
          return (
            <li key={item.value}>
              <button
                type="button"
                onClick={() => apply(item.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{item.hint}</span>
                </span>
                {active && (
                  <svg className="h-4 w-4 shrink-0 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function InputBar() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const inputImages = useStore((s) => s.inputImages)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
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

  // pill / popover 锚点
  const modelPillRef = useRef<HTMLButtonElement>(null)
  const stylePillRef = useRef<HTMLButtonElement>(null)
  const resolutionPillRef = useRef<HTMLButtonElement>(null)
  const advancedButtonRef = useRef<HTMLButtonElement>(null)

  const [isDragging, setIsDragging] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)
  const [optimizeHover, setOptimizeHover] = useState(false)
  const [mobileCollapsed, setMobileCollapsed] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')
  const [imageDragIndex, setImageDragIndex] = useState<number | null>(null)
  const [imageDragOverIndex, setImageDragOverIndex] = useState<number | null>(null)
  const [touchDragPreview, setTouchDragPreview] = useState<{ src: string; x: number; y: number } | null>(null)

  /** 顶部 pill 弹出层互斥 */
  type OpenMenu = 'model' | 'style' | 'resolution' | 'advanced' | null
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)

  const handleRef = useRef<HTMLDivElement>(null)
  const dragTouchRef = useRef({ startY: 0, moved: false })
  const imageDragIndexRef = useRef<number | null>(null)
  const imageTouchDragRef = useRef({ index: null as number | null, startX: 0, startY: 0, moved: false })
  const imageDragOverIndexRef = useRef<number | null>(null)
  const imageDragPreviewRef = useRef<HTMLElement | null>(null)
  const suppressImageClickRef = useRef(false)
  const maskConflictNoticeShownRef = useRef(false)
  const dragCounter = useRef(0)
  const isMobile = useIsMobile()
  const { imageHintId, showHint: showImageHint, hideHint: hideImageHint, startHintTouch: startImageHintTouch } = useImageHintTimer()
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

  const activeProfile = getActiveApiProfile(settings)
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

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleFilesRef.current(files)
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  // 移动端拖动条手势
  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      dragTouchRef.current = { startY: e.touches[0].clientY, moved: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - dragTouchRef.current.startY
      if (Math.abs(dy) > 10) dragTouchRef.current.moved = true
      if (dy > 30) setMobileCollapsed(true)
      if (dy < -30) setMobileCollapsed(false)
    }
    const onTouchEnd = () => {
      if (!dragTouchRef.current.moved) {
        setMobileCollapsed((v) => !v)
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const getTouchDropIndex = (touch: React.Touch) => {
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest<HTMLElement>('[data-input-image-index]')
    if (!target) return null
    const idx = Number(target.dataset.inputImageIndex)
    if (!Number.isInteger(idx)) return null
    const rect = target.getBoundingClientRect()
    return touch.clientX < rect.left + rect.width / 2 ? idx : idx + 1
  }

  const normalizeImageDropIndex = (idx: number) => {
    const minIdx = maskTargetImage ? 1 : 0
    return Math.max(minIdx, Math.min(inputImages.length, idx))
  }

  const isBeforeMaskDropArea = (clientX: number) => {
    if (!maskTargetImage) return false
    const maskEl = document.querySelector<HTMLElement>('[data-input-image-index="0"]')
    if (!maskEl) return false
    const rect = maskEl.getBoundingClientRect()
    return clientX < rect.left + rect.width / 2
  }

  const resetImageDrag = () => {
    setImageDragIndex(null)
    setImageDragOverIndex(null)
    imageDragIndexRef.current = null
    imageDragOverIndexRef.current = null
    imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
    setTouchDragPreview(null)
    imageDragPreviewRef.current?.remove()
    imageDragPreviewRef.current = null
    hideImageHint()
  }

  useEffect(() => {
    if (!touchDragPreview) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [touchDragPreview])

  const getDataTransferDragIndex = (e: React.DragEvent) => {
    const value = e.dataTransfer.getData('text/plain')
    const idx = Number(value)
    return Number.isInteger(idx) ? idx : null
  }

  const setImageDragTarget = (idx: number | null, clientX?: number) => {
    const fromIdx = imageDragIndexRef.current
    if (fromIdx !== null && maskTargetImage && (idx === 0 || (clientX != null && isBeforeMaskDropArea(clientX)))) {
      showImageHint(maskTargetImage.id)
      imageDragOverIndexRef.current = null
      setImageDragOverIndex(null)
      return
    }

    if (fromIdx !== null) hideImageHint()
    const normalizedIdx = idx == null ? null : normalizeImageDropIndex(idx)
    const isNoopTarget = fromIdx !== null && normalizedIdx !== null && (normalizedIdx === fromIdx || normalizedIdx === fromIdx + 1)
    const nextIdx = isNoopTarget ? null : normalizedIdx
    imageDragOverIndexRef.current = nextIdx
    setImageDragOverIndex(nextIdx)
  }

  const renderImageThumb = (img: (typeof inputImages)[number], idx: number) => {
    const isMaskTarget = maskDraft?.targetImageId === img.id
    const canEdit = !maskTargetImage || isMaskTarget
    const imageHintText = isMaskTarget
      ? '遮罩图必须为第一张图'
      : maskTargetImage
        ? '只能有一张遮罩图'
        : ''
    const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl
    const isImageDragging = imageDragIndex === idx
    const isLast = idx === inputImages.length - 1
    const showDropBefore = imageDragOverIndex === idx && imageDragIndex !== idx
    const showDropAfter = imageDragOverIndex === inputImages.length && isLast && imageDragIndex !== idx

    const handleDragStart = (e: React.DragEvent) => {
      if (isMaskTarget) {
        e.preventDefault()
        return
      }
      hideImageHint()
      imageDragIndexRef.current = idx
      setImageDragIndex(idx)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      const preview = document.createElement('div')
      preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:52px;height:52px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
      const previewImg = document.createElement('img')
      previewImg.src = displaySrc
      previewImg.style.cssText = 'width:52px;height:52px;object-fit:cover;display:block;'
      preview.appendChild(previewImg)
      document.body.appendChild(preview)
      imageDragPreviewRef.current = preview
      e.dataTransfer.setDragImage(preview, 26, 26)
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const fromIdx = imageDragIndexRef.current
      if (fromIdx === null || fromIdx === idx) return
      const rect = e.currentTarget.getBoundingClientRect()
      setImageDragTarget(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1, e.clientX)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = imageDragIndexRef.current ?? getDataTransferDragIndex(e)
      const toIdx = imageDragOverIndexRef.current
      if (fromIdx !== null && toIdx !== null) {
        moveInputImage(fromIdx, toIdx)
      }
      resetImageDrag()
    }

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isMaskTarget) {
        startImageHintTouch(img.id)
        return
      }
      const touch = e.touches[0]
      imageDragIndexRef.current = idx
      imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
      setTouchDragPreview(null)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const touchDrag = imageTouchDragRef.current
      if (touchDrag.index === null) return

      touchDrag.moved = true
      hideImageHint()
      suppressImageClickRef.current = true
      e.preventDefault()
      setImageDragIndex(touchDrag.index)
      setTouchDragPreview({ src: displaySrc, x: touch.clientX, y: touch.clientY })
      const dropIndex = getTouchDropIndex(touch)
      setImageDragTarget(dropIndex, touch.clientX)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchDrag = imageTouchDragRef.current
      hideImageHint()
      if (touchDrag.index !== null && imageDragOverIndexRef.current !== null) {
        e.preventDefault()
        moveInputImage(touchDrag.index, imageDragOverIndexRef.current)
        window.setTimeout(() => {
          suppressImageClickRef.current = false
        }, 0)
      }
      resetImageDrag()
    }

    const handleTouchCancel = () => {
      suppressImageClickRef.current = false
      hideImageHint()
      resetImageDrag()
    }

    return (
      <div
        key={img.id}
        data-input-image-index={idx}
        className={`relative group inline-block shrink-0 transition-opacity ${isImageDragging ? 'opacity-40' : ''}`}
        style={{ touchAction: isMaskTarget ? 'auto' : 'none' }}
        draggable={!isMobile && !isMaskTarget}
        onMouseEnter={() => imageHintText && (!isMobile || isMaskTarget) && showImageHint(img.id)}
        onMouseLeave={hideImageHint}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={resetImageDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <ButtonTooltip
          visible={imageHintId === img.id && Boolean(imageHintText) && (!isMobile || isMaskTarget)}
          text={imageHintText}
        />
        {showDropBefore && (
          <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        {showDropAfter && (
          <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        <div
          className={`relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
            isMaskTarget
              ? 'border-2 border-blue-500'
              : 'border border-gray-200 dark:border-white/[0.08]'
          }`}
          onClick={() => {
            if (suppressImageClickRef.current) return
            if (isMaskTarget) {
              setMaskEditorImageId(img.id)
              return
            }
            if (isMobile && maskTargetImage && !maskConflictNoticeShownRef.current) {
              maskConflictNoticeShownRef.current = true
              showToast('只能有一张遮罩图', 'info')
            }
            setLightboxImageId(img.id, inputImages.map((i) => i.id))
          }}
        >
          {displaySrc && (
            <img
              src={displaySrc}
              className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
              alt=""
            />
          )}
          {isMaskTarget && (
            <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
              MASK
            </span>
          )}
          {canEdit && (
            <button
              className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
              onClick={(e) => {
                e.stopPropagation()
                setMaskEditorImageId(img.id)
              }}
              title={isMaskTarget ? '编辑遮罩' : '添加遮罩'}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
        {!isMaskTarget && (
          <span
            className="absolute -top-2 -right-2 w-[22px] h-[22px] rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600 z-30"
            onClick={(e) => {
              e.stopPropagation()
              removeInputImage(idx)
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const renderClearAllButton = () => (
    <button
      onClick={() =>
        setConfirmDialog({
          title: maskTargetImage ? '清空全部输入图' : '清空参考图',
          message: maskTargetImage
            ? `确定要清空遮罩主图、${referenceImages.length} 张参考图和当前遮罩吗？`
            : `确定要清空全部 ${inputImages.length} 张参考图吗？`,
          action: () => clearInputImages(),
        })
      }
      className="w-[52px] h-[52px] rounded-xl border border-dashed border-gray-300 dark:border-white/[0.08] flex flex-col items-center justify-center gap-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-all cursor-pointer flex-shrink-0"
      title={maskTargetImage ? '清空遮罩主图、参考图和遮罩' : '清空全部参考图'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span className="text-[8px] leading-none">{maskTargetImage ? '清空全部' : '清空'}</span>
    </button>
  )

  const renderImageThumbs = () => {
    return (
      <div ref={imagesRef}>
        <div className="grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3 mb-3">
          {inputImages.map((img, idx) => renderImageThumb(img, idx))}
          {renderClearAllButton()}
        </div>
        {touchDragPreview?.src && createPortal(
          <div
            className="fixed z-[140] h-[52px] w-[52px] overflow-hidden rounded-xl shadow-xl pointer-events-none opacity-90"
            style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
          >
            <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
          </div>,
          document.body,
        )}
      </div>
    )
  }

  /** 顶部 pill 行（模型 / 风格 / 比例 / 分辨率 / 优化 + 上传 + 高级） */
  const renderPillRow = () => {
    const modelText = activeProfile.model || activeProfile.name || '未配置'
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {/* 模型 pill */}
        <div className="relative">
          <button
            ref={modelPillRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'model' ? null : 'model'))}
            className={PILL_BASE}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'model'}
            title={`当前模型：${modelText}`}
          >
            <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
            <span className="max-w-[140px] truncate">{modelText}</span>
            <Chevron />
          </button>
          {openMenu === 'model' && (
            <ModelMenu anchorRef={modelPillRef} onClose={() => setOpenMenu(null)} />
          )}
        </div>

        {/* 风格 pill */}
        <div className="relative">
          <button
            ref={stylePillRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'style' ? null : 'style'))}
            className={PILL_BASE}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'style'}
            title={`风格预设：${
              params.stylePreset && isStylePresetKey(params.stylePreset)
                ? STYLE_PRESETS[params.stylePreset].label
                : '无风格'
            }`}
          >
            <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19l9-7-9-7-9 7 9 7z" />
              <path d="M12 12v7" />
            </svg>
            <span>
              {params.stylePreset && isStylePresetKey(params.stylePreset)
                ? STYLE_PRESETS[params.stylePreset].label
                : '无风格'}
            </span>
            <Chevron />
          </button>
          {openMenu === 'style' && (
            <StylePickerPopover anchorRef={stylePillRef} onClose={() => setOpenMenu(null)} />
          )}
        </div>

        {/* 比例 pill */}
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null)
            setShowSizePicker(true)
          }}
          className={PILL_BASE}
          title={`图像比例：${ratioLabel}`}
        >
          <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="2" />
          </svg>
          <span>{ratioLabel}</span>
          <Chevron />
        </button>

        {/* 分辨率 pill */}
        <div className="relative">
          <button
            ref={resolutionPillRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'resolution' ? null : 'resolution'))}
            className={PILL_BASE}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'resolution'}
            title={`输出分辨率：${tierLabel}`}
          >
            <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 4h6v6H4z" />
              <path d="M14 4h6v6h-6z" />
              <path d="M4 14h6v6H4z" />
              <path d="M14 14h6v6h-6z" />
            </svg>
            <span>{tierLabel}</span>
            <Chevron />
          </button>
          {openMenu === 'resolution' && (
            <ResolutionMenu anchorRef={resolutionPillRef} onClose={() => setOpenMenu(null)} />
          )}
        </div>

        {/* 优化 pill */}
        <div
          className="relative"
          onMouseEnter={() => setOptimizeHover(true)}
          onMouseLeave={() => setOptimizeHover(false)}
        >
          <ButtonTooltip visible={Boolean(optimizeTooltipText) && optimizeHover} text={optimizeTooltipText} />
          <button
            type="button"
            onClick={() => canOptimize && setShowPromptOptimizer(true)}
            disabled={!canOptimize}
            className={canOptimize ? PILL_BASE : PILL_DISABLED}
            title="AI 提示词优化"
            aria-label="AI 提示词优化"
          >
            <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            <span>优化</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* 重置全部输入 */}
          {(() => {
            const promptLen = prompt.trim().length
            const canReset = promptLen > 0 || inputImages.length > 0 || maskDraft != null
            const parts: string[] = []
            if (promptLen > 0) parts.push(`文字（${promptLen} 字符）`)
            if (inputImages.length > 0) parts.push(`${inputImages.length} 张参考图`)
            if (maskDraft) parts.push('1 个遮罩')
            const resetMessage = `将清空：${parts.join('、')}。继续？`
            return (
              <button
                type="button"
                disabled={!canReset}
                onClick={() =>
                  setConfirmDialog({
                    title: '重置全部输入',
                    message: resetMessage,
                    action: () => {
                      setPrompt('')
                      clearInputImages()
                      clearMaskDraft()
                    },
                  })
                }
                className={
                  canReset
                    ? `${PILL_BASE} hover:bg-red-50/50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400`
                    : PILL_DISABLED
                }
                aria-label="重置全部输入"
                title={canReset ? '清空文字、参考图与遮罩' : '当前没有可重置的内容'}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                <span>重置</span>
              </button>
            )
          })()}

          {/* 上传 */}
          <div
            className="relative"
            onMouseEnter={() => setAttachHover(true)}
            onMouseLeave={() => setAttachHover(false)}
          >
            <ButtonTooltip visible={atImageLimit && attachHover} text={`参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加`} />
            <button
              type="button"
              onClick={() => !atImageLimit && fileInputRef.current?.click()}
              className={atImageLimit ? PILL_DISABLED : PILL_BASE}
              title={atImageLimit ? `已达上限 ${API_MAX_IMAGES} 张` : '上传参考图'}
              aria-label="上传参考图"
            >
              <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
              <span>上传</span>
            </button>
          </div>

          {/* 高级参数 */}
          <div className="relative">
            <button
              ref={advancedButtonRef}
              type="button"
              onClick={() => setOpenMenu((v) => (v === 'advanced' ? null : 'advanced'))}
              className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-gray-200/70 bg-white/60 text-gray-500 shadow-sm transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08] ${
                openMenu === 'advanced' ? 'ring-1 ring-blue-300 dark:ring-blue-500/40' : ''
              }`}
              aria-haspopup="dialog"
              aria-expanded={openMenu === 'advanced'}
              aria-label="高级参数"
              title="高级参数（quality / format / 数量 等）"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="21" x2="14" y1="4" y2="4" />
                <line x1="10" x2="3" y1="4" y2="4" />
                <line x1="21" x2="12" y1="12" y2="12" />
                <line x1="8" x2="3" y1="12" y2="12" />
                <line x1="21" x2="16" y1="20" y2="20" />
                <line x1="12" x2="3" y1="20" y2="20" />
                <line x1="14" x2="14" y1="2" y2="6" />
                <line x1="8" x2="8" y1="10" y2="14" />
                <line x1="16" x2="16" y1="18" y2="22" />
              </svg>
            </button>
            {openMenu === 'advanced' && (
              <AdvancedParamsPopover
                anchorRef={advancedButtonRef}
                onClose={() => setOpenMenu(null)}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

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
                <div className="mb-3">{renderPillRow()}</div>
              </div>
            </div>
          ) : (
            <div className="mb-3">{renderPillRow()}</div>
          )}

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 && (
            isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">
                    {renderImageThumbs()}
                  </div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 ml-1">
                    {maskDraft ? `1 张遮罩主图 · ${referenceImages.length} 张参考图` : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              renderImageThumbs()
            )
          )}

          {/* 输入框 + 发送 */}
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="描述你想要的图片，支持粘贴图片..."
                aria-label="描述图片"
                className="w-full px-4 py-3 rounded-2xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm focus:outline-none leading-relaxed resize-none shadow-sm transition-[border-color,box-shadow] duration-200"
              />
              {prompt.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPrompt('')
                    requestAnimationFrame(() => adjustTextareaHeight())
                    textareaRef.current?.focus()
                  }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300 transition-colors"
                  aria-label="清空输入"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div
              className="relative flex shrink-0 items-end pb-0.5"
              onMouseEnter={() => setSubmitHover(true)}
              onMouseLeave={() => setSubmitHover(false)}
            >
              <ButtonTooltip visible={!settings.apiKey && submitHover} text="尚未完成 API 配置，请点 sidebar 底部齿轮按钮打开设置" />
              <button
                type="button"
                onClick={() => settings.apiKey ? submitTask() : setShowSettings(true)}
                disabled={settings.apiKey ? !canSubmit : false}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm transition-all hover:shadow ${
                  !settings.apiKey
                    ? 'bg-gray-300 dark:bg-white/[0.06] text-white cursor-pointer'
                    : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
                title={settings.apiKey ? (maskDraft ? '遮罩编辑 (Ctrl+Enter)' : '生成 (Ctrl+Enter)') : '请先配置 API'}
                aria-label={maskDraft ? '提交遮罩编辑' : '提交生成'}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12l14-7-3 7 3 7-14-7z" />
                </svg>
              </button>
            </div>
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
