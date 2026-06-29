// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import { useTaskTimer } from './useTaskTimer'

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: DEFAULT_PARAMS,
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useTaskTimer', () => {
  it('clamps running duration at zero when createdAt is in the future', () => {
    vi.setSystemTime(1_000)

    const { result } = renderHook(() =>
      useTaskTimer(task({ status: 'running', createdAt: 61_000 })),
    )

    expect(result.current).toBe('00:00')
  })
})
