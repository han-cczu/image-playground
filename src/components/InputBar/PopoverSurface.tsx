import { useEffect, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverPlacement } from '../../hooks/usePopoverPlacement'

/** 创作面板位于真实布局底部，浮层通过既有定位 hook 脱离滚动裁切并限制手机横向边界。 */
export default function PopoverSurface({
  anchorRef,
  panelRef,
  label,
  width = 300,
  children,
  className = '',
}: {
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  label: string
  width?: number
  children: ReactNode
  className?: string
}) {
  const { menuStyle } = usePopoverPlacement(anchorRef, {
    open: true,
    fixed: true,
    estimatedHeight: 340,
  })
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth
  const panelWidth = Math.min(width, Math.max(0, viewportWidth - 24))
  const left = Math.max(12, Math.min(Number(menuStyle.left) || 12, viewportWidth - panelWidth - 12))
  const anchorDistance = Number(menuStyle.bottom ?? menuStyle.top ?? 12)
  const maxHeight = Math.max(80, window.innerHeight - anchorDistance - 12)
  useEffect(() => {
    const panel = panelRef.current
    const anchor = anchorRef.current
    panel?.querySelector<HTMLElement>('button:not([disabled]), input, textarea, select')?.focus()
    return () => {
      // 只在焦点仍属于本层时恢复，避免关闭下层面板抢走新打开 Modal 的焦点。
      if (document.activeElement === document.body || panel?.contains(document.activeElement))
        anchor?.focus()
    }
  }, [anchorRef, panelRef])
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={`ui-panel fixed z-40 max-h-[calc(100dvh-24px)] overflow-y-auto rounded-2xl border border-line bg-surface-raised p-3 text-content shadow-xl custom-scrollbar ${className}`}
      style={{ ...menuStyle, left, width: panelWidth, maxHeight }}
    >
      {children}
    </div>,
    document.body,
  )
}
