import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * 弹窗焦点陷阱:打开时把焦点移入容器,Tab/Shift+Tab 在容器内首尾环绕,关闭/卸载时还原打开前的焦点。
 * 容器需带 tabIndex={-1} 以便无可聚焦子元素时承接焦点。ESC 关闭由 useCloseOnEscape 全局栈负责,本 hook 不重复处理。
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return
    const node = containerRef.current
    if (!node) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const getFocusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      )

    // 打开时焦点移入弹窗(优先首个可聚焦元素,否则容器自身),避免焦点滞留在背景
    const first = getFocusable()[0]
    ;(first ?? node).focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey && (activeEl === firstEl || activeEl === node)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      // 还原焦点到打开弹窗前的元素(若仍在文档中)
      previouslyFocused?.focus?.()
    }
  }, [active, containerRef])
}
