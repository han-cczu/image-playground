import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function loadServiceWorker({ caches, fetch, location = 'https://example.test/sw.js' }) {
  const listeners = new Map()
  const locationUrl = new URL(location)
  const self = {
    location: { href: locationUrl.href, origin: locationUrl.origin },
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(),
    },
    registration: {
      unregister: vi.fn(),
    },
  }

  vm.runInNewContext(readFileSync(resolve('public/sw.js'), 'utf8'), {
    self,
    caches,
    fetch,
    URL,
    Promise,
    Response,
  })

  return { listeners, self }
}

describe('service worker runtime cache', () => {
  it('keeps clients.claim inside the activate lifetime promise', async () => {
    const deletePromise = Promise.resolve(true)
    let resolveClaim
    const claimPromise = new Promise((resolve) => {
      resolveClaim = resolve
    })
    const caches = {
      match: vi.fn(),
      open: vi.fn(),
      keys: vi.fn(() => Promise.resolve(['old-cache'])),
      delete: vi.fn(() => deletePromise),
    }
    const fetch = vi.fn()
    const { listeners, self } = loadServiceWorker({ caches, fetch })
    self.clients.claim = vi.fn(() => claimPromise)
    let waitUntilPromise

    listeners.get('activate')({
      waitUntil: vi.fn((promise) => {
        waitUntilPromise = promise
      }),
    })

    await Promise.all([deletePromise, new Promise((resolve) => setTimeout(resolve, 0))])
    let settled = false
    waitUntilPromise.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    resolveClaim()
    await expect(waitUntilPromise).resolves.toBeUndefined()
    expect(self.clients.claim).toHaveBeenCalledTimes(1)
  })

  it('attaches a rejection handler to fire-and-forget asset cache writes', async () => {
    const cacheWriteChain = {
      catch: vi.fn(() => Promise.resolve()),
    }
    const cache = {
      put: vi.fn(() => Promise.reject(new Error('quota exceeded'))),
    }
    const caches = {
      match: vi.fn(() => Promise.resolve(undefined)),
      open: vi.fn(() => ({
        then: vi.fn((onFulfilled) => {
          onFulfilled(cache)
          return cacheWriteChain
        }),
      })),
      keys: vi.fn(),
      delete: vi.fn(),
    }
    const networkResponse = new Response('asset', { status: 200 })
    const fetch = vi.fn(() => Promise.resolve(networkResponse))
    const { listeners } = loadServiceWorker({ caches, fetch })
    let responsePromise

    listeners.get('fetch')({
      request: new Request('https://example.test/assets/index.js', { method: 'GET' }),
      respondWith: vi.fn((promise) => {
        responsePromise = promise
      }),
    })

    await expect(responsePromise).resolves.toBe(networkResponse)
    expect(cache.put).toHaveBeenCalled()
    expect(cacheWriteChain.catch).toHaveBeenCalled()
  })

  it('runtime-caches assets under the service-worker subpath scope', async () => {
    const cacheWriteChain = {
      catch: vi.fn(() => Promise.resolve()),
    }
    const cache = {
      put: vi.fn(() => Promise.resolve()),
    }
    const caches = {
      match: vi.fn(() => Promise.resolve(undefined)),
      open: vi.fn(() => ({
        then: vi.fn((onFulfilled) => {
          onFulfilled(cache)
          return cacheWriteChain
        }),
      })),
      keys: vi.fn(),
      delete: vi.fn(),
    }
    const networkResponse = new Response('asset', { status: 200 })
    const fetch = vi.fn(() => Promise.resolve(networkResponse))
    const { listeners } = loadServiceWorker({
      caches,
      fetch,
      location: 'https://example.test/app/sw.js',
    })
    let responsePromise

    listeners.get('fetch')({
      request: new Request('https://example.test/app/assets/index.js', { method: 'GET' }),
      respondWith: vi.fn((promise) => {
        responsePromise = promise
      }),
    })

    await expect(responsePromise).resolves.toBe(networkResponse)
    expect(cache.put).toHaveBeenCalled()
  })

})
