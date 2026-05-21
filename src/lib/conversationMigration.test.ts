import { describe, expect, it } from 'vitest'
import type { FavoriteCategory, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { reseedConversationsFromFavoriteCategories } from './conversationMigration'
import { ARCHIVE_CONVERSATION_ID } from './conversations'

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function createCategory(id: string, name: string): FavoriteCategory {
  return {
    id,
    name,
    color: '#f59e0b',
    sortOrder: 0,
    createdAt: 100,
  }
}

describe('reseedConversationsFromFavoriteCategories', () => {
  it('creates one conversation per favoriteCategory and assigns tasks accordingly', () => {
    const tasks = [
      createTask({ id: 't1', favoriteCategoryId: 'cat-a', isFavorite: true }),
      createTask({ id: 't2', favoriteCategoryId: 'cat-b', isFavorite: true }),
      createTask({ id: 't3' }),
    ]
    const categories = [createCategory('cat-a', '角色'), createCategory('cat-b', '场景')]

    const result = reseedConversationsFromFavoriteCategories({
      tasks,
      favoriteCategories: categories,
      existingConversations: [],
      now: 999,
    })

    expect(result.conversations.map((c) => c.id).sort()).toEqual(
      ['cat-a', 'cat-b', ARCHIVE_CONVERSATION_ID].sort(),
    )
    expect(result.dirtyTasks.find((t) => t.id === 't1')?.conversationId).toBe('cat-a')
    expect(result.dirtyTasks.find((t) => t.id === 't2')?.conversationId).toBe('cat-b')
    expect(result.dirtyTasks.find((t) => t.id === 't3')?.conversationId).toBe(ARCHIVE_CONVERSATION_ID)
  })

  it('reuses categoryId as conversationId and copies title/color', () => {
    const result = reseedConversationsFromFavoriteCategories({
      tasks: [],
      favoriteCategories: [createCategory('cat-a', '角色')],
      existingConversations: [],
    })

    const conv = result.conversations.find((c) => c.id === 'cat-a')
    expect(conv).toMatchObject({
      id: 'cat-a',
      title: '角色',
      color: '#f59e0b',
    })
  })

  it('does not overwrite an existing conversation with the same id', () => {
    const existing = {
      id: 'cat-a',
      title: '已重命名',
      createdAt: 1,
      updatedAt: 2,
      color: '#000000',
    }
    const result = reseedConversationsFromFavoriteCategories({
      tasks: [],
      favoriteCategories: [createCategory('cat-a', '角色')],
      existingConversations: [existing],
    })

    expect(result.conversations.find((c) => c.id === 'cat-a')).toEqual(existing)
  })

  it('skips tasks that already have a conversationId', () => {
    const result = reseedConversationsFromFavoriteCategories({
      tasks: [createTask({ id: 't1', conversationId: 'preset' })],
      favoriteCategories: [],
      existingConversations: [],
    })

    expect(result.dirtyTasks).toHaveLength(0)
  })

  it('routes tasks pointing to a missing favoriteCategoryId to archive', () => {
    const result = reseedConversationsFromFavoriteCategories({
      tasks: [createTask({ id: 't1', favoriteCategoryId: 'missing-cat' })],
      favoriteCategories: [],
      existingConversations: [],
    })

    expect(result.dirtyTasks[0].conversationId).toBe(ARCHIVE_CONVERSATION_ID)
  })

  it('is idempotent: running twice yields no new dirty tasks', () => {
    const tasks = [createTask({ id: 't1', favoriteCategoryId: 'cat-a' })]
    const cats = [createCategory('cat-a', '角色')]

    const first = reseedConversationsFromFavoriteCategories({
      tasks,
      favoriteCategories: cats,
      existingConversations: [],
    })

    // 应用第一次的 dirty patch
    const dirtyById = new Map(first.dirtyTasks.map((t) => [t.id, t]))
    const tasksAfter = tasks.map((t) => dirtyById.get(t.id) ?? t)

    const second = reseedConversationsFromFavoriteCategories({
      tasks: tasksAfter,
      favoriteCategories: cats,
      existingConversations: first.conversations,
    })

    expect(second.dirtyTasks).toHaveLength(0)
  })
})
