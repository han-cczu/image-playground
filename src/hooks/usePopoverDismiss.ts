import { useEffect, useRef, type RefObject } from 'react'
import { useCloseOnEscape } from './useCloseOnEscape'

interface PopoverDismissOptions {
  /** 临时让位(如删除确认弹窗压在上层时):退出 Esc 栈、暂停外点判定 */
  disabled?: boolean
  /** Esc 的差异化响应(如编辑态先退回列表而非整体关闭),缺省与 onClose 相同 */
  onEscape?: () => void
}

/**
 * 非模态 popover 统一关闭逻辑:Esc + 点击外部
 * (原 ModelMenu/ResolutionMenu/StylePicker/GridConfig/AdvancedParams 各复制一份)。
 * Esc 走 useCloseOnEscape 全局栈:自建 document keydown 会绕过栈(叠层时一次 Esc 关错层),
 * 且缺 IME 组字守卫。外点用 pointerdown 并同时排除 anchor:pointerdown 先于 click 触发,
 * 若不排除 anchor,点击触发按钮会先在此关闭、随后 click 再 toggle 重开,表现为「关不掉」。
 * 条件渲染(挂载即打开)的 popover 直接传 open=true。
 */
export function usePopoverDismiss(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: PopoverDismissOptions = {},
) {
  const { disabled = false, onEscape } = options
  const active = open && !disabled

  // Esc 注册只随 open,不随 disabled 退栈:上层弹窗(如确认框)后注册天然居栈顶,让位无需出栈;
  // 若退栈再恢复会 re-push 到当前栈顶,越过期间打开的其他上层弹窗,破坏「栈序=打开序」
  useCloseOnEscape(open, onEscape ?? onClose)

  // 关闭回调走 ref:调用方多传内联闭包,避免每次渲染重挂 document 监听
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // 外点用 pointerdown(非 mousedown):触屏滚动手势落指也会立即关闭,与主流 light-dismiss 取向一致
  useEffect(() => {
    if (!active) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [active, anchorRef, panelRef])
}
