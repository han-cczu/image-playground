import type { Conversation, FavoriteCategory, TaskRecord } from '../types'
import {
  ARCHIVE_CONVERSATION_ID,
  createArchiveConversation,
} from './conversations'

export interface ReseedMigrationInput {
  tasks: TaskRecord[]
  favoriteCategories: FavoriteCategory[]
  existingConversations: Conversation[]
  now?: number
}

export interface ReseedMigrationResult {
  /** 迁移后完整的 conversations 列表（含原有 + 新建）。 */
  conversations: Conversation[]
  /** 因写入 conversationId 而发生变更的 task（需要 putTask 持久化）。 */
  dirtyTasks: TaskRecord[]
}

/**
 * 纯函数：按 favoriteCategory 切分旧 task 到对应 conversation。
 *
 * 规则：
 *   1) 每个 favoriteCategory 映射成一个 conversation，id 复用 categoryId 避免重复。
 *   2) 已有 conversation（同 id）保留其元数据，不覆盖 title/color/createdAt。
 *   3) 没有 favoriteCategoryId 的 task → 兜底 conversation = `__archive__`。
 *   4) 已有 conversationId 的 task 不再触碰（兜底向前兼容）。
 */
export function reseedConversationsFromFavoriteCategories(
  input: ReseedMigrationInput,
): ReseedMigrationResult {
  const now = input.now ?? Date.now()
  const conversationsById = new Map<string, Conversation>()
  for (const conv of input.existingConversations) {
    conversationsById.set(conv.id, conv)
  }

  // 1) 确保 archive 一定存在
  if (!conversationsById.has(ARCHIVE_CONVERSATION_ID)) {
    conversationsById.set(ARCHIVE_CONVERSATION_ID, createArchiveConversation(now))
  }

  // 2) 为每个 favoriteCategory 创建 conversation（id 复用 categoryId，避免重复）
  for (const category of input.favoriteCategories) {
    if (conversationsById.has(category.id)) continue
    conversationsById.set(category.id, {
      id: category.id,
      title: category.name || '新对话',
      createdAt: category.createdAt || now,
      updatedAt: category.createdAt || now,
      sortOrder: category.sortOrder,
      color: category.color ?? null,
    })
  }

  // 3) 给每个 task 分配 conversationId
  const dirtyTasks: TaskRecord[] = []
  for (const task of input.tasks) {
    if (typeof task.conversationId === 'string' && task.conversationId) continue

    const categoryId = task.favoriteCategoryId?.trim() || null
    let targetId = ARCHIVE_CONVERSATION_ID
    if (categoryId && conversationsById.has(categoryId)) {
      targetId = categoryId
    }
    dirtyTasks.push({ ...task, conversationId: targetId })
  }

  return {
    conversations: Array.from(conversationsById.values()),
    dirtyTasks,
  }
}
