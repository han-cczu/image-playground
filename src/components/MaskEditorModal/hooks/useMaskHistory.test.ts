import { describe, it, expect } from 'vitest'
import { HISTORY_BYTE_BUDGET, imageDataBytes, pushBounded, pushBudgeted } from './useMaskHistory'

/** 构造指定字节数的伪 ImageData(node 环境无 ImageData 构造器,只需 data.byteLength) */
function fakeImageData(bytes: number, tag = 0): ImageData {
  return { data: { byteLength: bytes }, width: 0, height: 0, colorSpace: 'srgb', tag } as unknown as ImageData
}

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

describe('pushBudgeted(M24 字节预算)', () => {
  const MB = 1024 * 1024

  it('小快照仅受条数上限约束(行为与 pushBounded 等价)', () => {
    const stack: ImageData[] = []
    for (let i = 0; i < 45; i++) pushBudgeted(stack, fakeImageData(4 * MB, i), { maxEntries: 40, byteBudget: 256 * MB })
    expect(stack.length).toBe(40)
    expect((stack[0] as unknown as { tag: number }).tag).toBe(5)
  })

  it('大快照按字节预算从最旧端驱逐:1920 尺寸(约 14.1MiB/张)在 256MiB 预算下只留约 18 张', () => {
    const snapshot = 1920 * 1920 * 4
    const stack: ImageData[] = []
    for (let i = 0; i < 40; i++) pushBudgeted(stack, fakeImageData(snapshot, i), { maxEntries: 40, byteBudget: HISTORY_BYTE_BUDGET })
    const totalBytes = stack.reduce((sum, img) => sum + imageDataBytes(img), 0)
    expect(totalBytes).toBeLessThanOrEqual(HISTORY_BYTE_BUDGET)
    expect(stack.length).toBe(Math.floor(HISTORY_BYTE_BUDGET / snapshot))
    // 留下的是最新的若干张
    expect((stack[stack.length - 1] as unknown as { tag: number }).tag).toBe(39)
  })

  it('最新项永不被逐:单张快照超预算时仍保留(undo 不至于完全失效)', () => {
    const stack: ImageData[] = []
    pushBudgeted(stack, fakeImageData(512 * MB, 1), { maxEntries: 40, byteBudget: 256 * MB })
    expect(stack.length).toBe(1)
  })

  it('reservedBytes(另一栈占用)计入同一预算', () => {
    const stack: ImageData[] = []
    for (let i = 0; i < 10; i++) pushBudgeted(stack, fakeImageData(10 * MB, i), { maxEntries: 40, byteBudget: 100 * MB, reservedBytes: 50 * MB })
    const totalBytes = stack.reduce((sum, img) => sum + imageDataBytes(img), 0)
    expect(totalBytes + 50 * MB).toBeLessThanOrEqual(100 * MB)
    expect(stack.length).toBe(5)
  })
})
