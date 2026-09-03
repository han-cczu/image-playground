import React, { useEffect, useState, useRef } from 'react'
import { useStore, addImageFromUrl, ensureImageCached } from '../store'
import { copyBlobToClipboard, getClipboardFailureMessage } from '../lib/image/clipboard'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { assertImagePixelLimit, MAX_INPUT_IMAGE_BYTES } from '../lib/taskRuntime'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from '../lib/tasks'

const MENU_IMAGE_FETCH_TIMEOUT_MS = 60_000

function assertMenuImageSize(bytes: number) {
  if (bytes > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
}

function assertResponseImageSize(res: Response) {
  const contentLength = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(contentLength)) assertMenuImageSize(contentLength)
}

function createAbortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

function readBlobWithAbort(response: Response, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw createAbortError()
  if (!response.body) {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(createAbortError())
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        response
          .blob()
          .then(resolve, reject)
          .finally(() => {
            signal.removeEventListener('abort', onAbort)
          })
      } catch (err) {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    })
  }

  return new Promise((resolve, reject) => {
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      try {
        reader.releaseLock()
      } catch {
        /* Ignore cleanup errors; abort/read failures carry the useful signal. */
      }
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onAbort = () => {
      void reader.cancel().catch(() => undefined)
      finish(() => reject(createAbortError()))
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const pump = (): void => {
      try {
        reader.read().then(
          ({ done, value }) => {
            if (done) {
              finish(() =>
                resolve(
                  new Blob(
                    chunks.map((chunk) => new Uint8Array(chunk)),
                    { type: response.headers.get('Content-Type') || 'application/octet-stream' },
                  ),
                ),
              )
              return
            }
            if (value) {
              bytes += value.byteLength
              if (bytes > MAX_INPUT_IMAGE_BYTES) {
                void reader.cancel().catch(() => undefined)
                finish(() =>
                  reject(
                    new Error(
                      `图片过大:超过 ${Math.round(MAX_INPUT_IMAGE_BYTES / 1024 / 1024)}MB 上限`,
                    ),
                  ),
                )
                return
              }
              chunks.push(value)
            }
            pump()
          },
          (err) => finish(() => reject(err)),
        )
      } catch (err) {
        finish(() => reject(err))
      }
    }
    pump()
  })
}

async function fetchImageBlobForMenu(src: string): Promise<Blob> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MENU_IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(src, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    assertResponseImageSize(res)
    const blob = await readBlobWithAbort(res, controller.signal)
    if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片文件')
    assertMenuImageSize(blob.size)
    return blob
  } catch (err) {
    if (controller.signal.aborted) throw new Error('图片读取超时', { cause: err })
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export default function ImageContextMenu() {
  const [menuInfo, setMenuInfo] = useState<{
    src: string
    imageId?: string
    x: number
    y: number
  } | null>(null)
  const inputImages = useStore((s) => s.inputImages)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const setCaptionSource = useStore((s) => s.setCaptionSource)
  const captionerKeyConfigured = useStore((s) => Boolean(s.settings.captioner.apiKey.trim()))
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isEmbeddedPage()) return

    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target && target.tagName === 'IMG') {
        const imgTarget = target as HTMLImageElement
        // 忽略没有 src 或空的 img
        if (!imgTarget.src) return

        // iOS 触控设备上，放行原生长按菜单（以支持原生保存图片）
        const isIOS =
          /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        const isTouch = window.matchMedia('(pointer: coarse)').matches
        if (isIOS && isTouch) return

        e.preventDefault()
        setMenuInfo({
          src: imgTarget.src,
          // 封面已 objectURL 化(H3):blob URL 在菜单打开期间可能因卡片卸载被 revoke,
          // 携带 data-image-id 的图后续动作优先按 id 重取,自包含不受 revoke 影响
          imageId: imgTarget.dataset.imageId || undefined,
          x: e.clientX,
          y: e.clientY,
        })
      }
    }

    // 监听全局 contextmenu，兼容桌面端右键和大部分移动端长按
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  // 点击其他地方、滚动或缩放时关闭菜单
  useEffect(() => {
    if (!menuInfo) return
    const close = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return
      }
      if (e.target instanceof Element && e.target.closest('[data-lightbox-root]')) {
        window.dispatchEvent(new Event('image-context-menu-dismiss-lightbox-click'))
      }
      setMenuInfo(null)
    }
    window.addEventListener('mousedown', close, { capture: true })
    window.addEventListener('touchstart', close, { capture: true })
    window.addEventListener('wheel', close, { capture: true })
    window.addEventListener('scroll', close, { capture: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close, { capture: true })
      window.removeEventListener('touchstart', close, { capture: true })
      window.removeEventListener('wheel', close, { capture: true })
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [menuInfo])

  // ESC 走全局 escStack:此前自建监听绕过栈,在 Lightbox 上右键开菜单后按一次 Esc 会把菜单
  // 和 Lightbox 一起关掉(栈语义:Esc 只关最顶层;菜单后开,注册在栈顶,先于 Lightbox 响应)
  useCloseOnEscape(Boolean(menuInfo), () => setMenuInfo(null))

  // 打开时把焦点移入菜单首项,便于键盘用户操作(置于早退之前以保证 hook 顺序稳定)。
  useEffect(() => {
    if (!menuInfo) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [menuInfo])

  if (!menuInfo) return null

  /** 取菜单目标图的可 fetch URL:带 imageId 时按 id 重取(blob: src 可能已被 revoke),否则原样用 src */
  const resolveMenuImageUrl = async (): Promise<string> => {
    if (menuInfo.imageId) {
      const dataUrl = await ensureImageCached(menuInfo.imageId)
      if (dataUrl) return dataUrl
    }
    return menuInfo.src
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    try {
      // 不先 await 取图:把整条取图链交给 copyBlobToClipboard,让 clipboard.write 留在点击手势的同步段内(Safari)
      await copyBlobToClipboard(resolveMenuImageUrl().then(fetchImageBlobForMenu))
      useStore.getState().showToast('图片已复制', 'success')
    } catch (err) {
      console.error(err)
      useStore.getState().showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    try {
      const blob = await fetchImageBlobForMenu(await resolveMenuImageUrl())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      let appended = false
      try {
        a.href = url
        const ext = blob.type.split('/')[1] || 'png'
        a.download = `image-${Date.now()}.${ext}`
        document.body.appendChild(a)
        appended = true
        a.click()
      } finally {
        if (appended) document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
      useStore.getState().showToast('开始下载', 'success')
    } catch (err) {
      console.error(err)
      useStore.getState().showToast('下载失败', 'error')
    }
  }

  const handleEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    if (inputImages.length >= MAX_INPUT_IMAGES_PER_SUBMISSION) {
      useStore
        .getState()
        .showToast(
          `参考图数量已达上限（${MAX_INPUT_IMAGES_PER_SUBMISSION} 张），无法继续添加`,
          'error',
        )
      return
    }

    try {
      await addImageFromUrl(await resolveMenuImageUrl())
      setDetailTaskId(null)
      setLightboxImageId(null)
      setMaskEditorImageId(null)
      useStore.getState().showToast('已加入参考图', 'success')
    } catch (err) {
      console.error(err)
      useStore
        .getState()
        .showToast(`加入参考图失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleCaption = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    if (!captionerKeyConfigured) {
      useStore.getState().showToast('反推提示词 API 尚未配置，请在设置中配置后再试', 'error')
      return
    }
    try {
      const blob = await fetchImageBlobForMenu(await resolveMenuImageUrl())
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      await assertImagePixelLimit(dataUrl)
      setDetailTaskId(null)
      setLightboxImageId(null)
      setMaskEditorImageId(null)
      setCaptionSource(dataUrl)
    } catch (err) {
      console.error(err)
      useStore
        .getState()
        .showToast(`反推失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  // 保证菜单在视口内
  let left = menuInfo.x
  let top = menuInfo.y
  const MENU_WIDTH = 120
  const MENU_HEIGHT = 160 // 四个按钮高度加 padding

  if (left + MENU_WIDTH > window.innerWidth) {
    left -= MENU_WIDTH
  }
  // 贴近视口底部时菜单翻到光标上方,入场动画方向跟随翻转(transform-origin 贴向光标侧)
  let openUp = false
  if (top + MENU_HEIGHT > window.innerHeight) {
    top -= MENU_HEIGHT
    openUp = true
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="图片操作"
      className={`fixed z-[9999] w-[120px] overflow-hidden rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 ${
        openUp ? 'animate-dropdown-up' : 'animate-dropdown-down'
      }`}
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        role="menuitem"
        onClick={handleCopy}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
      >
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        复制
      </button>
      <button
        role="menuitem"
        onClick={handleDownload}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
      >
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        下载
      </button>
      <button
        role="menuitem"
        onClick={handleEdit}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
      >
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        编辑
      </button>
      <button
        role="menuitem"
        onClick={handleCaption}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
      >
        <svg
          className="w-4 h-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h6m-6 8l-3-3V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H8l-4 4z"
          />
        </svg>
        反推提示词
      </button>
    </div>
  )
}

function isEmbeddedPage() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
