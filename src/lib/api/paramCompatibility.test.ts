import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../../types'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import {
  getOutputImageLimitForSettings,
  MAX_TASK_PARAM_STRING_LEN,
  normalizeParamsForSettings,
} from './paramCompatibility'

describe('parameter compatibility', () => {
  it('limits OpenAI output count to 10', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('normalizes output count to a finite integer within the supported range', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 1.7 }, settings).n).toBe(2)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 0 }, settings).n).toBe(1)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: Number.NaN }, settings).n).toBe(1)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 99 }, settings).n).toBe(10)
  })

  it('normalizes output compression to supported image API values', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    expect(
      normalizeParamsForSettings(
        { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: -12 },
        settings,
      ).output_compression,
    ).toBe(0)
    expect(
      normalizeParamsForSettings(
        { ...DEFAULT_PARAMS, output_format: 'webp', output_compression: 150 },
        settings,
      ).output_compression,
    ).toBe(100)
    expect(
      normalizeParamsForSettings(
        { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 42.7 },
        settings,
      ).output_compression,
    ).toBe(43)
    expect(
      normalizeParamsForSettings(
        { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: Number.NaN },
        settings,
      ).output_compression,
    ).toBeNull()
    expect(
      normalizeParamsForSettings(
        { ...DEFAULT_PARAMS, output_format: 'png', output_compression: 80 },
        settings,
      ).output_compression,
    ).toBeNull()
  })

  it('falls back invalid enum params to supported defaults', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    const normalized = normalizeParamsForSettings(
      {
        ...DEFAULT_PARAMS,
        quality: 'ultra' as TaskParams['quality'],
        output_format: 'gif' as TaskParams['output_format'],
        output_compression: 80,
        moderation: 'strict' as TaskParams['moderation'],
      },
      settings,
    )

    expect(normalized).toMatchObject({
      quality: DEFAULT_PARAMS.quality,
      output_format: DEFAULT_PARAMS.output_format,
      output_compression: DEFAULT_PARAMS.output_compression,
      moderation: DEFAULT_PARAMS.moderation,
    })
  })

  it('caps string params before persisting or rendering unknown values', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)
    const long = 'x'.repeat(MAX_TASK_PARAM_STRING_LEN + 50)

    const normalized = normalizeParamsForSettings(
      { ...DEFAULT_PARAMS, size: long, stylePreset: long },
      settings,
    )

    expect(normalized.size).toHaveLength(MAX_TASK_PARAM_STRING_LEN)
    expect(normalized.stylePreset).toHaveLength(MAX_TASK_PARAM_STRING_LEN)
  })
})
