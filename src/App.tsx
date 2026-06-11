import { useCallback, useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { normalizeSettings, switchApiProfileProvider } from './lib/api/apiProfiles'
import { maybeStartTour } from './lib/tour/autoStart'
import { readUrlBootstrap } from './lib/urlBootstrap'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import AmbientGlow from './components/AmbientGlow'
import EmptyState from './components/EmptyState'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import PromptOptimizerModal from './components/PromptOptimizerModal'
import ImageCaptionModal from './components/ImageCaptionModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import CommandPalette from './components/CommandPalette'
import CompareModal from './components/CompareModal'
import LineageModal from './components/LineageModal'
import BatchCaptionModal from './components/BatchCaptionModal'
import ErrorBoundary from './components/ErrorBoundary'
import InsecureContextBanner from './components/InsecureContextBanner'
import InitErrorBanner from './components/InitErrorBanner'
import TourOverlay from './components/TourOverlay'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const galleryView = useStore((s) => s.galleryView)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  /**
   * 当前视图下是否存在任务(存在性判定,非全量 filter+sort)。
   * showEmptyState 只关心「有没有」,且仅在其余筛选全为默认时才可能为真——故这里只按对话存在性
   * 判定即可,无需 filterAndSortTasks 的全量 [...tasks].sort + per-task 参数序列化。
   * 布尔 selector:zustand 仅在值翻转时通知——避免订阅 tasks 数组导致生成期间每次进度更新
   * 都从 App 顶层把 Header/Sidebar/InputBar/全部弹窗重渲染一遍。
   */
  const hasTasksInView = useStore((s) => {
    const convId = s.galleryView ? null : s.activeConversationId
    return s.tasks.some((t) => !convId || t.conversationId === convId)
  })

  /**
   * 是否展示「真正的空状态」（emoji + 4 个 pill）：
   *   - 当前对话下任何 task 都没有
   *   - 且用户没有在搜索/筛选
   * 否则交给 TaskGrid 自己的「没有匹配的记录」占位。
   */
  const showEmptyState =
    !hasTasksInView &&
    !searchQuery.trim() &&
    filterStatus === 'all' &&
    !filterFavorite &&
    !filterFavoriteCategoryId

  useEffect(() => {
    const bootstrap = readUrlBootstrap(window.location.href)
    const nextSettings = { ...bootstrap.settings }

    // 加固:引导改了 baseUrl 但没带新 apiKey 时,不复用旧 key——否则旧 key 会随 Authorization 发往新主机
    //(攻击者用 #apiUrl=evil 不带 key 即可窃取已配置的 key)。置 '' 让 settings 合并层的
    // `incoming.apiKey ?? profile.apiKey` 解析为空,强制为新主机重填 key。正常分享链 #apiUrl=...&apiKey=...
    // 同时带 key,nextSettings.apiKey 已定义,不触发此分支,零误伤。
    if (nextSettings.baseUrl !== undefined && nextSettings.apiKey === undefined) {
      nextSettings.apiKey = ''
    }

    const provider = bootstrap.provider
    if (provider) {
      const state = useStore.getState()
      const settings = normalizeSettings(state.settings)
      const current = settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]
      if (current) {
        nextSettings.profiles = settings.profiles.map((profile) =>
          profile.id === current.id
            ? {
                ...switchApiProfileProvider(profile, provider),
                ...(nextSettings.baseUrl !== undefined ? { baseUrl: nextSettings.baseUrl } : {}),
                ...(nextSettings.apiKey !== undefined ? { apiKey: nextSettings.apiKey } : {}),
                ...(provider === 'openai' && nextSettings.apiMode !== undefined ? { apiMode: nextSettings.apiMode } : {}),
                ...(provider === 'openai' && nextSettings.codexCli !== undefined ? { codexCli: nextSettings.codexCli } : {}),
              }
            : profile,
        )
        nextSettings.activeProfileId = current.id
      }
    }

    if (Object.keys(nextSettings).length) setSettings(nextSettings)
    if (bootstrap.changed) window.history.replaceState(null, '', bootstrap.cleanUrl)

    // 新手引导自动触发挂在 initStore 之后:老用户判定需要 tasks(IDB 异步)就位。
    // catch:initStore 失败(IDB 打开失败/升级被阻塞/记录损坏)时界面会呈现「全新空库」,
    // 必须用常驻 banner 与真空库区分,否则用户误以为数据丢失而做破坏性操作。
    // finally:即使 IDB 初始化失败引导也照常评估(profiles key 判定仍兜底)。
    void initStore()
      .catch((err) => {
        // 保留完整堆栈/cause 供排查(banner 只展示 message 文本)
        console.error('initStore failed:', err)
        setInitError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => maybeStartTour())
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  // 全局 Ctrl/⌘+K 切换命令面板（再次按下关闭）；不带 Shift/Alt，避开 Ctrl+Shift+K 等浏览器快捷键
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const state = useStore.getState()
        // ConfirmDialog(z-110)在面板(z-105)之上：此时打开面板会被遮罩盖住却抢走焦点，
        // 用户看着确认框、键盘却困在不可见面板里——确认框打开期间不响应。
        // 新手引导(z-130)同理:捕获层只吞指针不吞键盘,面板会开在遮罩下偷走焦点
        if (state.confirmDialog || state.tourActive) return
        state.setShowCommandPalette(!state.showCommandPalette)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const theme = useStore((s) => s.settings.theme ?? 'light')

  // 稳定引用:Sidebar/Header 的 props 不随 App 重渲染变化,配合子组件 memo 生效
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), [])

  useEffect(() => {
    const applyDark = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark)
      const themeMeta = document.querySelector('meta[name="theme-color"]')
      if (themeMeta) themeMeta.setAttribute('content', isDark ? '#09090b' : '#ffffff')
    }

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      applyDark(mql.matches)
      const onChange = (e: MediaQueryListEvent) => applyDark(e.matches)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }

    applyDark(theme === 'dark')
  }, [theme])

  return (
    <>
      <AmbientGlow />
      {/* 两条 banner 共用一个 sticky 容器:各自 sticky top-0 时滚动后会在同一位置互相覆盖 */}
      <div className="sticky top-0 z-30">
        <InsecureContextBanner />
        <InitErrorBanner error={initError} />
      </div>
      <div className="flex min-h-screen md:h-screen md:overflow-hidden">
        <ErrorBoundary region="sidebar">
          <Sidebar
            mobileOpen={mobileSidebarOpen}
            onMobileClose={closeMobileSidebar}
          />
        </ErrorBoundary>
        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:h-screen md:min-h-0">
          <ErrorBoundary region="header">
            <Header onOpenMobileSidebar={openMobileSidebar} />
          </ErrorBoundary>
          <ErrorBoundary region="main">
            <main
              data-home-main
              data-drag-select-surface
              className="flex-1 pb-48 md:overflow-y-auto"
            >
              <div className="app-enter-main safe-area-x mx-auto max-w-7xl">
                {showEmptyState ? (
                  <EmptyState mode={galleryView ? 'gallery' : 'conversation'} />
                ) : (
                  <>
                    <SearchBar />
                    <TaskGrid />
                  </>
                )}
              </div>
            </main>
          </ErrorBoundary>
        </div>
      </div>
      <ErrorBoundary region="inputbar">
        <InputBar />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <DetailModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <Lightbox />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <SettingsModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <PromptOptimizerModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <ImageCaptionModal />
      </ErrorBoundary>
      <ConfirmDialog />
      <Toast />
      <ErrorBoundary region="modal">
        <MaskEditorModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <ImageContextMenu />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <CommandPalette />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <CompareModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <LineageModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <BatchCaptionModal />
      </ErrorBoundary>
      <ErrorBoundary region="modal">
        <TourOverlay />
      </ErrorBoundary>
    </>
  )
}
