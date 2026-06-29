// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CaptionerSection } from './CaptionerSection'
import { OptimizerSection } from './OptimizerSection'
import {
  createDefaultCaptionerProfile,
  createDefaultOptimizerProfile,
} from '../../lib/api/apiProfiles'
import { listModels } from '../../lib/api/listModels'
import type { CaptionerProfile, PromptOptimizerProfile } from '../../types'

vi.mock('../../lib/api/listModels', () => ({
  listModels: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeCaptioner(id: string): CaptionerProfile {
  return createDefaultCaptionerProfile({
    id,
    name: id,
    baseUrl: `https://${id}.example.com/v1`,
    apiKey: `${id}-key`,
    model: `${id}-model`,
  })
}

function makeOptimizer(id: string): PromptOptimizerProfile {
  return createDefaultOptimizerProfile({
    id,
    name: id,
    baseUrl: `https://${id}.example.com/v1`,
    apiKey: `${id}-key`,
    model: `${id}-model`,
  })
}

describe('settings model-list loading state', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps captioner model-list loading scoped to the profile key', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const profileA = makeCaptioner('captioner-a')
    const profileB = makeCaptioner('captioner-b')
    const { rerender } = render(
      <CaptionerSection
        captioner={profileA}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    rerender(
      <CaptionerSection
        captioner={profileB}
        onUpdate={vi.fn()}
        timeoutInput={String(profileB.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )
    expect(fetchButton()).toHaveProperty('disabled', false)

    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    first.resolve(['old-captioner-model'])
    await Promise.resolve()
    expect(fetchButton()).toHaveProperty('disabled', true)

    second.resolve(['new-captioner-model'])
    await waitFor(() => {
      expect(fetchButton()).toHaveProperty('disabled', false)
    })
    expect(screen.getByText('new-captioner-model')).toBeTruthy()
  })

  it('keeps optimizer model-list loading scoped to the profile key', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const profileA = makeOptimizer('optimizer-a')
    const profileB = makeOptimizer('optimizer-b')
    const { rerender } = render(
      <OptimizerSection
        optimizer={profileA}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    rerender(
      <OptimizerSection
        optimizer={profileB}
        onUpdate={vi.fn()}
        timeoutInput={String(profileB.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )
    expect(fetchButton()).toHaveProperty('disabled', false)

    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    first.resolve(['old-optimizer-model'])
    await Promise.resolve()
    expect(fetchButton()).toHaveProperty('disabled', true)

    second.resolve(['new-optimizer-model'])
    await waitFor(() => {
      expect(fetchButton()).toHaveProperty('disabled', false)
    })
    expect(screen.getByText('new-optimizer-model')).toBeTruthy()
  })

  it('ignores stale captioner model-list results after returning to the same profile key', async () => {
    const first = createDeferred<string[]>()
    const other = createDeferred<string[]>()
    const latest = createDeferred<string[]>()
    vi.mocked(listModels)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(other.promise)
      .mockReturnValueOnce(latest.promise)

    const profileA = makeCaptioner('captioner-a')
    const profileB = makeCaptioner('captioner-b')
    const { rerender } = render(
      <CaptionerSection
        captioner={profileA}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())

    rerender(
      <CaptionerSection
        captioner={profileB}
        onUpdate={vi.fn()}
        timeoutInput={String(profileB.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )
    fireEvent.click(fetchButton())

    rerender(
      <CaptionerSection
        captioner={profileA}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )
    fireEvent.click(fetchButton())

    await act(async () => {
      latest.resolve(['new-captioner-model'])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByText('new-captioner-model')).toBeTruthy()
    })

    await act(async () => {
      first.resolve(['old-captioner-model'])
      await Promise.resolve()
    })

    expect(screen.queryByText('old-captioner-model')).toBeNull()
    expect(screen.getByText('new-captioner-model')).toBeTruthy()
  })

  it('ignores stale optimizer model-list results after returning to the same profile key', async () => {
    const first = createDeferred<string[]>()
    const other = createDeferred<string[]>()
    const latest = createDeferred<string[]>()
    vi.mocked(listModels)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(other.promise)
      .mockReturnValueOnce(latest.promise)

    const profileA = makeOptimizer('optimizer-a')
    const profileB = makeOptimizer('optimizer-b')
    const { rerender } = render(
      <OptimizerSection
        optimizer={profileA}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())

    rerender(
      <OptimizerSection
        optimizer={profileB}
        onUpdate={vi.fn()}
        timeoutInput={String(profileB.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )
    fireEvent.click(fetchButton())

    rerender(
      <OptimizerSection
        optimizer={profileA}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )
    fireEvent.click(fetchButton())

    await act(async () => {
      latest.resolve(['new-optimizer-model'])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByText('new-optimizer-model')).toBeTruthy()
    })

    await act(async () => {
      first.resolve(['old-optimizer-model'])
      await Promise.resolve()
    })

    expect(screen.queryByText('old-optimizer-model')).toBeNull()
    expect(screen.getByText('new-optimizer-model')).toBeTruthy()
  })

  it('clears captioner API key when switching provider', () => {
    const onUpdate = vi.fn()
    const profile = makeCaptioner('captioner-a')
    render(
      <CaptionerSection
        captioner={profile}
        onUpdate={onUpdate}
        timeoutInput={String(profile.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Gemini 原生' }))

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        apiKey: '',
      }),
    )
  })

  it('clears optimizer API key when switching provider', () => {
    const onUpdate = vi.fn()
    const profile = makeOptimizer('optimizer-a')
    render(
      <OptimizerSection
        optimizer={profile}
        onUpdate={onUpdate}
        timeoutInput={String(profile.timeout)}
        onTimeoutChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Gemini 原生' }))

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        apiKey: '',
      }),
    )
  })
})
