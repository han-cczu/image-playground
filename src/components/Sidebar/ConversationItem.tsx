import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { Conversation } from '../../types'
import { isArchiveConversation, pickFallbackColor } from '../../lib/conversations'
import { formatRelativeTime } from './relativeTime'

interface ConversationItemProps {
  conversation: Conversation
  active: boolean
  collapsed: boolean
  taskCount: number
  onSelect: () => void
  onDelete: () => void
}

/** 取标题首字符（兼容中文/emoji），用于折叠态图标。 */
function firstChar(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '?'
  // Array.from 能正确处理 surrogate pair 与多数 emoji
  return Array.from(trimmed)[0] ?? '?'
}

export default function ConversationItem({
  conversation,
  active,
  collapsed,
  taskCount,
  onSelect,
  onDelete,
}: ConversationItemProps) {
  const isArchive = isArchiveConversation(conversation.id)
  const dotColor = conversation.color || pickFallbackColor(conversation.id)
  const relTime = formatRelativeTime(conversation.updatedAt)
  const renameConversation = useStore((s) => s.renameConversation)

  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(conversation.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  /** 进入重命名模式时聚焦并全选 */
  useEffect(() => {
    if (!isRenaming) return
    const node = inputRef.current
    if (!node) return
    node.focus()
    node.select()
  }, [isRenaming])

  /** 外部点击 / Esc 关闭菜单 */
  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (menuButtonRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const startRename = () => {
    if (isArchive) return
    setDraftTitle(conversation.title)
    setIsRenaming(true)
    setMenuOpen(false)
  }

  const commitRename = () => {
    const trimmed = draftTitle.trim()
    if (!trimmed) {
      // 空字符串拒绝；恢复显示
      setIsRenaming(false)
      setDraftTitle(conversation.title)
      return
    }
    if (trimmed !== conversation.title) {
      void renameConversation(conversation.id, trimmed)
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setDraftTitle(conversation.title)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onSelect}
        title={`${conversation.title}（${taskCount} 个）`}
        aria-label={`切换到对话：${conversation.title}`}
        aria-current={active ? 'true' : undefined}
        className={`group relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
          active
            ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
        }`}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: dotColor }}
        >
          {firstChar(conversation.title)}
        </span>
      </button>
    )
  }

  return (
    <div
      className={`group relative flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
      }`}
    >
      {isRenaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
            maxLength={120}
            aria-label="重命名对话"
            className="flex-1 min-w-0 rounded-md border border-blue-300 bg-white px-2 py-1 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-blue-500/50 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-500/30"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={startRename}
          aria-current={active ? 'true' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={isArchive ? conversation.title : `${conversation.title}（双击重命名）`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{conversation.title}</span>
            <span className="truncate text-xs text-gray-400 dark:text-gray-500">
              {relTime}
              {taskCount > 0 ? ` · ${taskCount} 个` : ''}
            </span>
          </span>
        </button>
      )}

      {!isArchive && !isRenaming && (
        <div className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-600 group-hover:flex dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
            title="更多操作"
            aria-label={`对话操作菜单：${conversation.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="1.4" />
              <circle cx="12" cy="12" r="1.4" />
              <circle cx="12" cy="19" r="1.4" />
            </svg>
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label={`对话操作：${conversation.title}`}
              className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  startRename()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
                重命名
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  onDelete()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-500 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
                删除
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
