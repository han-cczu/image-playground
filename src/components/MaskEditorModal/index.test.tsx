// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { BrushToolbarProps } from './BrushToolbar'
import { useStore } from '../../store'
import MaskEditorModal from './index'

const maskEditorMocks = vi.hoisted(() => ({
  history: {
    undoStackRef: { current: [] },
    redoStackRef: { current: [] },
    syncHistoryState: vi.fn(),
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    clear: vi.fn(),
  },
  pointer: {
    hoverPoint: null,
    isPointerOverCanvas: false,
    isAltKeyPressed: false,
    isPanning: false,
    isStrokeActive: false,
    handlers: {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerLeave: vi.fn(),
    },
    resetGestures: vi.fn(),
    resetActiveStroke: vi.fn(),
    setIsPointerOverCanvas: vi.fn(),
    setHoverPoint: vi.fn(),
  },
  lastToolbarProps: null as BrushToolbarProps | null,
}))

vi.mock('../../hooks/useCloseOnEscape', () => ({
  useCloseOnEscape: () => undefined,
}))

vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => undefined,
}))

vi.mock('../../hooks/useLockBodyScroll', () => ({
  useLockBodyScroll: () => undefined,
}))

vi.mock('./hooks/useCanvasViewport', () => ({
  useCanvasViewport: () => ({
    viewTransform: { scale: 1, x: 0, y: 0 },
    viewTransformRef: { current: { scale: 1, x: 0, y: 0 } },
    resetViewportToDefault: () => undefined,
    resetViewTransform: () => undefined,
    isZoomed: false,
  }),
}))

vi.mock('./hooks/useMaskHistory', () => ({
  useMaskHistory: () => maskEditorMocks.history,
}))

vi.mock('./hooks/useMaskCanvasInit', async () => {
  const React = await import('react')
  function MockUseMaskCanvasInit(args: {
    setSourceDataUrl: (url: string) => void
    setSize: (size: { width: number; height: number }) => void
    setIsLoading: (loading: boolean) => void
  }) {
    const actionsRef = React.useRef(args)
    React.useLayoutEffect(() => {
      actionsRef.current = args
    })
    React.useEffect(() => {
      const actions = actionsRef.current
      actions.setSourceDataUrl('data:image/png;base64,AA==')
      actions.setSize({ width: 16, height: 16 })
      actions.setIsLoading(false)
    }, [])
    return {
      activeSessionIdRef: { current: 'session-a' },
    }
  }

  return {
    useMaskCanvasInit: MockUseMaskCanvasInit,
  }
})

vi.mock('./hooks/usePointerInteraction', () => ({
  usePointerInteraction: () => maskEditorMocks.pointer,
}))

vi.mock('./hooks/useCursorOverlay', () => ({
  useCursorOverlay: () => ({
    updateCursor: () => undefined,
  }),
}))

vi.mock('./CanvasViewport', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="canvas-viewport">{children}</div>
  ),
}))

vi.mock('./BrushToolbar', () => ({
  default: (props: BrushToolbarProps) => {
    maskEditorMocks.lastToolbarProps = props
    return (
      <div data-testid="brush-toolbar">
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo}>
          undo
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo}>
          redo
        </button>
        <button type="button" onClick={props.onClear} disabled={!props.isReady || props.isSaving}>
          clear
        </button>
      </div>
    )
  },
}))

vi.mock('./BrushSizePanel', () => ({
  default: () => null,
}))

vi.mock('./MaskInfoPopover', () => ({
  default: () => null,
}))

describe('MaskEditorModal', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    maskEditorMocks.history.canUndo = false
    maskEditorMocks.history.canRedo = false
    maskEditorMocks.pointer.isStrokeActive = false
    maskEditorMocks.lastToolbarProps = null
    useStore.setState(useStore.getInitialState(), true)
  })

  it('reports confirmed mask removal through the latest toast handler', () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    useStore.setState({
      maskEditorImageId: 'image-a',
      maskDraft: {
        targetImageId: 'image-a',
        maskDataUrl: 'data:image/png;base64,AA==',
        updatedAt: 1,
      },
      showToast: oldToast,
    })

    render(<MaskEditorModal />)

    fireEvent.click(screen.getByRole('button', { name: '移除遮罩' }))
    const dialog = useStore.getState().confirmDialog
    expect(dialog).not.toBeNull()

    useStore.setState({ showToast: latestToast })
    act(() => {
      dialog?.action()
    })

    expect(latestToast).toHaveBeenCalledWith('已移除遮罩', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('disables history and destructive actions while a touch stroke is active', () => {
    maskEditorMocks.history.canUndo = true
    maskEditorMocks.history.canRedo = true
    maskEditorMocks.pointer.isStrokeActive = true
    useStore.setState({ maskEditorImageId: 'image-a' })

    render(<MaskEditorModal />)

    expect(maskEditorMocks.lastToolbarProps?.canUndo).toBe(false)
    expect(maskEditorMocks.lastToolbarProps?.canRedo).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'redo' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear' }))
    expect(maskEditorMocks.history.undo).not.toHaveBeenCalled()
    expect(maskEditorMocks.history.redo).not.toHaveBeenCalled()
    expect(maskEditorMocks.history.clear).not.toHaveBeenCalled()
  })
})
