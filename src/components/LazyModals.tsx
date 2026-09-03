import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { useStore } from '../store'
import ErrorBoundary, { type FallbackActions } from './ErrorBoundary'

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
 * assets,离线与弱网下同样命中缓存。但**部署后仍开着的旧页面**是例外:新 SW 接管时
 * activate 删掉了旧缓存,服务端也已没有旧 hashed 文件,此时首次打开任一懒加载弹层
 * 必然 404。所以 chunk 加载失败要单独识别,给「刷新 / 关闭」而不是默认的「重试 / 清空数据」
 *(React.lazy 会永久缓存首次拒绝,原地重试注定再次失败;清空数据更是对症下错药)。
 *
 * 高频/常驻组件(DetailModal / Lightbox / ConfirmDialog / Toast / ImageContextMenu)
 * 留在 App 静态导入,不要挪进来。新增低频弹层时在此注册:lazy import + 与组件内部
 * 早退一致的挂载条件。
 */
/** 动态 import 失败的专用错误类型:按类型而不是按浏览器各异的 message 文案识别。 */
class ModalChunkLoadError extends Error {
  constructor(cause: unknown) {
    super('弹层资源加载失败', { cause })
    this.name = 'ModalChunkLoadError'
  }
}

function lazyModal<P extends object>(importer: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() =>
    importer().catch((cause: unknown) => {
      throw new ModalChunkLoadError(cause)
    }),
  )
}

const SettingsModal = lazyModal(() => import('./SettingsModal'))
const PromptOptimizerModal = lazyModal(() => import('./PromptOptimizerModal'))
const ImageCaptionModal = lazyModal(() => import('./ImageCaptionModal'))
const MaskEditorModal = lazyModal(() => import('./MaskEditorModal'))
const CommandPalette = lazyModal(() => import('./CommandPalette'))
const CompareModal = lazyModal(() => import('./CompareModal'))
const LineageModal = lazyModal(() => import('./LineageModal'))
const BatchCaptionModal = lazyModal(() => import('./BatchCaptionModal'))
const TourOverlay = lazyModal(() => import('./TourOverlay'))

/**
 * chunk 加载失败的弹层级兜底:刷新页面(拿新 index.html 与新 chunk)或关闭弹层回到主界面继续用。
 * 关闭走 onClose 复位对应的 store 开关——否则 Gate 的挂载条件一直为真,用户被困在错误卡片里。
 */
function ChunkLoadFallback({ onClose, onReload }: { onClose: () => void; onReload: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="chunk-load-fallback-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-md dark:bg-black/50"
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/50 bg-white p-5 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10">
        <h3
          id="chunk-load-fallback-title"
          className="text-base font-semibold text-gray-800 dark:text-gray-100"
        >
          弹层加载失败
        </h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          应用可能刚发布了新版本，当前页面引用的资源已不存在。刷新页面即可恢复；若有生成任务正在进行，可先关闭此弹层，等任务完成后再刷新。
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={onReload}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-400"
          >
            刷新页面
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * fallback 为 null:弹窗出现前本来就没有 UI,加载失败则由 ErrorBoundary 呈现弹层级
 * 错误卡片(与既有 region="modal" 行为一致)。Suspense 各弹窗独立,避免一个弹窗的
 * chunk 加载把另一个已打开的弹窗顶成 fallback。
 */
function Gate({
  open,
  onClose,
  children,
}: {
  open: boolean
  /** 复位该弹层的 store 开关:chunk 加载失败时给用户一条回主界面的路 */
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <ErrorBoundary
      region="modal"
      renderFallback={(actions: FallbackActions) =>
        actions.error instanceof ModalChunkLoadError ? (
          <ChunkLoadFallback onClose={onClose} onReload={actions.onReload} />
        ) : null
      }
    >
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
  const close = () => useStore.getState()

  return (
    <>
      <Gate open={showSettings} onClose={() => close().setShowSettings(false)}>
        <SettingsModal />
      </Gate>
      <Gate open={showPromptOptimizer} onClose={() => close().setShowPromptOptimizer(false)}>
        <PromptOptimizerModal />
      </Gate>
      <Gate open={hasCaptionSource} onClose={() => close().setCaptionSource(null)}>
        <ImageCaptionModal />
      </Gate>
      <Gate open={hasMaskEditor} onClose={() => close().setMaskEditorImageId(null)}>
        <MaskEditorModal />
      </Gate>
      <Gate open={showCommandPalette} onClose={() => close().setShowCommandPalette(false)}>
        <CommandPalette />
      </Gate>
      <Gate open={hasCompare} onClose={() => close().setCompareTaskIds(null)}>
        <CompareModal />
      </Gate>
      <Gate open={hasLineage} onClose={() => close().setLineageTaskId(null)}>
        <LineageModal />
      </Gate>
      <Gate open={hasBatchCaption} onClose={() => close().setCaptionBatchImageIds(null)}>
        <BatchCaptionModal />
      </Gate>
      <Gate open={tourActive} onClose={() => close().setTourActive(false)}>
        <TourOverlay />
      </Gate>
    </>
  )
}
