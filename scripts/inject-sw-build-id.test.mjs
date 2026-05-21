import { describe, it, expect } from 'vitest'
import { generateBuildId, injectBuildId } from './inject-sw-build-id.mjs'

describe('generateBuildId', () => {
  it('combines git short hash and timestamp', () => {
    expect(generateBuildId({ gitHash: 'a1b2c3d', now: 1716284400000 })).toBe('a1b2c3d-1716284400000')
  })

  it('falls back to "nogit" when gitHash is null', () => {
    expect(generateBuildId({ gitHash: null, now: 1716284400000 })).toBe('nogit-1716284400000')
  })

  it('falls back to "nogit" when gitHash is malformed (not hex)', () => {
    expect(generateBuildId({ gitHash: 'fatal: not a git repo', now: 1 })).toBe('nogit-1')
  })

  it('two calls at different timestamps produce different ids even with same git hash', () => {
    const a = generateBuildId({ gitHash: 'a1b2c3d', now: 1 })
    const b = generateBuildId({ gitHash: 'a1b2c3d', now: 2 })
    expect(a).not.toBe(b)
  })
})

describe('injectBuildId', () => {
  it('replaces __CACHE_NAME__ placeholder with prefixed build id', () => {
    const sw = `const CACHE_NAME = '__CACHE_NAME__'\nconst x = 1`
    const { content, cacheName } = injectBuildId(sw, 'a1b2c3d-1')
    expect(cacheName).toBe('image-playground-a1b2c3d-1')
    expect(content).toBe(`const CACHE_NAME = 'image-playground-a1b2c3d-1'\nconst x = 1`)
  })

  it('replaces all occurrences if multiple', () => {
    const sw = `__CACHE_NAME__ x __CACHE_NAME__`
    const { content } = injectBuildId(sw, 'h-1')
    expect(content).toBe('image-playground-h-1 x image-playground-h-1')
  })

  it('throws when placeholder is missing (double injection guard)', () => {
    expect(() => injectBuildId(`const CACHE_NAME = 'already-replaced'`, 'h-1')).toThrow(/找不到占位符/)
  })
})
