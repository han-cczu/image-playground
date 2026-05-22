import { describe, expect, it } from 'vitest'
import { buildFinalPrompt, STYLE_PRESETS } from './stylePresets'

describe('buildFinalPrompt', () => {
  it('returns the original prompt when stylePreset is undefined (no style)', () => {
    expect(buildFinalPrompt('cat', undefined)).toBe('cat')
  })

  it('prepends the english modifier of the matched preset, separated by ", "', () => {
    expect(buildFinalPrompt('cat', 'film')).toBe(
      'shot on 35mm film, kodak portra 400, grainy, soft contrast, vintage, cat',
    )
  })

  it('falls back to the original prompt for an unknown stylePreset key', () => {
    expect(buildFinalPrompt('cat', 'invalid-key')).toBe('cat')
  })

  it('treats an empty-string stylePreset as no style', () => {
    expect(buildFinalPrompt('cat', '')).toBe('cat')
  })

  it('keeps the original prompt verbatim (no trimming, no rewriting)', () => {
    const raw = '  hello world  '
    expect(buildFinalPrompt(raw, undefined)).toBe(raw)
    expect(buildFinalPrompt(raw, 'photoreal')).toBe(`${STYLE_PRESETS.photoreal.prompt}, ${raw}`)
  })

  it('does not treat Object.prototype keys as valid stylePreset', () => {
    // `in` operator would walk the prototype chain and match these keys; hasOwn guards against it
    expect(buildFinalPrompt('cat', '__proto__')).toBe('cat')
    expect(buildFinalPrompt('cat', 'toString')).toBe('cat')
    expect(buildFinalPrompt('cat', 'constructor')).toBe('cat')
    expect(buildFinalPrompt('cat', 'hasOwnProperty')).toBe('cat')
  })
})
