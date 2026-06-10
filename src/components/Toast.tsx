import { useStore } from '../store'

export default function Toast() {
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)

  const getIcon = () => {
    switch (toast?.type) {
      case 'success':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'error':
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
    }
  }

  const isError = toast?.type === 'error'

  return (
    // 常驻 live region(空时无内容):aria-live 区域需先存在于 DOM,内容变化才会被屏幕阅读器播报;
    // 随 toast 挂载/卸载的节点播报不可靠——此前屏幕阅读器收不到任何操作反馈
    // 外层恒 pointer-events-none:它的布局盒从 left:50% 向右铺开,水平居中由内层 .toast-enter
    // 的 translate(-50%) 完成——若在外层开放命中,可视气泡右侧会出现一条等宽的隐形点击拦截带
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-24 left-1/2 z-[120]"
    >
      {toast && (
        <div key={toast.id} className="toast-enter">
          <div className={`flex items-center gap-2.5 w-max max-w-[calc(100vw-32px)] sm:max-w-[min(28rem,60vw)] px-5 py-3.5 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-white/[0.08] rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] ring-1 ring-black/5 dark:ring-white/10 text-sm font-medium text-gray-700 dark:text-gray-300 ${isError ? 'pointer-events-auto' : ''}`}>
            <span className="flex-shrink-0">{getIcon()}</span>
            {/* 错误文案可选中复制(容器此时 pointer-events 开放),并提供手动关闭 */}
            <span className={`leading-5 whitespace-pre-line text-center ${isError ? 'select-text' : ''}`}>
              {toast.message}
            </span>
            {isError && (
              <button
                type="button"
                onClick={dismissToast}
                aria-label="关闭提示"
                className="flex-shrink-0 -mr-1 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
