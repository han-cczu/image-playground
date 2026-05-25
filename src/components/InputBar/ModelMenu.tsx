import { useRef, useEffect } from 'react'
import { useStore } from '../../store'
import { isOpenAIProfile } from '../../types'
import { useModelList } from './hooks/useModelList'

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
export default function ModelMenu({
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

  const activeProfile = settings.profiles.find((p) => p.id === settings.activeProfileId) ?? settings.profiles[0]

  const { state: modelState, fetchModels } = useModelList(activeProfile)

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
              onClick={() => void fetchModels()}
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
              title={modelState.message}
            >
              {modelState.message.length > 120 ? `${modelState.message.slice(0, 120)}…` : modelState.message}
            </span>
            <button
              type="button"
              onClick={() => void fetchModels()}
              className="self-start rounded-md border border-gray-200/70 bg-white/60 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              aria-label="重试"
            >
              重试
            </button>
          </div>
        )}

        {modelState.kind === 'success' && (() => {
          const currentInList = currentModel ? modelState.models.includes(currentModel) : false
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
              {modelState.models.length === 0 && !extraTop && (
                <li className="px-2 py-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                  API 返回模型列表为空
                </li>
              )}
              {modelState.models.map((id) => {
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
