import { MAX_TASK_TEXT_LEN } from '../tasks'
import { normalizeBaseUrl } from './devProxy'
import { isHttpUrl } from './imageApiShared'

const MAX_CHAT_ERROR_BODY_BYTES = 64 * 1024
const MAX_CHAT_STREAM_RAW_LEN = 64 * 1024
export const MAX_SET_TIMEOUT_MS = 2_147_483_647

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
  return Math.min(seconds * 1000, MAX_SET_TIMEOUT_MS)
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

export function isTimeoutAbort(error: unknown, timeoutSignal: AbortSignal): boolean {
  return timeoutSignal.aborted || isAbortError(error)
}

export function wrapCause(message: string, cause: unknown): Error {
  return cause instanceof Error ? new Error(message, { cause }) : new Error(message)
}

export function appendCappedStreamText(
  current: string,
  delta: string,
  onDelta?: (chunk: string) => void,
): string {
  const remaining = MAX_TASK_TEXT_LEN - current.length
  if (remaining <= 0) return current

  const accepted = delta.slice(0, remaining)
  if (accepted) onDelta?.(accepted)
  return current + accepted
}

export function appendCappedStreamRaw(current: string, chunk: string): string {
  if (current.length >= MAX_CHAT_STREAM_RAW_LEN) return current
  return (current + chunk).slice(0, MAX_CHAT_STREAM_RAW_LEN)
}

export function readStreamChunkWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutSignal: AbortSignal,
  externalSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  return new Promise((resolve, reject) => {
    const onExternalAbort = () => {
      cleanup()
      try {
        void reader.cancel?.().catch(() => undefined)
      } catch {
        /* Reader cancellation is best-effort; preserve the abort error. */
      }
      reject(wrapCause('已取消', externalSignal?.reason))
    }
    const onTimeoutAbort = () => {
      cleanup()
      try {
        void reader.cancel?.().catch(() => undefined)
      } catch {
        /* Reader cancellation is best-effort; preserve the timeout error. */
      }
      if (externalSignal?.aborted) reject(wrapCause('已取消', externalSignal.reason))
      else reject(wrapCause('请求超时', timeoutSignal.reason))
    }
    const cleanup = () => {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      timeoutSignal.removeEventListener('abort', onTimeoutAbort)
    }

    if (externalSignal?.aborted) {
      reject(wrapCause('已取消', externalSignal.reason))
      return
    }
    if (timeoutSignal.aborted) {
      if (externalSignal?.aborted) reject(wrapCause('已取消', externalSignal.reason))
      else reject(wrapCause('请求超时', timeoutSignal.reason))
      return
    }

    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true })
    try {
      reader.read().then(resolve, reject).finally(cleanup)
    } catch (err) {
      cleanup()
      reject(err)
    }
  })
}

function readTextWithAbort(
  response: Response,
  timeoutSignal: AbortSignal,
  externalSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const onExternalAbort = () => {
      cleanup()
      reject(wrapCause('已取消', externalSignal?.reason))
    }
    const onTimeoutAbort = () => {
      cleanup()
      if (externalSignal?.aborted) reject(wrapCause('已取消', externalSignal.reason))
      else reject(wrapCause('请求超时', timeoutSignal.reason))
    }
    const cleanup = () => {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      timeoutSignal.removeEventListener('abort', onTimeoutAbort)
    }

    if (externalSignal?.aborted) {
      reject(wrapCause('已取消', externalSignal.reason))
      return
    }
    if (timeoutSignal.aborted) {
      if (externalSignal?.aborted) {
        reject(wrapCause('已取消', externalSignal.reason))
        return
      }
      reject(wrapCause('请求超时', timeoutSignal.reason))
      return
    }

    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true })
    try {
      response.text().then(resolve, reject).finally(cleanup)
    } catch (err) {
      cleanup()
      reject(err)
    }
  })
}

async function readLimitedStreamTextWithAbort(
  response: Response,
  timeoutSignal: AbortSignal,
  externalSignal?: AbortSignal,
): Promise<string> {
  if (externalSignal?.aborted) throw wrapCause('已取消', externalSignal.reason)
  if (timeoutSignal.aborted) throw wrapCause('请求超时', timeoutSignal.reason)

  const contentLength = Number(response.headers?.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_CHAT_ERROR_BODY_BYTES) return ''

  const body = response.body
  if (!body) {
    return (await readTextWithAbort(response, timeoutSignal, externalSignal)).slice(
      0,
      MAX_CHAT_ERROR_BODY_BYTES,
    )
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0

  try {
    while (bytesRead < MAX_CHAT_ERROR_BODY_BYTES) {
      const { done, value } = await readStreamChunkWithAbort(reader, timeoutSignal, externalSignal)
      if (done) break
      if (!value?.byteLength) continue

      const remaining = MAX_CHAT_ERROR_BODY_BYTES - bytesRead
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value
      bytesRead += chunk.byteLength
      text += decoder.decode(chunk, { stream: bytesRead < MAX_CHAT_ERROR_BODY_BYTES })
      if (value.byteLength > remaining) break
    }

    text += decoder.decode()
    if (bytesRead >= MAX_CHAT_ERROR_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* Ignore cleanup errors so they do not mask timeout/cancel errors. */
    }
  }

  return text
}

/**
 * 读取非 2xx 错误体。普通读体失败退化为空字符串,但 abort 不能被吞:
 * - externalSignal abort => 用户主动取消
 * - timeoutSignal abort / AbortError => 请求超时
 */
export async function readChatErrorBody(
  response: Response,
  timeoutSignal: AbortSignal,
  externalSignal?: AbortSignal,
): Promise<string> {
  let text: string
  try {
    if (externalSignal?.aborted) throw wrapCause('已取消', externalSignal.reason)
    if (timeoutSignal.aborted) throw wrapCause('请求超时', timeoutSignal.reason)
    const contentLength = Number(response.headers?.get('Content-Length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_CHAT_ERROR_BODY_BYTES) return ''
    text = response.body
      ? await readLimitedStreamTextWithAbort(response, timeoutSignal, externalSignal)
      : (await readTextWithAbort(response, timeoutSignal, externalSignal)).slice(
          0,
          MAX_CHAT_ERROR_BODY_BYTES,
        )
  } catch (err) {
    if (err instanceof Error && (err.message === '已取消' || err.message === '请求超时')) throw err
    if (externalSignal?.aborted) throw wrapCause('已取消', err)
    if (isTimeoutAbort(err, timeoutSignal)) throw wrapCause('请求超时', err)
    return ''
  }

  if (externalSignal?.aborted) throw wrapCause('已取消', externalSignal.reason)
  if (timeoutSignal.aborted) throw wrapCause('请求超时', timeoutSignal.reason)
  return text
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
        (parsed.error &&
        typeof parsed.error === 'object' &&
        typeof parsed.error.message === 'string'
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
