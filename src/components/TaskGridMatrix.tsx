import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import type { TaskRecord } from '../types'
import { useStore, reuseConfig, editOutputs, retryGridCell, retryGridMissing, cancelBatch } from '../store'
import { reconstructMatrix, getGridAxisDef } from '../lib/gridExperiment'
import { MAX_BATCH_NOTE_LEN, pickCellRepresentative } from '../lib/gridSheet'
import { exportGridSheet } from '../lib/gridSheetRender'
import TaskCard from './TaskCard'

interface Props {
  batchId: string
  tasks: TaskRecord[]
  onDelete: (task: TaskRecord) => void
}

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const HEADER_CLASS = 'flex items-center justify-center px-2 py-1 text-center text-xs font-medium text-gray-500 dark:text-gray-400'

interface MatrixCellProps {
  task: TaskRecord
  isSelected: boolean
  onCellClick: (task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => void
  onDelete: (task: TaskRecord) => void
}

// memo + 稳定回调:本组件订阅 selectedTaskIds,框选/Ctrl 点选时只有 isSelected 翻转的格重渲染
const MatrixCell = memo(function MatrixCell({ task, isSelected, onCellClick, onDelete }: MatrixCellProps) {
  const onClick = useCallback((e: React.MouseEvent | React.TouchEvent) => onCellClick(task, e), [onCellClick, task])
  const onReuseCb = useCallback(() => reuseConfig(task), [task])
  const onEditCb = useCallback(() => editOutputs(task), [task])
  const onDeleteCb = useCallback(() => onDelete(task), [onDelete, task])
  return (
    <div className="task-card-wrapper" data-task-id={task.id}>
      <TaskCard
        task={task}
        isSelected={isSelected}
        onClick={onClick}
        onReuse={onReuseCb}
        onEditOutputs={onEditCb}
        onDelete={onDeleteCb}
      />
    </div>
  )
})

/** XY 网格矩阵卡:行=Y 取值、列=X 取值,单元格复用 TaskCard,空格可补跑。占据流中整行。 */
export default function TaskGridMatrix({ batchId, tasks, onDelete }: Props) {
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const batchNote = useStore((s) => s.batchNotes[batchId])
  const setBatchNote = useStore((s) => s.setBatchNote)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [exporting, setExporting] = useState(false)

  const matrix = useMemo(() => reconstructMatrix(tasks), [tasks])

  /**
   * 逐格代表 task(同格多 task 取最新,与导出共用 pickCellRepresentative 判定):
   * 一次 O(成员数) 分组建表,进度统计与渲染循环共查——原先每格调 cellTasks(filter 全量成员),
   * 两个 cols×rows 循环下是 O(格数²),且本组件订阅 selectedTaskIds,每次框选/Ctrl 点选都全量重算。
   * 复合键以 NUL 分隔:prompt 轴的 key 是提示词原文,可含空格等任意可见字符,普通分隔符会撞键。
   */
  const repByCell = useMemo(() => {
    const groups = new Map<string, TaskRecord[]>()
    for (const t of tasks) {
      if (!t.gridCoord) continue
      const key = `${t.gridCoord.x}\u0000${t.gridCoord.y ?? ''}`
      const group = groups.get(key)
      if (group) group.push(t)
      else groups.set(key, [t])
    }
    const map = new Map<string, TaskRecord>()
    for (const [key, group] of groups) {
      const rep = pickCellRepresentative(group)
      if (rep) map.set(key, rep)
    }
    return map
  }, [tasks])

  const selectedIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])

  // 进度 / 缺漏基于「矩阵格」而非成员条数:补跑新建 task 会保留旧 error,成员数会被抬高、
  // gaps 减法在重复坐标下失真(可负、或与真空格相互抵消)。逐格按代表 task 判定才稳。
  // useMemo:本组件订阅 selectedTaskIds,框选期间每次重渲染不必重扫 cols×rows。
  const progress = useMemo(() => {
    if (!matrix) return { totalCells: 0, doneCells: 0, pendingCells: 0 }
    let doneCells = 0
    let pendingCells = 0 // 缺失或失败的格
    for (const col of matrix.cols) {
      for (const row of matrix.rows) {
        const rep = repByCell.get(`${col.key}\u0000${row.key}`)
        if (rep?.status === 'done') doneCells += 1
        else if (!rep || rep.status === 'error') pendingCells += 1
      }
    }
    return { totalCells: matrix.cols.length * matrix.rows.length, doneCells, pendingCells }
  }, [matrix, repByCell])

  // 稳定回调(store action 引用稳定),供 MatrixCell 的 memo 依赖
  const handleCellClick = useCallback((task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => {
    const isCtrl = isMac ? (e as React.MouseEvent).metaKey : (e as React.MouseEvent).ctrlKey
    if (isCtrl) toggleTaskSelection(task.id)
    else setDetailTaskId(task.id)
  }, [toggleTaskSelection, setDetailTaskId])

  if (!matrix) return null
  const { axes, cols, rows } = matrix
  const hasY = Boolean(axes.y)

  const xLabel = getGridAxisDef(axes.x.kind)?.label ?? axes.x.kind
  const yLabel = axes.y ? (getGridAxisDef(axes.y.kind)?.label ?? axes.y.kind) : null

  const repTask = (colKey: string, rowKey: string): TaskRecord | null =>
    repByCell.get(`${colKey}\u0000${rowKey}`) ?? null

  const handleExport = () => {
    if (exporting) return
    setExporting(true)
    exportGridSheet({ tasks, batchId, note: batchNote?.text })
      .then(() => showToast('对照图已导出', 'success'))
      .catch((err) => {
        showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      })
      .finally(() => setExporting(false))
  }

  // 批内是否有在途成员:遍历成员而非格代表(进度统计按格,取消按条)
  const runningCount = tasks.filter((t) => t.status === 'running').length
  const handleCancelBatch = () => {
    setConfirmDialog({
      title: '取消整批生成?',
      message: `将取消 ${runningCount} 条进行中的任务(含排队未发出的),已发请求会被丢弃。取消的格仍可用「补跑全部失败格」重新触发。`,
      confirmText: '取消整批',
      // danger:确认主按钮红色——'warning' 映射橙色,与「补跑全部失败格」(amber)同色族,会抹掉红/橙语义分区
      tone: 'danger',
      action: () => {
        // 实时返回兜住弹窗到确认之间的状态漂移:期间成员可能已全部自然完成
        const { aborted, skipped } = cancelBatch(batchId)
        if (aborted + skipped === 0) {
          showToast('该批次已全部完成,无可取消任务', 'info')
        } else {
          showToast(`已取消 ${aborted + skipped} 条:中止 ${aborted} 条在途、跳过 ${skipped} 条排队`, 'success')
        }
      },
    })
  }

  const startEditNote = () => {
    setNoteDraft(batchNote?.text ?? '')
    setEditingNote(true)
  }

  const saveNote = () => {
    setBatchNote(batchId, noteDraft)
    setEditingNote(false)
  }

  const { totalCells, doneCells, pendingCells } = progress
  const hasFailuresOrGaps = pendingCells > 0

  const allIds = tasks.map((t) => t.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIdSet.has(id))
  const toggleSelectAll = () => {
    if (allSelected) {
      const allIdSet = new Set(allIds)
      setSelectedTaskIds(selectedTaskIds.filter((id) => !allIdSet.has(id)))
    } else {
      setSelectedTaskIds(Array.from(new Set([...selectedTaskIds, ...allIds])))
    }
  }

  return (
    <div className="col-span-full cv-auto-matrix rounded-2xl border border-gray-200/70 bg-gray-50/40 p-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
      {/* 小标题栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          参数网格 · X: {xLabel}
          {yLabel ? ` · Y: ${yLabel}` : ''} · 完成 {doneCells}/{totalCells}
          {pendingCells > 0 ? ` · 待补 ${pendingCells}` : ''}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 accent-blue-500" />
            选中整批
          </label>
          <button
            type="button"
            onClick={startEditNote}
            className="rounded-lg px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            title={batchNote ? '编辑批次笔记' : '添加批次笔记'}
          >
            {batchNote ? '笔记 ✓' : '笔记'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={doneCells < 1 || exporting}
            className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
            title={doneCells < 1 ? '至少 1 格完成后可导出' : '导出带轴标签的对照图 PNG'}
          >
            {exporting ? '导出中…' : '导出对照图'}
          </button>
          {hasFailuresOrGaps && (
            <button
              type="button"
              onClick={() => retryGridMissing(batchId, 'all')}
              className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-600 transition hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
            >
              补跑全部失败格
            </button>
          )}
          {runningCount > 0 && (
            <button
              type="button"
              onClick={handleCancelBatch}
              className="rounded-lg bg-red-50 px-2.5 py-1 text-xs text-red-600 transition hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              title="中止在途请求并跳过排队任务,取消的格可补跑"
            >
              取消批次
            </button>
          )}
        </div>
      </div>

      {/* 批次笔记:展示行 / 行内编辑 */}
      {editingNote ? (
        <div className="mb-3 flex flex-col gap-1.5">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            maxLength={MAX_BATCH_NOTE_LEN}
            rows={2}
            placeholder="记录这组实验的结论（导出对照图时会带上）"
            aria-label="批次笔记"
            className="w-full resize-none rounded-xl border border-gray-200/70 bg-white/60 px-2.5 py-1.5 text-xs leading-relaxed text-gray-700 outline-none focus:border-blue-300 custom-scrollbar dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/40"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditingNote(false)}
              className="rounded-lg px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveNote}
              className="rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-600"
            >
              保存笔记
            </button>
          </div>
        </div>
      ) : (
        batchNote && (
          <button
            type="button"
            onClick={startEditNote}
            title={batchNote.text}
            className="mb-3 block w-full truncate rounded-lg bg-white/50 px-2.5 py-1.5 text-left text-xs text-gray-500 transition hover:bg-white dark:bg-white/[0.03] dark:text-gray-400 dark:hover:bg-white/[0.06]"
          >
            📝 {batchNote.text}
          </button>
        )
      )}

      {/* 矩阵:第一列为行表头(无 Y 轴时占位),其余为 X 列 */}
      <div className="overflow-x-auto">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `${hasY ? 'minmax(56px,auto)' : '0'} repeat(${cols.length}, minmax(220px, 1fr))` }}
        >
          {/* 表头行 */}
          <div />
          {cols.map((col) => (
            <div key={col.key} className={HEADER_CLASS}>
              {col.label}
            </div>
          ))}

          {/* 数据行 */}
          {rows.map((row) => (
            <Fragment key={row.key || '__single__'}>
              {hasY ? (
                <div className={`${HEADER_CLASS} justify-end`}>{row.label}</div>
              ) : (
                <div />
              )}
              {cols.map((col) => {
                const task = repTask(col.key, row.key)
                if (!task) {
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => retryGridCell(batchId, { x: col.key, ...(hasY ? { y: row.key } : {}) })}
                      className="flex min-h-[120px] w-full items-center justify-center rounded-xl border border-dashed border-gray-300 text-xs text-gray-400 transition hover:border-blue-300 hover:text-blue-500 dark:border-white/[0.12] dark:text-gray-500 dark:hover:border-blue-500/40"
                    >
                      补跑此格
                    </button>
                  )
                }
                return (
                  <MatrixCell
                    key={col.key}
                    task={task}
                    isSelected={selectedIdSet.has(task.id)}
                    onCellClick={handleCellClick}
                    onDelete={onDelete}
                  />
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
