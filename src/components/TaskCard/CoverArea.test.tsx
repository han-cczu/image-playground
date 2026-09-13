// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createCancelledTask } from '../../lib/taskRuntime/cancel'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import CoverArea from './CoverArea'

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-cover',
    prompt: '测试提示词',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'error',
    error: '网络请求失败',
    createdAt: 1,
    finishedAt: 10,
    elapsed: 9,
    ...overrides,
  }
}

function renderCover(task: TaskRecord) {
  return render(<CoverArea task={task} thumbSrc="" coverRatio="" coverSize="" duration="00:01" />)
}

afterEach(cleanup)

describe('取消任务的封面展示', () => {
  it('把运行时实际写入的主动取消显示为已取消，保留原 error 状态', () => {
    const cancelled = createCancelledTask(makeTask({ status: 'running', error: null }), 20)
    renderCover(cancelled)
    expect(screen.getByText('已取消')).toBeTruthy()
    expect(screen.queryByText('失败')).toBeNull()
    expect(cancelled.status).toBe('error')
  })

  it.each(['网络请求失败', '取消请求失败：HTTP 500', '上游已取消生成：配额不足', '已取消生成 '])(
    '保留其他错误的失败展示：%s',
    (error) => {
      renderCover(makeTask({ error }))
      expect(screen.getByText('失败')).toBeTruthy()
      expect(screen.queryByText('已取消')).toBeNull()
    },
  )

  it('运行中记录即使带有历史取消文案也继续显示生成中', () => {
    renderCover(makeTask({ status: 'running', error: '已取消生成' }))
    expect(screen.getByText('生成中...')).toBeTruthy()
    expect(screen.queryByText('已取消')).toBeNull()
  })
})
