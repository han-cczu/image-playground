import { useStore } from '../store'
import { getActiveApiProfile } from '../lib/api/apiProfiles'

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
      <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
      <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }
  return (
    <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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

  const activeConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId)
    : null

  return (
    <header
      data-no-drag-select
      className="app-enter-header safe-area-top sticky top-0 z-30 border-b border-gray-200 bg-white/70 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-950/70"
    >
      <div className="safe-area-x safe-header-inner mx-auto flex max-w-7xl items-center justify-between gap-2">
        {/* 左侧：移动端 hamburger + 当前对话/模型信息 */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06] md:hidden"
            title="打开对话列表"
            aria-label="打开对话列表"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="flex min-w-0 items-center gap-2">
            {/* 桌面端：当前模型名 + 模式 chip */}
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100" title={modelLabel}>
                {modelLabel}
              </span>
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30">
                {modeLabel}
              </span>
            </div>

            {/* 移动端：当前对话标题（无对话时显示品牌名） */}
            <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100 md:hidden">
              {activeConversation?.title ?? 'Image Playground'}
            </span>
          </div>
        </div>

        {/* 右上：仅主题切换 */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={cycleTheme}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
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
