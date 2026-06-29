import type { ApiMode, ApiProvider, AppSettings } from '../types'
import { normalizeBaseUrl } from './api'
import { MAX_CONFIG_FIELD_LEN } from './api/apiProfiles'

const BOOTSTRAP_KEYS = ['apiUrl', 'apiKey', 'codexCli', 'apiMode', 'provider']

interface UrlBootstrapResult {
  settings: Partial<AppSettings>
  provider: ApiProvider | null
  cleanUrl: string
  changed: boolean
}

function parseHashParams(hash: string): URLSearchParams {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash
  const query = trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  if (!query || query.startsWith('/')) return new URLSearchParams()
  return new URLSearchParams(query)
}

function normalizeProvider(value: string | null): ApiProvider | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'gemini') return 'gemini'
  if (normalized === 'openai' || normalized === 'openai-compatible') return 'openai'
  return null
}

function normalizeApiMode(value: string | null): ApiMode | undefined {
  return value === 'images' || value === 'responses' ? value : undefined
}

function clampBootstrapValue(value: string): string {
  return value.slice(0, MAX_CONFIG_FIELD_LEN)
}

function normalizeBootstrapBaseUrl(value: string, provider: ApiProvider | null): string {
  const trimmed = value.trim()
  if (provider === 'gemini') return trimmed.replace(/\/+$/, '')
  return normalizeBaseUrl(trimmed)
}

function cleanSearchParams(searchParams: URLSearchParams) {
  for (const key of BOOTSTRAP_KEYS) {
    searchParams.delete(key)
  }
}

function cleanHash(hash: string): string {
  const params = parseHashParams(hash)
  if (![...params.keys()].some((key) => BOOTSTRAP_KEYS.includes(key))) return hash

  cleanSearchParams(params)
  const nextHash = params.toString()
  return nextHash ? `#${nextHash}` : ''
}

export function readUrlBootstrap(href: string): UrlBootstrapResult {
  const url = new URL(href)
  const searchParams = new URLSearchParams(url.search)
  const hashParams = parseHashParams(url.hash)
  const settings: Partial<AppSettings> = {}
  const provider = normalizeProvider(searchParams.get('provider') ?? hashParams.get('provider'))

  // 仅从 hash 读取 apiUrl(与 apiKey 对称):查询串里的 ?apiUrl= 可被攻击者注入改写 baseUrl,
  // 使带 Authorization 的请求发往恶意主机。'apiUrl' 仍保留在 BOOTSTRAP_KEYS,故查询串里的值仍会被
  // changed 命中并由 cleanSearchParams 清出 URL(读丢弃、URL 照样净化)。
  const apiUrlParam = hashParams.get('apiUrl')
  if (apiUrlParam !== null) {
    settings.baseUrl = clampBootstrapValue(normalizeBootstrapBaseUrl(apiUrlParam, provider))
  }

  // 仅从 hash 读取 apiKey:查询串会进服务器访问日志 / Referer,密钥绝不应走查询串。
  // 'apiKey' 仍保留在 BOOTSTRAP_KEYS 中,故查询串里的 ?apiKey= 仍会被 cleanSearchParams 清理出 URL。
  const apiKeyParam = hashParams.get('apiKey')
  if (apiKeyParam !== null) {
    settings.apiKey = clampBootstrapValue(apiKeyParam.trim())
  }

  const codexCliParam = searchParams.get('codexCli') ?? hashParams.get('codexCli')
  if (codexCliParam !== null) {
    settings.codexCli = codexCliParam.trim().toLowerCase() === 'true'
  }

  const apiMode = normalizeApiMode(searchParams.get('apiMode') ?? hashParams.get('apiMode'))
  if (apiMode) {
    settings.apiMode = apiMode
  }

  if (provider && apiKeyParam === null) {
    settings.apiKey = ''
  }
  const changed = BOOTSTRAP_KEYS.some((key) => searchParams.has(key) || hashParams.has(key))

  if (changed) {
    cleanSearchParams(searchParams)
    url.search = searchParams.toString()
    url.hash = cleanHash(url.hash)
  }

  return {
    settings,
    provider,
    cleanUrl: url.toString(),
    changed,
  }
}
