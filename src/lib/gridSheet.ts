import type { TaskRecord } from '../types'

/**
 * 矩阵对照图导出:布局纯函数(矩形数学 + 笔记折行)与批次笔记归一化。
 * canvas 绘制在 gridSheetRender.ts(浏览器侧薄壳),本文件不碰 DOM。
 */

export const SHEET_CELL_SIZE = 512
export const SHEET_GAP = 12
export const SHEET_PADDING = 24
export const SHEET_COL_HEADER_H = 48
export const SHEET_ROW_HEADER_W = 120
export const SHEET_NOTE_LINE_H = 28
export const SHEET_NOTE_MAX_LINES = 4
export const MAX_BATCH_NOTE_LEN = 500

export interface SheetRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SheetLayout {
  width: number
  height: number
  /** 已按宽度折行的笔记;空数组 = 无笔记区 */
  noteLines: string[]
  noteRect: SheetRect | null
  colHeaderRect: (col: number) => SheetRect
  rowHeaderRect: (row: number) => SheetRect
  cellRect: (col: number, row: number) => SheetRect
}

export interface BatchNote {
  text: string
  updatedAt: number
}

/**
 * 贪心折行:按 measureWidth 把文本切成 ≤ maxWidth 的行,最多 maxLines 行(末行截断加 …)。
 * 逐字符累加(中英混排无空格分词,字符粒度最稳)。
 */
function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measureWidth: (text: string) => number,
): string[] {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length === 0) return []
  const lines: string[] = []
  let current = ''
  for (const ch of chars) {
    if (measureWidth(current + ch) > maxWidth && current) {
      lines.push(current)
      if (lines.length === maxLines) break
      current = ch
    } else {
      current += ch
    }
  }
  if (lines.length < maxLines) {
    if (current) lines.push(current)
    return lines
  }
  // 已到行数上限且仍有剩余 → 末行截断加省略号
  const last = lines[maxLines - 1]
  let truncated = last
  while (truncated && measureWidth(truncated + '…') > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  lines[maxLines - 1] = truncated + '…'
  return lines
}

/**
 * 计算整图布局。结构(上→下):padding / 笔记区(可选) / 列头行 / 数据行×N / padding;
 * 左侧依次:padding / 行头列(无 Y 轴时宽 0) / 数据列×N。
 */
export function computeSheetLayout(opts: {
  cols: number
  rows: number
  hasY: boolean
  note?: string
  measureWidth: (text: string) => number
}): SheetLayout {
  const { cols, rows, hasY, note, measureWidth } = opts
  const rowHeaderW = hasY ? SHEET_ROW_HEADER_W : 0

  const width =
    SHEET_PADDING * 2 +
    rowHeaderW +
    (hasY ? SHEET_GAP : 0) +
    cols * SHEET_CELL_SIZE +
    (cols - 1) * SHEET_GAP

  const noteLines = note ? wrapText(note, width - SHEET_PADDING * 2, SHEET_NOTE_MAX_LINES, measureWidth) : []
  const noteHeight = noteLines.length > 0 ? noteLines.length * SHEET_NOTE_LINE_H + SHEET_GAP : 0
  const noteRect: SheetRect | null =
    noteLines.length > 0
      ? { x: SHEET_PADDING, y: SHEET_PADDING, w: width - SHEET_PADDING * 2, h: noteLines.length * SHEET_NOTE_LINE_H }
      : null

  const gridTop = SHEET_PADDING + noteHeight
  const cellsLeft = SHEET_PADDING + rowHeaderW + (hasY ? SHEET_GAP : 0)
  const cellsTop = gridTop + SHEET_COL_HEADER_H + SHEET_GAP

  const height = cellsTop + rows * SHEET_CELL_SIZE + (rows - 1) * SHEET_GAP + SHEET_PADDING

  const cellX = (col: number) => cellsLeft + col * (SHEET_CELL_SIZE + SHEET_GAP)
  const cellY = (row: number) => cellsTop + row * (SHEET_CELL_SIZE + SHEET_GAP)

  return {
    width,
    height,
    noteLines,
    noteRect,
    colHeaderRect: (col) => ({ x: cellX(col), y: gridTop, w: SHEET_CELL_SIZE, h: SHEET_COL_HEADER_H }),
    rowHeaderRect: (row) => ({ x: SHEET_PADDING, y: cellY(row), w: rowHeaderW, h: SHEET_CELL_SIZE }),
    cellRect: (col, row) => ({ x: cellX(col), y: cellY(row), w: SHEET_CELL_SIZE, h: SHEET_CELL_SIZE }),
  }
}

/** 同格多 task(n>1 / 补跑残留)取 createdAt 最新为代表——矩阵 UI 与导出共用同一判定。 */
export function pickCellRepresentative(tasks: TaskRecord[]): TaskRecord | null {
  if (tasks.length === 0) return null
  return tasks.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
}

/** 持久化/导入兜底:跳过无效条目、trim 空文本剔除、截断超长、修补 updatedAt。 */
export function normalizeBatchNotes(value: unknown, now = Date.now()): Record<string, BatchNote> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, BatchNote> = {}
  for (const [batchId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!batchId.trim()) continue
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Partial<BatchNote>
    if (typeof item.text !== 'string') continue
    const text = item.text.trim().slice(0, MAX_BATCH_NOTE_LEN)
    if (!text) continue
    result[batchId] = {
      text,
      updatedAt:
        typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : now,
    }
  }
  return result
}
