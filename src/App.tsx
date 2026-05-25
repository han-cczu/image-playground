import { useEffect, useMemo, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { normalizeSettings, switchApiProfileProvider } from './lib/api/apiProfiles'
import { readUrlBootstrap } from './lib/urlBootstrap'
import { filterAndSortTasks } from './lib/taskFilters'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
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
import ErrorBoundary from './components/ErrorBoundary'
import InsecureContextBanner from './components/InsecureContextBanner'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const tasks = useStore((s) => s.tasks)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const galleryView = useStore((s) => s.galleryView)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  /**
   * 当前视图下的任务（含全部 status / favorite 等筛选）。
   * - galleryView=true：跨对话全部 task
   * - galleryView=false：仅当前 activeConversationId 下 task
   * 只用来判断是否展示 EmptyState；TaskGrid 自己仍会再过滤一次。
   */
  const tasksInActiveConversation = useMemo(() => {
    return filterAndSortTasks(tasks, {
      searchQuery,
      filterStatus,
      filterFavorite,
      filterFavoriteCategoryId,
      filterConversationId: galleryView ? undefined : activeConversationId,
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId, activeConversationId, galleryView])

  /**
   * 是否展示「真正的空状态」（emoji + 4 个 pill）：
   *   - 当前对话下任何 task 都没有
   *   - 且用户没有在搜索/筛选
   * 否则交给 TaskGrid 自己的「没有匹配的记录」占位。
   */
  const showEmptyState =
    tasksInActiveConversation.length === 0 &&
    !searchQuery.trim() &&
    filterStatus === 'all' &&
    !filterFavorite &&
    !filterFavoriteCategoryId

  useEffect(() => {
    const bootstrap = readUrlBootstrap(window.location.href)
    const nextSettings = { ...bootstrap.settings }

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

    initStore()
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

  const theme = useStore((s) => s.settings.theme ?? 'light')

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
      <InsecureContextBanner />
      <div className="flex min-h-screen md:h-screen md:overflow-hidden">
        <ErrorBoundary region="sidebar">
          <Sidebar
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
        </ErrorBoundary>
        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:h-screen md:min-h-0">
          <ErrorBoundary region="header">
            <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
          </ErrorBoundary>
          <ErrorBoundary region="main">
            <main
              data-home-main
              data-drag-select-surface
              className="flex-1 pb-48 md:overflow-y-auto"
            >
              <div className="safe-area-x mx-auto max-w-7xl">
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
    </>
  )
}
