import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getCachedImage, ensureImageCached } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useFocusTrap } from '../hooks/useFocusTrap'
import {
  buildLineageGraph,
  buildLineageIndex,
  type LineageNode,
} from '../lib/lineage'
import { computeLineageLayout } from '../lib/lineageLayout'
import type { TaskRecord } from '../types'

/** 节点代表图兜底链:自身首张输出 → 首张输入 → 状态占位(避免空白缩略图) */
function nodeThumbId(task: TaskRecord): string | null {
  return task.outputImages?.[0] ?? task.inputImageIds?.[0] ?? null
}

function statusColor(status: TaskRecord['status']): string {
  return status === 'done' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-blue-400'
}

/**
 * 创作谱系树:独立全屏视图(照搬 CompareModal 骨架)。展示中心 task 的祖先链 + 后代树多跳 DAG。
 * 外层只负责开关与解析:中心 task 被删则自动关闭;key 绑 lineageTaskId,换中心整体重置。
 * z-50 与 DetailModal/CompareModal 同层;点节点替换式回 DetailModal(关谱系开详情)。
 */
export default function LineageModal() {
  const lineageTaskId = useStore((s) => s.lineageTaskId)
  const setLineageTaskId = useStore((s) => s.setLineageTaskId)
  const tasks = useStore((s) => s.tasks)

  const centerExists = useMemo(
    () => Boolean(lineageTaskId && tasks.some((t) => t.id === lineageTaskId)),
    [lineageTaskId, tasks],
  )

  // 中心 task 被删 → 关闭(zustand 外部写,非 React setState)
  useEffect(() => {
    if (lineageTaskId && !centerExists) setLineageTaskId(null)
  }, [lineageTaskId, centerExists, setLineageTaskId])

  if (!lineageTaskId || !centerExists) return null
  return <LineagePanel key={lineageTaskId} centerId={lineageTaskId} close={() => setLineageTaskId(null)} />
}

function LineagePanel({ centerId, close }: { centerId: string; close: () => void }) {
  const tasks = useStore((s) => s.tasks)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLineageTaskId = useStore((s) => s.setLineageTaskId)
  const panelRef = useRef<HTMLDivElement>(null)

  // 倒排索引 + 双向 BFS 谱系图。deps=[tasks]:生成期 tasks 变化会重算(后代随 outputs 落地"长出"),
  // 单遍 O(N) 在数千 task 下约几 ms,可接受;若实测卡顿改 keyed on 粗信号
  const graph = useMemo(() => buildLineageGraph(centerId, buildLineageIndex(tasks)), [centerId, tasks])
  const layout = useMemo(() => computeLineageLayout(graph), [graph])

  // 节点代表图 id(去重)→ cache-first 加载(照搬 CompareModal)
  const thumbIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of graph.nodes) {
      const id = nodeThumbId(node.task)
      if (id) ids.add(id)
    }
    return [...ids]
  }, [graph.nodes])

  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const id of thumbIds) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    return initial
  })

  useEffect(() => {
    let cancelled = false
    for (const id of thumbIds) {
      if (getCachedImage(id)) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setImageSrcs((prev) => (prev[id] ? prev : { ...prev, [id]: url }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [thumbIds])

  useCloseOnEscape(true, close)
  useLockBodyScroll(true)
  useFocusTrap(true, panelRef)

  const openDetail = (taskId: string) => {
    setLineageTaskId(null) // 替换式:关谱系回 DetailModal
    setDetailTaskId(taskId)
  }

  const renderNode = (node: LineageNode) => {
    const rect = layout.nodePos.get(node.task.id)
    if (!rect) return null
    const isCenter = node.task.id === centerId
    const thumbId = nodeThumbId(node.task)
    const src = thumbId ? imageSrcs[thumbId] : ''
    return (
      <button
        key={node.task.id}
        type="button"
        onClick={() => openDetail(node.task.id)}
        title={node.task.prompt || '(无提示词)'}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        className={`absolute flex items-center gap-2 rounded-xl border p-1.5 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.04] ${
          isCenter
            ? 'border-blue-500 ring-2 ring-blue-500 shadow-[0_0_28px_rgba(59,130,246,0.4)] bg-blue-50/40 dark:bg-blue-500/[0.08]'
            : 'border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900'
        }`}
      >
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-black/20">
          {src && <img src={src} className="h-full w-full object-cover" alt="" />}
          <span
            className={`absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white dark:ring-gray-900 ${statusColor(node.task.status)}`}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300">
          {node.task.prompt || '(无提示词)'}
        </span>
      </button>
    )
  }

  return (
    <div data-no-drag-select className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={close} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[92vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08]">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <svg className="h-5 w-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="5" r="2.5" />
              <circle cx="6" cy="19" r="2.5" />
              <circle cx="18" cy="19" r="2.5" />
              <path d="M12 7.5v3M12 10.5 6.8 16.6M12 10.5l5.2 6.1" />
            </svg>
            创作谱系
            {graph.truncated && (
              <span className="text-xs font-normal text-amber-500 dark:text-amber-400">
                · 谱系过大,仅展示中心邻近的 {graph.nodes.length} 个节点
              </span>
            )}
          </h3>
          <button
            onClick={close}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭谱系"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 画布:大谱系靠容器滚动(不缩放) */}
        <div className="flex-1 overflow-auto p-6 custom-scrollbar">
          {graph.nodes.length <= 1 ? (
            <div className="py-20 text-center text-sm text-gray-400 dark:text-gray-500">
              这条记录暂无可追溯的派生关系。
            </div>
          ) : (
            <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
              {/* 边层:SVG 覆盖,父底中点 → 子顶中点贝塞尔;回边虚线 */}
              <svg
                className="pointer-events-none absolute inset-0"
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                {graph.edges.map((edge) => (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    d={layout.edgePath(edge)}
                    fill="none"
                    stroke="rgba(59,130,246,0.4)"
                    strokeWidth={1.5}
                  />
                ))}
              </svg>
              {/* 节点层 */}
              {graph.nodes.map(renderNode)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
