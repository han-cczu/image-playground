import { useStore } from '../store'

/**
 * 重看新手引导的常驻入口(Header 右上,桌面/移动恒可见)。
 * 点击只重启导览,不读不改 hasSeenTour(首跑标记语义不受重看影响)。
 * 自身带 data-tour-id:引导末步会高亮它告诉用户「以后从这里重看」。
 */
export default function HelpButton() {
  const setTourActive = useStore((s) => s.setTourActive)
  const setTourStep = useStore((s) => s.setTourStep)
  return (
    <button
      type="button"
      data-tour-id="help"
      onClick={() => {
        setTourStep(0)
        setTourActive(true)
      }}
      className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
      title="重看新手引导"
      aria-label="重看新手引导"
    >
      <svg
        className="h-5 w-5 text-gray-600 dark:text-gray-300"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </button>
  )
}
