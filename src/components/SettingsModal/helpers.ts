import { normalizeBaseUrl } from '../../lib/api'
import {
  DEFAULT_CAPTIONER_PROFILE_ID,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_OPTIMIZER_PROFILE_ID,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  normalizeCaptionerProfile,
  normalizeOptimizerProfile,
} from '../../lib/api/apiProfiles'
import type { ApiProfile, AppSettings, CaptionerProfile, PromptOptimizerProfile } from '../../types'

export function getDefaultModelForMode(apiMode: AppSettings['apiMode']) {
  return apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL
}

/**
 * 保存时对 API 配置组逐个兜底:trim 名称/URL/模型并按 provider 区分默认端点与模型;
 * Gemini 只去尾部斜杠,OpenAI 走 normalizeBaseUrl,且 apiProxy 在代理不可用时强制关闭。
 */
export function normalizeApiProfilesForSave(
  profiles: ApiProfile[],
  apiProxyAvailable: boolean,
): ApiProfile[] {
  return profiles.map((profile) => {
    const trimmedName = profile.name.trim() || (profile.id === DEFAULT_OPENAI_PROFILE_ID ? '默认' : '新配置')
    const trimmedTimeout = Number(profile.timeout) || DEFAULT_SETTINGS.timeout
    if (profile.provider === 'gemini') {
      return {
        ...profile,
        name: trimmedName,
        baseUrl: profile.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_GEMINI_BASE_URL,
        model: profile.model.trim() || DEFAULT_GEMINI_MODEL,
        timeout: trimmedTimeout,
      }
    }
    return {
      ...profile,
      name: trimmedName,
      baseUrl: normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl),
      model: profile.model.trim() || getDefaultModelForMode(profile.apiMode),
      timeout: trimmedTimeout,
      apiProxy: apiProxyAvailable ? profile.apiProxy : false,
    }
  })
}

/** 保存时对优化器配置组逐个兜底(trim + provider 相关默认值),最后过 normalizeOptimizerProfile */
export function normalizeOptimizerProfilesForSave(
  profiles: PromptOptimizerProfile[],
): PromptOptimizerProfile[] {
  return profiles.map((profile) => {
    // Gemini provider 的 baseUrl/model 兜默认必须用 Gemini 端点/模型,否则空 baseUrl 会被强制写成
    // OpenAI 默认 URL,保存后 Gemini 请求打到错误端点(...profile spread 已带 provider,normalize 读取)
    const isGemini = profile.provider === 'gemini'
    return normalizeOptimizerProfile({
      ...profile,
      name: profile.name.trim() || (profile.id === DEFAULT_OPTIMIZER_PROFILE_ID ? '默认' : '新配置'),
      baseUrl: profile.baseUrl.trim() || (isGemini ? DEFAULT_GEMINI_BASE_URL : DEFAULT_SETTINGS.baseUrl),
      apiKey: profile.apiKey.trim(),
      model: profile.model.trim() || (isGemini ? DEFAULT_GEMINI_CHAT_MODEL : ''),
    })
  })
}

/** 保存时对图说器配置组逐个兜底,规则与优化器一致(Gemini 端点/模型默认值同样区分) */
export function normalizeCaptionerProfilesForSave(
  profiles: CaptionerProfile[],
): CaptionerProfile[] {
  return profiles.map((profile) => {
    const isGemini = profile.provider === 'gemini'
    return normalizeCaptionerProfile({
      ...profile,
      name: profile.name.trim() || (profile.id === DEFAULT_CAPTIONER_PROFILE_ID ? '默认' : '新配置'),
      baseUrl: profile.baseUrl.trim() || (isGemini ? DEFAULT_GEMINI_BASE_URL : DEFAULT_SETTINGS.baseUrl),
      apiKey: profile.apiKey.trim(),
      model: profile.model.trim() || (isGemini ? DEFAULT_GEMINI_CHAT_MODEL : ''),
    })
  })
}

/**
 * 保存时的非空兜底 + 激活 id 解析:
 * 配置组为空则放入 fallback;原激活项已不在组内(被删除)时回退到第一项。
 */
export function ensureProfilesWithActive<P extends { id: string }>(
  normalized: P[],
  fallback: P,
  requestedActiveId: string,
): { profiles: P[]; activeId: string } {
  const profiles = normalized.length ? normalized : [fallback]
  const activeId = profiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : profiles[0].id
  return { profiles, activeId }
}

/** flush 阶段把 normalize 后的 timeout 写回对应 profiles 数组中的激活项 */
export function applyTimeoutToProfiles<P extends { id: string; timeout: number }>(
  profiles: P[],
  activeProfileId: string,
  timeout: number,
): P[] {
  return profiles.map((profile) =>
    profile.id === activeProfileId ? { ...profile, timeout } : profile,
  )
}
