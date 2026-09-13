// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import TaskActionsMenu from './TaskActionsMenu'

const task: TaskRecord = {
  id: 'a',
  prompt: '图片',
  params: { ...DEFAULT_PARAMS },
  inputImageIds: [],
  outputImages: ['image'],
  maskImageId: null,
  maskTargetImageId: null,
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

afterEach(cleanup)

describe('任务更多操作', () => {
  it('支持键盘导航和 Esc 返回触发器，菜单操作不冒泡打开卡片', () => {
    const openDetails = vi.fn()
    const reuse = vi.fn()
    render(
      <div onClick={openDetails}>
        <div onClick={(event) => event.stopPropagation()}>
          <TaskActionsMenu task={task} onReuse={reuse} onEditOutputs={vi.fn()} onDelete={vi.fn()} />
        </div>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: '更多任务操作' })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '复用配置' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '编辑输出' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '复用配置' }))
    expect(reuse).toHaveBeenCalledOnce()
    expect(openDetails).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
