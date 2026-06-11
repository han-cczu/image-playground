import { useCallback } from 'react'
import type { TaskRecord } from '../../types'
import { cancelTask, clearTaskFavorite, removeMultipleTasks, setTaskFavoriteCategory, useStore } from '../../store'
import FavoriteCategoryMenu from '../FavoriteCategoryMenu'

interface Props {
  filteredTasks: TaskRecord[]
}

export default function SelectionActionBar({ filteredTasks }: Props) {
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const tasks = useStore((s) => s.tasks)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const setCompareTaskIds = useStore((s) => s.setCompareTaskIds)
  const setCaptionBatchImageIds = useStore((s) => s.setCaptionBatchImageIds)

  const allVisibleSelected =
    selectedTaskIds.length === filteredTasks.length && filteredTasks.length > 0

  const handleSelectAllToggle = useCallback(() => {
    if (allVisibleSelected) {
      clearSelection()
    } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id))
    }
  }, [allVisibleSelected, filteredTasks, clearSelection, setSelectedTaskIds])

  const handleSetFavoriteCategory = useCallback((categoryId: string | null) => {
    if (!categoryId) return
    const selectedTasks = tasks.filter((t) => selectedTaskIds.includes(t.id))
    const allInTarget =
      selectedTasks.length > 0 &&
      selectedTasks.every((t) => t.isFavorite && t.favoriteCategoryId === categoryId)
    if (allInTarget) return

    setConfirmDialog({
      title: '批量收藏',
      message: `确定要把选中的 ${selectedTaskIds.length} 条记录收藏到此分类吗？`,
      confirmText: '确认收藏',
      action: () => {
        void (async () => {
          await Promise.allSettled(
            selectedTaskIds.map((id) => setTaskFavoriteCategory(id, categoryId)),
          )
          clearSelection()
        })()
      },
    })
  }, [tasks, selectedTaskIds, clearSelection, setConfirmDialog])

  const handleClearFavorite = useCallback(() => {
    setConfirmDialog({
      title: '批量取消收藏',
      message: `确定要取消收藏选中的 ${selectedTaskIds.length} 条记录吗？`,
      confirmText: '确认取消',
      action: () => {
        void (async () => {
          await Promise.allSettled(
            selectedTaskIds.map((id) => clearTaskFavorite(id)),
          )
          clearSelection()
        })()
      },
    })
  }, [selectedTaskIds, clearSelection, setConfirmDialog])

  const handleDeleteSelected = useCallback(() => {
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${selectedTaskIds.length} 条记录吗？`,
      // 全选+秒点确认是误删风险最高点:短暂禁用确认键,强制看清数量再删
      minConfirmDelayMs: 700,
      action: () => {
        removeMultipleTasks(selectedTaskIds)
      },
    })
  }, [selectedTaskIds, setConfirmDialog])

  if (selectedTaskIds.length === 0) return null

  const allSelectedFavorite =
    selectedTaskIds.length > 0 &&
    selectedTaskIds.every((id) => tasks.find((t) => t.id === id)?.isFavorite)

  // 取消生成:选中集里的在途任务(通配批散卡多选取消的入口;取消≠删除,记录保留可重试/补跑)
  const runningSelected = selectedTaskIds.filter(
    (id) => tasks.find((t) => t.id === id)?.status === 'running',
  )
  const handleCancelRunning = () => {
    setConfirmDialog({
      title: '取消生成',
      message: `确定取消选中的 ${runningSelected.length} 条进行中任务?已发请求会被丢弃,记录保留可重试。`,
      confirmText: '取消生成',
      tone: 'danger',
      action: () => {
        // cancelTask 自带 status guard:弹窗期间转 done 的成员幂等跳过,计数取实际值
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

  // 对比:2~4 条已完成且有输出图的任务
  const canCompare =
    selectedTaskIds.length >= 2 &&
    selectedTaskIds.length <= 4 &&
    selectedTaskIds.every((id) => {
      const t = tasks.find((task) => task.id === id)
      return t?.status === 'done' && (t.outputImages?.length ?? 0) > 0
    })

  // 批量反推:选中的 done 且有输出图的任务(各取首图);谓词镜像 canCompare 但不限 2~4。
  // 去重:不同 task 可能共享同一首图 id(重试/复制),重复会让 modal 列表 key 撞 + 重复反推
  const batchCaptionImageIds = [
    ...new Set(
      selectedTaskIds
        .map((id) => tasks.find((t) => t.id === id))
        .filter((t): t is TaskRecord => t?.status === 'done' && (t.outputImages?.length ?? 0) > 0)
        .map((t) => t.outputImages[0]),
    ),
  ]
  const canBatchCaption = batchCaptionImageIds.length >= 1
  const handleBatchCaption = () => {
    setCaptionBatchImageIds(batchCaptionImageIds)
    clearSelection()
  }

  return (
    <div className="flex justify-center mb-3">
      <div className="bg-gray-800/90 dark:bg-gray-800/90 backdrop-blur shadow-lg rounded-full flex items-center p-1 border border-white/10 pointer-events-auto">
        <button
          onClick={clearSelection}
          className="p-2 text-gray-300 hover:text-white transition-colors"
          title="取消选择"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <button
          onClick={handleSelectAllToggle}
          className="p-2 text-blue-400 hover:text-blue-300 transition-colors"
          title={allVisibleSelected ? '取消全选' : '全选当前可见'}
        >
          {allVisibleSelected ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path strokeDasharray="4 4" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
            </svg>
          )}
        </button>
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <div className="relative">
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
                className="p-2 text-yellow-400 hover:text-yellow-300 transition-colors"
                title={allSelectedFavorite ? '收藏分类 / 取消收藏' : '收藏'}
              >
                <svg
                  className="w-5 h-5"
                  fill={allSelectedFavorite ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            )}
          />
        </div>
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <button
          onClick={() => canCompare && setCompareTaskIds(selectedTaskIds)}
          disabled={!canCompare}
          className={`p-2 transition-colors ${
            canCompare
              ? 'text-emerald-400 hover:text-emerald-300'
              : 'text-gray-500 cursor-not-allowed'
          }`}
          title={canCompare ? '并排对比选中任务' : '选择 2~4 条已完成任务进行对比'}
          aria-label="并排对比"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <rect x="3" y="4" width="8" height="16" rx="2" />
            <rect x="13" y="4" width="8" height="16" rx="2" />
          </svg>
        </button>
        <button
          onClick={() => canBatchCaption && handleBatchCaption()}
          disabled={!canBatchCaption}
          className={`p-2 transition-colors ${
            canBatchCaption
              ? 'text-purple-400 hover:text-purple-300'
              : 'text-gray-500 cursor-not-allowed'
          }`}
          title={canBatchCaption ? `批量反推(${batchCaptionImageIds.length} 张图)` : '选择已完成任务批量反推提示词'}
          aria-label="批量反推"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="14" rx="2" />
            <path d="M3 13l4-4 4 4 4-5 6 6" />
            <path d="M8 21h8" />
          </svg>
        </button>
        {runningSelected.length > 0 && (
          <>
            <div className="w-px h-5 bg-white/20 mx-1"></div>
            <button
              onClick={handleCancelRunning}
              className="p-2 text-red-400 hover:text-red-300 transition-colors"
              title={`取消生成(${runningSelected.length} 条在途)`}
              aria-label="取消选中的在途任务"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <rect x="9" y="9" width="6" height="6" />
              </svg>
            </button>
          </>
        )}
        <div className="w-px h-5 bg-white/20 mx-1"></div>
        <button
          onClick={handleDeleteSelected}
          className="p-2 text-red-400 hover:text-red-300 transition-colors"
          title="删除选中"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}
