import type { ApiProfile } from '../../types'
import { getActiveApiProfile } from './apiProfiles'
import { callGeminiImageApi } from './geminiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

/**
 * 按 provider 分流到对应实现。profileOverride 供 executeTask 传入「任务入队时固化的 profile」,
 * 保证排队中的批量任务不随 active profile 的切换漂移;缺省回退 active profile(优化器/反推等
 * 即时调用路径不受影响)。
 */
export async function callImageApi(opts: CallApiOptions, profileOverride?: ApiProfile): Promise<CallApiResult> {
  const profile = profileOverride ?? getActiveApiProfile(opts.settings)
  if (profile.provider === 'gemini') return callGeminiImageApi(opts, profile)

  return callOpenAICompatibleImageApi(opts, profile)
}
