import { useStore } from '../store'
import { getActiveApiProfile } from '../lib/api/apiProfiles'
import HelpButton from './HelpButton'

type Theme = 'light' | 'dark' | 'system'

const THEME_LABEL: Record<Theme, string> = {
  light: '日间',
  dark: '夜间',
  system: '跟随系统',
}

function nextTheme(current: Theme): Theme {
  if (current === 'light') return 'dark'
  if (current === 'dark') return 'system'
  return 'light'
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') {
    return (
      <svg
        className="w-5 h-5 text-gray-600 dark:text-gray-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m4.93 19.07 1.41-1.41" />
        <path d="m17.66 6.34 1.41-1.41" />
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg
        className="w-5 h-5 text-gray-600 dark:text-gray-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }
  return (
    <svg
      className="w-5 h-5 text-gray-600 dark:text-gray-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  )
}

interface HeaderProps {
  /** 打开移动端 sidebar 抽屉 */
  onOpenMobileSidebar: () => void
}

export default function Header({ onOpenMobileSidebar }: HeaderProps) {
  const theme = useStore((s) => (s.settings.theme ?? 'light') as Theme)
  const setSettings = useStore((s) => s.setSettings)
  const settings = useStore((s) => s.settings)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const conversations = useStore((s) => s.conversations)

  const cycleTheme = () => setSettings({ theme: nextTheme(theme) })

  const activeProfile = getActiveApiProfile(settings)
  const modelLabel = activeProfile.model || '未配置模型'
  const modeLabel =
    activeProfile.provider === 'openai'
      ? activeProfile.apiMode === 'responses'
        ? 'Responses'
        : '创建图'
      : 'Gemini'

  const galleryView = useStore((s) => s.galleryView)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const favoriteCategory = useStore((s) =>
    s.favoriteCategories.find((category) => category.id === s.filterFavoriteCategoryId),
  )
  const setShowCommandPalette = useStore((s) => s.setShowCommandPalette)
  // 图库视图跨对话展示,移动端标题若仍显示激活对话名会误导用户以为只看到了这一个对话
  const activeConversation =
    activeConversationId && !galleryView
      ? conversations.find((c) => c.id === activeConversationId)
      : null

  const title = galleryView
    ? filterFavorite
      ? '我的收藏'
      : filterFavoriteCategoryId
        ? (favoriteCategory?.name ?? '收藏分类')
        : '全部作品'
    : (activeConversation?.title ?? '创作工作台')

  return (
    <header data-no-drag-select className="safe-area-top z-30 shrink-0 bg-canvas">
      <div className="safe-header-inner mx-auto flex w-full max-w-[1488px] items-center justify-between gap-3 px-4 py-4 md:px-6">
        {/* 左侧：移动端 hamburger + 当前对话/模型信息 */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="ui-icon-button md:hidden"
            title="打开对话列表"
            aria-label="打开对话列表"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="min-w-0">
            <h1
              className="truncate text-lg font-semibold tracking-tight text-content md:text-2xl"
              title={title}
            >
              {title}
            </h1>
            <p className="mt-1 truncate text-xs text-content-muted">
              {galleryView ? '汇集所有对话中的创作作品' : '从一个想法，开始下一张作品'}
            </p>
          </div>
        </div>

        {/* 右上：重看引导 + 主题切换 */}
        <div className="flex shrink-0 items-center gap-1">
          <div
            className="mr-3 hidden max-w-48 items-center gap-2 text-xs text-content-muted lg:flex"
            title={`${modelLabel} · ${modeLabel}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span className="truncate">{modelLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            className="ui-icon-button"
            aria-label="打开命令面板"
            title="命令面板（Ctrl / ⌘ + K）"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          </button>
          <HelpButton />
          <button
            type="button"
            onClick={cycleTheme}
            className="ui-icon-button"
            title={`主题:${THEME_LABEL[theme]}(点击切换)`}
            aria-label={`切换主题，当前 ${THEME_LABEL[theme]}`}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </div>
    </header>
  )
}
