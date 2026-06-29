// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiProfileSection } from './ApiProfileSection'
import { DEFAULT_SETTINGS } from '../../lib/api/apiProfiles'
import { listModels } from '../../lib/api/listModels'
import type { OpenAIProfile } from '../../types'

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

function makeProfile(id: string): OpenAIProfile {
  const baseProfile = DEFAULT_SETTINGS.profiles[0] as OpenAIProfile
  return {
    ...baseProfile,
    id,
    name: id,
    baseUrl: `https://${id}.example.com/v1`,
    apiKey: `${id}-key`,
    model: `${id}-model`,
    provider: 'openai',
  }
}

function renderSection(activeProfile: OpenAIProfile) {
  return render(
    <ApiProfileSection
      activeProfile={activeProfile}
      apiProxyAvailable={false}
      apiProxyEnabled={false}
      onUpdate={vi.fn()}
      timeoutInput={String(activeProfile.timeout)}
      onTimeoutChange={vi.fn()}
      onTimeoutBlur={vi.fn()}
    />,
  )
}

describe('ApiProfileSection', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('scopes model-list loading state to the profile that started the request', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const profileA = makeProfile('profile-a')
    const profileB = makeProfile('profile-b')
    const { rerender } = renderSection(profileA)

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)
    expect(screen.getByText('加载中…')).toBeTruthy()

    rerender(
      <ApiProfileSection
        activeProfile={profileB}
        apiProxyAvailable={false}
        apiProxyEnabled={false}
        onUpdate={vi.fn()}
        timeoutInput={String(profileB.timeout)}
        onTimeoutChange={vi.fn()}
        onTimeoutBlur={vi.fn()}
      />,
    )

    expect(fetchButton()).toHaveProperty('disabled', false)
    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    first.resolve(['old-model'])
    await Promise.resolve()
    expect(fetchButton()).toHaveProperty('disabled', true)

    second.resolve(['new-model'])
    await waitFor(() => {
      expect(fetchButton()).toHaveProperty('disabled', false)
    })
    expect(screen.getByText('new-model')).toBeTruthy()
  })

  it('scopes model-list loading state to the API proxy setting', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const directProfile = makeProfile('profile-a')
    const proxyProfile = { ...directProfile, apiProxy: true }
    const { rerender } = render(
      <ApiProfileSection
        activeProfile={directProfile}
        apiProxyAvailable={true}
        apiProxyEnabled={false}
        onUpdate={vi.fn()}
        timeoutInput={String(directProfile.timeout)}
        onTimeoutChange={vi.fn()}
        onTimeoutBlur={vi.fn()}
      />,
    )

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    rerender(
      <ApiProfileSection
        activeProfile={proxyProfile}
        apiProxyAvailable={true}
        apiProxyEnabled={true}
        onUpdate={vi.fn()}
        timeoutInput={String(proxyProfile.timeout)}
        onTimeoutChange={vi.fn()}
        onTimeoutBlur={vi.fn()}
      />,
    )

    expect(fetchButton()).toHaveProperty('disabled', false)
    fireEvent.click(fetchButton())
    expect(fetchButton()).toHaveProperty('disabled', true)

    first.resolve(['direct-model'])
    await Promise.resolve()
    expect(fetchButton()).toHaveProperty('disabled', true)

    second.resolve(['proxy-model'])
    await waitFor(() => {
      expect(fetchButton()).toHaveProperty('disabled', false)
    })
    expect(screen.getByText('proxy-model')).toBeTruthy()
  })

  it('ignores stale same-profile model-list results after a newer request finishes', async () => {
    const first = createDeferred<string[]>()
    const other = createDeferred<string[]>()
    const latest = createDeferred<string[]>()
    vi.mocked(listModels)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(other.promise)
      .mockReturnValueOnce(latest.promise)

    const profileA = makeProfile('profile-a')
    const profileB = makeProfile('profile-b')
    const { rerender } = renderSection(profileA)

    const fetchButton = () => screen.getByRole('button', { name: '从 API 拉取模型列表' })
    fireEvent.click(fetchButton())

    rerender(
      <ApiProfileSection
        activeProfile={profileB}
        apiProxyAvailable={false}
        apiProxyEnabled={false}
        onUpdate={vi.fn()}
        timeoutInput={String(profileB.timeout)}
        onTimeoutChange={vi.fn()}
        onTimeoutBlur={vi.fn()}
      />,
    )
    fireEvent.click(fetchButton())

    rerender(
      <ApiProfileSection
        activeProfile={profileA}
        apiProxyAvailable={false}
        apiProxyEnabled={false}
        onUpdate={vi.fn()}
        timeoutInput={String(profileA.timeout)}
        onTimeoutChange={vi.fn()}
        onTimeoutBlur={vi.fn()}
      />,
    )
    fireEvent.click(fetchButton())
    expect(listModels).toHaveBeenCalledTimes(3)

    await act(async () => {
      latest.resolve(['new-model'])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByText('new-model')).toBeTruthy()
    })

    await act(async () => {
      first.resolve(['old-model'])
      await Promise.resolve()
    })

    expect(screen.queryByText('old-model')).toBeNull()
    expect(screen.getByText('new-model')).toBeTruthy()
  })

  it('tells users to pass API URL through the hash rather than the query string', () => {
    renderSection(makeProfile('profile-a'))

    expect(screen.getByText('#apiUrl=')).toBeTruthy()
    expect(screen.queryByText('?apiUrl=')).toBeNull()
  })
})
