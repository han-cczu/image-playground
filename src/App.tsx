import { useCallback, useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { maybeStartTour } from './lib/tour/autoStart'
import { applyUrlBootstrapToSettings, readUrlBootstrap } from './lib/urlBootstrap'
import { getActiveApiProfile } from './lib/api/apiProfiles'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import AmbientGlow from './components/AmbientGlow'
import EmptyState from './components/EmptyState'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import ErrorBoundary from './components/ErrorBoundary'
import InsecureContextBanner from './components/InsecureContextBanner'
import InitErrorBanner from './components/InitErrorBanner'
import LazyModals from './components/LazyModals'

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
    // settings 来自 zustand-persist 同步恢复,此刻可读:#apiUrl 不带 provider 时按激活 profile 的厂商归一化
    const activeProvider = getActiveApiProfile(useStore.getState().settings).provider
    const bootstrap = readUrlBootstrap(window.location.href, { defaultProvider: activeProvider })
    // 合并规则(#apiUrl 无 key 清 key / 同 provider 不重建 / 换厂商清 key)全在 applyUrlBootstrapToSettings,
    // 那里有单测;这里只负责取当前 settings、落盘、清地址栏。
    const nextSettings = applyUrlBootstrapToSettings(useStore.getState().settings, bootstrap)

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
        // 遮罩编辑器 / 优化器 / 反推(z-80)同理:面板能开在它们之上,但面板执行的「打开设置」(z-70)会挂在
        // 这些弹层下面、焦点陷阱却在栈顶——这些弹层打开期间不响应快捷键
        if (
          state.confirmDialog ||
          state.tourActive ||
          state.maskEditorImageId ||
          state.captionSource ||
          state.showPromptOptimizer
        )
          return
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
          <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={closeMobileSidebar} />
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
      <ConfirmDialog />
      <Toast />
      <ErrorBoundary region="modal">
        <ImageContextMenu />
      </ErrorBoundary>
      {/* 低频弹层统一走 LazyModals 惰性挂载(chunk 按需拉取);各弹层 z 层显式声明,DOM 顺序调整无叠层影响 */}
      <LazyModals />
    </>
  )
}
