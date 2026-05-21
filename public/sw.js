// 下方字符串占位符（双下划线 CACHE_NAME 双下划线）在构建后由 scripts/inject-sw-build-id.mjs
// 替换为 image-playground-<git-hash>-<timestamp>。注释里有意不重复写出该字面量，
// 避免被注入脚本顺带替换掉，破坏 dist/sw.js 注释的可读性。
// 校验：构建结束时若 dist/sw.js 中仍存在该占位符字面量，构建脚本会 exit 1。
const CACHE_NAME = '__CACHE_NAME__'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-icon.svg']

// kill-switch 是单向逃生通道：部署翻车（旧 SW 把用户锁死）时把下方常量改成 true 部署一次，
// 已注册旧 SW 的浏览器在下次访问时会自动 unregister 并强制刷新所有 tab，从而回到无 SW 拦截的正常网络。
// 确认全部用户都恢复后，再把该常量改回 false 部署正常版本。
const KILL_SWITCH = false

if (KILL_SWITCH) {
  // 逃生分支：跳过所有缓存逻辑，只注册 install + activate，绝不注册 fetch 监听，
  // 让浏览器走正常网络。注册 fetch 监听会让逃生分支重新具备拦截能力，与本分支目的相违。
  self.addEventListener('install', () => {
    self.skipWaiting()
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        // 先 claim 让本 SW 接管已注册旧 SW 控制的所有 client；否则 matchAll 默认只列出本 SW 已控制的
        // client（旧 SW 还在控制时为空），navigate 会被空数组吞掉，逃生分支形同虚设。
        await self.clients.claim()
        await self.registration.unregister()
        // includeUncontrolled: true 双保险，覆盖 claim 时序窗口里仍未被本 SW 控制的窗口。
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        // 单个 client.navigate() 在极端场景（client detached / cross-origin redirect 后等）会 reject，
        // 用 allSettled 隔离失败，避免某个 tab 失败把整个 activate Promise 拒绝、其他 tab 也救不回来。
        await Promise.allSettled(windows.map((c) => c.navigate(c.url)))
      })(),
    )
  })
} else {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
    )
    self.skipWaiting()
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
    )
    self.clients.claim()
  })

  self.addEventListener('fetch', (event) => {
    const { request } = event

    if (request.method !== 'GET') return

    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    if (request.mode === 'navigate') {
      // HTML 不写回缓存：在线时永远拿网络版本，避免旧 HTML 引用已删除的 hashed assets 文件名导致白屏。
      // 离线兜底由 install 阶段的 cache.addAll(['./index.html', ...]) 提供，会在下次部署的 activate 时随 CACHE_NAME 切换而刷新。
      event.respondWith(
        fetch(request).catch(() => caches.match('./index.html')),
      )
      return
    }

    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached

        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
      }),
    )
  })
}
