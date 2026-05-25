import type { StateCreator } from 'zustand'
import type { AppSettings } from '../../types'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../lib/api/apiProfiles'
import type { AppState } from '../index'

export interface SettingsSlice {
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set) => ({
  // Settings
  settings: { ...DEFAULT_SETTINGS },
  setSettings: (s) => set((st) => {
    const previous = normalizeSettings(st.settings)
    const incoming = s as Partial<AppSettings>
    const hasLegacyOverrides =
      incoming.baseUrl !== undefined ||
      incoming.apiKey !== undefined ||
      incoming.model !== undefined ||
      incoming.timeout !== undefined ||
      incoming.apiMode !== undefined ||
      incoming.codexCli !== undefined ||
      incoming.apiProxy !== undefined
    const merged = normalizeSettings({ ...previous, ...incoming })
    if (hasLegacyOverrides && incoming.profiles === undefined) {
      merged.profiles = merged.profiles.map((profile) => {
        if (profile.id !== merged.activeProfileId) return profile
        const baseOverrides = {
          baseUrl: incoming.baseUrl ?? profile.baseUrl,
          apiKey: incoming.apiKey ?? profile.apiKey,
          model: incoming.model ?? profile.model,
          timeout: incoming.timeout ?? profile.timeout,
        }
        if (profile.provider === 'openai') {
          return {
            ...profile,
            ...baseOverrides,
            apiMode:
              incoming.apiMode === 'images' || incoming.apiMode === 'responses'
                ? incoming.apiMode
                : profile.apiMode,
            codexCli: incoming.codexCli ?? profile.codexCli,
            apiProxy: incoming.apiProxy ?? profile.apiProxy,
          }
        }
        return { ...profile, ...baseOverrides }
      })
    }
    return { settings: normalizeSettings(merged) }
  }),
  dismissedCodexCliPrompts: [],
  dismissCodexCliPrompt: (key) => set((st) => ({
    dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
      ? st.dismissedCodexCliPrompts
      : [...st.dismissedCodexCliPrompts, key],
  })),
})
