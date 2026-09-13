import { useState, useCallback, useRef } from 'react'
import { listModels } from '../../lib/api/listModels'
import {
  DEFAULT_CAPTIONER_MODEL,
  DEFAULT_CAPTIONER_SYSTEM_PROMPT,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_SETTINGS,
} from '../../lib/api/apiProfiles'
import type { CaptionerProfile, OpenAIProfile } from '../../types'
import { ModelListDropdown } from './ModelListDropdown'
import { normalizeTimeout } from './timeout'
import { EyeIcon } from './EyeIcon'

export interface CaptionerSectionProps {
  captioner: CaptionerProfile
  onUpdate: (patch: Partial<CaptionerProfile>) => void
  timeoutInput: string
  onTimeoutChange: (v: string) => void
}

export function CaptionerSection({
  captioner,
  onUpdate,
  timeoutInput,
  onTimeoutChange,
}: CaptionerSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelListOpen, setModelListOpen] = useState(false)
  const [modelListLoadingKey, setModelListLoadingKey] = useState('')
  const [modelListState, setModelListState] = useState<{
    key: string
    list: string[] | null
    error: string | null
  }>({ key: '', list: null, error: null })
  const modelListRequestSeqRef = useRef(0)
  const latestModelListRequestByKeyRef = useRef<Map<string, number>>(new Map())
  const modelListKey = `${captioner.id}:${captioner.baseUrl}:${captioner.apiKey}`
  const modelListLoading = modelListLoadingKey === modelListKey
  const modelList = modelListState.key === modelListKey ? modelListState.list : null
  const modelListError = modelListState.key === modelListKey ? modelListState.error : null

  const fetchModelList = useCallback(async () => {
    const key = modelListKey
    setModelListOpen(true)
    setModelListLoadingKey(key)
    setModelListState({ key, list: null, error: null })
    const requestId = ++modelListRequestSeqRef.current
    latestModelListRequestByKeyRef.current.set(key, requestId)
    try {
      const tempProfile: OpenAIProfile = {
        id: 'captioner-temp',
        name: 'captioner',
        provider: 'openai',
        baseUrl: captioner.baseUrl,
        apiKey: captioner.apiKey,
        model: captioner.model,
        timeout: captioner.timeout,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }
      const ids = await listModels(tempProfile)
      if (latestModelListRequestByKeyRef.current.get(key) !== requestId) return
      setModelListState({ key, list: ids, error: ids.length === 0 ? '接口返回为空' : null })
    } catch (err) {
      if (latestModelListRequestByKeyRef.current.get(key) !== requestId) return
      setModelListState({
        key,
        list: null,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setModelListLoadingKey((current) => (current === key ? '' : current))
    }
  }, [captioner.baseUrl, captioner.apiKey, captioner.model, captioner.timeout, modelListKey])

  const provider = captioner.provider ?? 'openai'

  // 切 provider 时连同重置 baseUrl/model 到目标 provider 默认(对齐图像 profile 的 switchApiProfileProvider)——
  // 否则从已配置 OpenAI 切 Gemini 会残留 OpenAI baseUrl,致 x-goog-api-key 发往 OpenAI 主机(功能失败 + 凭据泄露)
  const switchProvider = (p: 'openai' | 'gemini') => {
    if (p === provider) return
    if (p === 'gemini') {
      onUpdate({
        provider: 'gemini',
        baseUrl: DEFAULT_GEMINI_BASE_URL,
        apiKey: '',
        model: DEFAULT_GEMINI_CHAT_MODEL,
      })
    } else {
      onUpdate({
        provider: 'openai',
        baseUrl: DEFAULT_SETTINGS.baseUrl,
        apiKey: '',
        model: DEFAULT_CAPTIONER_MODEL,
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="block">
        <span className="mb-1 block text-xs text-content-muted dark:text-content-muted">
          Provider
        </span>
        <div className="inline-flex rounded-xl border border-line p-0.5 dark:border-line">
          {(['openai', 'gemini'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => switchProvider(p)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                provider === p
                  ? 'bg-brand text-on-brand'
                  : 'text-content-muted hover:bg-surface-muted dark:text-content-muted dark:hover:bg-surface-raised'
              }`}
            >
              {p === 'openai' ? 'OpenAI 兼容' : 'Gemini 原生'}
            </button>
          ))}
        </div>
        <div
          data-selectable-text
          className="mt-1 text-xs text-content-subtle dark:text-content-subtle"
        >
          {provider === 'gemini'
            ? 'Gemini 原生 generateContent(vision)。模型需支持图像输入,如 gemini-2.5-flash。'
            : 'OpenAI 兼容 chat completions(vision)。'}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-content-muted dark:text-content-muted">
          配置名称
        </span>
        <input
          value={captioner.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          type="text"
          className="w-full ui-field text-base md:text-sm"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-content-muted dark:text-content-muted">
          API URL
        </span>
        <input
          value={captioner.baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          type="text"
          placeholder={provider === 'gemini' ? DEFAULT_GEMINI_BASE_URL : DEFAULT_SETTINGS.baseUrl}
          className="w-full ui-field text-base md:text-sm"
        />
        <div
          data-selectable-text
          className="mt-1 text-xs text-content-subtle dark:text-content-subtle"
        >
          {provider === 'gemini'
            ? '独立配置。Gemini 原生 generateContent 端点（如 generativelanguage.googleapis.com/v1beta）。'
            : '独立配置，与图像生成 / 提示词优化解耦。需是 OpenAI 兼容、且模型支持图像输入（vision）的 chat completions 接口。'}
        </div>
      </label>

      <div className="block">
        <span className="block text-xs text-content-muted dark:text-content-muted mb-1">
          API Key
        </span>
        <div className="relative">
          <input
            value={captioner.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            aria-label="反推提示词 API 密钥"
            type={showApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 pr-10 text-sm text-content outline-none transition focus:border-brand dark:border-line dark:bg-surface-raised dark:text-content dark:focus:border-brand"
          />
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-content-subtle hover:text-content transition-colors"
            tabIndex={-1}
          >
            <EyeIcon open={showApiKey} />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="block text-xs text-content-muted dark:text-content-muted mb-1">
          模型 ID
        </span>
        <ModelListDropdown
          value={captioner.model}
          onChange={(model) => onUpdate({ model })}
          onFetch={fetchModelList}
          isLoading={modelListLoading}
          isOpen={modelListOpen}
          onOpenChange={setModelListOpen}
          modelList={modelList}
          error={modelListError}
          placeholder={provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'}
          showFetchButton={provider !== 'gemini'}
        />
        <div
          data-selectable-text
          className="mt-1 text-xs text-content-subtle dark:text-content-subtle"
        >
          {provider === 'gemini'
            ? '需选择支持图像输入的 Gemini 模型（如 gemini-2.5-flash）。'
            : '需选择支持图像输入的模型（如 gpt-4o-mini / gpt-4o）。'}
        </div>
      </label>

      <label className="block">
        <span className="block text-xs text-content-muted dark:text-content-muted mb-1">
          请求超时 (秒)
        </span>
        <input
          value={timeoutInput}
          onChange={(e) => onTimeoutChange(e.target.value)}
          onBlur={() => {
            const normalized = normalizeTimeout(timeoutInput, captioner.timeout)
            onTimeoutChange(String(normalized))
            if (normalized !== captioner.timeout) {
              onUpdate({ timeout: normalized })
            }
          }}
          type="number"
          min={1}
          max={600}
          className="w-full ui-field text-base md:text-sm"
        />
      </label>

      <div className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-xs text-content-muted dark:text-content-muted">
            系统提示词
          </span>
          <button
            type="button"
            onClick={() => onUpdate({ systemPrompt: DEFAULT_CAPTIONER_SYSTEM_PROMPT })}
            className="text-xs text-brand-ink hover:text-brand-ink dark:text-brand-ink dark:hover:text-brand-ink transition-colors"
          >
            重置为默认
          </button>
        </div>
        <textarea
          value={captioner.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          rows={6}
          className="w-full ui-field text-base md:text-sm resize-y font-mono leading-relaxed"
        />
        <div
          data-selectable-text
          className="mt-1 text-xs text-content-subtle dark:text-content-subtle"
        >
          控制反推风格。默认值会要求模型输出单段结构化英文图像提示词。
        </div>
      </div>
    </div>
  )
}
