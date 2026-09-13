import { Fragment, memo, useCallback, useMemo, useState } from 'react'
import type { TaskRecord } from '../types'
import {
  useStore,
  reuseConfig,
  editOutputs,
  retryGridCell,
  retryGridMissing,
  cancelBatch,
} from '../store'
import { reconstructMatrix, getGridAxisDef } from '../lib/gridExperiment'
import { MAX_BATCH_NOTE_LEN } from '../lib/gridSheet'
import { getGridRepresentatives, gridCellKey } from '../lib/taskPresentation'
import { exportGridSheet } from '../lib/gridSheetRender'
import TaskCard from './TaskCard'

interface Props {
  batchId: string
  tasks: TaskRecord[]
  representatives?: Map<string, TaskRecord>
  onDelete: (task: TaskRecord) => void
}

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const HEADER_CLASS =
  'flex items-center justify-center px-2 py-1 text-center text-xs font-medium text-content-muted'

interface MatrixCellProps {
  task: TaskRecord
  isSelected: boolean
  onCellClick: (task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => void
  onDelete: (task: TaskRecord) => void
}

// memo + 稳定回调:本组件订阅 selectedTaskIds,框选/Ctrl 点选时只有 isSelected 翻转的格重渲染
const MatrixCell = memo(function MatrixCell({
  task,
  isSelected,
  onCellClick,
  onDelete,
}: MatrixCellProps) {
  const onClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => onCellClick(task, e),
    [onCellClick, task],
  )
  const onReuseCb = useCallback(() => {
    void reuseConfig(task).catch(() => {
      /* reuseConfig surfaces recoverable errors via toast */
    })
  }, [task])
  const onEditCb = useCallback(() => {
    void editOutputs(task).catch(() => {
      /* editOutputs surfaces recoverable errors via toast */
    })
  }, [task])
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
export default function TaskGridMatrix({ batchId, tasks, representatives, onDelete }: Props) {
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const batchNote = useStore((s) => s.batchNotes[batchId])
  const setBatchNote = useStore((s) => s.setBatchNote)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [exporting, setExporting] = useState(false)

  const matrix = useMemo(() => reconstructMatrix(tasks), [tasks])

  // 直接使用作品区同一张代表表，保证实际卡片与“选择当前显示”一致；独立挂载时仍可重建。
  const repByCell = useMemo(
    () => representatives ?? getGridRepresentatives(tasks),
    [representatives, tasks],
  )

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
        const rep = repByCell.get(gridCellKey(col.key, row.key))
        if (rep?.status === 'done') doneCells += 1
        else if (!rep || rep.status === 'error') pendingCells += 1
      }
    }
    return { totalCells: matrix.cols.length * matrix.rows.length, doneCells, pendingCells }
  }, [matrix, repByCell])

  // 稳定回调(store action 引用稳定),供 MatrixCell 的 memo 依赖
  const handleCellClick = useCallback(
    (task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => {
      const isCtrl = isMac ? (e as React.MouseEvent).metaKey : (e as React.MouseEvent).ctrlKey
      const state = useStore.getState()
      if (isCtrl) {
        state.toggleTaskSelection(task.id)
      } else {
        if (state.selectedTaskIds.length > 0) state.clearSelection()
        state.setDetailTaskId(task.id)
      }
    },
    [],
  )

  if (!matrix) return null
  const { axes, cols, rows } = matrix
  const hasY = Boolean(axes.y)

  const xLabel = getGridAxisDef(axes.x.kind)?.label ?? axes.x.kind
  const yLabel = axes.y ? (getGridAxisDef(axes.y.kind)?.label ?? axes.y.kind) : null

  const repTask = (colKey: string, rowKey: string): TaskRecord | null =>
    repByCell.get(gridCellKey(colKey, rowKey)) ?? null

  const handleExport = () => {
    if (exporting) return
    setExporting(true)
    exportGridSheet({ tasks, batchId, note: batchNote?.text })
      .then(() => useStore.getState().showToast('对照图已导出', 'success'))
      .catch((err) => {
        useStore
          .getState()
          .showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, 'error')
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
          useStore.getState().showToast('该批次已全部完成,无可取消任务', 'info')
        } else {
          useStore
            .getState()
            .showToast(
              `已取消 ${aborted + skipped} 条:中止 ${aborted} 条在途、跳过 ${skipped} 条排队`,
              'success',
            )
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
      setSelectedTaskIds((previous) => previous.filter((id) => !allIdSet.has(id)))
    } else {
      setSelectedTaskIds((previous) => Array.from(new Set([...previous, ...allIds])))
    }
  }

  return (
    <div className="cv-auto-matrix col-span-full min-w-0 rounded-2xl border border-line bg-surface-muted p-4">
      {/* 小标题栏 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-content-muted">
          参数网格 · X: {xLabel}
          {yLabel ? ` · Y: ${yLabel}` : ''} · 完成 {doneCells}/{totalCells}
          {pendingCells > 0 ? ` · 待补 ${pendingCells}` : ''}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-content-muted"
            title={`选中此批 ${tasks.length} 条任务，包括 ${tasks.length - repByCell.size} 条同格历史记录`}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 accent-brand"
            />
            <span>选中整批</span>
            <span>（{tasks.length} 条任务）</span>
          </label>
          <button
            type="button"
            onClick={startEditNote}
            className="ui-button text-content-muted"
            title={batchNote ? '编辑批次笔记' : '添加批次笔记'}
          >
            {batchNote ? '笔记 ✓' : '笔记'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={doneCells < 1 || exporting}
            className="ui-button bg-brand-soft text-brand-ink"
            title={doneCells < 1 ? '至少 1 格完成后可导出' : '导出带轴标签的对照图 PNG'}
          >
            {exporting ? '导出中…' : '导出对照图'}
          </button>
          {hasFailuresOrGaps && (
            <button
              type="button"
              onClick={() => retryGridMissing(batchId, 'all')}
              className="ui-button bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
            >
              补跑全部失败格
            </button>
          )}
          {runningCount > 0 && (
            <button
              type="button"
              onClick={handleCancelBatch}
              className="ui-button bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              title="中止在途请求并跳过排队任务,取消的格可补跑"
            >
              取消批次
            </button>
          )}
        </div>
      </div>

      {tasks.length > repByCell.size && (
        <p className="mb-3 text-xs text-content-muted">
          此批共 {tasks.length} 条任务，含 {tasks.length - repByCell.size}{' '}
          条同格历史记录；每格只显示最新任务。
        </p>
      )}

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
            className="ui-field custom-scrollbar w-full resize-none text-sm leading-relaxed"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditingNote(false)}
              className="ui-button text-content-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveNote}
              className="ui-button bg-brand text-on-brand hover:bg-brand-hover"
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
            className="mb-3 block min-h-11 w-full truncate rounded-lg bg-surface px-3 py-2 text-left text-sm text-content-muted transition hover:bg-surface-raised"
          >
            📝 {batchNote.text}
          </button>
        )
      )}

      {/* 矩阵:第一列为行表头(无 Y 轴时占位),其余为 X 列 */}
      <div className="overflow-x-auto" data-selection-clip>
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `${hasY ? 'minmax(56px,auto)' : '0'} repeat(${cols.length}, minmax(260px, 1fr))`,
          }}
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
              {hasY ? <div className={`${HEADER_CLASS} justify-end`}>{row.label}</div> : <div />}
              {cols.map((col) => {
                const task = repTask(col.key, row.key)
                if (!task) {
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() =>
                        retryGridCell(batchId, { x: col.key, ...(hasY ? { y: row.key } : {}) })
                      }
                      className="flex min-h-[200px] w-full items-center justify-center rounded-2xl border border-dashed border-line bg-surface text-sm text-content-muted transition hover:border-brand hover:text-brand-ink"
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
