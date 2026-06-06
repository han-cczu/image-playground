import type { TaskRecord } from '../types'
import { reconstructMatrix } from './gridExperiment'
import { ensureImageCached } from './imageCache'
import {
  computeSafeCellSize,
  computeSheetLayout,
  pickCellRepresentative,
  type SheetRect,
} from './gridSheet'

const NOTE_FONT = '18px system-ui, sans-serif'
const HEADER_FONT = '600 20px system-ui, sans-serif'

/** measureText 截断:超宽时去尾加 …(不命中返回原文) */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let truncated = text
  while (truncated && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return truncated + '…'
}

/** 居中绘制单行文本(带截断) */
function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, rect: SheetRect): void {
  const display = truncateToWidth(ctx, text, rect.w - 8)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(display, rect.x + rect.w / 2, rect.y + rect.h / 2)
}

/** contain 居中绘制图片 */
function drawContainedImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, rect: SheetRect): void {
  const scale = Math.min(rect.w / img.naturalWidth, rect.h / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.drawImage(img, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h)
}

/** blob URL → HTMLImageElement;加载失败返回 null(单格失败不中断整图) */
function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * 渲染矩阵对照图(白底、行列轴标签、可选笔记头)并触发 PNG 下载。
 * 失败 throw,由调用方 toast。
 */
export async function exportGridSheet(args: {
  tasks: TaskRecord[]
  batchId: string
  note?: string
}): Promise<void> {
  const matrix = reconstructMatrix(args.tasks)
  if (!matrix) throw new Error('无法重建矩阵骨架')
  const { cols, rows, cellTasks, axes } = matrix
  const hasY = Boolean(axes.y)

  // 浏览器 canvas 单边上限 ~16384px:大矩阵收缩格子尺寸;收缩到下限仍超限给明确文案
  // (否则 toBlob 静默返回 null,用户只看到一句没有原因的「生成 PNG 失败」)
  const cellSize = computeSafeCellSize(cols.length, rows.length, hasY)
  if (cellSize === null) {
    throw new Error(`网格过大(${cols.length}×${rows.length}),超出浏览器画布上限,无法导出`)
  }

  // 逐格代表图 id(与矩阵 UI 同判定:最新 task 的首图)
  const cellImageIds: (string | null)[][] = rows.map((row) =>
    cols.map((col) => {
      const rep = pickCellRepresentative(cellTasks(col.key, row.key))
      return rep?.outputImages?.[0] ?? null
    }),
  )

  // 并发取缓存 URL 并加载为 Image(去重;单图失败置 null)
  const uniqueIds = [...new Set(cellImageIds.flat().filter((id): id is string => Boolean(id)))]
  const urlById = new Map<string, string | null>()
  await Promise.all(
    uniqueIds.map(async (id) => {
      urlById.set(id, (await ensureImageCached(id).catch(() => null)) ?? null)
    }),
  )
  const imageById = new Map<string, HTMLImageElement | null>()
  await Promise.all(
    uniqueIds.map(async (id) => {
      imageById.set(id, await loadImage(urlById.get(id) ?? null))
    }),
  )

  // 布局(measureText 需先建 ctx 设字体;canvas 尺寸赋值会重置 ctx 状态,绘制时需重设字体)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  ctx.font = NOTE_FONT
  const layout = computeSheetLayout({
    cols: cols.length,
    rows: rows.length,
    hasY,
    note: args.note,
    measureWidth: (text) => ctx.measureText(text).width,
    cellSize,
  })
  canvas.width = layout.width
  canvas.height = layout.height

  // 背景(固定浅色,分享/打印可读性优先)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.width, layout.height)

  // 笔记区
  if (layout.noteRect) {
    ctx.font = NOTE_FONT
    ctx.fillStyle = '#4b5563'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    layout.noteLines.forEach((line, i) => {
      ctx.fillText(line, layout.noteRect!.x, layout.noteRect!.y + (i + 0.5) * 28)
    })
  }

  // 行列表头
  ctx.font = HEADER_FONT
  ctx.fillStyle = '#374151'
  cols.forEach((col, i) => drawCenteredText(ctx, col.label, layout.colHeaderRect(i)))
  if (hasY) {
    rows.forEach((row, i) => drawCenteredText(ctx, row.label, layout.rowHeaderRect(i)))
  }

  // 单元格
  rows.forEach((_, rowIndex) => {
    cols.forEach((__, colIndex) => {
      const rect = layout.cellRect(colIndex, rowIndex)
      const id = cellImageIds[rowIndex][colIndex]
      const img = id ? imageById.get(id) : null
      if (img) {
        drawContainedImage(ctx, img, rect)
      } else {
        ctx.fillStyle = '#f3f4f6'
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
        ctx.font = HEADER_FONT
        ctx.fillStyle = '#9ca3af'
        drawCenteredText(ctx, '无', rect)
        ctx.fillStyle = '#374151'
      }
    })
  })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成 PNG 失败')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `grid-${args.batchId.slice(0, 8)}-${Date.now()}.png`
  a.click()
  URL.revokeObjectURL(url)
}
