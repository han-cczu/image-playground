import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../../store'
import { findReusableEmptyConversation, normalizeConversations } from '../../lib/conversations'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import ConversationItem from './ConversationItem'

interface SidebarProps {
  /** 移动端抽屉是否打开（< md 断点时使用） */
  mobileOpen: boolean
  /** 关闭移动端抽屉 */
  onMobileClose: () => void
}

/** 简易 Logo（图标 + 文字），与品牌色一致。折叠态变为可点击的展开入口。 */
function Logo({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const inner = (
    <>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white"
        aria-hidden="true"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="1.5" fill="currentColor" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </span>
      {!collapsed && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
            Image Playground
          </span>
          <span className="truncate text-[11px] text-gray-400 dark:text-gray-500">
            创作你的图像
          </span>
        </div>
      )}
    </>
  )

  // 折叠态：Logo 变 button，点击展开（弥补原 toggle button 被布局挤掉的问题）
  if (collapsed && onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="group flex items-center gap-2 rounded-lg p-0.5 transition hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-500/50"
        title="展开 sidebar"
        aria-label="展开 sidebar"
      >
        <span className="relative">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white"
            aria-hidden="true"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="1.5" fill="currentColor" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </span>
          <span
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white opacity-0 shadow-sm ring-1 ring-gray-200 transition-opacity duration-150 group-hover:opacity-100 dark:bg-gray-800 dark:ring-white/10"
          >
            <svg
              className="h-2.5 w-2.5 text-gray-600 dark:text-gray-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </span>
      </button>
    )
  }
  // 展开态：保持原 div 语义
  return <div className="flex items-center gap-2">{inner}</div>
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const setActiveConversation = useStore((s) => s.setActiveConversation)
  const createConversation = useStore((s) => s.createConversation)
  const deleteConversationWithTasks = useStore((s) => s.deleteConversationWithTasks)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const tasks = useStore((s) => s.tasks)
  const galleryView = useStore((s) => s.galleryView)
  const setGalleryView = useStore((s) => s.setGalleryView)

  /** 按统一规则排序的对话（archive 永远在最底）。 */
  const sortedConversations = useMemo(
    () => normalizeConversations(conversations),
    [conversations],
  )

  /** 每个对话下的任务数（用于列表项徽标）。 */
  const taskCountByConversation = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) {
      const cid = t.conversationId
      if (!cid) continue
      map.set(cid, (map.get(cid) ?? 0) + 1)
    }
    return map
  }, [tasks])

  /** ESC 关闭移动端抽屉(走全局 escStack:自建监听会让一次 Esc 把抽屉与其上层确认弹窗一起关掉)。 */
  useCloseOnEscape(mobileOpen, onMobileClose)

  /** 抽屉打开时阻止背景滚动（仅 < md 生效，桌面端 sidebar 常驻不需要）。 */
  useEffect(() => {
    if (!mobileOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [mobileOpen])

  /** 抽屉打开时简易 trap focus：把焦点收回到抽屉容器上。 */
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!mobileOpen) return
    const node = panelRef.current
    if (!node) return
    const prev = document.activeElement as HTMLElement | null
    node.focus()
    return () => {
      prev?.focus?.()
    }
  }, [mobileOpen])

  const handleSelect = (id: string) => {
    // F3：active id 必须真实存在；否则忽略点击
    const target = useStore.getState().conversations.find((c) => c.id === id)
    if (!target) return
    setGalleryView(false)
    setActiveConversation(id)
    onMobileClose()
  }

  const handleCreate = () => {
    // 避免连按 + 堆积同名空"新对话"：若已存在可复用的空对话，直接切过去
    const reusable = findReusableEmptyConversation(sortedConversations, taskCountByConversation)
    if (reusable) {
      setGalleryView(false)
      setActiveConversation(reusable.id)
      onMobileClose()
      return
    }
    setGalleryView(false)
    createConversation()
    onMobileClose()
  }

  // —— 桌面端：始终在 md 及以上断点常驻 ——
  // —— 移动端：默认隐藏，按 mobileOpen 控制 ——
  const widthClass = sidebarCollapsed ? 'md:w-14' : 'md:w-64'

  // 抽屉显示状态：移动端打开 -> 滑入；否则 transform 隐藏（< md 才生效）
  const mobileTransform = mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'

  return (
    <>
      {/* 移动端遮罩 */}
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden"
          aria-label="关闭对话列表"
          onClick={onMobileClose}
        />
      )}

      <aside
        ref={panelRef}
        tabIndex={-1}
        aria-label="对话列表"
        className={`app-enter-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white outline-none transition-[transform,width] duration-200 dark:border-white/[0.08] dark:bg-gray-950 md:static md:z-0 md:h-screen ${widthClass} ${mobileTransform}`}
      >
        {/* 顶部：Logo + 折叠按钮。折叠态时 Logo 自身承担"展开"入口，toggle button 不再渲染，避免双入口冲突。 */}
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-3 dark:border-white/[0.06]">
          <Logo collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 md:flex"
              title="折叠 sidebar"
              aria-label="折叠 sidebar"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
        </div>

        {/* 图库 */}
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => {
              setGalleryView(true)
              onMobileClose()
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              galleryView
                ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
            } ${sidebarCollapsed ? 'justify-center px-2' : ''}`}
            title="图库"
            aria-label="打开图库（全部任务）"
            aria-current={galleryView ? 'true' : undefined}
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            {!sidebarCollapsed && <span>图库</span>}
          </button>
        </div>

        {/* 新建对话 */}
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={handleCreate}
            className={`flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10 dark:hover:text-blue-300 ${
              sidebarCollapsed ? 'justify-center px-2' : ''
            }`}
            title="新建对话"
            aria-label="新建对话"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {!sidebarCollapsed && <span>新建对话</span>}
          </button>
        </div>

        {/* 计数 */}
        {!sidebarCollapsed && (
          <div className="px-4 pt-1 pb-2 text-xs text-gray-400 dark:text-gray-500">
            对话 · {sortedConversations.length} 个
          </div>
        )}

        {/* 列表 */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="对话列表">
          <ul className="flex flex-col gap-0.5">
            {sortedConversations.map((c) => (
              <li key={c.id}>
                <ConversationItem
                  conversation={c}
                  active={!galleryView && c.id === activeConversationId}
                  collapsed={sidebarCollapsed}
                  taskCount={taskCountByConversation.get(c.id) ?? 0}
                  onSelect={() => handleSelect(c.id)}
                  onDelete={() => deleteConversationWithTasks(c.id)}
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* 底部：设置 */}
        <div className="border-t border-gray-100 px-3 py-2 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => {
              setShowSettings(true)
              onMobileClose()
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06] ${
              sidebarCollapsed ? 'justify-center px-2' : ''
            }`}
            title="设置"
            aria-label="打开设置"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.16.39.5.69.92.86H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {!sidebarCollapsed && <span>设置</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
