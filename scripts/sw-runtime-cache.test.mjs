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

describe('service worker runtime cache scope', () => {
  // 原 sw-routing.mjs 是与 sw.js 手工复制的镜像逻辑,测试只在验证镜像本身;
  // 这里直接加载 public/sw.js 断言真实路由行为,镜像文件已删除。
  function cachesWithSpy() {
    const cache = { put: vi.fn(() => Promise.resolve()) }
    return {
      cache,
      caches: {
        match: vi.fn(() => Promise.resolve(undefined)),
        open: vi.fn(() => Promise.resolve(cache)),
        keys: vi.fn(),
        delete: vi.fn(),
      },
    }
  }

  async function fetchThrough(listeners, url, extra = {}) {
    let responsePromise
    const handled = listeners.get('fetch')({
      request: new Request(url, { method: 'GET', ...extra }),
      respondWith: vi.fn((promise) => {
        responsePromise = promise
      }),
    })
    return { handled, responsePromise }
  }

  it('跨域 GET 不拦截、不写缓存', async () => {
    const { caches, cache } = cachesWithSpy()
    const fetch = vi.fn(() => Promise.resolve(new Response('asset', { status: 200 })))
    const { listeners } = loadServiceWorker({ caches, fetch })
    const { responsePromise } = await fetchThrough(listeners, 'https://cdn.example.test/assets/index-abc.js')

    expect(responsePromise).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('同源非 /assets/ 路径与 scope 之外的 /assets/ 只走网络不写缓存', async () => {
    const { caches, cache } = cachesWithSpy()
    const fetch = vi.fn(() => Promise.resolve(new Response('body', { status: 200 })))
    const { listeners } = loadServiceWorker({ caches, fetch, location: 'https://example.test/app/sw.js' })

    const api = await fetchThrough(listeners, 'https://example.test/api/tasks')
    await api.responsePromise
    const otherScope = await fetchThrough(listeners, 'https://example.test/other/assets/index-abc.js')
    await otherScope.responsePromise

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('托管层对缺失 /assets/* 回 index.html 200 时不把 HTML 当静态资源缓存', async () => {
    const { caches, cache } = cachesWithSpy()
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      ),
    )
    const { listeners } = loadServiceWorker({ caches, fetch })
    const { responsePromise } = await fetchThrough(listeners, 'https://example.test/assets/missing-abc.js')
    await responsePromise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(cache.put).not.toHaveBeenCalled()
  })
})

describe('service worker offline navigation fallback', () => {
  function navigateEvent() {
    let responsePromise
    const event = {
      request: { method: 'GET', mode: 'navigate', url: 'https://example.test/' },
      respondWith: vi.fn((promise) => {
        responsePromise = promise
      }),
    }
    return { event, response: () => responsePromise }
  }

  it('离线导航优先用 scope 根 "./" 的缓存(Workers 上 /index.html 是 307 重定向,缓存条目不能用于响应导航)', async () => {
    const shell = new Response('<html>shell</html>', { status: 200 })
    const caches = {
      match: vi.fn((key) => Promise.resolve(key === './' ? shell : undefined)),
      open: vi.fn(),
      keys: vi.fn(),
      delete: vi.fn(),
    }
    const fetch = vi.fn(() => Promise.reject(new TypeError('offline')))
    const { listeners } = loadServiceWorker({ caches, fetch })
    const { event, response } = navigateEvent()

    listeners.get('fetch')(event)

    await expect(response()).resolves.toBe(shell)
    expect(caches.match.mock.calls[0][0]).toBe('./')
  })

  it('scope 根缓存缺失时才回退到 "./index.html"', async () => {
    const legacyShell = new Response('<html>legacy</html>', { status: 200 })
    const caches = {
      match: vi.fn((key) => Promise.resolve(key === './index.html' ? legacyShell : undefined)),
      open: vi.fn(),
      keys: vi.fn(),
      delete: vi.fn(),
    }
    const fetch = vi.fn(() => Promise.reject(new TypeError('offline')))
    const { listeners } = loadServiceWorker({ caches, fetch })
    const { event, response } = navigateEvent()

    listeners.get('fetch')(event)

    await expect(response()).resolves.toBe(legacyShell)
    expect(caches.match.mock.calls.map((call) => call[0])).toEqual(['./', './index.html'])
  })
})
