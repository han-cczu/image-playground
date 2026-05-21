import type { PromptOptimizerConfig } from '../../types'
import { normalizeBaseUrl } from './devProxy'

export interface OptimizePromptOptions {
  /** AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 流式追加 token 回调 */
  onDelta?: (chunk: string) => void
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return '/v1/chat/completions'
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

function parseSseLine(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>
    }
    const delta = parsed.choices?.[0]?.delta?.content
    return typeof delta === 'string' ? delta : null
  } catch {
    return null
  }
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

  const url = buildChatCompletionsUrl(config.baseUrl)
  const timeoutMs = Math.max(1, config.timeout) * 1000

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
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    const text = await response.text().catch(() => '')
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
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
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
  if (!trimmed) throw new Error('优化结果为空')
  return trimmed
}
