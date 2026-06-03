import { Fragment } from 'react'
import type { TaskRecord } from '../types'
import { useStore, reuseConfig, editOutputs, retryGridCell, retryGridMissing } from '../store'
import { reconstructMatrix, getGridAxisDef } from '../lib/gridExperiment'
import TaskCard from './TaskCard'

interface Props {
  batchId: string
  tasks: TaskRecord[]
  onDelete: (task: TaskRecord) => void
}

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const HEADER_CLASS = 'flex items-center justify-center px-2 py-1 text-center text-xs font-medium text-gray-500 dark:text-gray-400'

/** XY 网格矩阵卡:行=Y 取值、列=X 取值,单元格复用 TaskCard,空格可补跑。占据流中整行。 */
export default function TaskGridMatrix({ batchId, tasks, onDelete }: Props) {
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)

  const matrix = reconstructMatrix(tasks)
  if (!matrix) return null
  const { axes, cols, rows, cellTasks } = matrix
  const hasY = Boolean(axes.y)

  const xLabel = getGridAxisDef(axes.x.kind)?.label ?? axes.x.kind
  const yLabel = axes.y ? (getGridAxisDef(axes.y.kind)?.label ?? axes.y.kind) : null

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const errorCount = tasks.filter((t) => t.status === 'error').length
  const gaps = cols.length * rows.length - tasks.length
  const hasFailuresOrGaps = errorCount > 0 || gaps > 0

  /** 同格多 task 取最新为代表 */
  const repTask = (colKey: string, rowKey: string): TaskRecord | null => {
    const list = cellTasks(colKey, rowKey)
    if (!list.length) return null
    return list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  }

  const allIds = tasks.map((t) => t.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedTaskIds.includes(id))
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedTaskIds(selectedTaskIds.filter((id) => !allIds.includes(id)))
    } else {
      setSelectedTaskIds(Array.from(new Set([...selectedTaskIds, ...allIds])))
    }
  }

  const handleCellClick = (task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => {
    const isCtrl = isMac ? (e as React.MouseEvent).metaKey : (e as React.MouseEvent).ctrlKey
    if (isCtrl) toggleTaskSelection(task.id)
    else setDetailTaskId(task.id)
  }

  return (
    <div className="col-span-full rounded-2xl border border-gray-200/70 bg-gray-50/40 p-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
      {/* 小标题栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          参数网格 · X: {xLabel}
          {yLabel ? ` · Y: ${yLabel}` : ''} · 完成 {doneCount}/{tasks.length}
          {errorCount > 0 ? ` · 失败 ${errorCount}` : ''}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 accent-blue-500" />
            选中整批
          </label>
          {hasFailuresOrGaps && (
            <button
              type="button"
              onClick={() => retryGridMissing(batchId, 'all')}
              className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-600 transition hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
            >
              补跑全部失败格
            </button>
          )}
        </div>
      </div>

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
                  <div key={col.key} className="task-card-wrapper" data-task-id={task.id}>
                    <TaskCard
                      task={task}
                      isSelected={selectedTaskIds.includes(task.id)}
                      onClick={(e) => handleCellClick(task, e)}
                      onReuse={() => reuseConfig(task)}
                      onEditOutputs={() => editOutputs(task)}
                      onDelete={() => onDelete(task)}
                    />
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
