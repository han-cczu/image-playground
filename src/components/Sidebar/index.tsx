import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { normalizeConversations } from '../../lib/conversations'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useIsMobile } from '../../hooks/useIsMobile'
import ConversationItem from './ConversationItem'

interface SidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const setActiveConversation = useStore((s) => s.setActiveConversation)
  const createOrReuseEmptyConversation = useStore((s) => s.createOrReuseEmptyConversation)
  const deleteConversationWithTasks = useStore((s) => s.deleteConversationWithTasks)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const tasks = useStore((s) => s.tasks)
  const galleryView = useStore((s) => s.galleryView)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const setFilterFavoriteCategoryId = useStore((s) => s.setFilterFavoriteCategoryId)
  const isMobile = useIsMobile(768)
  const belowDesktop = useIsMobile(1024)
  // 平板默认收紧导航是展示选择，不在 resize 时覆盖用户的桌面折叠偏好。
  const [tabletExpanded, setTabletExpanded] = useState(false)
  const collapsed = !isMobile && (belowDesktop ? !tabletExpanded : sidebarCollapsed)
  const panelRef = useRef<HTMLElement>(null)
  useCloseOnEscape(mobileOpen && isMobile, onMobileClose)
  useLockBodyScroll(mobileOpen)
  useFocusTrap(mobileOpen && isMobile, panelRef)

  const sortedConversations = useMemo(() => normalizeConversations(conversations), [conversations])
  const taskCountByConversation = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) {
      if (task.conversationId) map.set(task.conversationId, (map.get(task.conversationId) ?? 0) + 1)
    }
    return map
  }, [tasks])

  const handleSelect = useCallback(
    (id: string) => {
      if (!useStore.getState().conversations.some((conversation) => conversation.id === id)) return
      setGalleryView(false)
      setActiveConversation(id)
      onMobileClose()
    },
    [setGalleryView, setActiveConversation, onMobileClose],
  )
  const handleDelete = useCallback(
    (id: string) => {
      deleteConversationWithTasks(id)
    },
    [deleteConversationWithTasks],
  )
  const handleCreate = () => {
    setGalleryView(false)
    createOrReuseEmptyConversation()
    onMobileClose()
  }
  const openGallery = (favorites: boolean) => {
    // 只改变范围与收藏条件；搜索、状态和全局草稿继续保留。setter 自己判断是否需要清多选。
    setGalleryView(true)
    setFilterFavorite(favorites)
    if (!favorites) setFilterFavoriteCategoryId(null)
    onMobileClose()
  }
  const toggleNavigation = () => {
    if (belowDesktop) setTabletExpanded((value) => !value)
    else toggleSidebar()
  }
  const galleryActive = galleryView && !filterFavorite && !filterFavoriteCategoryId
  const favoritesActive = galleryView && filterFavorite
  const navClass = (active: boolean) =>
    `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-content-muted hover:bg-surface-raised hover:text-content'} ${collapsed ? 'justify-center px-0' : ''}`

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="关闭对话列表"
          onClick={onMobileClose}
        />
      )}
      <aside
        ref={panelRef}
        tabIndex={-1}
        aria-label="对话列表"
        aria-hidden={isMobile && !mobileOpen ? true : undefined}
        inert={isMobile && !mobileOpen ? true : undefined}
        data-collapsed={collapsed}
        className={`workspace-sidebar fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[transform,width] duration-200 md:static md:z-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div
          className={`flex min-h-20 items-center gap-2 px-4 ${collapsed ? 'justify-center px-2' : ''}`}
        >
          <button
            type="button"
            onClick={collapsed ? toggleNavigation : handleCreate}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink"
            aria-label={collapsed ? '展开 sidebar' : 'Image Playground，新建创作'}
            title={collapsed ? '展开侧栏' : '新建创作'}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="9" cy="9" r="1.5" />
              <path d="m4 17 5-5 4 4 3-3 4 4" />
            </svg>
          </button>
          {!collapsed && (
            <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-content">
              Image Playground
            </span>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={isMobile ? onMobileClose : toggleNavigation}
              className="ui-icon-button h-8 w-8"
              aria-label={isMobile ? '关闭导航' : '折叠 sidebar'}
              title="折叠侧栏"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
          )}
        </div>

        <div className={collapsed ? 'px-3 pb-5' : 'px-4 pb-5'}>
          <button
            type="button"
            onClick={handleCreate}
            className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover ${collapsed ? 'px-0' : ''}`}
            aria-label="新建对话"
            title="新建创作"
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {!collapsed && <span>新建创作</span>}
          </button>
        </div>
        <nav aria-label="作品导航" className="space-y-1 px-3">
          <button
            type="button"
            onClick={() => openGallery(false)}
            className={navClass(galleryActive)}
            aria-current={galleryActive ? 'page' : undefined}
            aria-label="打开图库（全部任务）"
            title="全部作品"
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            {!collapsed && <span>全部作品</span>}
          </button>
          <button
            type="button"
            onClick={() => openGallery(true)}
            className={navClass(favoritesActive)}
            aria-current={favoritesActive ? 'page' : undefined}
            aria-label="打开我的收藏"
            title="我的收藏"
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
            </svg>
            {!collapsed && <span>我的收藏</span>}
          </button>
        </nav>

        {!collapsed && (
          <div className="mt-7 flex items-center justify-between px-5 pb-2 text-xs font-medium text-content-subtle">
            <span>近期对话</span>
            <span>{sortedConversations.length}</span>
          </div>
        )}
        <nav
          className={`min-h-0 flex-1 overflow-y-auto px-3 pb-4 ${collapsed ? 'mt-5' : ''}`}
          aria-label="对话列表"
        >
          {!collapsed && (
            <ul className="flex flex-col gap-1">
              {sortedConversations.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationItem
                    conversation={conversation}
                    active={!galleryView && conversation.id === activeConversationId}
                    collapsed={false}
                    taskCount={taskCountByConversation.get(conversation.id) ?? 0}
                    onSelect={handleSelect}
                    onDelete={handleDelete}
                  />
                </li>
              ))}
            </ul>
          )}
          {!collapsed && !sortedConversations.length && (
            <p className="px-2 py-3 text-xs leading-5 text-content-subtle">创作记录会保存在这里</p>
          )}
        </nav>
        <div className="border-t border-line p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              setShowSettings(true)
              onMobileClose()
            }}
            className={navClass(false)}
            aria-label="打开设置"
            title="设置"
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 17h16" />
              <circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" />
              <circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" />
            </svg>
            {!collapsed && <span>设置</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
