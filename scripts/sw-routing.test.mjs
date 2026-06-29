import { describe, expect, it } from 'vitest'
import { shouldRuntimeCache } from './sw-routing.mjs'

const serviceWorkerUrl = 'https://example.test/sw.js'

describe('shouldRuntimeCache', () => {
  it('only caches same-origin GET assets', () => {
    expect(
      shouldRuntimeCache({
        method: 'GET',
        requestUrl: 'https://example.test/assets/index-abc.js',
        serviceWorkerUrl,
      }),
    ).toBe(true)
    expect(
      shouldRuntimeCache({
        method: 'GET',
        requestUrl: 'https://example.test/api/tasks',
        serviceWorkerUrl,
      }),
    ).toBe(false)
    expect(
      shouldRuntimeCache({
        method: 'POST',
        requestUrl: 'https://example.test/assets/index-abc.js',
        serviceWorkerUrl,
      }),
    ).toBe(false)
    expect(
      shouldRuntimeCache({
        method: 'GET',
        requestUrl: 'https://cdn.example.test/assets/index-abc.js',
        serviceWorkerUrl,
      }),
    ).toBe(false)
  })

  it('caches same-origin assets under a subpath deployment scope', () => {
    expect(
      shouldRuntimeCache({
        method: 'GET',
        requestUrl: 'https://example.test/app/assets/index-abc.js',
        serviceWorkerUrl: 'https://example.test/app/sw.js',
      }),
    ).toBe(true)

    expect(
      shouldRuntimeCache({
        method: 'GET',
        requestUrl: 'https://example.test/other/assets/index-abc.js',
        serviceWorkerUrl: 'https://example.test/app/sw.js',
      }),
    ).toBe(false)
  })
})
