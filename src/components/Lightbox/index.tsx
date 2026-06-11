import { useCallback, useRef } from 'react'
import { useStore } from '../../store'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useLightboxImage } from './hooks/useLightboxImage'
import { useLightboxNavigation } from './hooks/useLightboxNavigation'
import { useLightboxZoom } from './hooks/useLightboxZoom'
import { useLightboxPointer } from './hooks/useLightboxPointer'
import NavButton from './NavButton'
import { ZoomBadge, IndexIndicator } from './Indicators'

export default function Lightbox() {
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)

  const close = useCallback(() => setLightboxImageId(null), [setLightboxImageId])
  useCloseOnEscape(Boolean(lightboxImageId), close)
  useLockBodyScroll(Boolean(lightboxImageId))

  // 图片与遮罩资源加载(cache-first + 遮罩预览 dataURL)
  const { src, maskPreviewSrc } = useLightboxImage(lightboxImageId)

  // 列表导航 + 键盘左右切换
  const { currentIndex, total, showNav, goPrev, goNext } = useLightboxNavigation(lightboxImageId)

  if (!lightboxImageId || !src) return null

  return (
    <LightboxInner
      src={src}
      maskPreviewSrc={maskPreviewSrc}
      onClose={close}
      showNav={showNav}
      currentIndex={currentIndex}
      total={total}
      onPrev={goPrev}
      onNext={goNext}
    />
  )
}

interface LightboxInnerProps {
  src: string
  maskPreviewSrc?: string
  onClose: () => void
  showNav: boolean
  currentIndex: number
  total: number
  onPrev: () => void
  onNext: () => void
}

/** 内部组件：保证挂载时 DOM 已经存在，所有 ref / effect 都可靠 */
function LightboxInner({ src, maskPreviewSrc, onClose, showNav, currentIndex, total, onPrev, onNext }: LightboxInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // LightboxInner 仅在打开时挂载,焦点陷阱常驻 true;作用在 containerRef(根节点带 tabIndex={-1} 承接焦点)。
  useFocusTrap(true, containerRef)

  // 缩放:scale/tx/ty ref + apply(边界 clamp)+ 滚轮缩放 + 缩放徽标计时
  const { scaleRef, txRef, tyRef, apply, showZoomBadge } = useLightboxZoom(containerRef, src)

  // 指针手势:鼠标拖拽 / 双指 pinch / 单击关闭 / 双击缩放 + 点击抑制
  const { onClick, onDoubleClick, isDragging } = useLightboxPointer({
    containerRef,
    scaleRef,
    txRef,
    tyRef,
    apply,
    onClose,
  })

  const s = scaleRef.current
  const tx = txRef.current
  const ty = tyRef.current
  const isZoomed = s > 1
  const zoomPercent = Math.round(s * 100)

  return (
    <div
      ref={containerRef}
      data-lightbox-root
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex items-center justify-center select-none outline-none"
      style={{ cursor: isZoomed ? (isDragging ? 'grabbing' : 'grab') : 'pointer' }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-in" />
      <div className="relative animate-zoom-in">
        <div
          className="relative flex items-center justify-center"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${s})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
            willChange: 'transform',
          }}
        >
          <img
            src={src}
            className="saveable-image max-w-[85vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onDragStart={(e) => e.preventDefault()}
            alt=""
          />
          {maskPreviewSrc && (
            <img
              src={maskPreviewSrc}
              className="absolute inset-0 w-full h-full object-contain rounded-lg pointer-events-none"
              alt=""
            />
          )}
        </div>
      </div>

      {/* 左右切换按钮 */}
      {showNav && !isZoomed && (
        <>
          <NavButton direction="prev" onNavigate={onPrev} />
          <NavButton direction="next" onNavigate={onNext} />
        </>
      )}

      {/* 底部指示器 */}
      {showZoomBadge && isZoomed && zoomPercent !== 100 && <ZoomBadge zoomPercent={zoomPercent} />}
      {showNav && !isZoomed && <IndexIndicator currentIndex={currentIndex} total={total} />}
    </div>
  )
}
