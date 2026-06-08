import { isHttpUrl } from './imageApiShared'
import { DEFAULT_GEMINI_BASE_URL } from './apiProfiles'

/**
 * Gemini 原生 generateContent 流式调用(captioner/optimizer 共用)。
 *
 * 与 OpenAI 兼容 chat completions(chatCompletionsShared)完全不同的协议:
 * - 端点 <base>/models/<model>:streamGenerateContent?alt=sse(非 /v1/chat/completions)
 * - 鉴权 header x-goog-api-key(非 Bearer)
 * - 系统提示走顶层 systemInstruction(无 system role)
 * - SSE 帧体是 { candidates:[{ content:{ parts:[{text}] } }] }(非 choices[].delta.content)
 * - 安全拦截在 200 流体内以 promptFeedback.blockReason / finishReason=SAFETY 返回
 *
 * 自带 reader 循环(不复用 OpenAI 路径),把风险隔离在新增 Gemini 路径,不动已测的 OpenAI 流。
 */

export interface GeminiChatConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 秒 */
  timeout: number
  systemPrompt: string
}

export interface GeminiChatOptions {
  signal?: AbortSignal
  onDelta?: (chunk: string) => void
}

interface GeminiSsePart {
  text?: string
}
interface GeminiSseChunk {
  candidates?: Array<{ content?: { parts?: GeminiSsePart[] }; finishReason?: string }>
  promptFeedback?: { blockReason?: string }
}

/** streamGenerateContent?alt=sse 端点;不复用 normalizeBaseUrl(会把 v1beta 误补 /v1) */
export function buildGeminiStreamUrl(baseUrl: string, model: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  // 非空但非 http(s) 的裸串会被当同源相对路径 → 带 x-goog-api-key 的请求发往应用源致 key 外泄
  if (trimmed && !isHttpUrl(trimmed)) throw new Error('未配置 API URL')
  const cleanBase = trimmed || DEFAULT_GEMINI_BASE_URL
  const cleanModel = model.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return `${cleanBase}/models/${cleanModel}:streamGenerateContent?alt=sse`
}

/** 解析一帧 SSE:遍历 candidates[0].content.parts[] 拼接所有 text(跳过非 text part,应对 thinking/多 part) */
export function parseGeminiSseLine(line: string): string {
  if (!line.startsWith('data:')) return ''
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return ''
  let chunk: GeminiSseChunk
  try {
    chunk = JSON.parse(payload) as GeminiSseChunk
  } catch {
    return ''
  }
  const parts = chunk.candidates?.[0]?.content?.parts ?? []
  let out = ''
  for (const part of parts) {
    if (typeof part.text === 'string') out += part.text
  }
  return out
}

/** 扫描整个累积 raw 的所有 data: 行找 blockReason / SAFETY(非只末帧),空流时不丢真错 */
export function extractGeminiStreamError(raw: string): string {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload) as GeminiSseChunk
      if (chunk.promptFeedback?.blockReason) return `请求被拒绝：${chunk.promptFeedback.blockReason}`
      const finish = chunk.candidates?.[0]?.finishReason
      if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') return `生成中断：${finish}`
    } catch {
      // 忽略非 JSON 行
    }
  }
  return ''
}

/**
 * 流式调用 Gemini generateContent。parts 由调用方组装(文本 / 文本+inlineData 图)。
 * @returns 完整累计文本(trim);空结果先扫 raw 抠错,否则抛 emptyError
 */
export async function streamGeminiChat(
  config: GeminiChatConfig,
  parts: Array<Record<string, unknown>>,
  emptyError: string,
  options: GeminiChatOptions = {},
): Promise<string> {
  const url = buildGeminiStreamUrl(config.baseUrl, config.model)
  const timeoutMs = (config.timeout > 0 ? config.timeout : 60) * 1000

  const externalSignal = options.signal
  const timeoutController = new AbortController()
  const onExternalAbort = () => timeoutController.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) timeoutController.abort(externalSignal.reason)
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timeoutTimer = setTimeout(() => timeoutController.abort(new Error('请求超时')), timeoutMs)

  const body: Record<string, unknown> = { contents: [{ role: 'user', parts }] }
  if (config.systemPrompt.trim()) {
    body.systemInstruction = { parts: [{ text: config.systemPrompt }] }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey.trim(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
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

  const stream = response.body
  if (!stream) {
    clearTimeout(timeoutTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    throw new Error('响应不包含数据流')
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let raw = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      buffer += text
      raw += text
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)
        const delta = parseGeminiSseLine(line)
        if (delta) {
          full += delta
          options.onDelta?.(delta)
        }
        newlineIdx = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) {
      const delta = parseGeminiSseLine(buffer.trim())
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
  if (!trimmed) throw new Error(extractGeminiStreamError(raw) || emptyError)
  return trimmed
}
