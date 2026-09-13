import { memo, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { Conversation } from '../../types'
import { isArchiveConversation, pickFallbackColor } from '../../lib/conversations'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { formatRelativeTime } from './relativeTime'

interface ConversationItemProps {
  conversation: Conversation
  active: boolean
  collapsed: boolean
  taskCount: number
  /** 以 id 为参的稳定回调:配合 memo,任务增删只重渲染计数变化的对话项 */
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

/** 取标题首字符（兼容中文/emoji），用于折叠态图标。 */
function firstChar(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '?'
  // Array.from 能正确处理 surrogate pair 与多数 emoji
  return Array.from(trimmed)[0] ?? '?'
}

export default memo(function ConversationItem({
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
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
    }
  }, [menuOpen])

  // Esc 走全局栈:自建 document 监听会绕过 escStack,一次 Esc 把本菜单与其上层弹窗一起关掉
  useCloseOnEscape(menuOpen, () => setMenuOpen(false))

  // Enter 提交后 input 卸载会再触发 onBlur→commitRename;用一次性标志防止重复 renameConversation 写入
  const committingRef = useRef(false)

  const startRename = () => {
    if (isArchive) return
    committingRef.current = false
    setDraftTitle(conversation.title)
    setIsRenaming(true)
    setMenuOpen(false)
  }

  const commitRename = () => {
    if (committingRef.current) return
    committingRef.current = true
    const trimmed = draftTitle.trim()
    if (!trimmed) {
      // 空字符串拒绝；恢复显示
      setIsRenaming(false)
      setDraftTitle(conversation.title)
      return
    }
    if (trimmed !== conversation.title) {
      void renameConversation(conversation.id, trimmed).catch(() => {
        /* store action already restores state and surfaces the error */
      })
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    committingRef.current = true
    setIsRenaming(false)
    setDraftTitle(conversation.title)
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        title={`${conversation.title}（${taskCount} 个）`}
        aria-label={`切换到对话：${conversation.title}`}
        aria-current={active ? 'true' : undefined}
        className={`group relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
          active
            ? 'bg-brand-soft text-brand-ink ring-1 ring-brand/20'
            : 'text-content-muted hover:bg-surface-raised'
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
          ? 'bg-brand-soft text-brand-ink'
          : 'text-content-muted hover:bg-surface-raised hover:text-content'
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
              // IME 守卫:中文组字确认的 Enter/Esc 是输入法操作,不是提交/取消(与片段库输入框同款)
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
            className="ui-field min-w-0 flex-1 px-2 py-1 text-sm focus:border-brand"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(conversation.id)}
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
            <span className="truncate text-xs text-content-subtle">
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
            className={`${
              // 菜单打开时强制可见:hover 设备上鼠标移出对话行后菜单仍开着,
              // 触发按钮若回到 display:none,aria-expanded=true 的按钮会从渲染树消失,
              // 包裹 div 塌缩还会让标题回流、已开菜单锚点上跳
              // any-pointer:coarse 兜住混合设备(hover:hover 的触屏本,hover:none 不匹配);
              // group-focus-within 兜住键盘通道(display:none 不进 Tab 序)
              menuOpen
                ? 'flex'
                : 'hidden group-hover:flex group-focus-within:flex [@media(hover:none)]:flex [@media(any-pointer:coarse)]:flex'
            } h-8 w-8 shrink-0 items-center justify-center rounded-lg text-content-subtle hover:bg-surface-raised hover:text-content [@media(any-pointer:coarse)]:min-h-11 [@media(any-pointer:coarse)]:min-w-11`}
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
              className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-line bg-surface-raised p-1 shadow-popover"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  startRename()
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-content hover:bg-surface-muted"
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
                  onDelete(conversation.id)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-500 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
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
})
