import { useMemo, useRef, useState, useEffect } from 'react'
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
import type { Conversation, TaskRecord } from '../types'
import { useStore, reuseConfig, editOutputs, removeTask, reorderTask } from '../store'
import { filterAndSortTasks } from '../lib/taskFilters'
import { pickFallbackColor } from '../lib/conversations'
import TaskCard from './TaskCard'

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
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
}

function SortableTaskCard({ task, index, isSelected, dragDisabled, conversationTag, ...handlers }: SortableTaskCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="task-card-wrapper"
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
          {...handlers}
        />
      </div>
    </div>
  )
}

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
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
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

  /** 派生 conversationId → Conversation，给图库视图下 task 卡片渲染对话标签用。 */
  const conversationById = useMemo(
    () => new Map<string, Conversation>(conversations.map((c) => [c.id, c])),
    [conversations],
  )

  const dragDisabled =
    galleryView ||
    searchQuery.trim() !== '' ||
    filterStatus !== 'all' ||
    filterFavorite ||
    Boolean(filterFavoriteCategoryId) ||
    filteredTasks.length < 2

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

  const handleDelete = (task: typeof tasks[0]) => {
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

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
        <SortableContext items={filteredTasks.map((t) => t.id)} strategy={rectSortingStrategy}>
          <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
            {filteredTasks.map((task, index) => {
              let conversationTag: ConversationTag | undefined
              if (galleryView && task.conversationId) {
                const conv = conversationById.get(task.conversationId)
                if (conv) {
                  conversationTag = {
                    id: conv.id,
                    title: conv.title,
                    color: conv.color || pickFallbackColor(conv.id),
                    onClick: () => {
                      setGalleryView(false)
                      setActiveConversation(conv.id)
                    },
                  }
                }
              }
              return (
              <SortableTaskCard
                key={task.id}
                task={task}
                index={index}
                isSelected={selectedTaskIds.includes(task.id)}
                dragDisabled={dragDisabled}
                conversationTag={conversationTag}
                onClick={(e) => {
                  if (Date.now() < suppressClickUntil.current) {
                    e.preventDefault()
                    return
                  }
                  suppressClickUntil.current = 0
                  const isCtrl = isMac ? (e as React.MouseEvent).metaKey : (e as React.MouseEvent).ctrlKey
                  if (isCtrl) {
                    useStore.getState().toggleTaskSelection(task.id)
                  } else if (selectedTaskIds.length > 0) {
                    clearSelection()
                    setDetailTaskId(task.id)
                  } else {
                    setDetailTaskId(task.id)
                  }
                }}
                onReuse={() => reuseConfig(task)}
                onEditOutputs={() => editOutputs(task)}
                onDelete={() => handleDelete(task)}
              />
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
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
