import { readRuntimeEnv } from './runtimeEnv'

export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** 形如 v1 / v1beta / v2 的 API 版本路径段 */
const VERSION_SEGMENT = /^v\d+[a-z0-9]*$/i

/** 用户把完整端点地址粘进「API URL」时要剥掉的尾巴(按路径末尾的段匹配,不碰中间路径) */
const ENDPOINT_TAILS: readonly (readonly string[])[] = [
  ['chat', 'completions'],
  ['images', 'generations'],
  ['images', 'edits'],
  ['images', 'variations'],
  ['responses'],
  ['models'],
  ['embeddings'],
  ['completions'],
]

function stripEndpointTail(segments: string[]): string[] {
  for (const tail of ENDPOINT_TAILS) {
    if (segments.length < tail.length) continue
    const end = segments.slice(-tail.length)
    if (end.every((segment, index) => segment.toLowerCase() === tail[index])) {
      return segments.slice(0, -tail.length)
    }
  }
  return segments
}

/** 路径里是否已含版本段(v1 / v1beta / v2 …):有则拼接端点时不再额外插入 v1。 */
export function hasApiVersionSegment(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).pathname.split('/').some((segment) => VERSION_SEGMENT.test(segment))
  } catch {
    return false
  }
}

/**
 * 归一化 API 基址:补协议、去尾斜杠、剥掉误粘进来的端点尾巴(/chat/completions、/images/… 等),
 * 路径中没有任何版本段且非空时补 /v1(与 buildApiUrl 对「空路径」的补 v1 口径一致)。
 * 不再「在第一个 v1 处截断」:Cloudflare AI Gateway(/v1/<account>/<gateway>/openai)、
 * 各类带前缀路径的网关会被截成 origin/v1 而指向不存在的端点;v1 之后的路径必须原样保留。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = stripEndpointTail(url.pathname.split('/').filter(Boolean))
    const hasVersion = pathSegments.some((segment) => VERSION_SEGMENT.test(segment))
    const normalizedSegments =
      hasVersion || !pathSegments.length ? pathSegments : [...pathSegments, 'v1']
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target || !isHttpUrl(target)) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')
  // 基址路径里已有版本段(/v1、网关的 /v1/<acct>/<gw>/openai、/v1beta/openai)就直接拼端点,否则补 v1
  const apiPath = hasApiVersionSegment(normalizedBaseUrl)
    ? endpointPath
    : ['v1', endpointPath].join('/')

  if (useApiProxy) {
    return `${proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX}/${apiPath}`
  }

  // 空 baseUrl 不再退化为同源相对路径(否则密钥会随请求发往应用部署源)。
  if (!normalizedBaseUrl || !isHttpUrl(normalizedBaseUrl)) throw new Error('未配置 API URL')
  return `${normalizedBaseUrl}/${apiPath}`
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(
  proxyConfig: DevProxyConfig | null = readClientDevProxyConfig(),
): boolean {
  return (
    readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true' ||
    Boolean(proxyConfig?.enabled)
  )
}
