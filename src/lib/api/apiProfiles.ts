import type {
  ApiMode,
  ApiProfile,
  ApiProvider,
  AppSettings,
  CaptionerConfig,
  CaptionerProfile,
  GeminiProfile,
  OpenAIProfile,
  PromptOptimizerConfig,
  PromptOptimizerProfile,
} from '../../types'
import { isOpenAIProfile } from '../../types'
import { readRuntimeEnv } from './runtimeEnv'

export const DEFAULT_BASE_URL =
  readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL) || 'https://api.openai.com/v1'
export const DEFAULT_IMAGES_MODEL = 'gpt-image-2'
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-image'
export const DEFAULT_OPENAI_PROFILE_ID = 'default-openai'
export const DEFAULT_API_TIMEOUT = 600
export const MAX_NAMED_PROFILES = 50
export const MAX_PROFILE_NAME_LEN = 50
export const MAX_CONFIG_FIELD_LEN = 4096

/**
 * 批量调度并发上限的取值域。默认沿用原 taskRuntime 写死常量(3):批量场景叠加
 * callImageApi 内部多图拆单(codexCli && n>1 时各图一个子请求)会相乘,保守默认防上游 429;
 * 上界 6 在 codexCli n=10 下已达 ~60 子请求,不再上调,UI 文案提示相乘风险。
 */
export const BATCH_CONCURRENCY_MIN = 1
export const BATCH_CONCURRENCY_MAX = 6
export const DEFAULT_BATCH_CONCURRENCY = 3

/** 整数化 + 双向夹紧,非数兜默认;唯一净化口在 normalizeSettings 白名单(读取处信任不再 clamp) */
export function clampBatchConcurrency(value: unknown): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_BATCH_CONCURRENCY
  return Math.min(BATCH_CONCURRENCY_MAX, Math.max(BATCH_CONCURRENCY_MIN, n))
}

export const AUTO_RETRY_MIN = 0
export const AUTO_RETRY_MAX_LIMIT = 3
export const DEFAULT_AUTO_RETRY_MAX = 2

/** 自动重试次数净化(0=关闭);口径与 clampBatchConcurrency 一致:唯一净化口在 normalizeSettings */
export function clampAutoRetryMax(value: unknown): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_AUTO_RETRY_MAX
  return Math.min(AUTO_RETRY_MAX_LIMIT, Math.max(AUTO_RETRY_MIN, n))
}

function clampConfigField(value: string): string {
  return value.slice(0, MAX_CONFIG_FIELD_LEN)
}

function normalizeConfigString(
  value: unknown,
  fallback: string,
  options: { requireTrimmed?: boolean } = {},
): string {
  if (typeof value !== 'string') return fallback
  if (options.requireTrimmed && !value.trim()) return fallback
  return clampConfigField(value)
}

export const DEFAULT_OPTIMIZER_MODEL = 'gpt-4o-mini'
/** Gemini 反推/优化默认模型(支持 vision + systemInstruction) */
export const DEFAULT_GEMINI_CHAT_MODEL = 'gemini-2.5-flash'
export const DEFAULT_OPTIMIZER_TIMEOUT = 60
export const DEFAULT_OPTIMIZER_PROFILE_ID = 'default-optimizer'
export const DEFAULT_OPTIMIZER_SYSTEM_PROMPT = `You are an expert prompt engineer specializing in text-to-image generation.

Rewrite the user's draft prompt into a single, vivid, structured English image prompt suitable for state-of-the-art image models (GPT Image, DALL·E, Midjourney, Stable Diffusion).

Guidelines:
- Output ONLY the rewritten prompt. No preface, no quotes, no commentary, no markdown.
- Preserve the user's core intent, subject, and any explicit constraints (style, aspect ratio, count, named entities).
- Add concrete visual details: subject, composition, lighting, color palette, materials, mood, camera/lens (if applicable), and art style.
- Keep it under ~120 words. One paragraph.
- If the user already wrote a high-quality English prompt, lightly polish it instead of rewriting.`

export const DEFAULT_CAPTIONER_MODEL = 'gpt-4o-mini'
export const DEFAULT_CAPTIONER_TIMEOUT = 60
export const DEFAULT_CAPTIONER_PROFILE_ID = 'default-captioner'
export const DEFAULT_CAPTIONER_SYSTEM_PROMPT = `You are an expert at reverse-engineering image-generation prompts from images.

Look at the provided image and write a single, vivid, structured English prompt that could recreate it with a state-of-the-art image model (GPT Image, DALL·E, Midjourney, Stable Diffusion).

Guidelines:
- Output ONLY the prompt. No preface, no quotes, no commentary, no markdown.
- Describe the main subject, composition, lighting, color palette, materials/textures, mood, and art style. Include camera/lens cues if it looks like a photo.
- Be concrete and specific; avoid vague adjectives.
- Keep it under ~120 words. One paragraph.`

export function createDefaultPromptOptimizer(
  overrides: Partial<PromptOptimizerConfig> = {},
): PromptOptimizerConfig {
  return {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_OPTIMIZER_MODEL,
    timeout: DEFAULT_OPTIMIZER_TIMEOUT,
    systemPrompt: DEFAULT_OPTIMIZER_SYSTEM_PROMPT,
    ...overrides,
  }
}

export function normalizePromptOptimizer(input: unknown): PromptOptimizerConfig {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const provider = record.provider === 'gemini' ? 'gemini' : 'openai'
  const defaults =
    provider === 'gemini'
      ? createDefaultPromptOptimizer({
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          model: DEFAULT_GEMINI_CHAT_MODEL,
          provider,
        })
      : createDefaultPromptOptimizer()
  return {
    baseUrl: normalizeConfigString(record.baseUrl, defaults.baseUrl, { requireTrimmed: true }),
    apiKey: normalizeConfigString(record.apiKey, defaults.apiKey),
    model: normalizeConfigString(record.model, defaults.model, { requireTrimmed: true }),
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
        ? record.timeout
        : defaults.timeout,
    systemPrompt: normalizeConfigString(record.systemPrompt, defaults.systemPrompt, {
      requireTrimmed: true,
    }),
    provider,
  }
}

function normalizeProfileName(value: unknown, fallback = '新配置'): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, MAX_PROFILE_NAME_LEN)
    : fallback
}

export function createDefaultOptimizerProfile(
  overrides: Partial<PromptOptimizerProfile> = {},
): PromptOptimizerProfile {
  return {
    id: DEFAULT_OPTIMIZER_PROFILE_ID,
    name: '默认',
    ...createDefaultPromptOptimizer(),
    ...overrides,
  }
}

export function normalizeOptimizerProfile(input: unknown): PromptOptimizerProfile {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const config = normalizePromptOptimizer(record)
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? clampConfigField(record.id)
      : `optimizer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const name = normalizeProfileName(record.name)
  return { ...config, id, name }
}

/**
 * 仅用于初始化场景（如打开设置面板时一次性读取激活配置）。
 * 消费方在渲染路径上应直接读 `settings.promptOptimizer` 镜像，不要在循环/选择器里调用此函数。
 */
export function getActiveOptimizerProfile(
  settings: Partial<AppSettings> | unknown,
): PromptOptimizerProfile {
  const normalized = normalizeSettings(settings)
  return (
    normalized.optimizerProfiles.find((p) => p.id === normalized.activeOptimizerProfileId) ??
    normalized.optimizerProfiles[0]
  )
}

export function createDefaultCaptioner(overrides: Partial<CaptionerConfig> = {}): CaptionerConfig {
  return {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_CAPTIONER_MODEL,
    timeout: DEFAULT_CAPTIONER_TIMEOUT,
    systemPrompt: DEFAULT_CAPTIONER_SYSTEM_PROMPT,
    ...overrides,
  }
}

export function normalizeCaptioner(input: unknown): CaptionerConfig {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const provider = record.provider === 'gemini' ? 'gemini' : 'openai'
  const defaults =
    provider === 'gemini'
      ? createDefaultCaptioner({
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          model: DEFAULT_GEMINI_CHAT_MODEL,
          provider,
        })
      : createDefaultCaptioner()
  return {
    baseUrl: normalizeConfigString(record.baseUrl, defaults.baseUrl, { requireTrimmed: true }),
    apiKey: normalizeConfigString(record.apiKey, defaults.apiKey),
    model: normalizeConfigString(record.model, defaults.model, { requireTrimmed: true }),
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
        ? record.timeout
        : defaults.timeout,
    systemPrompt: normalizeConfigString(record.systemPrompt, defaults.systemPrompt, {
      requireTrimmed: true,
    }),
    provider,
  }
}

export function createDefaultCaptionerProfile(
  overrides: Partial<CaptionerProfile> = {},
): CaptionerProfile {
  return {
    id: DEFAULT_CAPTIONER_PROFILE_ID,
    name: '默认',
    ...createDefaultCaptioner(),
    ...overrides,
  }
}

export function normalizeCaptionerProfile(input: unknown): CaptionerProfile {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const config = normalizeCaptioner(record)
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? clampConfigField(record.id)
      : `captioner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const name = normalizeProfileName(record.name)
  return { ...config, id, name }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function makeUniqueProfileIds<T extends { id: string }>(
  profiles: T[],
  fallbackPrefix: string,
): T[] {
  const used = new Set<string>()
  return profiles.map((profile, index) => {
    const baseId = clampConfigField(profile.id.trim() || `${fallbackPrefix}-${index + 1}`)
    let id = baseId
    let suffix = 2
    while (used.has(id)) {
      const suffixText = `-${suffix}`
      id = `${baseId.slice(0, MAX_CONFIG_FIELD_LEN - suffixText.length)}${suffixText}`
      suffix += 1
    }
    used.add(id)
    return id === profile.id ? profile : { ...profile, id }
  })
}

/**
 * 仅用于初始化场景（如打开设置面板时一次性读取激活配置）。
 * 消费方在渲染路径上应直接读 `settings.captioner` 镜像，不要在循环/选择器里调用此函数。
 */
export function getActiveCaptionerProfile(
  settings: Partial<AppSettings> | unknown,
): CaptionerProfile {
  const normalized = normalizeSettings(settings)
  return (
    normalized.captionerProfiles.find((p) => p.id === normalized.activeCaptionerProfileId) ??
    normalized.captionerProfiles[0]
  )
}

export function createDefaultOpenAIProfile(overrides: Partial<OpenAIProfile> = {}): OpenAIProfile {
  return {
    id: DEFAULT_OPENAI_PROFILE_ID,
    name: '默认',
    provider: 'openai',
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_IMAGES_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    ...overrides,
  }
}

export function createDefaultGeminiProfile(overrides: Partial<GeminiProfile> = {}): GeminiProfile {
  return {
    id: `gemini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '新配置',
    provider: 'gemini',
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    apiKey: '',
    model: DEFAULT_GEMINI_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    ...overrides,
  }
}

/** 切换 provider：保留 id/name/timeout，重置端点/模型并清空 apiKey，避免把旧供应商密钥发往新端点。 */
export function switchApiProfileProvider(profile: ApiProfile, provider: ApiProvider): ApiProfile {
  const common = {
    id: profile.id,
    name: profile.name,
    apiKey: '',
    timeout: profile.timeout,
  }
  if (provider === 'gemini') {
    return {
      ...common,
      provider: 'gemini',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_MODEL,
    }
  }
  return {
    ...common,
    provider: 'openai',
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_IMAGES_MODEL,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
  }
}

export function normalizeApiProfile(input: unknown, fallback?: Partial<ApiProfile>): ApiProfile {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const provider: ApiProvider = record.provider === 'gemini' ? 'gemini' : 'openai'

  const id =
    typeof record.id === 'string' && record.id.trim() ? clampConfigField(record.id) : undefined
  const name = normalizeProfileName(record.name, '').trim() || undefined
  const baseUrl =
    typeof record.baseUrl === 'string' && record.baseUrl.trim()
      ? clampConfigField(record.baseUrl)
      : undefined
  const apiKey = typeof record.apiKey === 'string' ? clampConfigField(record.apiKey) : undefined
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? clampConfigField(record.model)
      : undefined
  const timeout =
    typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
      ? record.timeout
      : undefined

  if (provider === 'gemini') {
    const defaults = createDefaultGeminiProfile(fallback as Partial<GeminiProfile> | undefined)
    return {
      id: id ?? defaults.id,
      name: name ?? defaults.name,
      provider: 'gemini',
      baseUrl: baseUrl ?? defaults.baseUrl,
      apiKey: apiKey ?? defaults.apiKey,
      model: model ?? defaults.model,
      timeout: timeout ?? defaults.timeout,
    }
  }

  const defaults = createDefaultOpenAIProfile(fallback as Partial<OpenAIProfile> | undefined)
  const apiMode: ApiMode = record.apiMode === 'responses' ? 'responses' : 'images'
  return {
    id: id ?? defaults.id,
    name: name ?? defaults.name,
    provider: 'openai',
    baseUrl: baseUrl ?? defaults.baseUrl,
    apiKey: apiKey ?? defaults.apiKey,
    model: model ?? defaults.model,
    timeout: timeout ?? defaults.timeout,
    apiMode,
    codexCli: Boolean(record.codexCli),
    apiProxy: Boolean(record.apiProxy),
  }
}

export function normalizeSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const legacyProfile = createDefaultOpenAIProfile({
    baseUrl: normalizeConfigString(record.baseUrl, DEFAULT_BASE_URL),
    apiKey: normalizeConfigString(record.apiKey, ''),
    model: normalizeConfigString(record.model, DEFAULT_IMAGES_MODEL, { requireTrimmed: true }),
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
        ? record.timeout
        : DEFAULT_API_TIMEOUT,
    apiMode: record.apiMode === 'responses' ? 'responses' : 'images',
    codexCli: Boolean(record.codexCli),
    apiProxy: Boolean(record.apiProxy),
  })
  const filteredRawProfiles = Array.isArray(record.profiles)
    ? (record.profiles as unknown[]).filter((profile): profile is Record<string, unknown> => {
        if (!isPlainRecord(profile)) return false
        return profile.provider !== 'fal'
      })
    : []
  const profiles = filteredRawProfiles.length
    ? makeUniqueProfileIds(
        filteredRawProfiles.map((profile) => normalizeApiProfile(profile)),
        'profile',
      ).slice(0, MAX_NAMED_PROFILES)
    : [legacyProfile]
  const activeProfileId =
    typeof record.activeProfileId === 'string' &&
    profiles.some((p) => p.id === clampConfigField(record.activeProfileId as string))
      ? clampConfigField(record.activeProfileId)
      : profiles[0].id
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]
  const activeAsOpenAI = isOpenAIProfile(active) ? active : null

  const rawOptimizerProfiles = Array.isArray(record.optimizerProfiles)
    ? (record.optimizerProfiles as unknown[]).filter(isPlainRecord)
    : []
  const optimizerProfiles = rawOptimizerProfiles.length
    ? makeUniqueProfileIds(
        rawOptimizerProfiles.map((p) => normalizeOptimizerProfile(p)),
        'optimizer',
      ).slice(0, MAX_NAMED_PROFILES)
    : [
        createDefaultOptimizerProfile({
          ...normalizePromptOptimizer(record.promptOptimizer),
          id: DEFAULT_OPTIMIZER_PROFILE_ID,
          name: '默认',
        }),
      ]
  const activeOptimizerProfileId =
    typeof record.activeOptimizerProfileId === 'string' &&
    optimizerProfiles.some(
      (p) => p.id === clampConfigField(record.activeOptimizerProfileId as string),
    )
      ? clampConfigField(record.activeOptimizerProfileId)
      : optimizerProfiles[0].id
  const activeOptimizer =
    optimizerProfiles.find((p) => p.id === activeOptimizerProfileId) ?? optimizerProfiles[0]

  const rawCaptionerProfiles = Array.isArray(record.captionerProfiles)
    ? (record.captionerProfiles as unknown[]).filter(isPlainRecord)
    : []
  const captionerProfiles = rawCaptionerProfiles.length
    ? makeUniqueProfileIds(
        rawCaptionerProfiles.map((p) => normalizeCaptionerProfile(p)),
        'captioner',
      ).slice(0, MAX_NAMED_PROFILES)
    : [
        createDefaultCaptionerProfile({
          ...normalizeCaptioner(record.captioner),
          id: DEFAULT_CAPTIONER_PROFILE_ID,
          name: '默认',
        }),
      ]
  const activeCaptionerProfileId =
    typeof record.activeCaptionerProfileId === 'string' &&
    captionerProfiles.some(
      (p) => p.id === clampConfigField(record.activeCaptionerProfileId as string),
    )
      ? clampConfigField(record.activeCaptionerProfileId)
      : captionerProfiles[0].id
  const activeCaptioner =
    captionerProfiles.find((p) => p.id === activeCaptionerProfileId) ?? captionerProfiles[0]

  return {
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    timeout: active.timeout,
    apiMode: activeAsOpenAI?.apiMode ?? 'images',
    codexCli: activeAsOpenAI?.codexCli ?? false,
    apiProxy: activeAsOpenAI?.apiProxy ?? false,
    clearInputAfterSubmit:
      typeof record.clearInputAfterSubmit === 'boolean' ? record.clearInputAfterSubmit : false,
    batchConcurrency: clampBatchConcurrency(record.batchConcurrency),
    autoRetryMax: clampAutoRetryMax(record.autoRetryMax),
    theme:
      record.theme === 'light' || record.theme === 'dark' || record.theme === 'system'
        ? record.theme
        : 'light',
    profiles,
    activeProfileId,
    promptOptimizer: {
      baseUrl: activeOptimizer.baseUrl,
      apiKey: activeOptimizer.apiKey,
      model: activeOptimizer.model,
      timeout: activeOptimizer.timeout,
      systemPrompt: activeOptimizer.systemPrompt,
      provider: activeOptimizer.provider ?? 'openai',
    },
    optimizerProfiles,
    activeOptimizerProfileId,
    captioner: {
      baseUrl: activeCaptioner.baseUrl,
      apiKey: activeCaptioner.apiKey,
      model: activeCaptioner.model,
      timeout: activeCaptioner.timeout,
      systemPrompt: activeCaptioner.systemPrompt,
      provider: activeCaptioner.provider ?? 'openai',
    },
    captionerProfiles,
    activeCaptionerProfileId,
  }
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const record =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const normalized = normalizeSettings(settings)
  const profile =
    normalized.profiles.find((p) => p.id === normalized.activeProfileId) ??
    normalized.profiles[0] ??
    createDefaultOpenAIProfile()

  // Legacy callers may pass `{ ...DEFAULT_SETTINGS, apiKey/baseUrl/... }` without updating
  // `profiles`. Treat top-level mirrors as overrides only for the untouched default OpenAI
  // profile; real configured profiles remain the source of truth.
  if (!hasOnlyDefaultProfiles(normalized) && !isDefaultOpenAIProfile(profile)) return profile

  const baseOverrides = {
    baseUrl: normalizeConfigString(record.baseUrl, profile.baseUrl),
    apiKey: normalizeConfigString(record.apiKey, profile.apiKey),
    model: normalizeConfigString(record.model, profile.model, { requireTrimmed: true }),
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
        ? record.timeout
        : profile.timeout,
  }

  if (isOpenAIProfile(profile)) {
    return {
      ...profile,
      ...baseOverrides,
      apiMode:
        record.apiMode === 'images' || record.apiMode === 'responses'
          ? record.apiMode
          : profile.apiMode,
      codexCli: typeof record.codexCli === 'boolean' ? record.codexCli : profile.codexCli,
      apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : profile.apiProxy,
    }
  }

  return { ...profile, ...baseOverrides }
}

/** HTTP 头值只能是 ByteString:含换行 / NUL / 非 Latin-1 字符时 fetch 直接抛 TypeError */
function isInvalidHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0 || code === 10 || code === 13 || code > 0xff) return true
  }
  return false
}

export function validateApiProfile(profile: ApiProfile): string | null {
  if (!profile.name.trim()) return '缺少名称'
  if (!profile.baseUrl.trim()) return '缺少 API URL'
  if (!profile.apiKey.trim()) return '缺少 API Key'
  // 粘贴时带进换行/全角字符的 key,发请求时 fetch 会抛 TypeError,自动重试把它当网络故障退避 3 轮才报错;
  // 这里提前拦下并说清原因
  if (isInvalidHeaderValue(profile.apiKey.trim()))
    return 'API Key 含换行或非法字符，请检查是否粘贴出错'
  if (!profile.model.trim()) return '缺少模型 ID'
  return null
}

function isDefaultOpenAIProfile(profile: ApiProfile): boolean {
  if (!isOpenAIProfile(profile)) return false
  return (
    profile.id === DEFAULT_OPENAI_PROFILE_ID &&
    profile.name === '默认' &&
    profile.baseUrl === DEFAULT_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_IMAGES_MODEL &&
    profile.timeout === DEFAULT_API_TIMEOUT &&
    profile.apiMode === 'images' &&
    profile.codexCli === false &&
    profile.apiProxy === false
  )
}

function hasOnlyDefaultProfiles(settings: AppSettings): boolean {
  return (
    settings.profiles.length === 1 &&
    settings.activeProfileId === DEFAULT_OPENAI_PROFILE_ID &&
    isDefaultOpenAIProfile(settings.profiles[0])
  )
}

function createImportedProfileId(provider: ApiProvider, usedIds: Set<string>): string {
  let id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

type ProfileDedupKeyOptions = {
  /** 把 apiKey 当作空串参与计算,用途见 collectMergeDedupKeys。 */
  ignoreApiKey?: boolean
}

/**
 * 合并导入时用来判断「导入项本地是否已有」的键集合:每个本地 profile 放两把键——全字段键,以及把
 * apiKey 抹空后的键。导出(redactSettingsForExport)会把备份里所有 apiKey 抹空,只按全字段键比较的话,
 * 本地已填密钥的 profile 与自己备份里的同一条永远不相等,在已配置好的浏览器里合并导入自己的备份就会
 * 给每个配置追加一份同名、无密钥的幽灵副本(选中即报「缺少 API Key」)。
 * 导入项 apiKey 非空时其键的 apiKey 槽位非空,不可能命中抹空键,所以同端点同模型不同密钥的多账号配置
 * 仍按全字段判重、照常追加。不直接把 apiKey 从键里去掉也是为此——dedupe*Profiles 对导入列表内部去重
 * 复用同一把键,去掉会把多账号配置折叠丢失。
 */
function collectMergeDedupKeys<T>(
  profiles: T[],
  getDedupKey: (profile: T, options?: ProfileDedupKeyOptions) => string,
): Set<string> {
  const keys = new Set<string>()
  for (const profile of profiles) {
    keys.add(getDedupKey(profile))
    keys.add(getDedupKey(profile, { ignoreApiKey: true }))
  }
  return keys
}

function getApiProfileDedupKey(profile: ApiProfile, options?: ProfileDedupKeyOptions): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    options?.ignoreApiKey ? '' : profile.apiKey.trim(),
    profile.model.trim(),
    isOpenAIProfile(profile) ? profile.apiMode : null,
  ])
}

function dedupeApiProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getApiProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getOptimizerProfileDedupKey(
  profile: PromptOptimizerProfile,
  options?: ProfileDedupKeyOptions,
): string {
  return JSON.stringify([
    profile.provider ?? 'openai',
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    options?.ignoreApiKey ? '' : profile.apiKey.trim(),
    profile.model.trim(),
    // 纳入 systemPrompt + name:导出会抹空 apiKey,否则同 baseUrl+model 的多套配置往返导入时会被折叠丢失
    profile.systemPrompt.trim(),
    profile.name.trim(),
  ])
}

function dedupeOptimizerProfiles(profiles: PromptOptimizerProfile[]): PromptOptimizerProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getOptimizerProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isDefaultOptimizerProfile(profile: PromptOptimizerProfile): boolean {
  return (
    profile.id === DEFAULT_OPTIMIZER_PROFILE_ID &&
    profile.name === '默认' &&
    (profile.provider ?? 'openai') === 'openai' &&
    profile.baseUrl === DEFAULT_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_OPTIMIZER_MODEL &&
    profile.timeout === DEFAULT_OPTIMIZER_TIMEOUT &&
    profile.systemPrompt === DEFAULT_OPTIMIZER_SYSTEM_PROMPT
  )
}

function hasOnlyDefaultOptimizerProfiles(settings: AppSettings): boolean {
  return (
    settings.optimizerProfiles.length === 1 &&
    settings.activeOptimizerProfileId === DEFAULT_OPTIMIZER_PROFILE_ID &&
    isDefaultOptimizerProfile(settings.optimizerProfiles[0])
  )
}

function createImportedOptimizerProfileId(usedIds: Set<string>): string {
  let id = `optimizer-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `optimizer-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

function getCaptionerProfileDedupKey(
  profile: CaptionerProfile,
  options?: ProfileDedupKeyOptions,
): string {
  return JSON.stringify([
    profile.provider ?? 'openai',
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    options?.ignoreApiKey ? '' : profile.apiKey.trim(),
    profile.model.trim(),
    // 纳入 systemPrompt + name:导出会抹空 apiKey,否则同 baseUrl+model 的多套配置往返导入时会被折叠丢失
    profile.systemPrompt.trim(),
    profile.name.trim(),
  ])
}

function dedupeCaptionerProfiles(profiles: CaptionerProfile[]): CaptionerProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getCaptionerProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isDefaultCaptionerProfile(profile: CaptionerProfile): boolean {
  return (
    profile.id === DEFAULT_CAPTIONER_PROFILE_ID &&
    profile.name === '默认' &&
    (profile.provider ?? 'openai') === 'openai' &&
    profile.baseUrl === DEFAULT_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_CAPTIONER_MODEL &&
    profile.timeout === DEFAULT_CAPTIONER_TIMEOUT &&
    profile.systemPrompt === DEFAULT_CAPTIONER_SYSTEM_PROMPT
  )
}

function hasOnlyDefaultCaptionerProfiles(settings: AppSettings): boolean {
  return (
    settings.captionerProfiles.length === 1 &&
    settings.activeCaptionerProfileId === DEFAULT_CAPTIONER_PROFILE_ID &&
    isDefaultCaptionerProfile(settings.captionerProfiles[0])
  )
}

function createImportedCaptionerProfileId(usedIds: Set<string>): string {
  let id = `captioner-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `captioner-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

export function mergeImportedSettings(
  currentSettings: Partial<AppSettings> | unknown,
  importedSettings: Partial<AppSettings> | unknown,
): AppSettings {
  const current = normalizeSettings(currentSettings)
  const normalizedImported = normalizeSettings(importedSettings)
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
    optimizerProfiles: dedupeOptimizerProfiles(normalizedImported.optimizerProfiles),
    captionerProfiles: dedupeCaptionerProfiles(normalizedImported.captionerProfiles),
  })

  if (hasOnlyDefaultProfiles(current)) {
    return imported
  }

  const usedIds = new Set(current.profiles.map((profile) => profile.id))
  const existingKeys = collectMergeDedupKeys(current.profiles, getApiProfileDedupKey)
  const importedProfiles = imported.profiles
    .filter((profile) => !existingKeys.has(getApiProfileDedupKey(profile)))
    .map((profile) => ({
      ...profile,
      id: createImportedProfileId(profile.provider, usedIds),
    }))
  const profiles = [...current.profiles, ...importedProfiles]

  let mergedOptimizerProfiles: PromptOptimizerProfile[]
  let mergedActiveOptimizerProfileId: string
  if (hasOnlyDefaultOptimizerProfiles(current)) {
    mergedOptimizerProfiles = imported.optimizerProfiles
    mergedActiveOptimizerProfileId = imported.activeOptimizerProfileId
  } else {
    const usedOptimizerIds = new Set(current.optimizerProfiles.map((p) => p.id))
    const existingOptimizerKeys = collectMergeDedupKeys(
      current.optimizerProfiles,
      getOptimizerProfileDedupKey,
    )
    const importedOptimizerProfiles = imported.optimizerProfiles
      .filter((p) => !existingOptimizerKeys.has(getOptimizerProfileDedupKey(p)))
      .map((p) => ({ ...p, id: createImportedOptimizerProfileId(usedOptimizerIds) }))
    mergedOptimizerProfiles = [...current.optimizerProfiles, ...importedOptimizerProfiles]
    mergedActiveOptimizerProfileId = current.activeOptimizerProfileId
  }

  let mergedCaptionerProfiles: CaptionerProfile[]
  let mergedActiveCaptionerProfileId: string
  if (hasOnlyDefaultCaptionerProfiles(current)) {
    mergedCaptionerProfiles = imported.captionerProfiles
    mergedActiveCaptionerProfileId = imported.activeCaptionerProfileId
  } else {
    const usedCaptionerIds = new Set(current.captionerProfiles.map((p) => p.id))
    const existingCaptionerKeys = collectMergeDedupKeys(
      current.captionerProfiles,
      getCaptionerProfileDedupKey,
    )
    const importedCaptionerProfiles = imported.captionerProfiles
      .filter((p) => !existingCaptionerKeys.has(getCaptionerProfileDedupKey(p)))
      .map((p) => ({ ...p, id: createImportedCaptionerProfileId(usedCaptionerIds) }))
    mergedCaptionerProfiles = [...current.captionerProfiles, ...importedCaptionerProfiles]
    mergedActiveCaptionerProfileId = current.activeCaptionerProfileId
  }

  return normalizeSettings({
    ...current,
    profiles,
    activeProfileId: current.activeProfileId,
    optimizerProfiles: mergedOptimizerProfiles,
    activeOptimizerProfileId: mergedActiveOptimizerProfileId,
    captionerProfiles: mergedCaptionerProfiles,
    activeCaptionerProfileId: mergedActiveCaptionerProfileId,
  })
}

export const DEFAULT_SETTINGS: AppSettings = normalizeSettings({
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  model: DEFAULT_IMAGES_MODEL,
  timeout: DEFAULT_API_TIMEOUT,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
  clearInputAfterSubmit: false,
  batchConcurrency: DEFAULT_BATCH_CONCURRENCY,
  autoRetryMax: DEFAULT_AUTO_RETRY_MAX,
})
