import { describe, it, expect } from 'vitest'
import { pushBounded } from './useMaskHistory'

describe('pushBounded', () => {
  it('在达到上限后丢弃最旧的项（cap=40）', () => {
    const stack: number[] = []
    for (let i = 0; i < 45; i++) pushBounded(stack, i, 40)
    // 共压入 45 项，超出 40 的最旧 5 项被丢弃，保留 5..44
    expect(stack.length).toBe(40)
    expect(stack[0]).toBe(5)
    expect(stack[stack.length - 1]).toBe(44)
  })

  it('就地修改并返回同一数组引用', () => {
    const stack: string[] = []
    const result = pushBounded(stack, 'a', 40)
    expect(result).toBe(stack)
    expect(stack).toEqual(['a'])
  })

  it('undo/redo 对称：从 undo 弹出的快照压入 redo 后总量守恒', () => {
    const undo: number[] = []
    const redo: number[] = []
    pushBounded(undo, 1, 40)
    pushBounded(undo, 2, 40)
    pushBounded(undo, 3, 40)
    // 模拟一次 undo：从 undo 弹出，压入 redo
    const popped = undo.pop()!
    pushBounded(redo, popped, 40)
    expect(undo).toEqual([1, 2])
    expect(redo).toEqual([3])
    expect(undo.length + redo.length).toBe(3)
    // 模拟一次 redo：从 redo 弹出，压回 undo
    const back = redo.pop()!
    pushBounded(undo, back, 40)
    expect(undo).toEqual([1, 2, 3])
    expect(redo).toEqual([])
  })

  it('未达上限时不丢弃（clear 后压入一张快照仍保留）', () => {
    const undo: number[] = []
    pushBounded(undo, 99, 40)
    expect(undo.length).toBe(1)
    expect(undo[0]).toBe(99)
  })
})
