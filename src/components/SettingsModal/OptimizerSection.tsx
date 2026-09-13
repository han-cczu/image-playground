import { useState, useCallback, useRef } from 'react'
import { listModels } from '../../lib/api/listModels'
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_OPTIMIZER_MODEL,
  DEFAULT_OPTIMIZER_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
} from '../../lib/api/apiProfiles'
import type { OpenAIProfile, PromptOptimizerProfile } from '../../types'
import { ModelListDropdown } from './ModelListDropdown'
import { normalizeTimeout } from './timeout'
import { EyeIcon } from './EyeIcon'

export interface OptimizerSectionProps {
  optimizer: PromptOptimizerProfile
  onUpdate: (patch: Partial<PromptOptimizerProfile>) => void
  // timeout input is kept in index.tsx for dirty-detection; passed as props
  timeoutInput: string
  onTimeoutChange: (v: string) => void
}

export function OptimizerSection({
  optimizer,
  onUpdate,
  timeoutInput,
  onTimeoutChange,
}: OptimizerSectionProps) {
  const [showOptimizerApiKey, setShowOptimizerApiKey] = useState(false)
  const [optimizerModelListOpen, setOptimizerModelListOpen] = useState(false)
  const [optimizerModelListLoadingKey, setOptimizerModelListLoadingKey] = useState('')
  const [optimizerModelListState, setOptimizerModelListState] = useState<{
    key: string
    list: string[] | null
    error: string | null
  }>({ key: '', list: null, error: null })
  const optimizerModelListRequestSeqRef = useRef(0)
  const latestOptimizerModelListRequestByKeyRef = useRef<Map<string, number>>(new Map())
  const optimizerModelListKey = `${optimizer.id}:${optimizer.baseUrl}:${optimizer.apiKey}`
  const optimizerModelListLoading = optimizerModelListLoadingKey === optimizerModelListKey
  const optimizerModelList =
    optimizerModelListState.key === optimizerModelListKey ? optimizerModelListState.list : null
  const optimizerModelListError =
    optimizerModelListState.key === optimizerModelListKey ? optimizerModelListState.error : null

  const fetchOptimizerModelList = useCallback(async () => {
    const key = optimizerModelListKey
    setOptimizerModelListOpen(true)
    setOptimizerModelListLoadingKey(key)
    setOptimizerModelListState({ key, list: null, error: null })
    const requestId = ++optimizerModelListRequestSeqRef.current
    latestOptimizerModelListRequestByKeyRef.current.set(key, requestId)
    try {
      const tempProfile: OpenAIProfile = {
        id: 'optimizer-temp',
        name: 'optimizer',
        provider: 'openai',
        baseUrl: optimizer.baseUrl,
        apiKey: optimizer.apiKey,
        model: optimizer.model,
        timeout: optimizer.timeout,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }
      const ids = await listModels(tempProfile)
      if (latestOptimizerModelListRequestByKeyRef.current.get(key) !== requestId) return
      setOptimizerModelListState({
        key,
        list: ids,
        error: ids.length === 0 ? '接口返回为空' : null,
      })
    } catch (err) {
      if (latestOptimizerModelListRequestByKeyRef.current.get(key) !== requestId) return
      setOptimizerModelListState({
        key,
        list: null,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setOptimizerModelListLoadingKey((current) => (current === key ? '' : current))
    }
  }, [
    optimizer.baseUrl,
    optimizer.apiKey,
    optimizer.model,
    optimizer.timeout,
    optimizerModelListKey,
  ])

  const provider = optimizer.provider ?? 'openai'

  // 切 provider 连同重置 baseUrl/model(同 CaptionerSection,防残留 OpenAI baseUrl 致 key 发往错误主机)
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
        model: DEFAULT_OPTIMIZER_MODEL,
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
            ? 'Gemini 原生 generateContent(纯文本),如 gemini-2.5-flash。'
            : 'OpenAI 兼容 chat completions(纯文本)。'}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-content-muted dark:text-content-muted">
          配置名称
        </span>
        <input
          value={optimizer.name}
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
          value={optimizer.baseUrl}
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
            : '独立配置，与图像生成 Provider 解耦。需是 OpenAI 兼容的 chat completions 接口。'}
        </div>
      </label>

      <div className="block">
        <span className="block text-xs text-content-muted dark:text-content-muted mb-1">
          API Key
        </span>
        <div className="relative">
          <input
            value={optimizer.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            aria-label="提示词优化 API 密钥"
            type={showOptimizerApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 pr-10 text-sm text-content outline-none transition focus:border-brand dark:border-line dark:bg-surface-raised dark:text-content dark:focus:border-brand"
          />
          <button
            type="button"
            onClick={() => setShowOptimizerApiKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-content-subtle hover:text-content transition-colors"
            tabIndex={-1}
          >
            <EyeIcon open={showOptimizerApiKey} />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="block text-xs text-content-muted dark:text-content-muted mb-1">
          模型 ID
        </span>
        <ModelListDropdown
          value={optimizer.model}
          onChange={(model) => onUpdate({ model })}
          onFetch={fetchOptimizerModelList}
          isLoading={optimizerModelListLoading}
          isOpen={optimizerModelListOpen}
          onOpenChange={setOptimizerModelListOpen}
          modelList={optimizerModelList}
          error={optimizerModelListError}
          placeholder={provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'}
          showFetchButton={provider !== 'gemini'}
        />
      </label>

      <label className="block">
        <span className="block text-xs text-content-muted dark:text-content-muted mb-1">
          请求超时 (秒)
        </span>
        <input
          value={timeoutInput}
          onChange={(e) => onTimeoutChange(e.target.value)}
          onBlur={() => {
            const normalized = normalizeTimeout(timeoutInput, optimizer.timeout)
            onTimeoutChange(String(normalized))
            if (normalized !== optimizer.timeout) {
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
            onClick={() => onUpdate({ systemPrompt: DEFAULT_OPTIMIZER_SYSTEM_PROMPT })}
            className="text-xs text-brand-ink hover:text-brand-ink dark:text-brand-ink dark:hover:text-brand-ink transition-colors"
          >
            重置为默认
          </button>
        </div>
        <textarea
          value={optimizer.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          rows={6}
          className="w-full ui-field text-base md:text-sm resize-y font-mono leading-relaxed"
        />
        <div
          data-selectable-text
          className="mt-1 text-xs text-content-subtle dark:text-content-subtle"
        >
          控制改写风格。默认值会要求模型输出单段结构化英文图像提示词。
        </div>
      </div>
    </div>
  )
}
