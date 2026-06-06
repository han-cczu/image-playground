import { describe, expect, it } from 'vitest'
import {
  genSnippetId,
  insertAtCursor,
  MAX_SNIPPET_CONTENT_LEN,
  MAX_SNIPPET_NAME_LEN,
  MAX_SNIPPETS,
  mergeSnippets,
  normalizeSnippets,
} from './promptSnippets'
import type { PromptSnippet } from '../types'

function makeSnippet(overrides: Partial<PromptSnippet> = {}): PromptSnippet {
  return {
    id: 'snip-1',
    name: '片段',
    content: '内容',
    createdAt: 100,
    updatedAt: 100,
    sortOrder: 0,
    ...overrides,
  }
}

describe('genSnippetId', () => {
  it('generates unique ids with the snip- prefix', () => {
    const a = genSnippetId()
    const b = genSnippetId()
    expect(a).toMatch(/^snip-/)
    expect(a).not.toBe(b)
  })
})

describe('normalizeSnippets', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeSnippets(undefined)).toEqual([])
    expect(normalizeSnippets(null)).toEqual([])
    expect(normalizeSnippets('x')).toEqual([])
    expect(normalizeSnippets({})).toEqual([])
  })

  it('skips entries without a valid id or content', () => {
    const result = normalizeSnippets([
      null,
      'str',
      { id: '', content: 'a' },
      { id: 's1' }, // 无 content
      { id: 's2', content: '   ' }, // 空白 content
      { id: 's3', content: 'ok' },
    ])
    expect(result.map((s) => s.id)).toEqual(['s3'])
  })

  it('patches missing fields and clamps name/content length', () => {
    const longName = 'n'.repeat(MAX_SNIPPET_NAME_LEN + 10)
    const longContent = 'c'.repeat(MAX_SNIPPET_CONTENT_LEN + 10)
    const [s] = normalizeSnippets([{ id: 's1', name: longName, content: longContent }], 999)
    expect(s.name).toHaveLength(MAX_SNIPPET_NAME_LEN)
    expect(s.content).toHaveLength(MAX_SNIPPET_CONTENT_LEN)
    expect(s.createdAt).toBe(999)
    expect(s.updatedAt).toBe(999)
    expect(s.sortOrder).toBe(0)
  })

  it('falls back to 未命名片段 when name is blank', () => {
    const [s] = normalizeSnippets([{ id: 's1', name: '  ', content: 'a' }])
    expect(s.name).toBe('未命名片段')
  })

  it('dedupes by id keeping the last occurrence', () => {
    const result = normalizeSnippets([
      { id: 's1', content: 'old' },
      { id: 's1', content: 'new' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('new')
  })

  it('sorts by sortOrder then createdAt and compacts sortOrder to consecutive ints', () => {
    const result = normalizeSnippets([
      makeSnippet({ id: 'b', sortOrder: 5 }),
      makeSnippet({ id: 'a', sortOrder: 2 }),
      makeSnippet({ id: 'c', sortOrder: 5, createdAt: 50 }),
    ])
    expect(result.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(result.map((s) => s.sortOrder)).toEqual([0, 1, 2])
  })

  it('truncates to MAX_SNIPPETS', () => {
    const many = Array.from({ length: MAX_SNIPPETS + 20 }, (_, i) =>
      makeSnippet({ id: `s${i}`, sortOrder: i }),
    )
    expect(normalizeSnippets(many)).toHaveLength(MAX_SNIPPETS)
  })
})

describe('mergeSnippets', () => {
  it('keeps local snippets on id conflict and appends new ones', () => {
    const local = [makeSnippet({ id: 's1', content: 'local' })]
    const imported = [
      makeSnippet({ id: 's1', content: 'imported' }),
      makeSnippet({ id: 's2', content: 'new' }),
    ]
    const result = mergeSnippets(local, imported)
    expect(result.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result[0].content).toBe('local')
  })

  it('handles empty sides', () => {
    const one = [makeSnippet()]
    expect(mergeSnippets([], one).map((s) => s.id)).toEqual(['snip-1'])
    expect(mergeSnippets(one, []).map((s) => s.id)).toEqual(['snip-1'])
  })
})

describe('insertAtCursor', () => {
  it('inserts at a collapsed cursor in the middle', () => {
    expect(insertAtCursor('ab', 1, 1, 'X')).toEqual({ next: 'aXb', caret: 2 })
  })

  it('inserts at head and tail', () => {
    expect(insertAtCursor('ab', 0, 0, 'X')).toEqual({ next: 'Xab', caret: 1 })
    expect(insertAtCursor('ab', 2, 2, 'X')).toEqual({ next: 'abX', caret: 3 })
  })

  it('replaces the selection range', () => {
    expect(insertAtCursor('hello world', 0, 5, 'bye')).toEqual({ next: 'bye world', caret: 3 })
  })

  it('swaps selStart > selEnd', () => {
    expect(insertAtCursor('hello world', 5, 0, 'bye')).toEqual({ next: 'bye world', caret: 3 })
  })

  it('clamps out-of-range and non-finite indices', () => {
    expect(insertAtCursor('ab', -5, 99, 'X')).toEqual({ next: 'X', caret: 1 })
    expect(insertAtCursor('ab', Number.NaN, Number.NaN, 'X')).toEqual({ next: 'abX', caret: 3 })
  })

  it('works with empty text and empty snippet', () => {
    expect(insertAtCursor('', 0, 0, 'X')).toEqual({ next: 'X', caret: 1 })
    expect(insertAtCursor('ab', 1, 1, '')).toEqual({ next: 'ab', caret: 1 })
  })

  it('uses UTF-16 indices (matches textarea selection semantics around surrogate pairs)', () => {
    // '🎨' 占 2 个 UTF-16 单元;textarea 的 selectionStart 同样按 UTF-16 计
    expect(insertAtCursor('🎨b', 2, 2, 'X')).toEqual({ next: '🎨Xb', caret: 3 })
  })
})
