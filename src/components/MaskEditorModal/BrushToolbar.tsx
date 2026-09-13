import type { Tool } from './types'

export interface BrushToolbarProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
  brushSize: number
  showBrushControls: boolean
  onToggleBrushSize: () => void
  brushSizeControlRef: React.RefObject<HTMLDivElement | null>
  brushSizeButtonRef: React.RefObject<HTMLButtonElement | null>
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  isZoomed: boolean
  onResetView: () => void
  onClear: () => void
  isReady: boolean
  isSaving: boolean
}

export default function BrushToolbar({
  tool,
  onToolChange,
  brushSize,
  showBrushControls,
  onToggleBrushSize,
  brushSizeControlRef,
  brushSizeButtonRef,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isZoomed,
  onResetView,
  onClear,
  isReady,
  isSaving,
}: BrushToolbarProps) {
  return (
    <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 flex items-center justify-center z-20 pointer-events-none w-full px-2 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-4 px-2 sm:px-3 py-1.5 sm:py-2 bg-surface dark:bg-surface backdrop-blur-md border border-line dark:border-line rounded-2xl sm:rounded-2xl shadow-2xl pointer-events-auto">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="flex items-center bg-surface-muted dark:bg-surface-muted p-1 rounded-lg">
            <button
              className={`p-2 sm:p-2.5 rounded-lg transition-all ${tool === 'brush' ? 'bg-white shadow-sm text-brand-ink dark:bg-surface-raised dark:text-brand-ink dark:shadow-none' : 'text-content-muted hover:text-content dark:text-content-muted dark:hover:text-content'}`}
              onClick={() => onToolChange('brush')}
              disabled={!isReady || isSaving}
              title="画笔"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
            <button
              className={`p-2 sm:p-2.5 rounded-lg transition-all ${tool === 'eraser' ? 'bg-white shadow-sm text-brand-ink dark:bg-surface-raised dark:text-brand-ink dark:shadow-none' : 'text-content-muted hover:text-content dark:text-content-muted dark:hover:text-content'}`}
              onClick={() => onToolChange('eraser')}
              disabled={!isReady || isSaving}
              title="橡皮"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <g transform="translate(0, 1) rotate(-45 12 12)">
                  <path fill="currentColor" d="M4 10a2 2 0 0 1 2-2h7v8H6a2 2 0 0 1-2-2z" />
                  <rect x="4" y="8" width="16" height="8" rx="2" />
                </g>
                <path d="M8 21h12" />
              </svg>
            </button>
          </div>

          <div ref={brushSizeControlRef} className="relative flex items-center justify-center">
            <button
              ref={brushSizeButtonRef}
              onClick={onToggleBrushSize}
              className={`flex items-center justify-center w-10 h-10 sm:w-[46px] sm:h-[46px] rounded-lg transition-all border ${showBrushControls ? 'bg-brand-soft border-brand text-brand-ink dark:bg-surface-raised dark:border-line dark:text-brand-ink' : 'bg-white border-line text-content hover:bg-surface-muted dark:bg-transparent dark:border-line dark:text-content dark:hover:border-line'}`}
              disabled={!isReady || isSaving}
              title="调节笔刷大小"
            >
              <span className="text-[14px] sm:text-[15px] font-semibold tracking-tight">
                {brushSize}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-2 sm:ml-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-2 sm:p-2.5 text-content-muted hover:bg-surface-muted rounded-lg disabled:opacity-30 dark:text-content-muted dark:hover:bg-surface-raised dark:hover:text-content transition-all"
            title="撤销"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-2 sm:p-2.5 text-content-muted hover:bg-surface-muted rounded-lg disabled:opacity-30 dark:text-content-muted dark:hover:bg-surface-raised dark:hover:text-content transition-all"
            title="重做"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
          <div className="w-px h-4 sm:h-5 bg-surface-raised dark:bg-surface-raised mx-1"></div>
          <button
            onClick={onResetView}
            disabled={!isReady || isSaving || !isZoomed}
            className="p-2 sm:p-2.5 text-content-muted hover:bg-surface-muted rounded-lg disabled:opacity-30 dark:text-content-muted dark:hover:bg-surface-raised dark:hover:text-content transition-all"
            title="重置视图"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 14h6v6" />
              <path d="M20 10h-6V4" />
              <path d="M14 10l7-7" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
          <button
            onClick={onClear}
            disabled={!isReady || isSaving}
            className="p-2 sm:p-2.5 text-content-muted hover:bg-surface-muted rounded-lg disabled:opacity-30 dark:text-content-muted dark:hover:bg-surface-raised dark:hover:text-content transition-all"
            title="清空遮罩"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
