import { lazy, Suspense, type ReactNode } from 'react'
import { useStore } from '../store'
import ErrorBoundary from './ErrorBoundary'

/**
 * 惰性弹层集散地:低频弹层的 chunk 按需拉取,不进首屏主包。
 *
 * 为什么可以安全地在这里做条件挂载:Modal 原语与既有各弹窗的约定就是「挂载即打开,
 * 关闭即卸载」——每个弹窗组件内部本来就按同一个 store 标志早退 return null,把同一
 * 判定提到挂载层后行为完全等价(内部早退保留,作为双保险)。
 *
 * 为什么单独成组件而不写在 App 里:App 顶层的订阅集是 C1 性能轮刻意收敛过的,
 * 弹层开关的布尔订阅收在本组件,开/关弹窗只重渲染这一层,不碰 App。
 *
 * 首开有一次 chunk 网络拉取(通常毫秒级):线上 SW 在 install 期预缓存全部 hashed
 * assets,离线与弱网下同样命中缓存,不会出现「离线打不开设置」。
 *
 * 高频/常驻组件(DetailModal / Lightbox / ConfirmDialog / Toast / ImageContextMenu)
 * 留在 App 静态导入,不要挪进来。新增低频弹层时在此注册:lazy import + 与组件内部
 * 早退一致的挂载条件。
 */
const SettingsModal = lazy(() => import('./SettingsModal'))
const PromptOptimizerModal = lazy(() => import('./PromptOptimizerModal'))
const ImageCaptionModal = lazy(() => import('./ImageCaptionModal'))
const MaskEditorModal = lazy(() => import('./MaskEditorModal'))
const CommandPalette = lazy(() => import('./CommandPalette'))
const CompareModal = lazy(() => import('./CompareModal'))
const LineageModal = lazy(() => import('./LineageModal'))
const BatchCaptionModal = lazy(() => import('./BatchCaptionModal'))
const TourOverlay = lazy(() => import('./TourOverlay'))

/**
 * fallback 为 null:弹窗出现前本来就没有 UI,加载失败则由 ErrorBoundary 呈现弹层级
 * 错误卡片(与既有 region="modal" 行为一致)。Suspense 各弹窗独立,避免一个弹窗的
 * chunk 加载把另一个已打开的弹窗顶成 fallback。
 */
function Gate({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) return null
  return (
    <ErrorBoundary region="modal">
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default function LazyModals() {
  // 布尔 selector:zustand 仅在值翻转时通知,弹层内容变化(如 compareTaskIds 数组内容)不触发本层重渲染
  const showSettings = useStore((s) => s.showSettings)
  const showPromptOptimizer = useStore((s) => s.showPromptOptimizer)
  const hasCaptionSource = useStore((s) => Boolean(s.captionSource))
  const hasMaskEditor = useStore((s) => Boolean(s.maskEditorImageId))
  const showCommandPalette = useStore((s) => s.showCommandPalette)
  const hasCompare = useStore((s) => Boolean(s.compareTaskIds))
  const hasLineage = useStore((s) => Boolean(s.lineageTaskId))
  const hasBatchCaption = useStore((s) => (s.captionBatchImageIds?.length ?? 0) > 0)
  const tourActive = useStore((s) => s.tourActive)

  return (
    <>
      <Gate open={showSettings}>
        <SettingsModal />
      </Gate>
      <Gate open={showPromptOptimizer}>
        <PromptOptimizerModal />
      </Gate>
      <Gate open={hasCaptionSource}>
        <ImageCaptionModal />
      </Gate>
      <Gate open={hasMaskEditor}>
        <MaskEditorModal />
      </Gate>
      <Gate open={showCommandPalette}>
        <CommandPalette />
      </Gate>
      <Gate open={hasCompare}>
        <CompareModal />
      </Gate>
      <Gate open={hasLineage}>
        <LineageModal />
      </Gate>
      <Gate open={hasBatchCaption}>
        <BatchCaptionModal />
      </Gate>
      <Gate open={tourActive}>
        <TourOverlay />
      </Gate>
    </>
  )
}
