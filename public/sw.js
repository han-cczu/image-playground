// 下方字符串占位符（双下划线 CACHE_NAME 双下划线）在构建后由 scripts/inject-sw-build-id.mjs
// 替换为 image-playground-<git-hash>-<timestamp>。注释里有意不重复写出该字面量，
// 避免被注入脚本顺带替换掉，破坏 dist/sw.js 注释的可读性。
// 校验：构建结束时若 dist/sw.js 中仍存在该占位符字面量，构建脚本会 exit 1。
const CACHE_NAME = '__CACHE_NAME__'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-icon.svg']
// 构建后由 inject-sw-build-id.mjs 替换为 dist/assets/ 全部 hashed 文件的 JSON 数组字符串。
// 此前 install 只预缓存 APP_SHELL,hashed JS/CSS 全靠 fetch 期 runtime-cache——离线保障是
// 「部分缓存」:刚部署完(activate 删旧缓存)就离线的用户拿到 index.html 却拿不到它引用的
// assets,白屏。开发态占位符未替换 → 解析为空数组,行为与替换前一致。
const PRECACHE_MANIFEST = '__PRECACHE_MANIFEST__'
const PRECACHE_ASSETS = PRECACHE_MANIFEST.startsWith('[') ? JSON.parse(PRECACHE_MANIFEST) : []

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
    // 任一资源 404 则 install 失败、旧 SW 继续服务(addAll 的原子语义,符合预期:
    // 宁可不切换也不要半套缓存)。新缓存在 install 期写满,activate 删旧缓存才是安全的。
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...PRECACHE_ASSETS])),
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
          // 仅缓存内容寻址的 hashed 静态资源(/assets/);其余同源 GET 只走网络不写缓存,
          // 避免运行时缓存对所有同源 GET 无限 cache.put(单次部署生命周期内只增不减、可能逼近配额)。
          if (response.ok && url.pathname.includes('/assets/')) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
      }),
    )
  })
}
