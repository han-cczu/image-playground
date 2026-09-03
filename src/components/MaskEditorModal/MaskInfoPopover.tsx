import { useRef } from 'react'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'

interface MaskInfoPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 触屏轻点后浏览器补发仿真 mouse 事件的忽略窗口 */
const SYNTHETIC_MOUSE_WINDOW_MS = 700

/**
 * 「编辑遮罩」标题旁的说明浮层(toggletip):点按切换固定显示,桌面悬停即时预览。
 *
 * 旧实现 hover/click 都只 show 不 hide,触屏打开后没有任何关闭路径(卡死在屏幕上),
 * 还自带一份浮层骨架。现关闭统一交 usePopoverDismiss(Esc + 外点),显示端只管打开/切换。
 * mouse 事件要做触屏防抖:轻点会补发仿真 mouseenter,不忽略的话
 * 「mouseenter 先开 → click 再 toggle 关」,轻点看起来毫无反应。
 */
export default function MaskInfoPopover({ open, onOpenChange }: MaskInfoPopoverProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastTouchAtRef = useRef(0)

  usePopoverDismiss(open, anchorRef, panelRef, () => onOpenChange(false))

  const isSyntheticMouse = () => Date.now() - lastTouchAtRef.current < SYNTHETIC_MOUSE_WINDOW_MS
  const markTouch = () => {
    lastTouchAtRef.current = Date.now()
  }

  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200" id="mask-editor-title">
        编辑遮罩
      </h2>
      <div className="relative flex items-center">
        <button
          ref={anchorRef}
          type="button"
          // 鼠标设备 hover 已把说明层打开,再点击是「固定」意图;若按 toggle 处理会把刚打开的层关掉。
          // 关闭一律交给 usePopoverDismiss(外点 / Esc)与 mouseleave;触屏没有 hover,点击仍需能开合
          onClick={() => {
            if (isSyntheticMouse() || !open) onOpenChange(!open)
          }}
          onMouseEnter={() => {
            if (!isSyntheticMouse()) onOpenChange(true)
          }}
          onMouseLeave={() => {
            if (!isSyntheticMouse()) onOpenChange(false)
          }}
          onTouchStart={markTouch}
          onTouchEnd={markTouch}
          className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:bg-gray-100 focus-visible:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300 dark:focus-visible:bg-gray-800 dark:focus-visible:text-gray-300"
          aria-label="遮罩编辑说明"
          aria-expanded={open}
          aria-controls={open ? 'mask-info-popover' : undefined}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        {open && (
          <div
            ref={panelRef}
            id="mask-info-popover"
            className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-gray-200/80 bg-white px-3 py-2 text-xs leading-5 text-gray-600 shadow-lg dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300"
          >
            {/* 箭头对准 24px 宽按钮的中心:(24 - 12) / 2 = 6px = left-1.5 */}
            <div className="absolute -top-1.5 left-1.5 h-3 w-3 rotate-45 border-l border-t border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-gray-900" />
            根据官方文档说明，此功能仅基于提示词，无法完全控制模型编辑区域
          </div>
        )}
      </div>
    </div>
  )
}
