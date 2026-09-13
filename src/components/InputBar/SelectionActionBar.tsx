import { useMemo } from 'react'
import type { TaskRecord } from '../../types'
import { getPresentedSelection, type TaskPresentation } from '../../lib/taskPresentation'
import {
  cancelTask,
  clearTaskFavorite,
  removeMultipleTasks,
  setTaskFavoriteCategory,
  useStore,
} from '../../store'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'

interface Props {
  presentation: TaskPresentation
}

/** 与作品区共享显示集合；整批显式选择的历史成员保留，但隐藏块永远不进入可执行集合。 */
export default function SelectionActionBar({ presentation }: Props) {
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const tasks = useStore((s) => s.tasks)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const setCompareTaskIds = useStore((s) => s.setCompareTaskIds)
  const setCaptionBatchImageIds = useStore((s) => s.setCaptionBatchImageIds)
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])

  const { taskIds, historyCount, batchCount } = getPresentedSelection(presentation, selectedTaskIds)
  const selected = new Set(taskIds)
  const selectedTasks = taskIds
    .map((id) => byId.get(id))
    .filter((task): task is TaskRecord => Boolean(task))
  const allDisplayedSelected =
    presentation.displayedTasks.length > 0 &&
    presentation.displayedTasks.every((task) => selected.has(task.id))
  const scopeText =
    batchCount > 0 ? `涉及 ${batchCount} 个矩阵批次，包含 ${historyCount} 条同格历史记录。` : ''

  const handleSelectAllToggle = () => {
    // 普通全选只改变卡片代表；取消当前显示全选时不顺带取消用户明确选中的历史成员。
    if (allDisplayedSelected) {
      setSelectedTaskIds((previous) =>
        previous.filter(
          (id) => presentation.memberTaskIds.has(id) && !presentation.displayedTaskIds.has(id),
        ),
      )
    } else {
      setSelectedTaskIds((previous) => [
        ...new Set([
          ...previous.filter((id) => presentation.memberTaskIds.has(id)),
          ...presentation.displayedTaskIds,
        ]),
      ])
    }
  }

  const handleSetFavoriteCategory = (categoryId: string | null) => {
    if (
      !categoryId ||
      selectedTasks.every((task) => task.isFavorite && task.favoriteCategoryId === categoryId)
    )
      return
    setConfirmDialog({
      title: '批量收藏',
      message: `确定要把选中的 ${taskIds.length} 条记录收藏到此分类吗？${scopeText}`,
      confirmText: '确认收藏',
      action: () =>
        Promise.allSettled(taskIds.map((id) => setTaskFavoriteCategory(id, categoryId))).then(
          (results) => {
            const failed = results.filter((result) => result.status === 'rejected').length
            if (failed > 0)
              useStore.getState().showToast(`批量收藏失败：${failed} 条未保存`, 'error')
            clearSelection()
          },
        ),
    })
  }

  const handleClearFavorite = () => {
    setConfirmDialog({
      title: '批量取消收藏',
      message: `确定要取消收藏选中的 ${taskIds.length} 条记录吗？${scopeText}`,
      confirmText: '确认取消',
      action: () =>
        Promise.allSettled(taskIds.map((id) => clearTaskFavorite(id))).then((results) => {
          const failed = results.filter((result) => result.status === 'rejected').length
          if (failed > 0)
            useStore.getState().showToast(`批量取消收藏失败：${failed} 条未保存`, 'error')
          clearSelection()
        }),
    })
  }

  const handleDeleteSelected = () => {
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${taskIds.length} 条记录吗？${scopeText}`,
      minConfirmDelayMs: 700,
      tone: 'danger',
      action: () => removeMultipleTasks(taskIds),
    })
  }

  if (taskIds.length === 0) return null

  const allSelectedFavorite =
    selectedTasks.length > 0 && selectedTasks.every((task) => task.isFavorite)
  const runningSelected = selectedTasks
    .filter((task) => task.status === 'running')
    .map((task) => task.id)
  const handleCancelRunning = () => {
    setConfirmDialog({
      title: '取消生成',
      message: `确定取消选中的 ${runningSelected.length} 条进行中任务？已发请求会被丢弃，记录保留可重试。${scopeText}`,
      confirmText: '取消生成',
      tone: 'danger',
      action: () => {
        // 确认期间完成的任务由运行时 guard 跳过；提示必须使用实际取消数。
        let cancelled = 0
        for (const id of runningSelected) if (cancelTask(id)) cancelled += 1
        useStore
          .getState()
          .showToast(
            cancelled > 0 ? `已取消 ${cancelled} 条任务` : '选中任务已全部完成,无可取消',
            cancelled > 0 ? 'success' : 'info',
          )
      },
    })
  }

  const canCompare =
    taskIds.length >= 2 &&
    taskIds.length <= 4 &&
    selectedTasks.length === taskIds.length &&
    selectedTasks.every((task) => task.status === 'done' && task.outputImages.length > 0)
  const batchCaptionImageIds = [
    ...new Set(
      selectedTasks
        .filter((task) => task.status === 'done' && task.outputImages.length > 0)
        .map((task) => task.outputImages[0]),
    ),
  ]

  return (
    <section
      data-no-drag-select
      aria-label="已选任务操作"
      className="mb-5 rounded-2xl border border-brand/25 bg-brand-soft p-3 text-content"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="px-1">
          <p className="text-sm font-semibold">已选择 {taskIds.length} 条任务</p>
          {scopeText && <p className="mt-1 text-xs text-content-muted">{scopeText}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleSelectAllToggle}
            className="ui-button bg-surface text-brand-ink"
            title={allDisplayedSelected ? '取消当前显示全选' : '选择当前显示的任务'}
          >
            {allDisplayedSelected ? '取消当前显示全选' : '选择当前显示的任务'}
          </button>
          <div className="shrink-0">
            <FavoriteCategoryMenu
              includeDefaultFallback
              align="right"
              onSelect={handleSetFavoriteCategory}
              includeClearFavorite={allSelectedFavorite}
              onClearFavorite={allSelectedFavorite ? handleClearFavorite : undefined}
              renderTrigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="ui-button bg-surface"
                  title={allSelectedFavorite ? '收藏分类 / 取消收藏' : '收藏'}
                >
                  收藏
                </button>
              )}
            />
          </div>
          <button
            type="button"
            onClick={() => canCompare && setCompareTaskIds(taskIds)}
            disabled={!canCompare}
            className="ui-button bg-surface"
            title={canCompare ? '并排对比选中任务' : '选择 2~4 条已完成任务进行对比'}
            aria-label="并排对比"
          >
            对比
          </button>
          <button
            type="button"
            disabled={batchCaptionImageIds.length === 0}
            onClick={() => {
              setCaptionBatchImageIds(batchCaptionImageIds)
              clearSelection()
            }}
            className="ui-button bg-surface"
            aria-label="批量反推"
            title={
              batchCaptionImageIds.length
                ? `批量反推(${batchCaptionImageIds.length} 张图)`
                : '选择已完成任务批量反推提示词'
            }
          >
            反推
          </button>
          {runningSelected.length > 0 && (
            <button
              type="button"
              onClick={handleCancelRunning}
              className="ui-button bg-surface text-red-600 dark:text-red-400"
              aria-label="取消选中的在途任务"
            >
              取消生成 {runningSelected.length}
            </button>
          )}
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="ui-button bg-surface text-red-600 dark:text-red-400"
            aria-label="删除选中"
            title="删除选中"
          >
            删除
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ui-button text-content-muted"
            title="取消选择"
          >
            清除选择
          </button>
        </div>
      </div>
    </section>
  )
}
