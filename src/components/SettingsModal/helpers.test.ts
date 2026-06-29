import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../lib/api/apiProfiles'
import { normalizeApiProfilesForSave } from './helpers'

describe('normalizeApiProfilesForSave', () => {
  it('normalizes non-positive timeouts to the API default', () => {
    const [openai, gemini] = normalizeApiProfilesForSave(
      [
        {
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'openai-negative',
          timeout: -1,
        },
        {
          provider: 'gemini',
          id: 'gemini-zero',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'key',
          model: 'gemini-2.5-flash-image',
          timeout: 0,
        },
      ],
      true,
    )

    expect(openai.timeout).toBe(DEFAULT_SETTINGS.timeout)
    expect(gemini.timeout).toBe(DEFAULT_SETTINGS.timeout)
  })
})
