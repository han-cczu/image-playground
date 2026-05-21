import type { ReactNode } from 'react'

/**
 * 主区域空状态：当前对话没有任何任务时展示。
 * 形态参考 IkunImage：emoji + 标题 + 描述 + 4 个特性 pill（仅装饰）。
 */
const FEATURE_PILLS: { label: string; icon: ReactNode }[] = [
  {
    label: '10 种宽高比',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="6" width="18" height="12" rx="2" />
      </svg>
    ),
  },
  {
    label: '1K / 2K / 4K',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16v16H4z" />
        <path d="M9 9l3 3 3-3" />
      </svg>
    ),
  },
  {
    label: '8 种风格预设',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13L9.5 4.5a2.121 2.121 0 0 0-3 3L15 16" />
      </svg>
    ),
  },
  {
    label: 'AI 提示词优化',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l2.39 4.84L20 8.27l-4 3.9.94 5.5L12 15.77l-4.94 1.9L8 12.17 4 8.27l5.61-1.43L12 2z" />
      </svg>
    ),
  },
]

export default function EmptyState() {
  return (
    <div
      data-no-drag-select
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center"
    >
      <div className="mb-4 text-6xl" aria-hidden="true">
        🍌
      </div>
      <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
        开始创作
      </h2>
      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
        在下方输入提示词，选择风格和参数，即可生成图片。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {FEATURE_PILLS.map((pill) => (
          <span
            key={pill.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300"
          >
            <span className="text-blue-500 dark:text-blue-400" aria-hidden="true">
              {pill.icon}
            </span>
            {pill.label}
          </span>
        ))}
      </div>
    </div>
  )
}
