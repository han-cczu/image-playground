import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from './fuzzyMatch'

describe('fuzzyMatch', () => {
  it('matches when query chars appear in order as a subsequence', () => {
    expect(fuzzyMatch('nwc', 'new conversation')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'new conversation')).toBeNull()
  })

  it('rejects when chars exist but out of order', () => {
    expect(fuzzyMatch('cn', 'nc')).toBeNull()
  })

  it('is case-insensitive on both sides', () => {
    expect(fuzzyMatch('NC', 'new conversation')).not.toBeNull()
    expect(fuzzyMatch('nc', 'NEW CONVERSATION')).not.toBeNull()
  })

  it('matches everything with score 0 on empty / whitespace-only query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
    expect(fuzzyMatch('   ', 'anything')).toEqual({ score: 0, indices: [] })
    expect(fuzzyMatch('', '')).toEqual({ score: 0, indices: [] })
  })

  it('ignores whitespace inside the query (multi-word query)', () => {
    const m = fuzzyMatch('new conv', 'New Conversation')
    expect(m).not.toBeNull()
  })

  it('returns null when text is empty but query is not', () => {
    expect(fuzzyMatch('a', '')).toBeNull()
  })

  it('scores consecutive runs higher than scattered matches', () => {
    const consecutive = fuzzyMatch('abc', 'abcdef')!
    const scattered = fuzzyMatch('abc', 'axbxcx')!
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('scores word-start matches higher than mid-word matches', () => {
    const wordStart = fuzzyMatch('nc', 'new conversation')!
    const midWord = fuzzyMatch('nc', 'inception')!
    expect(wordStart.score).toBeGreaterThan(midWord.score)
  })

  it('returns correct hit indices for highlighting', () => {
    expect(fuzzyMatch('nc', 'New Conversation')!.indices).toEqual([0, 4])
    expect(fuzzyMatch('abc', 'abc')!.indices).toEqual([0, 1, 2])
  })

  it('matches CJK text and treats CJK chars as word chars (no inflated word-start bonus)', () => {
    const m = fuzzyMatch('深色', '深色主题')!
    expect(m.indices).toEqual([0, 1])
    // 首字词首 + 第二字连续但非词首：3+1 + 1+2 = 7
    const midM = fuzzyMatch('色', '深色主题')!
    // '色' 前是汉字「深」(\p{L})，不算词首：仅基础分
    expect(midM.score).toBeLessThan(fuzzyMatch('深', '深色主题')!.score)
  })

  it('uses codepoint indices so emoji (surrogate pairs) do not shift hits', () => {
    // '🎨' 是一个码点；'a' 命中码点下标 1 而非 UTF-16 下标 2
    expect(fuzzyMatch('a', '🎨a')!.indices).toEqual([1])
  })
})
