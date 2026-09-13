import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TaskRecord } from '../../types'
import { retryTask } from '../../store'
import { usePopoverPlacement } from '../../hooks/usePopoverPlacement'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
}

/** 卡片内的低频动作放进统一浮层；portal 避免被卡片圆角和矩阵滚动容器裁掉。 */
export default function TaskActionsMenu({ task, onReuse, onEditOutputs, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const placement = usePopoverPlacement(anchorRef, {
    open,
    fixed: true,
    align: 'right',
    estimatedHeight: 200,
  })
  const closeAndFocus = () => {
    setOpen(false)
    anchorRef.current?.focus()
  }
  usePopoverDismiss(open, anchorRef, menuRef, () => setOpen(false), { onEscape: closeAndFocus })
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])

  const run = (action: () => void) => {
    closeAndFocus()
    action()
  }
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ui-icon-button shrink-0 text-content-muted"
        aria-label="更多任务操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          placement.update()
          setOpen((value) => !value)
        }}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="任务操作"
            data-no-drag-select
            className="fixed z-[60] w-44 max-w-[calc(100vw-32px)] rounded-xl border border-line bg-surface-raised p-1.5 shadow-xl"
            style={placement.menuStyle}
            // React portal 事件仍沿组件树冒泡，不能把选择菜单项变成打开卡片详情。
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                // 菜单卸载前把焦点放回触发器，再由浏览器执行 Tab，避免从 body 重新跳到页面开头。
                closeAndFocus()
                return
              }
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const buttons = [
                ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                  []),
              ]
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                      buttons.length
              buttons[next]?.focus()
            }}
          >
            {task.status === 'error' && (
              <button
                type="button"
                role="menuitem"
                className="ui-button w-full justify-start text-brand-ink"
                onClick={() =>
                  run(() => {
                    void retryTask(task).catch(() => {
                      /* 运行时提示错误。 */
                    })
                  })
                }
              >
                重试失败任务
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="ui-button w-full justify-start"
              onClick={() => run(onReuse)}
            >
              复用配置
            </button>
            <button
              type="button"
              role="menuitem"
              className="ui-button w-full justify-start"
              disabled={!task.outputImages.length}
              onClick={() => run(onEditOutputs)}
            >
              编辑输出
            </button>
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              className="ui-button w-full justify-start text-red-600 dark:text-red-400"
              onClick={() => run(onDelete)}
            >
              删除记录
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
