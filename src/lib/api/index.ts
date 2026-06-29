import type { ApiProfile, AppSettings } from '../../types'
import { isOpenAIProfile } from '../../types'
import { getActiveApiProfile } from './apiProfiles'
import { callGeminiImageApi } from './geminiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { normalizeParamsForSettings } from './paramCompatibility'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

function settingsWithActiveProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const profiles = settings.profiles.some((candidate) => candidate.id === profile.id)
    ? settings.profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate))
    : [profile, ...settings.profiles]
  return {
    ...settings,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: isOpenAIProfile(profile) ? profile.apiMode : 'images',
    codexCli: isOpenAIProfile(profile) ? profile.codexCli : false,
    apiProxy: isOpenAIProfile(profile) ? profile.apiProxy : false,
    profiles,
    activeProfileId: profile.id,
  }
}

/**
 * 按 provider 分流到对应实现。profileOverride 供 executeTask 传入「任务入队时固化的 profile」,
 * 保证排队中的批量任务不随 active profile 的切换漂移;缺省回退 active profile(优化器/反推等
 * 即时调用路径不受影响)。
 */
export async function callImageApi(opts: CallApiOptions, profileOverride?: ApiProfile): Promise<CallApiResult> {
  const profile = profileOverride ?? getActiveApiProfile(opts.settings)
  const normalizedOpts: CallApiOptions = {
    ...opts,
    params: normalizeParamsForSettings(opts.params, settingsWithActiveProfile(opts.settings, profile)),
  }
  if (profile.provider === 'gemini') return callGeminiImageApi(normalizedOpts, profile)

  return callOpenAICompatibleImageApi(normalizedOpts, profile)
}
