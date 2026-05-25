import { DEFAULT_IMAGES_MODEL, DEFAULT_RESPONSES_MODEL } from '../../lib/api/apiProfiles'
import type { AppSettings } from '../../types'

export function getDefaultModelForMode(apiMode: AppSettings['apiMode']) {
  return apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL
}
