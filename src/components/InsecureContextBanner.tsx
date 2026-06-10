import { useStore } from '../store'

/**
 * 仅在非 secure context（即 HTTP + IP 部署）下渲染的一行 banner，
 * 提醒用户当前丢失了 PWA / 离线 / kill-switch 等能力。
 * sticky 定位由 App 中与 InitErrorBanner 共享的容器提供（各自 sticky 会在滚动后互相覆盖）。
 *
 * 渲染条件：
 *   - 浏览器环境（typeof window !== 'undefined'）
 *   - !window.isSecureContext
 *   - 用户未点击 × 关闭（dismissedInsecureContextBanner === false）
 *
 * 关闭状态走 zustand-persist，刷新后保持关闭。
 *
 * 注意：不要把本组件包在 ErrorBoundary 内（recovery surface 反模式）。
 */
export default function InsecureContextBanner() {
  const dismissed = useStore((s) => s.dismissedInsecureContextBanner)
  const setDismissed = useStore((s) => s.setDismissedInsecureContextBanner)

  if (typeof window === 'undefined') return null
  if (window.isSecureContext) return null
  if (dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100 sm:text-sm"
    >
      <span aria-hidden="true" className="flex-shrink-0">⚠️</span>
      <span className="min-w-0 flex-1 leading-5">
        当前为 HTTP 模式，PWA 安装 / 离线访问 / kill-switch 不可用。建议部署 HTTPS 域名以启用完整功能。
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="关闭提示"
        className="flex-shrink-0 rounded-md p-1 text-amber-800/80 transition-colors hover:bg-amber-100 hover:text-amber-900 dark:text-amber-200/80 dark:hover:bg-amber-900/50 dark:hover:text-amber-100"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
