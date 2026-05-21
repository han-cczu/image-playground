import type { Conversation } from '../types'

/** 「历史记录」对话固定 id，承载未归类（无 favoriteCategoryId）的旧任务，不允许删除。 */
export const ARCHIVE_CONVERSATION_ID = '__archive__'
export const ARCHIVE_CONVERSATION_TITLE = '历史记录'

/** 迁移版本：写入 localStorage 防止 reseed 重跑。 */
export const CONVERSATION_MIGRATION_VERSION = 1
export const CONVERSATION_MIGRATION_VERSION_KEY = 'image-playground.conversationMigrationVersion'

let conversationUid = 0
export function genConversationId(): string {
  return `conv-${Date.now().toString(36)}-${(++conversationUid).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createArchiveConversation(now = Date.now()): Conversation {
  return {
    id: ARCHIVE_CONVERSATION_ID,
    title: ARCHIVE_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    sortOrder: Number.MAX_SAFE_INTEGER,
    color: null,
  }
}

export function isArchiveConversation(id: string | null | undefined): boolean {
  return id === ARCHIVE_CONVERSATION_ID
}

/**
 * 归一化对话列表：跳过无效 id、修补缺失字段、按 updatedAt 降序输出（archive 永远最末）。
 */
export function normalizeConversations(
  conversations: unknown,
  now = Date.now(),
): Conversation[] {
  if (!Array.isArray(conversations)) return []

  const byId = new Map<string, Conversation>()
  conversations.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    const item = entry as Partial<Conversation>
    if (typeof item.id !== 'string' || !item.id.trim()) return

    const createdAt =
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now
    const updatedAt =
      typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : createdAt

    byId.set(item.id, {
      id: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title : '新对话',
      createdAt,
      updatedAt,
      sortOrder:
        typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder)
          ? item.sortOrder
          : index,
      color: typeof item.color === 'string' ? item.color : item.color === null ? null : undefined,
    })
  })

  return Array.from(byId.values()).sort((a, b) => {
    // archive 永远沉底
    if (a.id === ARCHIVE_CONVERSATION_ID && b.id !== ARCHIVE_CONVERSATION_ID) return 1
    if (b.id === ARCHIVE_CONVERSATION_ID && a.id !== ARCHIVE_CONVERSATION_ID) return -1
    return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  })
}

/** 取 prompt 前 N 字符作为对话标题（去掉换行、压缩空白）。 */
export function deriveConversationTitleFromPrompt(prompt: string, maxLen = 24): string {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  if (!compact) return '新对话'
  return compact.length > maxLen ? compact.slice(0, maxLen) : compact
}

/** 读取已写入的迁移版本（localStorage），失败/缺失返回 0。 */
export function readConversationMigrationVersion(): number {
  try {
    if (typeof localStorage === 'undefined') return 0
    const raw = localStorage.getItem(CONVERSATION_MIGRATION_VERSION_KEY)
    if (!raw) return 0
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

/** 写入迁移版本（localStorage），出错时静默忽略。 */
export function writeConversationMigrationVersion(version: number): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(CONVERSATION_MIGRATION_VERSION_KEY, String(version))
  } catch {
    /* ignore */
  }
}
