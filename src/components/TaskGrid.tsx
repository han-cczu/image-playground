import { memo, useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TaskRecord } from '../types'
import { useStore, reuseConfig, editOutputs, removeTask, reorderTask } from '../store'
import { filterAndSortTasks } from '../lib/taskFilters'
import { groupIntoGridBlocks } from '../lib/gridExperiment'
import { pickFallbackColor } from '../lib/conversations'
import TaskCard from './TaskCard'
import TaskGridMatrix from './TaskGridMatrix'

export interface ConversationTag {
  id: string
  title: string
  color: string
  onClick: () => void
}

interface SortableTaskCardProps {
  task: TaskRecord
  index: number
  isSelected: boolean
  dragDisabled: boolean
  conversationTag?: ConversationTag
  /** 稳定回调(以 task 为参,在 TaskGrid 层 useCallback):避免每卡内联闭包打穿 React.memo */
  onCardClick: (task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => void
  onReuse: (task: TaskRecord) => void
  onEditOutputs: (task: TaskRecord) => void
  onDelete: (task: TaskRecord) => void
}

// React.memo:框选 setSelectedTaskIds 时只有 isSelected 实际翻转的卡重渲染,其余跳过 reconcile
const SortableTaskCard = memo(function SortableTaskCard({
  task,
  index,
  isSelected,
  dragDisabled,
  conversationTag,
  onCardClick,
  onReuse,
  onEditOutputs,
  onDelete,
}: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: dragDisabled })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 20 : undefined,
  }

  // 内层闭包 useCallback 化:否则每次 SortableTaskCard 重渲染都新建,打穿内层 TaskCard 的 memo
  const onClick = useCallback((e: React.MouseEvent | React.TouchEvent) => onCardClick(task, e), [onCardClick, task])
  const onReuseCb = useCallback(() => onReuse(task), [onReuse, task])
  const onEditCb = useCallback(() => onEditOutputs(task), [onEditOutputs, task])
  const onDeleteCb = useCallback(() => onDelete(task), [onDelete, task])

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="task-card-wrapper cv-auto"
      data-task-id={task.id}
    >
      <div className="card-enter" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
        <TaskCard
          task={task}
          isSelected={isSelected}
          conversationTag={conversationTag}
          dragHandle={{
            ref: setActivatorNodeRef,
            listeners,
            attributes,
            disabled: dragDisabled,
          }}
          onClick={onClick}
          onReuse={onReuseCb}
          onEditOutputs={onEditCb}
          onDelete={onDeleteCb}
        />
      </div>
    </div>
  )
})

/** 超此 task 数仅渲染前 N 条(按 task 计数,矩阵块按成员数累计)+ 提示。极端大库兜底,会强制关拖拽。 */
const RENDER_CAP = 2000

export default function TaskGrid() {
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const filterFavoriteCategoryId = useStore((s) => s.filterFavoriteCategoryId)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const galleryView = useStore((s) => s.galleryView)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setActiveConversation = useStore((s) => s.setActiveConversation)
  const conversations = useStore((s) => s.conversations)
  const filterConversationId = galleryView ? null : activeConversationId
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  // includes() 逐卡判定是 O(选中数×卡数);框选拖动期间每次 mousemove 都重渲染,用 Set 摊平
  const selectedIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const hasDragged = useRef(false)
  const suppressClickUntil = useRef(0)
  const startedOnCard = useRef(false)
  const startedWithCtrl = useRef(false)
  const initialSelection = useRef<string[]>([])
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const filteredTasks = useMemo(() => {
    return filterAndSortTasks(tasks, {
      searchQuery,
      filterStatus,
      filterFavorite,
      filterFavoriteCategoryId,
      filterConversationId,
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId, filterConversationId])

  // 把扁平任务流分组成渲染项:同 batchId 的网格 task 聚合成矩阵块,其余为普通卡片。
  const renderItems = useMemo(() => groupIntoGridBlocks(filteredTasks), [filteredTasks])
  // 极端大库兜底:按 task 计数(矩阵块计成员数)累计到 RENDER_CAP 截断——renderItems.length
  // 会因网格块把整批算 1 项而严重低估真实 task 数,故用 task 数为准(与 spec 一致)
  const isCapped = filteredTasks.length > RENDER_CAP
  const visibleItems = useMemo(() => {
    if (!isCapped) return renderItems
    const out: typeof renderItems = []
    let count = 0
    for (const item of renderItems) {
      const n = item.type === 'grid' ? item.tasks.length : 1
      if (count + n > RENDER_CAP) break
      out.push(item)
      count += n
    }
    return out
  }, [renderItems, isCapped])
  const hasGridBlock = useMemo(() => visibleItems.some((i) => i.type === 'grid'), [visibleItems])
  // 拖拽排序只在普通卡片间:矩阵成员不进 SortableContext;sortableIds 仅取已渲染项,
  // 避免 cap 截断时 items 引用未渲染卡造成 dnd 不一致。
  const sortableIds = useMemo(
    () => visibleItems.flatMap((i) => (i.type === 'card' ? [i.task.id] : [])),
    [visibleItems],
  )

  /** 图库视图下 conversationId → 对话标签(含稳定 onClick);memo 使其引用稳定,不打穿卡片 memo */
  const conversationTagById = useMemo(() => {
    if (!galleryView) return null
    const map = new Map<string, ConversationTag>()
    for (const conv of conversations) {
      map.set(conv.id, {
        id: conv.id,
        title: conv.title,
        color: conv.color || pickFallbackColor(conv.id),
        onClick: () => {
          setGalleryView(false)
          setActiveConversation(conv.id)
        },
      })
    }
    return map
  }, [galleryView, conversations, setGalleryView, setActiveConversation])

  const dragDisabled =
    galleryView ||
    searchQuery.trim() !== '' ||
    filterStatus !== 'all' ||
    filterFavorite ||
    Boolean(filterFavoriteCategoryId) ||
    filteredTasks.length < 2 ||
    hasGridBlock ||
    // cap 截断时被隐藏卡不在 sortableIds 里,拖拽到截断区会落空——直接关拖拽(上万 task 手动排序本无意义)
    isCapped

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // 键盘可拖拽:聚焦拖拽手柄后空格拾起、方向键移动、空格放下、Esc 取消
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = filteredTasks.findIndex((t) => t.id === active.id)
    const newIndex = filteredTasks.findIndex((t) => t.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(filteredTasks, oldIndex, newIndex)
    const pos = reordered.findIndex((t) => t.id === active.id)
    const prevId = pos > 0 ? reordered[pos - 1].id : null
    const nextId = pos < reordered.length - 1 ? reordered[pos + 1].id : null
    reorderTask(String(active.id), prevId, nextId)
  }

  // 稳定回调(以 task 为参,deps 仅含稳定 setter):内联闭包会让每卡 props 每 render 变化,打穿 memo。
  // 选择态从 useStore.getState() 现取而非闭包捕获,避免 selectedTaskIds 变化时回调失稳。
  const handleDelete = useCallback((task: TaskRecord) => {
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }, [setConfirmDialog])

  const handleCardClick = useCallback((task: TaskRecord, e: React.MouseEvent | React.TouchEvent) => {
    if (Date.now() < suppressClickUntil.current) {
      e.preventDefault()
      return
    }
    suppressClickUntil.current = 0
    const isCtrl = isMac ? (e as React.MouseEvent).metaKey : (e as React.MouseEvent).ctrlKey
    const state = useStore.getState()
    if (isCtrl) {
      state.toggleTaskSelection(task.id)
    } else if (state.selectedTaskIds.length > 0) {
      state.clearSelection()
      state.setDetailTaskId(task.id)
    } else {
      state.setDetailTaskId(task.id)
    }
  }, [isMac])

  const handleReuse = useCallback((task: TaskRecord) => reuseConfig(task), [])
  const handleEditOutputs = useCallback((task: TaskRecord) => editOutputs(task), [])

  const beginSelection = (target: HTMLElement, clientX: number, clientY: number, isCtrl: boolean) => {
    startedOnCard.current = Boolean(target.closest('.task-card-wrapper'))
    startedWithCtrl.current = isCtrl
    initialSelection.current = [...useStore.getState().selectedTaskIds]

    isDragging.current = true
    hasDragged.current = false
    dragStart.current = { x: clientX, y: clientY }
    document.body.classList.add('select-none')
    document.body.classList.add('drag-selecting')
    setSelectionBox({
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
    })
  }

  const updateSelectionFromPoint = (clientX: number, clientY: number) => {
    const start = dragStart.current
    if (!start || !gridRef.current) return

    const minX = Math.min(start.x, clientX)
    const maxX = Math.max(start.x, clientX)
    const minY = Math.min(start.y, clientY)
    const maxY = Math.max(start.y, clientY)

    const cards = gridRef.current.querySelectorAll('.task-card-wrapper')
    const newSelected = new Set(initialSelection.current)
    const initialSelected = new Set(initialSelection.current)

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect()
      const taskId = card.getAttribute('data-task-id')
      if (!taskId) return

      const isIntersecting =
        minX < rect.right && maxX > rect.left && minY < rect.bottom && maxY > rect.top

      if (isIntersecting) {
        if (initialSelected.has(taskId)) {
          newSelected.delete(taskId)
        } else {
          newSelected.add(taskId)
        }
      } else if (!initialSelected.has(taskId)) {
        newSelected.delete(taskId)
      }
    })

    setSelectedTaskIds(Array.from(newSelected))
  }

  useEffect(() => {
    const getEventElement = (e: MouseEvent) => {
      if (e.target instanceof Element) return e.target
      return document.elementFromPoint(e.clientX, e.clientY)
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = getEventElement(e)
      if (!target) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('[data-input-bar]')) return
      if (target.closest('[data-no-drag-select], [data-lightbox-root]')) return
      if (target.closest('button, a, input, textarea, select')) return

      const isCtrl = isMac ? e.metaKey : e.ctrlKey
      beginSelection(target as HTMLElement, e.clientX, e.clientY, isCtrl)
      e.preventDefault()
    }

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return

      const start = dragStart.current
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (distance < 6 && !hasDragged.current) return

      hasDragged.current = true
      setSelectionBox({
        startX: start.x,
        startY: start.y,
        currentX: e.clientX,
        currentY: e.clientY,
      })
      updateSelectionFromPoint(e.clientX, e.clientY)
      e.preventDefault()
    }

    const handleDocumentMouseUp = () => {
      if (isDragging.current) {
        document.body.classList.remove('select-none')
        document.body.classList.remove('drag-selecting')
      }
      if (isDragging.current && !hasDragged.current && !startedOnCard.current && !startedWithCtrl.current) {
        clearSelection()
      }
      if (isDragging.current && hasDragged.current) {
        suppressClickUntil.current = Date.now() + 250
      }
      isDragging.current = false
      dragStart.current = null
      setSelectionBox(null)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('mousemove', handleDocumentMouseMove, true)
    document.addEventListener('mouseup', handleDocumentMouseUp, true)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('mousemove', handleDocumentMouseMove, true)
      document.removeEventListener('mouseup', handleDocumentMouseUp, true)
    }
  }, [clearSelection, isMac])

  if (!filteredTasks.length) {
    // 「真正的空对话」由 App 的 EmptyState 承接；这里只在用户主动加了筛选/搜索时占位。
    if (searchQuery || filterFavorite || filterFavoriteCategoryId || filterStatus !== 'all') {
      return (
        <div className="text-center py-20 text-gray-400 dark:text-gray-500">
          <p className="text-sm">没有找到匹配的记录</p>
        </div>
      )
    }
    return null
  }

  return (
    <div 
      ref={rootRef}
      data-task-grid-root
      className="relative min-h-[50vh]"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
          <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
            {visibleItems.map((item, index) => {
              if (item.type === 'grid') {
                return (
                  <TaskGridMatrix
                    key={`grid-${item.batchId}`}
                    batchId={item.batchId}
                    tasks={item.tasks}
                    onDelete={handleDelete}
                  />
                )
              }
              const task = item.task
              const conversationTag =
                galleryView && task.conversationId
                  ? conversationTagById?.get(task.conversationId)
                  : undefined
              return (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  index={index}
                  isSelected={selectedIdSet.has(task.id)}
                  dragDisabled={dragDisabled}
                  conversationTag={conversationTag}
                  onCardClick={handleCardClick}
                  onReuse={handleReuse}
                  onEditOutputs={handleEditOutputs}
                  onDelete={handleDelete}
                />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
      {isCapped && (
        <div className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">
          仅显示前 {RENDER_CAP} 条,共 {filteredTasks.length} 条记录。请用搜索 / 筛选缩小范围以查看其余。
        </div>
      )}
      {selectionBox && (
        <div
          className="fixed bg-blue-500/20 border border-blue-500/50 pointer-events-none z-[30]"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
          }}
        />
      )}
    </div>
  )
}
