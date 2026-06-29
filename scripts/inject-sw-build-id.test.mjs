import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  generateBuildId,
  injectBuildId,
  injectPrecacheManifest,
  listPrecacheAssets,
  readGitShortHash,
} from './inject-sw-build-id.mjs'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('generateBuildId', () => {
  it('combines git short hash and timestamp', () => {
    expect(generateBuildId({ gitHash: 'a1b2c3d', now: 1716284400000 })).toBe(
      'a1b2c3d-1716284400000',
    )
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

describe('readGitShortHash', () => {
  it('prefers GIT_COMMIT from Docker build args before shelling out to git', () => {
    vi.stubEnv('GIT_COMMIT', 'deadbee')

    expect(readGitShortHash()).toBe('deadbee')
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
    expect(() => injectBuildId(`const CACHE_NAME = 'already-replaced'`, 'h-1')).toThrow(
      /找不到占位符/,
    )
  })
})

describe('injectPrecacheManifest', () => {
  it('replaces the precache placeholder with a JSON asset array', () => {
    const sw = `const PRECACHE_MANIFEST = '__PRECACHE_MANIFEST__'`

    expect(injectPrecacheManifest(sw, ['./assets/index-a.js', './assets/index-b.css'])).toBe(
      `const PRECACHE_MANIFEST = '["./assets/index-a.js","./assets/index-b.css"]'`,
    )
  })

  it('throws when the precache placeholder is missing', () => {
    expect(() => injectPrecacheManifest(`const PRECACHE_MANIFEST = '[]'`, [])).toThrow(
      /预缓存清单注入失败/,
    )
  })

  it('rejects asset names that cannot be embedded in the quoted service-worker string', () => {
    expect(() => injectPrecacheManifest(`'__PRECACHE_MANIFEST__'`, [`./assets/bad'.js`])).toThrow(
      /单引号/,
    )
  })
})

describe('listPrecacheAssets', () => {
  it('returns sorted dist asset paths and ignores nested directories', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'image-playground-assets-'))
    const assetsDir = join(dir, 'assets')
    await mkdir(assetsDir)
    await writeFile(join(assetsDir, 'b.js'), '')
    await writeFile(join(assetsDir, 'a.css'), '')
    await mkdir(join(assetsDir, 'nested'))

    expect(listPrecacheAssets(dir)).toEqual(['./assets/a.css', './assets/b.js'])
  })
})
