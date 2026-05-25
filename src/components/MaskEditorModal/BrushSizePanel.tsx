import { createPortal } from 'react-dom'

interface SliderAnchor {
  left: number
  bottom: number
}

interface BrushSizePanelProps {
  open: boolean
  brushSize: number
  onChange: (nextSize: number) => void
  anchor: SliderAnchor | null
  disabled: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
}

export default function BrushSizePanel({
  open,
  brushSize,
  onChange,
  anchor,
  disabled,
  panelRef,
}: BrushSizePanelProps) {
  if (!open || !anchor) return null

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[100] h-44 w-14 -translate-x-1/2 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700"
      style={{ left: anchor.left, bottom: anchor.bottom }}
    >
      <input
        type="range"
        min={8}
        max={220}
        value={brushSize}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute left-1/2 top-1/2 h-5 w-32 -translate-x-1/2 -translate-y-1/2 -rotate-90 accent-blue-500 cursor-ns-resize"
        disabled={disabled}
      />
    </div>,
    document.body,
  )
}
