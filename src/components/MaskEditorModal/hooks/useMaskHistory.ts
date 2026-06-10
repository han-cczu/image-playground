import { useCallback, useRef, useState } from 'react'

const HISTORY_LIMIT = 40

/**
 * undo+redo 两栈合计的快照字节预算:每步快照是全分辨率 ImageData(1920 工作尺寸约 14.1MiB),
 * 仅按条数(40)封顶时最坏 ~560MiB 常驻 JS 堆,移动端(iOS 标签页内存上限约 1-1.5GB)长编辑
 * 会话有 OOM 崩标签页风险——崩溃即丢失全部未保存编辑。小尺寸遮罩仍由条数上限约束(行为不变)。
 */
export const HISTORY_BYTE_BUDGET = 256 * 1024 * 1024

export function imageDataBytes(img: ImageData): number {
  return img.data.byteLength
}

/**
 * 将一项压入有上限的栈：超过 max 时从头部丢弃最旧的项。
 * 纯函数，便于单测。返回的是同一个数组引用（就地修改），与原实现一致。
 */
export function pushBounded<T>(stack: T[], item: T, max: number): T[] {
  stack.push(item)
  if (stack.length > max) stack.shift()
  return stack
}

/**
 * 条数上限 + 字节预算双重驱逐(从最旧端逐出);最新项永不被逐(栈至少保 1 项,undo 不至于全失效)。
 * reservedBytes 为同预算下另一个栈(redo)的占用。纯函数,便于单测。
 */
export function pushBudgeted(
  stack: ImageData[],
  item: ImageData,
  opts: { maxEntries: number; byteBudget: number; reservedBytes?: number },
): ImageData[] {
  pushBounded(stack, item, opts.maxEntries)
  let total = (opts.reservedBytes ?? 0) + stack.reduce((sum, snapshot) => sum + imageDataBytes(snapshot), 0)
  while (stack.length > 1 && total > opts.byteBudget) {
    const removed = stack.shift()!
    total -= imageDataBytes(removed)
  }
  return stack
}

export interface MaskHistory {
  canUndo: boolean
  canRedo: boolean
  pushSnapshot: () => void
  restoreMask: (imageData: ImageData) => void
  undo: () => void
  redo: () => void
  clear: () => void
  cancelActiveStroke: () => void
}

export function useMaskHistory(args: {
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  renderPreview: () => void
  fillWhiteMask: () => void
}): MaskHistory & {
  undoStackRef: React.MutableRefObject<ImageData[]>
  redoStackRef: React.MutableRefObject<ImageData[]>
  syncHistoryState: () => void
} {
  const { maskCanvasRef, renderPreview, fillWhiteMask } = args

  const undoStackRef = useRef<ImageData[]>([])
  const redoStackRef = useRef<ImageData[]>([])
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    })
  }, [])

  const restoreMask = useCallback((imageData: ImageData) => {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return

    ctx.putImageData(imageData, 0, 0)
    renderPreview()
  }, [maskCanvasRef, renderPreview])

  const pushSnapshot = useCallback(() => {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return

    // redo 先清(新笔画作废重做链),undo 栈独占全部字节预算;
    // undo/redo 互换(两栈 1:1 交换快照)不增加总量,只需在新增快照的入口控制预算
    redoStackRef.current = []
    pushBudgeted(undoStackRef.current, ctx.getImageData(0, 0, canvas.width, canvas.height), {
      maxEntries: HISTORY_LIMIT,
      byteBudget: HISTORY_BYTE_BUDGET,
    })
    syncHistoryState()
  }, [maskCanvasRef, syncHistoryState])

  const undo = useCallback(() => {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    const previous = undoStackRef.current.pop()
    if (!canvas || !ctx || !previous) return

    redoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    restoreMask(previous)
    syncHistoryState()
  }, [maskCanvasRef, restoreMask, syncHistoryState])

  const redo = useCallback(() => {
    const canvas = maskCanvasRef.current
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    const next = redoStackRef.current.pop()
    if (!canvas || !ctx || !next) return

    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    restoreMask(next)
    syncHistoryState()
  }, [maskCanvasRef, restoreMask, syncHistoryState])

  const clear = useCallback(() => {
    const canvas = maskCanvasRef.current
    if (!canvas) return

    pushSnapshot()
    fillWhiteMask()
    renderPreview()
  }, [maskCanvasRef, pushSnapshot, fillWhiteMask, renderPreview])

  // 取消进行中的笔画：回退最近一次快照（在第二根手指落下、转入捏合手势时调用）。
  // 指针 ref（activePointerIdRef / lastPointRef）的守卫与重置由 usePointerInteraction 负责。
  const cancelActiveStroke = useCallback(() => {
    const previous = undoStackRef.current.pop()
    if (previous) restoreMask(previous)
    syncHistoryState()
  }, [restoreMask, syncHistoryState])

  return {
    canUndo: historyState.undo > 0,
    canRedo: historyState.redo > 0,
    pushSnapshot,
    restoreMask,
    undo,
    redo,
    clear,
    cancelActiveStroke,
    undoStackRef,
    redoStackRef,
    syncHistoryState,
  }
}
