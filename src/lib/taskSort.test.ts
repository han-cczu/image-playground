import { describe, expect, it } from 'vitest'
import { computeReorderedSortOrders, SORT_STEP } from './taskSort'

describe('computeReorderedSortOrders', () => {
  it('移到 prev 之后 / next 之前:顺序与整数化降序正确', () => {
    // [a,b,c] 把 c 移到 a 之后、b 之前 → a,c,b
    const orders = computeReorderedSortOrders(['a', 'b', 'c'], 'c', 'a', 'b')
    expect(orders.get('a')).toBe(3 * SORT_STEP)
    expect(orders.get('c')).toBe(2 * SORT_STEP)
    expect(orders.get('b')).toBe(1 * SORT_STEP)
  })

  it('移到最前(无 prev)', () => {
    const orders = computeReorderedSortOrders(['a', 'b', 'c'], 'c', null, 'a')
    expect(orders.get('c')).toBe(3 * SORT_STEP)
    expect(orders.get('a')).toBe(2 * SORT_STEP)
    expect(orders.get('b')).toBe(1 * SORT_STEP)
  })

  it('移到最后(无 next)', () => {
    const orders = computeReorderedSortOrders(['a', 'b', 'c'], 'a', 'c', null)
    expect(orders.get('b')).toBe(3 * SORT_STEP)
    expect(orders.get('c')).toBe(2 * SORT_STEP)
    expect(orders.get('a')).toBe(1 * SORT_STEP)
  })

  it('结果互异且严格降序(自愈后可继续二分插入)', () => {
    const orders = computeReorderedSortOrders(['a', 'b', 'c', 'd'], 'b', 'd', null)
    // 顺序 a,c,d,b
    const vals = ['a', 'c', 'd', 'b'].map((id) => orders.get(id)!)
    for (let i = 1; i < vals.length; i++) expect(vals[i - 1]).toBeGreaterThan(vals[i])
    expect(new Set(vals).size).toBe(4)
  })
})
