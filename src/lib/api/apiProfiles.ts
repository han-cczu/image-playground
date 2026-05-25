import type {
  ApiMode,
  ApiProfile,
  ApiProvider,
  AppSettings,
  GeminiProfile,
  OpenAIProfile,
  PromptOptimizerConfig,
  PromptOptimizerProfile,
} from '../../types'
import { isOpenAIProfile } from '../../types'
import { readRuntimeEnv } from './runtimeEnv'

const DEFAULT_BASE_URL = readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL) || 'https://api.openai.com/v1'
export const DEFAULT_IMAGES_MODEL = 'gpt-image-2'
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-image'
export const DEFAULT_OPENAI_PROFILE_ID = 'default-openai'
export const DEFAULT_API_TIMEOUT = 600

export const DEFAULT_OPTIMIZER_MODEL = 'gpt-4o-mini'
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
  const defaults = createDefaultPromptOptimizer()
  return {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : defaults.apiKey,
    model:
      typeof record.model === 'string' && record.model.trim() ? record.model : defaults.model,
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) && record.timeout > 0
        ? record.timeout
        : defaults.timeout,
    systemPrompt:
      typeof record.systemPrompt === 'string' && record.systemPrompt.trim()
        ? record.systemPrompt
        : defaults.systemPrompt,
  }
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
      ? record.id
      : `optimizer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const name = typeof record.name === 'string' && record.name.trim() ? record.name : '新配置'
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

/** 切换 provider：保留 id/name/apiKey/timeout，按目标 provider 重置其他字段 */
export function switchApiProfileProvider(profile: ApiProfile, provider: ApiProvider): ApiProfile {
  const common = {
    id: profile.id,
    name: profile.name,
    apiKey: profile.apiKey,
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

  const id = typeof record.id === 'string' && record.id.trim() ? record.id : undefined
  const name = typeof record.name === 'string' && record.name.trim() ? record.name : undefined
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : undefined
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : undefined
  const model = typeof record.model === 'string' && record.model.trim() ? record.model : undefined
  const timeout =
    typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : undefined

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
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : DEFAULT_BASE_URL,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    model: typeof record.model === 'string' && record.model.trim() ? record.model : DEFAULT_IMAGES_MODEL,
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : DEFAULT_API_TIMEOUT,
    apiMode: record.apiMode === 'responses' ? 'responses' : 'images',
    codexCli: Boolean(record.codexCli),
    apiProxy: Boolean(record.apiProxy),
  })
  const filteredRawProfiles = Array.isArray(record.profiles)
    ? (record.profiles as unknown[]).filter((profile) => {
        if (!profile || typeof profile !== 'object') return true
        return (profile as Record<string, unknown>).provider !== 'fal'
      })
    : []
  const profiles = filteredRawProfiles.length
    ? filteredRawProfiles.map((profile) => normalizeApiProfile(profile))
    : [legacyProfile]
  const activeProfileId =
    typeof record.activeProfileId === 'string' && profiles.some((p) => p.id === record.activeProfileId)
      ? record.activeProfileId
      : profiles[0].id
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]
  const activeAsOpenAI = isOpenAIProfile(active) ? active : null

  const rawOptimizerProfiles = Array.isArray(record.optimizerProfiles)
    ? (record.optimizerProfiles as unknown[])
    : []
  const optimizerProfiles = rawOptimizerProfiles.length
    ? rawOptimizerProfiles.map((p) => normalizeOptimizerProfile(p))
    : [
        createDefaultOptimizerProfile({
          ...normalizePromptOptimizer(record.promptOptimizer),
          id: DEFAULT_OPTIMIZER_PROFILE_ID,
          name: '默认',
        }),
      ]
  const activeOptimizerProfileId =
    typeof record.activeOptimizerProfileId === 'string' &&
    optimizerProfiles.some((p) => p.id === record.activeOptimizerProfileId)
      ? record.activeOptimizerProfileId
      : optimizerProfiles[0].id
  const activeOptimizer =
    optimizerProfiles.find((p) => p.id === activeOptimizerProfileId) ?? optimizerProfiles[0]

  return {
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: active.model,
    timeout: active.timeout,
    apiMode: activeAsOpenAI?.apiMode ?? 'images',
    codexCli: activeAsOpenAI?.codexCli ?? false,
    apiProxy: activeAsOpenAI?.apiProxy ?? false,
    clearInputAfterSubmit: typeof record.clearInputAfterSubmit === 'boolean' ? record.clearInputAfterSubmit : false,
    theme: record.theme === 'light' || record.theme === 'dark' || record.theme === 'system' ? record.theme : 'light',
    profiles,
    activeProfileId,
    promptOptimizer: {
      baseUrl: activeOptimizer.baseUrl,
      apiKey: activeOptimizer.apiKey,
      model: activeOptimizer.model,
      timeout: activeOptimizer.timeout,
      systemPrompt: activeOptimizer.systemPrompt,
    },
    optimizerProfiles,
    activeOptimizerProfileId,
  }
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const record = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const normalized = normalizeSettings(settings)
  const profile =
    normalized.profiles.find((p) => p.id === normalized.activeProfileId) ??
    normalized.profiles[0] ??
    createDefaultOpenAIProfile()

  const baseOverrides = {
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : profile.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : profile.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : profile.model,
    timeout:
      typeof record.timeout === 'number' && Number.isFinite(record.timeout) ? record.timeout : profile.timeout,
  }

  if (isOpenAIProfile(profile)) {
    return {
      ...profile,
      ...baseOverrides,
      apiMode:
        record.apiMode === 'images' || record.apiMode === 'responses' ? record.apiMode : profile.apiMode,
      codexCli: typeof record.codexCli === 'boolean' ? record.codexCli : profile.codexCli,
      apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : profile.apiProxy,
    }
  }

  return { ...profile, ...baseOverrides }
}

export function validateApiProfile(profile: ApiProfile): string | null {
  if (!profile.name.trim()) return '缺少名称'
  if (!profile.baseUrl.trim()) return '缺少 API URL'
  if (!profile.apiKey.trim()) return '缺少 API Key'
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

function getApiProfileDedupKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
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

function getOptimizerProfileDedupKey(profile: PromptOptimizerProfile): string {
  return JSON.stringify([
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
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
  })

  if (hasOnlyDefaultProfiles(current)) {
    return imported
  }

  const usedIds = new Set(current.profiles.map((profile) => profile.id))
  const existingKeys = new Set(current.profiles.map(getApiProfileDedupKey))
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
    const existingOptimizerKeys = new Set(current.optimizerProfiles.map(getOptimizerProfileDedupKey))
    const importedOptimizerProfiles = imported.optimizerProfiles
      .filter((p) => !existingOptimizerKeys.has(getOptimizerProfileDedupKey(p)))
      .map((p) => ({ ...p, id: createImportedOptimizerProfileId(usedOptimizerIds) }))
    mergedOptimizerProfiles = [...current.optimizerProfiles, ...importedOptimizerProfiles]
    mergedActiveOptimizerProfileId = current.activeOptimizerProfileId
  }

  return normalizeSettings({
    ...current,
    profiles,
    activeProfileId: current.activeProfileId,
    optimizerProfiles: mergedOptimizerProfiles,
    activeOptimizerProfileId: mergedActiveOptimizerProfileId,
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
})
