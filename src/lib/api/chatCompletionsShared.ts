import { normalizeBaseUrl } from './devProxy'
import { isHttpUrl } from './imageApiShared'

/**
 * 构造 OpenAI 兼容 chat completions 端点 URL。
 *
 * baseUrl 归一为空、或归一结果不是绝对 http(s) URL(例如无 scheme 的裸串经 catch 分支
 * 返回)时**硬失败**,避免退化为同源相对路径导致 Authorization 头里的密钥被发往应用部署源。
 */
export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized || !isHttpUrl(normalized)) {
    throw new Error('未配置 API URL')
  }
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`
}

/** 把秒级超时解析为毫秒;对 NaN / Infinity / 非正数回退到 fallback 秒数。 */
export function resolveChatTimeoutMs(timeoutSeconds: number, fallbackSeconds: number): number {
  const seconds =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : fallbackSeconds
  return seconds * 1000
}

/**
 * 当流中没有任何内容 delta 时,尝试从原始响应体里提取服务端错误信息
 * (部分 OpenAI 兼容服务在 200 流里以 JSON 错误体 / `data: {error}` 返回失败)。
 * 解析不出则返回 null,由调用方回退到通用「结果为空」提示。仅应在确无 delta 时调用。
 */
export function extractStreamErrorMessage(raw: string): string | null {
  const candidates: string[] = []
  const whole = raw.trim()
  if (whole) candidates.push(whole)
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim()
      if (payload && payload !== '[DONE]') candidates.push(payload)
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        error?: { message?: unknown } | string
        message?: unknown
      }
      const message =
        (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string'
          ? parsed.error.message
          : '') ||
        (typeof parsed.error === 'string' ? parsed.error : '') ||
        (typeof parsed.message === 'string' ? parsed.message : '')
      if (message) return message
    } catch {
      /* 不是 JSON,跳过 */
    }
  }
  return null
}

/** 解析单行 SSE,提取 chat completions 流式 delta 文本(非 data 行或非内容返回 null)。 */
export function parseSseLine(line: string): string | null {
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
