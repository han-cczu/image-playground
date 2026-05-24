import { useEffect, useState, useCallback } from 'react'
import { listModels } from '../../lib/api/listModels'
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  switchApiProfileProvider,
} from '../../lib/api/apiProfiles'
import type { ApiProfile, AppSettings } from '../../types'
import Select from '../Select'
import { ModelListDropdown } from './ModelListDropdown'

export interface ApiProfileSectionProps {
  activeProfile: ApiProfile
  apiProxyAvailable: boolean
  apiProxyEnabled: boolean
  onUpdate: (patch: Partial<ApiProfile>) => void
  // timeout input is kept in index.tsx for dirty-detection; passed as props
  timeoutInput: string
  onTimeoutChange: (v: string) => void
  onTimeoutBlur: () => void
}

function getDefaultModelForMode(apiMode: AppSettings['apiMode']) {
  return apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL
}

export function ApiProfileSection({
  activeProfile,
  apiProxyAvailable,
  apiProxyEnabled,
  onUpdate,
  timeoutInput,
  onTimeoutChange,
  onTimeoutBlur,
}: ApiProfileSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelListOpen, setModelListOpen] = useState(false)
  const [modelListLoading, setModelListLoading] = useState(false)
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [modelListError, setModelListError] = useState<string | null>(null)

  // Reset model list cache when key connection params change
  useEffect(() => {
    setModelListOpen(false)
    setModelList(null)
    setModelListError(null)
  }, [activeProfile.id, activeProfile.baseUrl, activeProfile.apiKey])

  const fetchModelList = useCallback(async () => {
    if (activeProfile.provider !== 'openai') return
    setModelListOpen(true)
    setModelListLoading(true)
    setModelListError(null)
    try {
      const ids = await listModels(activeProfile)
      setModelList(ids)
      if (ids.length === 0) setModelListError('接口返回为空')
    } catch (err) {
      setModelList(null)
      setModelListError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelListLoading(false)
    }
  }, [activeProfile])

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">配置名称</span>
        <input
          value={activeProfile.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          type="text"
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">服务商类型</span>
        <Select
          value={activeProfile.provider}
          onChange={(value) => onUpdate(switchApiProfileProvider(activeProfile, value as ApiProfile['provider']))}
          options={[{ label: 'OpenAI 兼容接口', value: 'openai' }, { label: 'Google Gemini', value: 'gemini' }]}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>

      {activeProfile.provider === 'openai' && (
        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="block text-xs text-gray-500 dark:text-gray-400">API URL</span>
            <div
              onClick={(e) => {
                e.preventDefault()
                onUpdate({ codexCli: !activeProfile.codexCli })
              }}
              className="flex cursor-pointer items-center gap-1.5"
              role="switch"
              aria-checked={activeProfile.codexCli}
              aria-label="Codex CLI"
            >
              <span className={`text-xs transition-colors ${activeProfile.codexCli ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>Codex CLI</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${activeProfile.codexCli ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${activeProfile.codexCli ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </span>
            </div>
          </div>
          <input
            value={activeProfile.baseUrl}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            type="text"
            disabled={apiProxyEnabled}
            placeholder={DEFAULT_SETTINGS.baseUrl}
            className={`w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 ${apiProxyEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          <div data-selectable-text className="mt-1 min-h-[22px] flex items-center text-xs text-gray-400 dark:text-gray-500">
            {apiProxyEnabled ? (
              <span className="text-yellow-600 dark:text-yellow-500">已开启代理，实际请求目标由部署端决定，此处设置被忽略。</span>
            ) : (
              <span>支持通过查询参数覆盖：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>，<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">codexCli=true</code></span>
            )}
          </div>
        </label>
      )}

      {activeProfile.provider === 'gemini' && (
        <label className="block">
          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
          <input
            value={activeProfile.baseUrl}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            type="text"
            placeholder={DEFAULT_GEMINI_BASE_URL}
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            默认走 Google AI Studio。如使用代理或第三方兼容服务，可在此处覆盖。
          </div>
        </label>
      )}

      {apiProxyAvailable && activeProfile.provider === 'openai' && (
        <div className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="block text-xs text-gray-500 dark:text-gray-400">API 代理</span>
            <button
              type="button"
              onClick={() => onUpdate({ apiProxy: !activeProfile.apiProxy })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${activeProfile.apiProxy ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              role="switch"
              aria-checked={activeProfile.apiProxy}
              aria-label="API 代理"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${activeProfile.apiProxy ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div data-selectable-text className="text-xs text-gray-400 dark:text-gray-500">
            由当前部署提供同源代理，用于解决浏览器跨域限制；开启后 API URL 设置会被忽略。
          </div>
        </div>
      )}

      <div className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</span>
        <div className="relative">
          <input
            value={activeProfile.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            type={showApiKey ? 'text' : 'password'}
            placeholder={activeProfile.provider === 'gemini' ? 'AIza...' : 'sk-...'}
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
          >
            {showApiKey ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        </div>
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          URL 临时传入密钥请使用 hash：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">#apiKey=</code>，读取后会自动清除。
        </div>
      </div>

      {activeProfile.provider === 'openai' && (
        <label className="block">
          <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API 接口</span>
          <Select
            value={activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode}
            onChange={(value) => {
              const apiMode = value as AppSettings['apiMode']
              const nextModel =
                activeProfile.model === DEFAULT_IMAGES_MODEL || activeProfile.model === DEFAULT_RESPONSES_MODEL
                  ? getDefaultModelForMode(apiMode)
                  : activeProfile.model
              onUpdate({ apiMode, model: nextModel })
            }}
            options={[
              { label: 'Images API (/v1/images)', value: 'images' },
              { label: 'Responses API (/v1/responses)', value: 'responses' },
            ]}
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            支持通过查询参数覆盖：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=images</code> 或 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=responses</code>。
          </div>
        </label>
      )}

      <label className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          模型 ID
        </span>
        <ModelListDropdown
          value={activeProfile.model}
          onChange={(model) => onUpdate({ model })}
          onFetch={fetchModelList}
          isLoading={modelListLoading}
          isOpen={modelListOpen}
          onOpenChange={setModelListOpen}
          modelList={modelList}
          error={modelListError}
          placeholder={activeProfile.provider === 'gemini' ? DEFAULT_GEMINI_MODEL : getDefaultModelForMode(activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode)}
          showFetchButton={activeProfile.provider === 'openai'}
        />
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {activeProfile.provider === 'gemini' ? (
            <>使用 Google 多模态图像模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_GEMINI_MODEL}</code>。不支持遮罩与 quality 参数；多图生成会并发拆单。</>
          ) : (activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode) === 'responses' ? (
            <>Responses API 需要使用支持 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">image_generation</code> 工具的文本模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_RESPONSES_MODEL}</code>。</>
          ) : (
            <>Images API 需要使用 GPT Image 模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_IMAGES_MODEL}</code>。</>
          )}
        </div>
      </label>

      <label className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
        <input
          value={timeoutInput}
          onChange={(e) => onTimeoutChange(e.target.value)}
          onBlur={onTimeoutBlur}
          type="number"
          min={10}
          max={600}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>
    </div>
  )
}
