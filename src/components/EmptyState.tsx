import type { ReactNode } from 'react'

/**
 * 主区域空状态：
 *  - mode='conversation'（默认）：当前对话没有任何任务时展示。
 *    形态：emoji + 标题 + 描述 + 4 个特性 pill（仅装饰）。
 *  - mode='gallery'：图库视图全局无任务时展示，简化文案、隐藏 pill。
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

interface Props {
  mode?: 'conversation' | 'gallery'
}

export default function EmptyState({ mode = 'conversation' }: Props) {
  const isGallery = mode === 'gallery'
  const title = isGallery ? '图库还是空的' : '开始创作'
  const description = isGallery
    ? '开始创作后，所有作品会汇总到这里'
    : '在下方输入提示词，选择风格和参数，即可生成图片。'

  return (
    <div
      data-no-drag-select
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center"
    >
      <svg
        className="mb-4 h-[88px] w-[88px] text-gray-800 dark:text-gray-100"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3654-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.02 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4029-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
      </svg>
      <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>
      {!isGallery && (
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
      )}
    </div>
  )
}
