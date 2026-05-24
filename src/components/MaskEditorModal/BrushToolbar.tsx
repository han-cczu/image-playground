type Tool = 'brush' | 'eraser'

interface BrushToolbarProps {
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
      <div className="flex items-center gap-2 sm:gap-4 px-2 sm:px-3 py-1.5 sm:py-2 bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border border-gray-200/80 dark:border-white/5 rounded-2xl sm:rounded-[1.25rem] shadow-2xl pointer-events-auto">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="flex items-center bg-gray-100/80 dark:bg-[#232325]/80 p-1 rounded-xl sm:rounded-[14px]">
            <button
              className={`p-2 sm:p-2.5 rounded-lg sm:rounded-xl transition-all ${tool === 'brush' ? 'bg-white shadow-sm text-blue-500 dark:bg-[#323338] dark:text-blue-400 dark:shadow-none' : 'text-gray-500 hover:text-gray-700 dark:text-[#8a8a8e] dark:hover:text-gray-200'}`}
              onClick={() => onToolChange('brush')}
              disabled={!isReady || isSaving}
              title="画笔"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            <button
              className={`p-2 sm:p-2.5 rounded-lg sm:rounded-xl transition-all ${tool === 'eraser' ? 'bg-white shadow-sm text-blue-500 dark:bg-[#323338] dark:text-blue-400 dark:shadow-none' : 'text-gray-500 hover:text-gray-700 dark:text-[#8a8a8e] dark:hover:text-gray-200'}`}
              onClick={() => onToolChange('eraser')}
              disabled={!isReady || isSaving}
              title="橡皮"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className={`flex items-center justify-center w-10 h-10 sm:w-[46px] sm:h-[46px] rounded-xl sm:rounded-[14px] transition-all border ${showBrushControls ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-[#323338] dark:border-gray-600 dark:text-blue-400' : 'bg-white border-gray-200/80 text-gray-700 hover:bg-gray-50 dark:bg-transparent dark:border-[#323338] dark:text-[#e0e0e0] dark:hover:border-gray-500'}`}
              disabled={!isReady || isSaving}
              title="调节笔刷大小"
            >
              <span className="text-[14px] sm:text-[15px] font-semibold tracking-tight">{brushSize}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-2 sm:ml-1">
          <button onClick={onUndo} disabled={!canUndo} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="撤销">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button onClick={onRedo} disabled={!canRedo} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="重做">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
          <div className="w-px h-4 sm:h-5 bg-gray-300 dark:bg-[#323338] mx-1"></div>
          <button onClick={onResetView} disabled={!isReady || isSaving || !isZoomed} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="重置视图">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14h6v6"/>
              <path d="M20 10h-6V4"/>
              <path d="M14 10l7-7"/>
              <path d="M3 21l7-7"/>
            </svg>
          </button>
          <button onClick={onClear} disabled={!isReady || isSaving} className="p-2 sm:p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg sm:rounded-xl disabled:opacity-30 dark:text-[#8a8a8e] dark:hover:bg-white/10 dark:hover:text-gray-200 transition-all" title="清空遮罩">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
