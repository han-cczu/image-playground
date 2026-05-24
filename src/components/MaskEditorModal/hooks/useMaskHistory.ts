import { useCallback, useRef, useState } from 'react'

const HISTORY_LIMIT = 40

/**
 * 将一项压入有上限的栈：超过 max 时从头部丢弃最旧的项。
 * 纯函数，便于单测。返回的是同一个数组引用（就地修改），与原实现一致。
 */
export function pushBounded<T>(stack: T[], item: T, max: number): T[] {
  stack.push(item)
  if (stack.length > max) stack.shift()
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

    pushBounded(undoStackRef.current, ctx.getImageData(0, 0, canvas.width, canvas.height), HISTORY_LIMIT)
    redoStackRef.current = []
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
