import type { OpenAIProfile } from '../../types'
import { buildApiUrl, isApiProxyAvailable, readClientDevProxyConfig } from './devProxy'

/** 模型列表拉取超时:无超时则网关悬挂时下拉 UI 永久停留加载态(列表是辅助功能,不必等满生成超时) */
const LIST_MODELS_TIMEOUT_MS = 15_000
export const MAX_MODEL_LIST_ITEMS = 500
export const MAX_MODEL_ID_LEN = 5000
/**
 * 成功体读取上限。真实聚合网关的列表远超错误体口径:OpenRouter `/models` 约 700KB,
 * one-api / new-api 数百条带 permission[] 的标准模型对象也轻松过 100KB。曾把错误体的 64KB
 * 套到成功体上,结果这些网关的响应被截成非法 JSON → 解析失败被吞成「成功的空列表」→
 * 被 useModelList 按 profile 缓存整个会话,UI 只显示「返回为空」,用户无从得知是被截断。
 * 8 MiB 足够容纳数千条带元数据的模型项,同时仍是有界读体(解析后只保留 id,内存无压力)。
 */
const MAX_MODEL_LIST_BODY_BYTES = 8 * 1024 * 1024
/** 错误体只用来拼 HTTP 状态提示(最终只取前 200 字符),64KB 截断即可,不必抛错 */
const MAX_MODEL_LIST_ERROR_BODY_BYTES = 64 * 1024

function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

/**
 * 成功体超限专用错误:必须能穿透 listModels 里「解析失败容忍为 null」的 catch,
 * 否则截断/超限又会退化成静默空列表。
 */
class ModelListTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`模型列表响应过大(超过 ${maxBytes / (1024 * 1024)} MiB 上限),请检查 API URL 是否正确`)
    this.name = 'ModelListTooLargeError'
  }
}

/**
 * 超限策略:
 * - truncate:静默截断到 maxBytes(错误体——只用来拼状态提示,截断无害);
 * - throw:抛 ModelListTooLargeError(成功体——截断后的 JSON 必然解析失败,不抛错就会被吞成
 *   「成功的空列表」并缓存整个会话,这正是 64KB 时代 OpenRouter 列表「为空」的事故根源)。
 */
type OverflowPolicy = 'truncate' | 'throw'

async function readModelListBody<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')
  return await new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      read()
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', onAbort)
        })
    } catch (err) {
      signal.removeEventListener('abort', onAbort)
      reject(err)
    }
  })
}

async function readLimitedModelListText(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  overflow: OverflowPolicy,
): Promise<string> {
  // abort 判定必须先于 Content-Length 超限判定:fetch 在超时 abort 后才 resolve 时,
  // 用户该看到的是「超时」而不是「响应过大」
  if (signal.aborted) throw createAbortError()

  const contentLength = Number(response.headers?.get('Content-Length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    if (overflow === 'throw') throw new ModelListTooLargeError(maxBytes)
    return ''
  }

  const body = response.body
  if (!body) {
    return readModelListBody(() => response.text(), signal).then((text) => {
      if (overflow === 'truncate') return text.slice(0, maxBytes)
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new ModelListTooLargeError(maxBytes)
      }
      return text
    })
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await readModelListBody(() => reader.read(), signal)
      if (done) break
      if (!value?.byteLength) continue

      const remaining = maxBytes - bytesRead
      if (value.byteLength <= remaining) {
        bytesRead += value.byteLength
        text += decoder.decode(value, { stream: true })
        continue
      }

      // 超限:先 cancel 让上游停止推送(有界读体的本意——不能把整条流读进内存),再按策略处理
      await reader.cancel().catch(() => undefined)
      if (overflow === 'throw') throw new ModelListTooLargeError(maxBytes)
      text += decoder.decode(value.slice(0, remaining), { stream: true })
      break
    }

    text += decoder.decode()
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
    const res = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await readLimitedModelListText(
        res,
        controller.signal,
        MAX_MODEL_LIST_ERROR_BODY_BYTES,
        'truncate',
      ).catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') throw e
        return ''
      })
      throw new Error(`HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ''}`)
    }
    // 解析失败容忍为 null,但读体阶段的 abort(超时落在 json() 期间)与成功体超限必须重抛——
    // 否则两者都被吞成「成功的空列表」,还会被 useModelList 当成功结果缓存整个会话
    data = await readLimitedModelListText(
      res,
      controller.signal,
      MAX_MODEL_LIST_BODY_BYTES,
      'throw',
    )
      .then((text) => JSON.parse(text))
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') throw e
        if (e instanceof ModelListTooLargeError) throw e
        return null
      })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error(
        `拉取模型列表超时(${LIST_MODELS_TIMEOUT_MS / 1000} 秒),请检查 API URL 或稍后重试`,
        { cause: err },
      )
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
