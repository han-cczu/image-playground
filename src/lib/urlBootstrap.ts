import type { ApiMode, ApiProvider, AppSettings } from '../types'
import { normalizeBaseUrl } from './api'

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

  const apiUrlParam = searchParams.get('apiUrl') ?? hashParams.get('apiUrl')
  if (apiUrlParam !== null) {
    settings.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
  }

  const apiKeyParam = hashParams.get('apiKey') ?? searchParams.get('apiKey')
  if (apiKeyParam !== null) {
    settings.apiKey = apiKeyParam.trim()
  }

  const codexCliParam = searchParams.get('codexCli') ?? hashParams.get('codexCli')
  if (codexCliParam !== null) {
    settings.codexCli = codexCliParam.trim().toLowerCase() === 'true'
  }

  const apiMode = normalizeApiMode(searchParams.get('apiMode') ?? hashParams.get('apiMode'))
  if (apiMode) {
    settings.apiMode = apiMode
  }

  const provider = normalizeProvider(searchParams.get('provider') ?? hashParams.get('provider'))
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
