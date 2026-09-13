import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import type { Point, ViewTransform } from '../../lib/image/viewportTransform'
import type { CanvasSize } from './types'

interface CanvasViewportProps {
  size: CanvasSize | null
  isLoading: boolean
  viewTransform: ViewTransform
  isPanning: boolean
  isAltKeyPressed: boolean
  hoverPoint: Point | null
  imageCanvasRef: React.RefObject<HTMLCanvasElement | null>
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>
  cursorCanvasRef: React.RefObject<HTMLCanvasElement | null>
  baseFrameRef: React.RefObject<HTMLDivElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void
    onPointerLeave: (e: ReactPointerEvent<HTMLCanvasElement>) => void
  }
  children?: ReactNode
}

export default function CanvasViewport({
  size,
  isLoading,
  viewTransform,
  isPanning,
  isAltKeyPressed,
  hoverPoint,
  imageCanvasRef,
  maskCanvasRef,
  previewCanvasRef,
  cursorCanvasRef,
  baseFrameRef,
  stageRef,
  handlers,
  children,
}: CanvasViewportProps) {
  return (
    <div
      ref={stageRef}
      className="flex-1 relative flex items-center justify-center overflow-hidden bg-surface-muted dark:bg-black/50 p-0 pb-[76px] sm:p-6 sm:pb-[100px]"
      style={{ containerType: 'size' }}
    >
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface text-sm text-content-muted backdrop-blur-sm dark:bg-surface-muted dark:text-content">
          正在载入图片...
        </div>
      )}
      <div
        ref={baseFrameRef}
        className="relative max-h-full max-w-full sm:rounded-xl shadow-inner sm:ring-1 ring-black/5 touch-none dark:bg-black/50 dark:ring-line"
        style={{
          aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1',
          width: size ? `min(100%, 100cqh * ${size.width / size.height})` : '520px',
          maxHeight: '100%',
        }}
      >
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `matrix(${viewTransform.scale}, 0, 0, ${viewTransform.scale}, ${viewTransform.x}, ${viewTransform.y})`,
            transformOrigin: '0 0',
          }}
        >
          <canvas ref={imageCanvasRef} className="absolute inset-0 h-full w-full" />
          <canvas
            ref={previewCanvasRef}
            className="absolute inset-0 h-full w-full pointer-events-none"
          />
          <canvas
            ref={maskCanvasRef}
            className="absolute inset-0 h-full w-full touch-none select-none opacity-0"
            style={{
              cursor: isPanning
                ? 'grabbing'
                : isAltKeyPressed
                  ? 'grab'
                  : hoverPoint
                    ? 'none'
                    : 'crosshair',
            }}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerUp}
            onLostPointerCapture={handlers.onPointerUp}
            onPointerLeave={handlers.onPointerLeave}
          />
        </div>
      </div>
      <canvas
        ref={cursorCanvasRef}
        className="absolute inset-0 h-full w-full pointer-events-none"
      />
      {children}
    </div>
  )
}
