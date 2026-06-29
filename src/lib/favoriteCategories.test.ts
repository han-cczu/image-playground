import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FAVORITE_CATEGORY_COLOR,
  MAX_FAVORITE_CATEGORY_ID_LEN,
  mergeFavoriteCategories,
  normalizeFavoriteCategories,
} from './favoriteCategories'

describe('normalizeFavoriteCategories', () => {
  it('caps imported categories and clamps untrusted names', () => {
    const oversized = Array.from({ length: 250 }, (_, i) => ({
      id: `cat-${i}`,
      name: `  ${'x'.repeat(80)}-${i}  `,
      color: i === 249 ? '#14b8a6' : 'invalid',
      sortOrder: i,
      createdAt: i,
    }))

    const result = normalizeFavoriteCategories(oversized)

    expect(result).toHaveLength(200)
    expect(result[0]).toEqual({
      id: 'cat-0',
      name: 'x'.repeat(50),
      color: DEFAULT_FAVORITE_CATEGORY_COLOR,
      sortOrder: 0,
      createdAt: 0,
    })
    expect(result[result.length - 1]?.id).toBe('cat-199')
    expect(result.find((category) => category.id === 'cat-249')).toBeUndefined()
  })

  it('caps imported category ids so bounded arrays cannot carry unbounded strings', () => {
    const longId = 'cat-'.repeat(MAX_FAVORITE_CATEGORY_ID_LEN + 10)

    const result = normalizeFavoriteCategories([{ id: longId, name: '角色' }])

    expect(result[0].id).toHaveLength(MAX_FAVORITE_CATEGORY_ID_LEN)
  })
})

describe('mergeFavoriteCategories', () => {
  it('re-caps merged categories when both sides are individually large', () => {
    const local = normalizeFavoriteCategories(
      Array.from({ length: 200 }, (_, i) => ({
        id: `local-${i}`,
        name: `local-${i}`,
        color: '#14b8a6',
        sortOrder: i,
        createdAt: i,
      })),
    )
    const imported = normalizeFavoriteCategories(
      Array.from({ length: 200 }, (_, i) => ({
        id: `imported-${i}`,
        name: `imported-${i}`,
        color: '#3b82f6',
        sortOrder: 1000 + i,
        createdAt: 1000 + i,
      })),
    )

    const result = mergeFavoriteCategories(local, imported)

    expect(result).toHaveLength(200)
    expect(result[0]?.id).toBe('local-0')
    expect(result[result.length - 1]?.id).toBe('local-199')
    expect(result.find((category) => category.id === 'imported-0')).toBeUndefined()
  })
})
