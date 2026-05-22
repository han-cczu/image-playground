import { describe, expect, it } from 'vitest'
import type { Conversation } from '../types'
import {
  ARCHIVE_CONVERSATION_ID,
  ARCHIVE_CONVERSATION_TITLE,
  findReusableEmptyConversation,
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

describe('findReusableEmptyConversation', () => {
  it('空 conversations 列表 → 返回 null', () => {
    const result = findReusableEmptyConversation([], new Map())
    expect(result).toBeNull()
  })

  it('唯一一个空"新对话" → 命中', () => {
    const conv = makeConversation({ id: 'a' })
    const result = findReusableEmptyConversation([conv], new Map())
    expect(result).not.toBeNull()
    expect(result?.id).toBe('a')
  })

  it('多个空"新对话" → 返回 createdAt 最大的（最近创建的）', () => {
    const older = makeConversation({ id: 'older', createdAt: 1000 })
    const newer = makeConversation({ id: 'newer', createdAt: 3000 })
    const middle = makeConversation({ id: 'middle', createdAt: 2000 })
    const result = findReusableEmptyConversation(
      [older, newer, middle],
      new Map(),
    )
    expect(result?.id).toBe('newer')
  })

  it('已重命名的对话（title !== "新对话"）→ 不命中', () => {
    const renamed = makeConversation({ id: 'renamed', title: '我的项目' })
    const result = findReusableEmptyConversation([renamed], new Map())
    expect(result).toBeNull()
  })

  it('有 task 的对话（taskCount > 0）→ 不命中', () => {
    const conv = makeConversation({ id: 'has-task' })
    const taskCount = new Map<string, number>([['has-task', 2]])
    const result = findReusableEmptyConversation([conv], taskCount)
    expect(result).toBeNull()
  })

  it('archive 对话（"历史记录"）→ 不命中，即使 task count 为 0', () => {
    // 即使 title 偶然等于默认值，archive 也不应被识别为可复用
    const archive = makeConversation({
      id: ARCHIVE_CONVERSATION_ID,
      title: '新对话', // 故意构造同名标题
    })
    const result = findReusableEmptyConversation([archive], new Map())
    expect(result).toBeNull()
  })

  it('archive 真实场景（title="历史记录"）→ 不命中', () => {
    const archive = makeConversation({
      id: ARCHIVE_CONVERSATION_ID,
      title: ARCHIVE_CONVERSATION_TITLE,
    })
    const result = findReusableEmptyConversation([archive], new Map())
    expect(result).toBeNull()
  })

  it('混合场景：从多个对话中只挑空"新对话"且选最新的', () => {
    const empty1 = makeConversation({ id: 'e1', createdAt: 1000 })
    const renamed = makeConversation({
      id: 'renamed',
      title: '已命名',
      createdAt: 5000, // 即使最新，因已重命名也不应命中
    })
    const empty2 = makeConversation({ id: 'e2', createdAt: 2000 })
    const withTask = makeConversation({ id: 'with-task', createdAt: 4000 })
    const archive = makeConversation({
      id: ARCHIVE_CONVERSATION_ID,
      title: ARCHIVE_CONVERSATION_TITLE,
      createdAt: 9999,
    })
    const taskCount = new Map<string, number>([['with-task', 1]])
    const result = findReusableEmptyConversation(
      [empty1, renamed, empty2, withTask, archive],
      taskCount,
    )
    expect(result?.id).toBe('e2')
  })

  it('自定义 defaultTitle 参数生效', () => {
    const conv = makeConversation({ id: 'custom', title: 'New Chat' })
    const result = findReusableEmptyConversation([conv], new Map(), 'New Chat')
    expect(result?.id).toBe('custom')
  })

  it('多个 createdAt 完全相等 → 返回先遇到的（reduce 默认稳定行为）', () => {
    const first = makeConversation({ id: 'first', createdAt: 1000 })
    const second = makeConversation({ id: 'second', createdAt: 1000 })
    const third = makeConversation({ id: 'third', createdAt: 1000 })
    const result = findReusableEmptyConversation(
      [first, second, third],
      new Map(),
    )
    // reduce 用严格大于 (>)，相等时保留 latest（数组首项），等价于"先遇到的"
    expect(result?.id).toBe('first')
  })

  it('入参 conversations 不被 mutate（纯函数保证）', () => {
    const a = makeConversation({ id: 'a', createdAt: 1000 })
    const b = makeConversation({ id: 'b', createdAt: 2000 })
    const input = [a, b]
    const snapshot = [...input]
    findReusableEmptyConversation(input, new Map())
    expect(input).toEqual(snapshot)
    expect(input[0]).toBe(a)
    expect(input[1]).toBe(b)
  })
})
