import { useCallback, useEffect, useRef, useState } from 'react'
import { getCachedImage } from '../lib/imageCache'
import { acquireImageObjectUrl, releaseImageObjectUrl } from '../lib/objectUrlCache'

/**
 * 找最近的可滚动祖先作 IntersectionObserver root:桌面端卡片在 md:overflow-y-auto 的
 * 内层滚动容器(main)里,若 root 用默认 viewport,rootMargin 只扩张 viewport 矩形,
 * 目标先被滚动祖先裁剪——等效预载边距为 0,快速滚动会有明显的封面 pop-in。
 * TaskGridMatrix 的 overflow-x-auto 横向格子同理受益。
 */
function findScrollRoot(el: HTMLElement): Element | null {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX)) return node
    node = node.parentElement
  }
  return null
}

/**
 * 卡片封面的懒加载图源:
 * - IntersectionObserver 进入滚动容器附近(±600px)才发起加载——大库首渲不再对每张挂载卡
 *   各打一次 IDB 全量读(此前 RENDER_CAP=2000 张卡 mount 即全部读图);
 * - dataUrl LRU 命中(刚生成的图)先作首帧立显,随后仍以 objectURL 替换——否则每张卡的
 *   state 各 pin 一份数 MB base64 直到卸载,LRU 驱逐管不到组件 state,长会话连续生成
 *   数百张图就是数百 MB 不可回收堆占用(审查修正);
 * - objectURL 引用计数,卸载/换图即 release;src 按「加载时 imageId」派生,天然防旧请求
 *   后到串图;cleanup 同步失效已 release 的 cover——否则 imageId 经 undefined 回流到旧值
 *   (网格格代表随筛选切换)时,会把已 revoke 的 blob URL 渲染进 <img>(破图闪烁)。
 *
 * 返回 attachRef 挂到卡片根元素;不支持 IntersectionObserver 的环境(旧浏览器/测试)立即加载。
 */
export function useLazyCoverImage(imageId: string | undefined): {
  src: string
  attachRef: (el: HTMLElement | null) => void
} {
  const [cover, setCover] = useState<{ id: string; url: string } | null>(null)
  const [visible, setVisible] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const src = cover && imageId && cover.id === imageId ? cover.url : ''

  const attachRef = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
          observerRef.current = null
        }
      },
      { root: findScrollRoot(el), rootMargin: '600px' },
    )
    observer.observe(el)
    observerRef.current = observer
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  useEffect(() => {
    if (!imageId || !visible) return

    let cancelled = false
    let acquired = false
    void (async () => {
      // 让出一个微任务:保证 setCover 不在 effect 体内同步执行(避免级联渲染)
      await Promise.resolve()
      if (cancelled) return
      // LRU 命中作首帧立显(刚生成的图即时换封面),随后仍换成 objectURL 释放 base64
      const cached = getCachedImage(imageId)
      if (cached) setCover({ id: imageId, url: cached })
      const url = await acquireImageObjectUrl(imageId)
      if (cancelled) {
        // 组件已卸载/换图:立刻归还引用,避免泄漏
        if (url) releaseImageObjectUrl(imageId)
        return
      }
      if (url) {
        acquired = true
        setCover({ id: imageId, url })
      }
      // url 为 null(图已删)时保留 LRU 首帧(若有),不强行清空
    })()
    return () => {
      cancelled = true
      if (acquired) {
        releaseImageObjectUrl(imageId)
        // 引用已归还、URL 可能随之 revoke:同步失效匹配的 cover,
        // 防 imageId 回流到该值时把死 URL 渲染进 <img>
        setCover((current) => (current && current.id === imageId ? null : current))
      }
    }
  }, [imageId, visible])

  return { src, attachRef }
}
