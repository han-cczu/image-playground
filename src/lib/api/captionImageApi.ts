import type { CaptionerConfig } from '../../types'
import { normalizeBaseUrl } from './devProxy'

export interface CaptionImageOptions {
  /** AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 流式追加 token 回调 */
  onDelta?: (chunk: string) => void
}

/** 引导语：放在 user 文本部分，配合 systemPrompt 一起约束输出 */
const USER_GUIDE_TEXT = 'Describe this image as a detailed text-to-image prompt.'

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
 * 对一张图片做反推：通过 OpenAI 兼容 chat completions（vision，stream=true）生成文生图提示词。
 *
 * @param imageDataUrl base64 data URL（如 data:image/png;base64,...）
 * @returns 完整的反推文本
 * @throws 网络 / 鉴权 / 超时 / 服务端错误时抛出可读 Error
 */
export async function captionImageStream(
  config: CaptionerConfig,
  imageDataUrl: string,
  options: CaptionImageOptions = {},
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error('未配置 API Key')
  }
  if (!imageDataUrl.trim()) {
    throw new Error('未选择图片')
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
          {
            role: 'user',
            content: [
              { type: 'text', text: USER_GUIDE_TEXT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
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
  if (!trimmed) throw new Error('反推结果为空')
  return trimmed
}
