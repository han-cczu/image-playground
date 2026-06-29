import type { OpenAIProfile } from '../../types'
import { buildApiUrl, isApiProxyAvailable, readClientDevProxyConfig } from './devProxy'

/** 模型列表拉取超时:无超时则网关悬挂时下拉 UI 永久停留加载态(列表是辅助功能,不必等满生成超时) */
const LIST_MODELS_TIMEOUT_MS = 15_000
export const MAX_MODEL_LIST_ITEMS = 500
export const MAX_MODEL_ID_LEN = 5000
const MAX_MODEL_LIST_BODY_BYTES = 64 * 1024

function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

async function readModelListBody<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')
  return await new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      read().then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort)
      })
    } catch (err) {
      signal.removeEventListener('abort', onAbort)
      reject(err)
    }
  })
}

async function readLimitedModelListText(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw createAbortError()

  const contentLength = Number(response.headers?.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_MODEL_LIST_BODY_BYTES) return ''

  const body = response.body
  if (!body) {
    return readModelListBody(() => response.text(), signal).then((text) =>
      text.slice(0, MAX_MODEL_LIST_BODY_BYTES),
    )
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0

  try {
    while (bytesRead < MAX_MODEL_LIST_BODY_BYTES) {
      const { done, value } = await readModelListBody(() => reader.read(), signal)
      if (done) break
      if (!value?.byteLength) continue

      const remaining = MAX_MODEL_LIST_BODY_BYTES - bytesRead
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value
      bytesRead += chunk.byteLength
      text += decoder.decode(chunk, { stream: bytesRead < MAX_MODEL_LIST_BODY_BYTES })
      if (value.byteLength > remaining) break
    }

    text += decoder.decode()
    if (bytesRead >= MAX_MODEL_LIST_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* Ignore cleanup errors so they do not mask timeout errors. */
    }
  }

  return text
}

export async function listModels(profile: OpenAIProfile): Promise<string[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = Boolean(profile.apiProxy) && isApiProxyAvailable(proxyConfig)
  const url = buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy)

  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  }
  const apiKey = profile.apiKey.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LIST_MODELS_TIMEOUT_MS)
  let data: unknown
  try {
    const res = await fetch(url, { method: 'GET', headers, cache: 'no-store', signal: controller.signal })
    if (!res.ok) {
      const text = await readLimitedModelListText(res, controller.signal).catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') throw e
        return ''
      })
      throw new Error(`HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ''}`)
    }
    // 解析失败容忍为 null,但读体阶段的 abort(超时落在 json() 期间)必须重抛——
    // 否则超时被吞成「成功的空列表」,还会被 useModelList 当成功结果缓存整个会话
    data = await readLimitedModelListText(res, controller.signal).then((text) => JSON.parse(text)).catch((e: unknown) => {
      if ((e as { name?: string })?.name === 'AbortError') throw e
      return null
    })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error(`拉取模型列表超时(${LIST_MODELS_TIMEOUT_MS / 1000} 秒),请检查 API URL 或稍后重试`, { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }

  const raw = Array.isArray((data as { data?: unknown })?.data)
    ? (data as { data: unknown[] }).data
    : Array.isArray(data)
      ? (data as unknown[])
      : []

  const ids = raw
    .map((m) => (typeof m === 'string' ? m : (m as { id?: unknown })?.id))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => id.slice(0, MAX_MODEL_ID_LEN))

  return Array.from(new Set(ids)).sort().slice(0, MAX_MODEL_LIST_ITEMS)
}
