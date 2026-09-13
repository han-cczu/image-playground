import { describe, expect, it } from 'vitest'
import type { Conversation } from '../types'
import {
  ARCHIVE_CONVERSATION_ID,
  ARCHIVE_CONVERSATION_TITLE,
  isConversationLimitReached,
  MAX_CONVERSATION_ID_LEN,
  MAX_CONVERSATIONS,
  normalizeConversations,
} from './conversations'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: '新对话',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('normalizeConversations', () => {
  it('caps imported conversations and clamps untrusted titles', () => {
    const conversations = Array.from({ length: 550 }, (_, i) => ({
      id: `conv-${i}`,
      title: `  ${'x'.repeat(90)}-${i}  `,
      createdAt: i,
      updatedAt: 1000 - i,
      sortOrder: i,
    }))

    const result = normalizeConversations(conversations)

    expect(result).toHaveLength(500)
    expect(result[0]).toEqual({
      id: 'conv-0',
      title: 'x'.repeat(80),
      createdAt: 0,
      updatedAt: 1000,
      sortOrder: 0,
      color: undefined,
    })
    expect(result.find((conversation) => conversation.id === 'conv-549')).toBeUndefined()
  })

  it('普通对话满额时截掉的是 updatedAt 最旧的普通对话,「历史记录」永远保留且沉底', () => {
    const regular = Array.from({ length: MAX_CONVERSATIONS }, (_, i) => ({
      id: `conv-${i}`,
      title: `对话 ${i}`,
      createdAt: i,
      updatedAt: 1000 + i,
    }))
    const archive = {
      id: ARCHIVE_CONVERSATION_ID,
      title: ARCHIVE_CONVERSATION_TITLE,
      createdAt: 0,
      updatedAt: 0,
    }

    const result = normalizeConversations([archive, ...regular])

    expect(result).toHaveLength(MAX_CONVERSATIONS)
    expect(result[result.length - 1].id).toBe(ARCHIVE_CONVERSATION_ID)
    expect(result.find((c) => c.id === 'conv-0')).toBeUndefined()
    expect(result.find((c) => c.id === `conv-${MAX_CONVERSATIONS - 1}`)).toBeDefined()
    // 幂等:initStore 会用 [archive, ...已归一化结果] 再归一化一次,不能再次截掉 archive
    const again = normalizeConversations([archive, ...result])
    expect(again.map((c) => c.id)).toEqual(result.map((c) => c.id))
  })

  it('isConversationLimitReached 只数普通对话,阈值与 normalizeConversations 留给 archive 的位置一致', () => {
    const archive = makeConversation({ id: ARCHIVE_CONVERSATION_ID })
    const regular = (n: number) =>
      Array.from({ length: n }, (_, i) => makeConversation({ id: `conv-${i}` }))
    expect(isConversationLimitReached([archive, ...regular(MAX_CONVERSATIONS - 2)])).toBe(false)
    expect(isConversationLimitReached([archive, ...regular(MAX_CONVERSATIONS - 1)])).toBe(true)
    expect(isConversationLimitReached(regular(MAX_CONVERSATIONS - 1))).toBe(true)
  })

  it('caps imported conversation ids and drops invalid colors', () => {
    const longId = 'conv-'.repeat(MAX_CONVERSATION_ID_LEN + 10)

    const result = normalizeConversations([
      {
        id: longId,
        title: '安全边界',
        color: 'not-a-color'.repeat(1000),
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'valid-color',
        title: '颜色',
        color: '#14b8a6',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'null-color',
        title: '默认颜色',
        color: null,
        createdAt: 1,
        updatedAt: 0,
      },
    ])

    expect(result[0]).toMatchObject({
      id: longId.slice(0, MAX_CONVERSATION_ID_LEN),
      color: undefined,
    })
    expect(result.find((conversation) => conversation.id === 'valid-color')?.color).toBe('#14b8a6')
    expect(result.find((conversation) => conversation.id === 'null-color')?.color).toBeNull()
  })
})
