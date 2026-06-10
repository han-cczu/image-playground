import type { PromptOptimizerConfig } from '../../types'
import {
  buildChatCompletionsUrl,
  extractStreamErrorMessage,
  parseSseLine,
  resolveChatTimeoutMs,
} from './chatCompletionsShared'
import { streamGeminiChat } from './geminiChatShared'
import { DEFAULT_OPTIMIZER_TIMEOUT } from './apiProfiles'

export interface OptimizePromptOptions {
  /** AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 流式追加 token 回调 */
  onDelta?: (chunk: string) => void
}

/**
 * 通过 OpenAI 兼容 chat completions（stream=true）优化提示词。
 *
 * @returns 完整的优化后文本
 * @throws 网络 / 鉴权 / 超时 / 服务端错误时抛出可读 Error
 */
export async function optimizePromptStream(
  config: PromptOptimizerConfig,
  userPrompt: string,
  options: OptimizePromptOptions = {},
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error('未配置 API Key')
  }
  if (!userPrompt.trim()) {
    throw new Error('提示词为空')
  }

  // provider 分流(缺省/undefined 走 OpenAI,守住现有测试);optimizer 纯文本无 vision
  if (config.provider === 'gemini') {
    return streamGeminiChat(config, [{ text: userPrompt }], '优化结果为空', options)
  }

  const url = buildChatCompletionsUrl(config.baseUrl)
  const timeoutMs = resolveChatTimeoutMs(config.timeout, DEFAULT_OPTIMIZER_TIMEOUT)

  const externalSignal = options.signal
  const timeoutController = new AbortController()
  const onExternalAbort = () => timeoutController.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) timeoutController.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timeoutTimer = setTimeout(() => timeoutController.abort(new Error('请求超时')), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model.trim() || 'gpt-4o-mini',
        stream: true,
        messages: [
          { role: 'system', content: config.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: timeoutController.signal,
    })
  } catch (err) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    if (externalSignal?.aborted) throw new Error('已取消')
    if ((err as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw new Error(`网络错误：${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    // 先读错误体、后解除超时/取消接线:顺序反了的话,错误体悬挂时 text() 永久挂起且无法取消
    const text = await response.text().catch(() => '')
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    // 读错误体期间用户点了取消:与本函数其余路径同口径归一化为「已取消」,不转写成 HTTP 错误
    if (externalSignal?.aborted) throw new Error('已取消')
    throw new Error(`HTTP ${response.status}${text ? ` - ${text.slice(0, 300)}` : ''}`)
  }

  const body = response.body
  if (!body) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    throw new Error('响应不包含数据流')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let raw = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      buffer += text
      raw += text
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)
        const delta = parseSseLine(line)
        if (delta) {
          full += delta
          options.onDelta?.(delta)
        }
        newlineIdx = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) {
      const delta = parseSseLine(buffer.trim())
      if (delta) {
        full += delta
        options.onDelta?.(delta)
      }
    }
  } catch (err) {
    if (externalSignal?.aborted) throw new Error('已取消')
    if ((err as { name?: string }).name === 'AbortError') throw new Error('请求超时')
    throw err
  } finally {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    reader.releaseLock()
  }

  const trimmed = full.trim()
  if (!trimmed) throw new Error(extractStreamErrorMessage(raw) || '优化结果为空')
  return trimmed
}
