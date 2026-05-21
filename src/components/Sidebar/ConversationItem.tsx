import type { Conversation } from '../../types'
import { isArchiveConversation } from '../../lib/conversations'
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

/** 简易 hash → 取色（按 id 稳定地从一组品牌色里挑一个，仅用于折叠态图标背景兜底）。 */
const FALLBACK_COLORS = ['#3b82f6', '#f59e0b', '#14b8a6', '#a855f7', '#ef4444', '#22c55e', '#ec4899', '#64748b']
function pickFallbackColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length]
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
      className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium" title={conversation.title}>
            {conversation.title}
          </span>
          <span className="truncate text-xs text-gray-400 dark:text-gray-500">
            {relTime}
            {taskCount > 0 ? ` · ${taskCount} 个` : ''}
          </span>
        </span>
      </button>
      {!isArchive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500 group-hover:flex dark:hover:bg-red-500/10"
          title="删除对话"
          aria-label={`删除对话：${conversation.title}`}
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
        </button>
      )}
    </div>
  )
}
