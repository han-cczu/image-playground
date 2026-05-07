import type { OpenAIProfile } from '../../types'
import { buildApiUrl, isApiProxyAvailable, readClientDevProxyConfig } from './devProxy'

export async function listModels(profile: OpenAIProfile): Promise<string[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = Boolean(profile.apiProxy) && isApiProxyAvailable(proxyConfig)
  const url = buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy)

  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  }
  if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`

  const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ''}`)
  }

  const data = await res.json().catch(() => null)
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
