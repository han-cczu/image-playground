import { useEffect, useState, useCallback } from 'react'
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
  const [optimizerModelListLoading, setOptimizerModelListLoading] = useState(false)
  const [optimizerModelList, setOptimizerModelList] = useState<string[] | null>(null)
  const [optimizerModelListError, setOptimizerModelListError] = useState<string | null>(null)

  // Reset model list cache when key connection params change
  useEffect(() => {
    setOptimizerModelListOpen(false)
    setOptimizerModelList(null)
    setOptimizerModelListError(null)
  }, [optimizer.id, optimizer.baseUrl, optimizer.apiKey])

  const fetchOptimizerModelList = useCallback(async () => {
    setOptimizerModelListOpen(true)
    setOptimizerModelListLoading(true)
    setOptimizerModelListError(null)
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
      setOptimizerModelList(ids)
      if (ids.length === 0) setOptimizerModelListError('接口返回为空')
    } catch (err) {
      setOptimizerModelList(null)
      setOptimizerModelListError(err instanceof Error ? err.message : String(err))
    } finally {
      setOptimizerModelListLoading(false)
    }
  }, [optimizer.baseUrl, optimizer.apiKey, optimizer.model, optimizer.timeout])

  const provider = optimizer.provider ?? 'openai'

  // 切 provider 连同重置 baseUrl/model(同 CaptionerSection,防残留 OpenAI baseUrl 致 key 发往错误主机)
  const switchProvider = (p: 'openai' | 'gemini') => {
    if (p === provider) return
    if (p === 'gemini') {
      onUpdate({ provider: 'gemini', baseUrl: DEFAULT_GEMINI_BASE_URL, model: DEFAULT_GEMINI_CHAT_MODEL })
    } else {
      onUpdate({ provider: 'openai', baseUrl: DEFAULT_SETTINGS.baseUrl, model: DEFAULT_OPTIMIZER_MODEL })
    }
  }

  return (
    <div className="space-y-4">
      <div className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Provider</span>
        <div className="inline-flex rounded-xl border border-gray-200/70 p-0.5 dark:border-white/[0.08]">
          {(['openai', 'gemini'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => switchProvider(p)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                provider === p
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]'
              }`}
            >
              {p === 'openai' ? 'OpenAI 兼容' : 'Gemini 原生'}
            </button>
          ))}
        </div>
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {provider === 'gemini'
            ? 'Gemini 原生 generateContent(纯文本),如 gemini-2.5-flash。'
            : 'OpenAI 兼容 chat completions(纯文本)。'}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">配置名称</span>
        <input
          value={optimizer.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          type="text"
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
        <input
          value={optimizer.baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          type="text"
          placeholder={provider === 'gemini' ? DEFAULT_GEMINI_BASE_URL : DEFAULT_SETTINGS.baseUrl}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {provider === 'gemini'
            ? '独立配置。Gemini 原生 generateContent 端点（如 generativelanguage.googleapis.com/v1beta）。'
            : '独立配置，与图像生成 Provider 解耦。需是 OpenAI 兼容的 chat completions 接口。'}
        </div>
      </label>

      <div className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</span>
        <div className="relative">
          <input
            value={optimizer.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            type={showOptimizerApiKey ? 'text' : 'password'}
            placeholder="sk-..."
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={() => setShowOptimizerApiKey((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
          >
            <EyeIcon open={showOptimizerApiKey} />
          </button>
        </div>
      </div>

      <label className="block">
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">模型 ID</span>
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
        <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
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
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
      </label>

      <div className="block">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-xs text-gray-500 dark:text-gray-400">系统提示词</span>
          <button
            type="button"
            onClick={() => onUpdate({ systemPrompt: DEFAULT_OPTIMIZER_SYSTEM_PROMPT })}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            重置为默认
          </button>
        </div>
        <textarea
          value={optimizer.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          rows={6}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 resize-y font-mono leading-relaxed"
        />
        <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          控制改写风格。默认值会要求模型输出单段结构化英文图像提示词。
        </div>
      </div>
    </div>
  )
}
