import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, getCachedImage, ensureImageCached } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../hooks/useLockBodyScroll'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { buildCompareRows } from '../lib/compareTasks'
import type { TaskRecord } from '../types'

const COLUMN_LETTERS = ['A', 'B', 'C', 'D']

/**
 * 列头副标题：网格坐标优先，否则创建时间。
 * 坐标存的是 GridAxisValue.key（稳定键），展示用成员自带的 gridAxes 反查 label——
 * 与矩阵 UI 同源；不反查的话 size 轴显示档位简写、无风格 cell 的 key 是 '' 直接渲染成空白。
 * 注意 y === ''（Y 轴的空键取值）≠ y === undefined（无 Y 轴），不能用 truthy 判断。
 */
function columnSubtitle(task: TaskRecord): string {
  const coord = task.gridCoord
  if (coord) {
    const axisLabel = (axis: 'x' | 'y', key: string) =>
      task.gridAxes?.[axis]?.values.find((v) => v.key === key)?.label || key || '—'
    const xLabel = axisLabel('x', coord.x)
    return coord.y === undefined ? xLabel : `${xLabel} × ${axisLabel('y', coord.y)}`
  }
  return `创建于 ${new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}`
}

/**
 * A/B 并排对比：每列一条任务（图 + 多图切换），下方参数行跨列对齐、差异行高亮。
 * 外层只负责开关与 id 解析：关闭即卸载内层，重开自带全新图下标/缓存状态；
 * key 绑定 id 列表，换一组对比对象也整体重置。
 * z-50 与 DetailModal 同层，点列图开 Lightbox（z-60）叠放细看。
 */
export default function CompareModal() {
  const compareTaskIds = useStore((s) => s.compareTaskIds)
  const setCompareTaskIds = useStore((s) => s.setCompareTaskIds)
  const tasks = useStore((s) => s.tasks)

  /** 渲染期按 id 解析；task 在打开期间被删则该列消失 */
  const compareTasks = useMemo(() => {
    if (!compareTaskIds) return []
    return compareTaskIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is TaskRecord => Boolean(t))
  }, [compareTaskIds, tasks])

  // 有效列 < 2 时整体关闭（删除导致）。setCompareTaskIds 是 zustand 外部 store 写入，非 React setState。
  useEffect(() => {
    if (compareTaskIds && compareTasks.length < 2) setCompareTaskIds(null)
  }, [compareTaskIds, compareTasks.length, setCompareTaskIds])

  if (!compareTaskIds || compareTasks.length < 2) return null
  return (
    <ComparePanel
      key={compareTaskIds.join(',')}
      compareTasks={compareTasks}
      close={() => setCompareTaskIds(null)}
    />
  )
}

function ComparePanel({ compareTasks, close }: { compareTasks: TaskRecord[]; close: () => void }) {
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const panelRef = useRef<HTMLDivElement>(null)

  /** 每列独立的当前图下标（按 task.id 记，列被删不串位）；挂载即全新 */
  const [imageIndexById, setImageIndexById] = useState<Record<string, number>>({})

  /** 全部列的输出图 id（列被删时收缩，已载多余项无害） */
  const imageIds = useMemo(
    () => [...new Set(compareTasks.flatMap((t) => t.outputImages || []))],
    [compareTasks],
  )

  // cache-first：挂载时同步吃缓存（useState 初始化器，不进 effect）
  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const id of imageIds) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    return initial
  })

  // 未命中缓存的异步补载（setState 仅在异步回调里）
  useEffect(() => {
    let cancelled = false
    for (const id of imageIds) {
      if (getCachedImage(id)) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setImageSrcs((prev) => (prev[id] ? prev : { ...prev, [id]: url }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [imageIds])

  const rows = useMemo(() => buildCompareRows(compareTasks), [compareTasks])

  useCloseOnEscape(true, close)
  useLockBodyScroll(true)
  useFocusTrap(true, panelRef)

  const columnCount = compareTasks.length
  // grid-cols 动态类需在 Tailwind 可静态分析的集合内
  const gridColsClass =
    columnCount === 2 ? 'lg:grid-cols-2' : columnCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={close}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[92vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08]">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <svg className="h-5 w-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="8" height="16" rx="2" />
              <rect x="13" y="4" width="8" height="16" rx="2" />
            </svg>
            并排对比（{columnCount} 列）
          </h3>
          <button
            onClick={close}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭对比"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {/* 图片列区 */}
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${gridColsClass}`}>
            {compareTasks.map((task, columnIndex) => {
              const outputs = task.outputImages || []
              const index = Math.min(imageIndexById[task.id] ?? 0, Math.max(outputs.length - 1, 0))
              const currentId = outputs[index]
              const src = currentId ? imageSrcs[currentId] : ''
              return (
                <div key={task.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-500/90 text-xs font-bold text-white">
                      {COLUMN_LETTERS[columnIndex]}
                    </span>
                    <span className="truncate text-xs text-gray-400 dark:text-gray-500">
                      {columnSubtitle(task)}
                    </span>
                  </div>
                  {currentId ? (
                    <button
                      type="button"
                      onClick={() => setLightboxImageId(currentId, outputs)}
                      className="flex h-[36vh] items-center justify-center overflow-hidden rounded-2xl border border-gray-200/60 bg-gray-50 dark:border-white/[0.06] dark:bg-white/[0.03]"
                      title="点击放大"
                      aria-label={`放大第 ${COLUMN_LETTERS[columnIndex]} 列图片`}
                    >
                      {src ? (
                        <img src={src} alt={`对比列 ${COLUMN_LETTERS[columnIndex]}`} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-xs text-gray-400">加载中…</span>
                      )}
                    </button>
                  ) : (
                    <div className="flex h-[36vh] items-center justify-center rounded-2xl border border-dashed border-gray-200 text-xs text-gray-400 dark:border-white/[0.08]">
                      无输出
                    </div>
                  )}
                  {outputs.length > 1 && (
                    <div className="flex items-center justify-center gap-1.5">
                      {/* key 带下标:输出图 id 是内容寻址哈希,同批两张字节相同的图会撞 id */}
                      {outputs.map((id, i) => (
                        <button
                          key={`${id}-${i}`}
                          type="button"
                          onClick={() => setImageIndexById((prev) => ({ ...prev, [task.id]: i }))}
                          aria-label={`第 ${COLUMN_LETTERS[columnIndex]} 列第 ${i + 1} 张`}
                          className={`h-2 w-2 rounded-full transition-colors ${
                            i === index
                              ? 'bg-blue-500'
                              : 'bg-gray-300 hover:bg-gray-400 dark:bg-white/[0.15] dark:hover:bg-white/[0.3]'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 参数对照区：行标题 + 跨列值；差异行高亮 */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-16" />
                {compareTasks.map((task) => (
                  <col key={task.id} />
                ))}
              </colgroup>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className={
                      row.differs
                        ? 'bg-blue-50/60 dark:bg-blue-500/[0.07]'
                        : ''
                    }
                  >
                    <th
                      scope="row"
                      className="px-2 py-2 text-left align-top text-xs font-medium text-gray-400 dark:text-gray-500"
                    >
                      <span className="inline-flex items-center gap-1">
                        {row.differs && (
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-label="存在差异" />
                        )}
                        {row.label}
                      </span>
                    </th>
                    {row.values.map((value, i) => (
                      <td
                        key={compareTasks[i].id}
                        className={`px-2 py-2 align-top text-gray-700 dark:text-gray-300 ${
                          row.multiline ? 'whitespace-pre-wrap break-words text-xs leading-relaxed' : ''
                        }`}
                      >
                        {row.multiline ? (
                          <div className="max-h-32 overflow-y-auto custom-scrollbar">{value}</div>
                        ) : (
                          value
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
