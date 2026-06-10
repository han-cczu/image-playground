import type { OpenAIProfile } from '../../types'
import { buildApiUrl, isApiProxyAvailable, readClientDevProxyConfig } from './devProxy'

/** 模型列表拉取超时:无超时则网关悬挂时下拉 UI 永久停留加载态(列表是辅助功能,不必等满生成超时) */
const LIST_MODELS_TIMEOUT_MS = 15_000

export async function listModels(profile: OpenAIProfile): Promise<string[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = Boolean(profile.apiProxy) && isApiProxyAvailable(proxyConfig)
  const url = buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy)

  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  }
  if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), LIST_MODELS_TIMEOUT_MS)
  let data: unknown
  try {
    const res = await fetch(url, { method: 'GET', headers, cache: 'no-store', signal: controller.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ''}`)
    }
    // 解析失败容忍为 null,但读体阶段的 abort(超时落在 json() 期间)必须重抛——
    // 否则超时被吞成「成功的空列表」,还会被 useModelList 当成功结果缓存整个会话
    data = await res.json().catch((e: unknown) => {
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

  return Array.from(new Set(ids)).sort()
}
