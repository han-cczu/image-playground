import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore } from '../../../store'
import { listModels } from '../../../lib/api/listModels'
import { isOpenAIProfile } from '../../../types'
import type { ApiProfile } from '../../../types'

export type ModelListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; models: string[] }
  | { kind: 'error'; message: string }

export function useModelList(activeProfile: ApiProfile): {
  state: ModelListState
  fetchModels: () => Promise<void>
} {
  /** profileId -> model id list */
  const cacheRef = useRef<Map<string, string[]>>(new Map())
  const [state, setState] = useState<ModelListState>({ kind: 'idle' })

  const fetchModels = useCallback(
    async (force: boolean = false) => {
      if (!activeProfile || !isOpenAIProfile(activeProfile) || !activeProfile.apiKey.trim()) return
      const profileId = activeProfile.id
      if (!force) {
        const cached = cacheRef.current.get(profileId)
        if (cached) {
          setState({ kind: 'success', models: cached })
          return
        }
      }
      setState({ kind: 'loading' })
      try {
        const ids = await listModels(activeProfile)
        // 仅在 active profile 未变化时写入状态
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        cacheRef.current.set(profileId, ids)
        if (stillActive) setState({ kind: 'success', models: ids })
      } catch (err) {
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        if (stillActive) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      }
    },
    [activeProfile],
  )

  // 菜单打开 / active profile 切换时：检查缓存，未命中且条件满足则拉取
  useEffect(() => {
    if (!activeProfile) return
    if (!isOpenAIProfile(activeProfile)) {
      setState({ kind: 'idle' })
      return
    }
    if (!activeProfile.apiKey.trim()) {
      setState({ kind: 'idle' })
      return
    }
    const cached = cacheRef.current.get(activeProfile.id)
    if (cached) {
      setState({ kind: 'success', models: cached })
      return
    }
    void fetchModels(false)
  }, [activeProfile, fetchModels])

  return { state, fetchModels: () => fetchModels(true) }
}
