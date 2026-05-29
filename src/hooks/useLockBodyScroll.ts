import { useEffect } from 'react'

// 模块级计数器:支持多个弹窗叠加打开/关闭顺序错乱时不提前解锁。
let lockCount = 0
let prevOverflow = ''

/**
 * 弹窗打开期间锁定 body 滚动,阻止背景滚动与移动端 scroll chaining。
 * :root 已设 scrollbar-gutter:stable 预留滚动条位置,故只设 overflow:hidden 即可,不补 paddingRight,避免布局抖动。
 */
export function useLockBodyScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount++
    return () => {
      lockCount--
      if (lockCount === 0) {
        document.body.style.overflow = prevOverflow
      }
    }
  }, [active])
}
