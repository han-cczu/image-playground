import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { filterAndSortTasks } from './taskFilters'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'portrait',
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

describe('task filtering', () => {
  it('filters favorite records by category without showing non-favorites', () => {
    const tasks = [
      task({ id: 'cat-favorite', isFavorite: true, favoriteCategoryId: 'cat-a', createdAt: 1 }),
      task({ id: 'uncategorized-favorite', isFavorite: true, createdAt: 2 }),
      task({ id: 'stale-non-favorite', isFavorite: false, favoriteCategoryId: 'cat-a', createdAt: 3 }),
      task({ id: 'other-category', isFavorite: true, favoriteCategoryId: 'cat-b', createdAt: 4 }),
    ]

    const filtered = filterAndSortTasks(tasks, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterFavoriteCategoryId: 'cat-a',
    })

    expect(filtered.map((item) => item.id)).toEqual(['cat-favorite'])
  })

  it('keeps uncategorized favorites visible when filtering all favorites', () => {
    const tasks = [
      task({ id: 'plain-favorite', isFavorite: true, createdAt: 1 }),
      task({ id: 'categorized-favorite', isFavorite: true, favoriteCategoryId: 'cat-a', createdAt: 2 }),
      task({ id: 'plain-task', isFavorite: false, createdAt: 3 }),
    ]

    const filtered = filterAndSortTasks(tasks, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: true,
      filterFavoriteCategoryId: null,
    })

    expect(filtered.map((item) => item.id)).toEqual(['categorized-favorite', 'plain-favorite'])
  })

  it('filters by conversationId when provided', () => {
    const tasks = [
      task({ id: 'in-a', conversationId: 'conv-a', createdAt: 1 }),
      task({ id: 'in-b', conversationId: 'conv-b', createdAt: 2 }),
      task({ id: 'no-conv', createdAt: 3 }),
    ]

    const filtered = filterAndSortTasks(tasks, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterFavoriteCategoryId: null,
      filterConversationId: 'conv-a',
    })

    expect(filtered.map((item) => item.id)).toEqual(['in-a'])
  })

  it('combines conversationId filter with favorite category filter (intersection)', () => {
    const tasks = [
      task({
        id: 'a-fav',
        conversationId: 'conv-a',
        isFavorite: true,
        favoriteCategoryId: 'cat-a',
        createdAt: 1,
      }),
      task({
        id: 'b-fav',
        conversationId: 'conv-b',
        isFavorite: true,
        favoriteCategoryId: 'cat-a',
        createdAt: 2,
      }),
      task({
        id: 'a-non-fav',
        conversationId: 'conv-a',
        isFavorite: false,
        createdAt: 3,
      }),
    ]

    const filtered = filterAndSortTasks(tasks, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterFavoriteCategoryId: 'cat-a',
      filterConversationId: 'conv-a',
    })

    expect(filtered.map((item) => item.id)).toEqual(['a-fav'])
  })

  it('treats empty/undefined conversationId as no conversation filter', () => {
    const tasks = [
      task({ id: 'a', conversationId: 'conv-a', createdAt: 1 }),
      task({ id: 'b', conversationId: 'conv-b', createdAt: 2 }),
    ]

    const filtered = filterAndSortTasks(tasks, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterFavoriteCategoryId: null,
      filterConversationId: '',
    })

    expect(filtered.map((item) => item.id).sort()).toEqual(['a', 'b'])
  })
})
