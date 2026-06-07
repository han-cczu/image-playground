import { describe, expect, it } from 'vitest'
import {
  computeSafeCellSize,
  computeSheetLayout,
  MAX_BATCH_NOTE_LEN,
  MAX_BATCH_NOTES,
  mergeBatchNotes,
  normalizeBatchNotes,
  pickCellRepresentative,
  SHEET_CELL_SIZE,
  SHEET_COL_HEADER_H,
  SHEET_GAP,
  SHEET_MAX_EDGE,
  SHEET_MIN_CELL_SIZE,
  SHEET_NOTE_LINE_H,
  SHEET_NOTE_MAX_LINES,
  SHEET_PADDING,
  SHEET_ROW_HEADER_W,
} from './gridSheet'
import { DEFAULT_PARAMS } from '../types'
import type { TaskRecord } from '../types'

/** 测试用:每字符 10px 的等宽近似 */
const measure10 = (text: string) => Array.from(text).length * 10

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    prompt: 'p',
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

describe('computeSheetLayout', () => {
  it('computes width/height for a 2x2 grid with Y axis and no note', () => {
    const layout = computeSheetLayout({ cols: 2, rows: 2, hasY: true, measureWidth: measure10 })
    const expectedWidth =
      SHEET_PADDING * 2 + SHEET_ROW_HEADER_W + SHEET_GAP + 2 * SHEET_CELL_SIZE + SHEET_GAP
    expect(layout.width).toBe(expectedWidth)
    const cellsTop = SHEET_PADDING + SHEET_COL_HEADER_H + SHEET_GAP
    expect(layout.height).toBe(cellsTop + 2 * SHEET_CELL_SIZE + SHEET_GAP + SHEET_PADDING)
    expect(layout.noteLines).toEqual([])
    expect(layout.noteRect).toBeNull()
  })

  it('omits the row header column without a Y axis', () => {
    const layout = computeSheetLayout({ cols: 3, rows: 1, hasY: false, measureWidth: measure10 })
    expect(layout.width).toBe(SHEET_PADDING * 2 + 3 * SHEET_CELL_SIZE + 2 * SHEET_GAP)
    expect(layout.rowHeaderRect(0).w).toBe(0)
    // 首格紧贴 padding(无行头与其 gap)
    expect(layout.cellRect(0, 0).x).toBe(SHEET_PADDING)
  })

  it('positions rects on the expected grid lines', () => {
    const layout = computeSheetLayout({ cols: 2, rows: 2, hasY: true, measureWidth: measure10 })
    const c00 = layout.cellRect(0, 0)
    const c11 = layout.cellRect(1, 1)
    expect(c11.x - c00.x).toBe(SHEET_CELL_SIZE + SHEET_GAP)
    expect(c11.y - c00.y).toBe(SHEET_CELL_SIZE + SHEET_GAP)
    // 列头与数据列对齐
    expect(layout.colHeaderRect(1).x).toBe(c11.x)
    // 行头与数据行对齐
    expect(layout.rowHeaderRect(1).y).toBe(c11.y)
  })

  it('reserves a note area and shifts the grid down', () => {
    const without = computeSheetLayout({ cols: 2, rows: 1, hasY: false, measureWidth: measure10 })
    const withNote = computeSheetLayout({
      cols: 2, rows: 1, hasY: false, note: '短笔记', measureWidth: measure10,
    })
    expect(withNote.noteLines).toEqual(['短笔记'])
    expect(withNote.noteRect).toEqual({
      x: SHEET_PADDING, y: SHEET_PADDING, w: withNote.width - SHEET_PADDING * 2, h: SHEET_NOTE_LINE_H,
    })
    expect(withNote.height - without.height).toBe(SHEET_NOTE_LINE_H + SHEET_GAP)
    expect(withNote.cellRect(0, 0).y - without.cellRect(0, 0).y).toBe(SHEET_NOTE_LINE_H + SHEET_GAP)
  })

  it('wraps long notes and truncates at max lines with ellipsis', () => {
    // 宽度 = padding*2 + 2*cell + gap;可用 = 宽-2*padding = 2*512+12 = 1036 → 每行 103 字(10px/字)
    const longNote = 'x'.repeat(103 * SHEET_NOTE_MAX_LINES + 50)
    const layout = computeSheetLayout({
      cols: 2, rows: 1, hasY: false, note: longNote, measureWidth: measure10,
    })
    expect(layout.noteLines).toHaveLength(SHEET_NOTE_MAX_LINES)
    expect(layout.noteLines[SHEET_NOTE_MAX_LINES - 1].endsWith('…')).toBe(true)
    // 每行不超过可用宽度
    for (const line of layout.noteLines) {
      expect(measure10(line)).toBeLessThanOrEqual(1036)
    }
  })

  it('collapses whitespace in notes', () => {
    const layout = computeSheetLayout({
      cols: 1, rows: 1, hasY: false, note: '  a \n b  ', measureWidth: measure10,
    })
    expect(layout.noteLines).toEqual(['a b'])
  })
})

describe('pickCellRepresentative', () => {
  it('returns null for empty and the newest task otherwise', () => {
    expect(pickCellRepresentative([])).toBeNull()
    const tasks = [
      makeTask({ id: 'a', createdAt: 100 }),
      makeTask({ id: 'b', createdAt: 300 }),
      makeTask({ id: 'c', createdAt: 200 }),
    ]
    expect(pickCellRepresentative(tasks)!.id).toBe('b')
  })
})

describe('normalizeBatchNotes', () => {
  it('returns {} for non-object input', () => {
    expect(normalizeBatchNotes(undefined)).toEqual({})
    expect(normalizeBatchNotes(null)).toEqual({})
    expect(normalizeBatchNotes([])).toEqual({})
    expect(normalizeBatchNotes('x')).toEqual({})
  })

  it('drops invalid entries and blank texts, trims and clamps long ones', () => {
    const result = normalizeBatchNotes({
      '': { text: 'no-id' },
      'b1': null,
      'b2': { text: 42 },
      'b3': { text: '   ' },
      'b4': { text: '  好实验  ', updatedAt: 123 },
      'b5': { text: 'x'.repeat(MAX_BATCH_NOTE_LEN + 99) },
    }, 999)
    expect(Object.keys(result)).toEqual(['b4', 'b5'])
    expect(result.b4).toEqual({ text: '好实验', updatedAt: 123 })
    expect(result.b5.text).toHaveLength(MAX_BATCH_NOTE_LEN)
    expect(result.b5.updatedAt).toBe(999)
  })
})

describe('computeSafeCellSize(审查修复:canvas 单边上限)', () => {
  it('keeps full size for normal grids', () => {
    expect(computeSafeCellSize(8, 8, true)).toBe(SHEET_CELL_SIZE)
    expect(computeSafeCellSize(2, 1, false)).toBe(SHEET_CELL_SIZE)
  })

  it('shrinks cell size so the sheet stays within SHEET_MAX_EDGE', () => {
    // 40 列单轴:512px/格 → 20996px 超限;收缩后须 ≤ 上限且 ≥ 下限
    const cell = computeSafeCellSize(40, 1, false)
    expect(cell).not.toBeNull()
    expect(cell).toBeLessThan(SHEET_CELL_SIZE)
    expect(cell).toBeGreaterThanOrEqual(SHEET_MIN_CELL_SIZE)
    const layout = computeSheetLayout({ cols: 40, rows: 1, hasY: false, measureWidth: measure10, cellSize: cell! })
    expect(layout.width).toBeLessThanOrEqual(SHEET_MAX_EDGE)
  })

  it('returns null when even the min cell size cannot fit (caller shows a clear message)', () => {
    expect(computeSafeCellSize(200, 1, false)).toBeNull()
  })

  it('reserves the max note region in the height budget when hasNote (审查修复:笔记高度逃逸 clamp)', () => {
    // 31 行高瘦网格:无笔记时格子尺寸贴着高度上限算;带笔记需更小
    const withoutNote = computeSafeCellSize(2, 31, true)
    const withNote = computeSafeCellSize(2, 31, true, true)
    expect(withNote).not.toBeNull()
    expect(withNote!).toBeLessThan(withoutNote!)
    // 用收缩后的尺寸 + 满 4 行笔记排版,总高仍 ≤ SHEET_MAX_EDGE,不再依赖 16384-16000 的隐式余量
    const layout = computeSheetLayout({
      cols: 2, rows: 31, hasY: true, note: 'x'.repeat(MAX_BATCH_NOTE_LEN),
      measureWidth: measure10, cellSize: withNote!,
    })
    expect(layout.noteLines).toHaveLength(SHEET_NOTE_MAX_LINES)
    expect(layout.height).toBeLessThanOrEqual(SHEET_MAX_EDGE)
  })

  it('layout respects a custom cellSize in every rect', () => {
    const layout = computeSheetLayout({ cols: 2, rows: 2, hasY: true, measureWidth: measure10, cellSize: 100 })
    expect(layout.cellRect(0, 0).w).toBe(100)
    expect(layout.cellRect(1, 1).x - layout.cellRect(0, 1).x).toBe(100 + SHEET_GAP)
    expect(layout.rowHeaderRect(0).h).toBe(100)
  })
})

describe('normalizeBatchNotes 条数上限(审查修复:localStorage 配额炸弹)', () => {
  it('caps entries at MAX_BATCH_NOTES keeping the most recently updated', () => {
    const flood = Object.fromEntries(
      Array.from({ length: MAX_BATCH_NOTES + 100 }, (_, i) => [`b${i}`, { text: 'x', updatedAt: i }]),
    )
    const result = normalizeBatchNotes(flood)
    expect(Object.keys(result)).toHaveLength(MAX_BATCH_NOTES)
    // 保留 updatedAt 最大的一批:最小的 100 条被丢弃
    expect(result.b0).toBeUndefined()
    expect(result.b99).toBeUndefined()
    expect(result.b100).toBeDefined()
    expect(result[`b${MAX_BATCH_NOTES + 99}`]).toBeDefined()
  })
})

describe('mergeBatchNotes(审查修复:merge 导入绕过条数上限)', () => {
  it('keeps local on batchId conflict and appends new imported ids', () => {
    const merged = mergeBatchNotes(
      { b1: { text: 'local', updatedAt: 1 } },
      { b1: { text: 'imported', updatedAt: 2 }, b2: { text: 'new', updatedAt: 2 } },
    )
    expect(merged).toEqual({
      b1: { text: 'local', updatedAt: 1 },
      b2: { text: 'new', updatedAt: 2 },
    })
  })

  it('re-caps the union at MAX_BATCH_NOTES when both sides are individually within cap', () => {
    // 两侧各 500 条且 batchId 不相交:裸展开会得到 1000 条直写持久化
    const local = Object.fromEntries(
      Array.from({ length: MAX_BATCH_NOTES }, (_, i) => [`l${i}`, { text: 'x', updatedAt: 1000 + i }]),
    )
    const imported = Object.fromEntries(
      Array.from({ length: MAX_BATCH_NOTES }, (_, i) => [`i${i}`, { text: 'x', updatedAt: i }]),
    )
    const merged = mergeBatchNotes(local, imported)
    expect(Object.keys(merged)).toHaveLength(MAX_BATCH_NOTES)
    // updatedAt 更新的本地侧整组保留,导入侧被截掉
    expect(merged.l0).toBeDefined()
    expect(merged[`l${MAX_BATCH_NOTES - 1}`]).toBeDefined()
    expect(merged.i0).toBeUndefined()
  })
})
