import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * 陷阱栈:叠层弹窗(如 SettingsModal 上的 ConfirmDialog)各自持有 document 级监听,
 * 只有栈顶陷阱响应 Tab 与焦点回收——否则下层陷阱会把焦点从上层弹窗里抢走。
 * 后开的弹窗 effect 后执行、后入栈,天然位于栈顶。
 */
const trapStack: number[] = []
let nextTrapId = 0

/**
 * 弹窗焦点陷阱:打开时把焦点移入容器,Tab/Shift+Tab 在容器内首尾环绕,关闭/卸载时还原打开前的焦点。
 * 容器需带 tabIndex={-1} 以便无可聚焦子元素时承接焦点。ESC 关闭由 useCloseOnEscape 全局栈负责,本 hook 不重复处理。
 *
 * options.extraContainerRefs:portal 到容器外的附属面板(如遮罩编辑器的画笔尺寸面板)。
 * 监听挂 document 而非容器节点:portal 面板的 keydown 不会冒泡进容器;且持焦元素被
 * disable(如保存中禁用保存按钮)后焦点掉到 body,容器级监听对后续 Tab 完全失聪,
 * 焦点便从被遮挡的背景控件中穿行——document 级监听 + 「焦点不在环内即拉回」修复这两类逃逸。
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options?: { extraContainerRefs?: Array<RefObject<HTMLElement | null>> },
): void {
  // options 是每次渲染的新对象字面量,经 ref 透传避免主 effect 反复重建;
  // ref 写入放 effect 而非渲染期(react-hooks/refs),事件回调读取时必已同步
  const extraRefsRef = useRef(options?.extraContainerRefs)
  useEffect(() => {
    extraRefsRef.current = options?.extraContainerRefs
  })

  useEffect(() => {
    if (!active) return
    const node = containerRef.current
    if (!node) return

    const id = nextTrapId++
    trapStack.push(id)
    const previouslyFocused = document.activeElement as HTMLElement | null

    const getContainers = () => [
      node,
      ...(extraRefsRef.current ?? [])
        .map((ref) => ref.current)
        .filter((el): el is HTMLElement => Boolean(el)),
    ]
    const getFocusable = () =>
      getContainers().flatMap((container) =>
        Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null,
        ),
      )

    // 打开时焦点移入弹窗(优先首个可聚焦元素,否则容器自身),避免焦点滞留在背景
    const first = getFocusable()[0]
    ;(first ?? node).focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (trapStack[trapStack.length - 1] !== id) return
      const containers = getContainers()
      const focusable = getFocusable()
      if (focusable.length === 0) {
        e.preventDefault()
        node.focus()
        return
      }
      const activeEl = document.activeElement as HTMLElement | null
      const idx = activeEl ? focusable.indexOf(activeEl) : -1
      if (idx === -1) {
        const inContainers = activeEl
          ? containers.some((container) => container === activeEl || container.contains(activeEl))
          : false
        if (!inContainers) {
          // 焦点已逃逸出陷阱(持焦按钮被 disable 后焦点掉 body 等):拉回环内
          e.preventDefault()
          focusable[0].focus()
          return
        }
        // 焦点在容器壳(tabIndex=-1)或环外的容器内元素上:按方向进入环首/环尾
        e.preventDefault()
        ;(e.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus()
        return
      }
      if (e.shiftKey && idx === 0) {
        e.preventDefault()
        focusable[focusable.length - 1].focus()
      } else if (!e.shiftKey && idx === focusable.length - 1) {
        e.preventDefault()
        focusable[0].focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const stackIdx = trapStack.indexOf(id)
      if (stackIdx !== -1) trapStack.splice(stackIdx, 1)
      // 还原焦点到打开弹窗前的元素(若仍在文档中)
      previouslyFocused?.focus?.()
    }
  }, [active, containerRef])
}
