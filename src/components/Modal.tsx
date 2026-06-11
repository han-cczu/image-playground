import { useRef, type KeyboardEventHandler, type ReactNode } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useFocusTrap } from '../hooks/useFocusTrap'

/**
 * 弹窗骨架原语:统一 backdrop、panel 基类、三件套 hooks(ESC 栈/滚动锁/焦点陷阱)与
 * a11y 属性(role="dialog" + aria-modal + aria-label)。
 *
 * 挂载即打开:开关留在调用方(条件渲染),关闭即卸载,内部状态随之重置——与既有各弹窗
 * 「外层开关 + 内层 key 重置」的模式一致。
 *
 * containerClassName 必须携带 z 层与纵向对齐(Tailwind 需要字面量类名,不能在此拼接动态 z)。
 */
interface ModalProps {
  onClose: () => void
  /** 弹窗的无障碍名称(读屏器播报用) */
  ariaLabel: string
  /** panel 布局类:宽高上限、padding、flex/overflow 等(骨架基类之外的部分) */
  panelClassName: string
  /** z 层 + 纵向对齐,默认居中;如 'z-[80] items-center'、'z-[105] items-start pt-[12vh]' */
  containerClassName?: string
  /** deep = 更重的遮罩模糊 + 90% 表面(DetailModal/ConfirmDialog 风格) */
  tone?: 'default' | 'deep'
  animation?: 'modal' | 'confirm'
  /** 点击 backdrop 是否关闭,默认 true */
  closeOnBackdrop?: boolean
  /** ESC 是否可关(如延迟确认期禁用),默认 true */
  escEnabled?: boolean
  /** 透传到 panel(如命令面板的 ↑↓/Enter 导航) */
  onPanelKeyDown?: KeyboardEventHandler<HTMLDivElement>
  children: ReactNode
}

const BACKDROP_TONE = {
  default: 'bg-black/30 backdrop-blur-sm',
  deep: 'bg-black/20 dark:bg-black/40 backdrop-blur-md',
} as const

const SURFACE_TONE = {
  default: 'bg-white/95 shadow-2xl backdrop-blur-xl dark:bg-gray-900/95',
  deep: 'bg-white/90 backdrop-blur-xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:bg-gray-900/90 dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)]',
} as const

const ANIMATION = {
  modal: 'animate-modal-in',
  confirm: 'animate-confirm-in',
} as const

export default function Modal({
  onClose,
  ariaLabel,
  panelClassName,
  containerClassName = 'z-50 items-center',
  tone = 'default',
  animation = 'modal',
  closeOnBackdrop = true,
  escEnabled = true,
  onPanelKeyDown,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(escEnabled, onClose)
  useLockBodyScroll(true)
  useFocusTrap(true, panelRef)

  return (
    <div data-no-drag-select className={`fixed inset-0 flex justify-center p-4 ${containerClassName}`}>
      <div
        className={`absolute inset-0 animate-overlay-in ${BACKDROP_TONE[tone]}`}
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`relative z-10 rounded-3xl border border-white/50 ring-1 ring-black/5 dark:border-white/[0.08] dark:ring-white/10 ${SURFACE_TONE[tone]} ${ANIMATION[animation]} ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  )
}

/** 标题 h3:大多数弹窗共用的「图标 + 文案」样式 */
export function ModalTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100 ${className}`}>
      {children}
    </h3>
  )
}

/** 带底边框的标题栏(Compare/Lineage/BatchCaption 风格):内容区在其下方独立滚动 */
export function ModalHeaderBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08] ${className}`}
    >
      {children}
    </div>
  )
}

/** 右上角圆形关闭按钮(全部弹窗同款) */
export function ModalCloseButton({
  onClick,
  label = '关闭',
  className = '',
  iconClassName = 'h-5 w-5',
}: {
  onClick: () => void
  label?: string
  className?: string
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 ${className}`}
    >
      <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}
