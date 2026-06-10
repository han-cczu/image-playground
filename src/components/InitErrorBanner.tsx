/**
 * initStore 失败时渲染的一行 banner(常红,不可关闭——数据没加载成功前关闭提示只会害用户)。
 * sticky 定位由 App 中与 InsecureContextBanner 共享的容器提供(各自 sticky 会在滚动后互相覆盖)。
 *
 * 为什么不用 toast:toast 3 秒消失,而「本地数据加载失败」必须与「全新空库」可区分——
 * 否则用户第一反应是数据丢了,可能立刻执行清空/重导等破坏性操作(db.ts 里精心构造的
 * 错误文案如「请关闭其它标签页重试」此前没有任何 UI 出口)。
 *
 * 注意:不要把本组件包在 ErrorBoundary 内(recovery surface 反模式,与 InsecureContextBanner 同)。
 */
export default function InitErrorBanner({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-sm dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100 sm:text-sm"
    >
      <span aria-hidden="true" className="flex-shrink-0">⛔</span>
      <span className="min-w-0 flex-1 leading-5">
        本地数据加载失败：{error}。当前显示的不是你的真实数据，请勿执行清空 / 导入等操作。
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex-shrink-0 rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 transition-colors hover:bg-red-200 dark:bg-red-900/50 dark:text-red-100 dark:hover:bg-red-900/80"
      >
        重试
      </button>
    </div>
  )
}
