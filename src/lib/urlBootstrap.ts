import type { ApiMode, ApiProvider, AppSettings } from '../types'
import { normalizeBaseUrl } from './api'
import {
  MAX_CONFIG_FIELD_LEN,
  normalizeSettings,
  switchApiProfileProvider,
} from './api/apiProfiles'

const BOOTSTRAP_KEYS = ['apiUrl', 'apiKey', 'codexCli', 'apiMode', 'provider']

export interface UrlBootstrapResult {
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

export interface ReadUrlBootstrapOptions {
  /** 链接未带 provider 时按激活 profile 的 provider 归一化 apiUrl:Gemini 地址不能套 OpenAI 的补 /v1 规则 */
  defaultProvider?: ApiProvider | null
}

export function readUrlBootstrap(
  href: string,
  options: ReadUrlBootstrapOptions = {},
): UrlBootstrapResult {
  const url = new URL(href)
  const searchParams = new URLSearchParams(url.search)
  const hashParams = parseHashParams(url.hash)
  const settings: Partial<AppSettings> = {}
  // 仅从 hash 读取 provider(与 apiUrl/apiKey 同口径):provider 会驱动激活 profile 的重建(换厂商时端点/模型
  // 归默认、密钥清空并落盘),若允许查询串摄入,攻击者贴一条 ?provider=gemini 的外链、受害者点开即被静默改配置,
  // 地址栏随即被 replaceState 清理,无从归因。'provider' 仍保留在 BOOTSTRAP_KEYS,查询串里的值照样被清理出 URL。
  const provider = normalizeProvider(hashParams.get('provider'))

  // 仅从 hash 读取 apiUrl(与 apiKey 对称):查询串里的 ?apiUrl= 可被攻击者注入改写 baseUrl,
  // 使带 Authorization 的请求发往恶意主机。'apiUrl' 仍保留在 BOOTSTRAP_KEYS,故查询串里的值仍会被
  // changed 命中并由 cleanSearchParams 清出 URL(读丢弃、URL 照样净化)。
  const apiUrlParam = hashParams.get('apiUrl')
  if (apiUrlParam !== null) {
    settings.baseUrl = clampBootstrapValue(
      normalizeBootstrapBaseUrl(apiUrlParam, provider ?? options.defaultProvider ?? null),
    )
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

  // 注意:这里不因 provider 而清 apiKey——解析层不知道当前激活 profile 的 provider,分不清「真换厂商」与
  // 「#provider=openai 落在本就是 OpenAI 的 profile 上」;一刀切置 '' 会让后者也被清 key。
  // 清 key 的判定放在 applyUrlBootstrapToSettings(那里能看到 current.provider)。
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

/**
 * 把 URL 引导结果合并到当前 settings,产出交给 setSettings 的增量(空对象 = 无需写入)。
 * 抽成纯函数而非留在 App 的挂载 effect 里:「同 provider 不重建 / 真换厂商必清 key」这类判定必须能在 node
 * 环境单测,而 App 挂载链路牵着 initStore/IDB,无法廉价复现。
 */
export function applyUrlBootstrapToSettings(
  currentSettings: AppSettings,
  bootstrap: UrlBootstrapResult,
): Partial<AppSettings> {
  const nextSettings = { ...bootstrap.settings }

  // 加固:引导改了 baseUrl 但没带新 apiKey 时,不复用旧 key——否则旧 key 会随 Authorization 发往新主机
  //(攻击者用 #apiUrl=evil 不带 key 即可窃取已配置的 key)。置 '' 让 settings 合并层的
  // `incoming.apiKey ?? profile.apiKey` 解析为空,强制为新主机重填 key。正常分享链 #apiUrl=...&apiKey=...
  // 同时带 key,nextSettings.apiKey 已定义,不触发此分支,零误伤。
  if (nextSettings.baseUrl !== undefined && nextSettings.apiKey === undefined) {
    nextSettings.apiKey = ''
  }

  const provider = bootstrap.provider
  if (provider) {
    const settings = normalizeSettings(currentSettings)
    const current =
      settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
      settings.profiles[0]
    if (current) {
      // 只有真换厂商才走 switchApiProfileProvider(它按「换厂商即重置」契约把端点/模型/模式/Codex 归默认、清 key);
      // 同 provider 时以原 profile 为基底只叠加 URL 显式给出的字段——否则自建网关 + Responses 模式的用户用
      // #apiKey=…&provider=openai 轮换密钥,会被顺手改打 api.openai.com + 默认模型,只在下次生成出错时才发现。
      const switching = current.provider !== provider
      // 换厂商且 URL 未带新 key:清空——旧厂商的 key 不得随请求发往新厂商端点(承接上轮 M11 语义)。
      if (switching && nextSettings.apiKey === undefined) {
        nextSettings.apiKey = ''
      }
      nextSettings.profiles = settings.profiles.map((profile) => {
        if (profile.id !== current.id) return profile
        const base = switching ? switchApiProfileProvider(profile, provider) : profile
        return {
          ...base,
          ...(nextSettings.baseUrl !== undefined ? { baseUrl: nextSettings.baseUrl } : {}),
          ...(nextSettings.apiKey !== undefined ? { apiKey: nextSettings.apiKey } : {}),
          ...(base.provider === 'openai' && nextSettings.apiMode !== undefined
            ? { apiMode: nextSettings.apiMode }
            : {}),
          ...(base.provider === 'openai' && nextSettings.codexCli !== undefined
            ? { codexCli: nextSettings.codexCli }
            : {}),
        }
      })
      nextSettings.activeProfileId = current.id
    }
  }

  return nextSettings
}
