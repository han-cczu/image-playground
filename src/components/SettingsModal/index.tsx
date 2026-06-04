import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { normalizeBaseUrl } from '../../lib/api'
import { isApiProxyAvailable, readClientDevProxyConfig } from '../../lib/api/devProxy'
import { useStore, exportData, importData, clearAllData } from '../../store'
import type { ImportMode } from '../../lib/exportImport'
import {
  createDefaultOpenAIProfile,
  createDefaultOptimizerProfile,
  createDefaultCaptionerProfile,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_OPTIMIZER_PROFILE_ID,
  DEFAULT_CAPTIONER_PROFILE_ID,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  getActiveOptimizerProfile,
  getActiveCaptionerProfile,
  normalizeOptimizerProfile,
  normalizeCaptionerProfile,
  normalizeSettings,
} from '../../lib/api/apiProfiles'
import type { ApiProfile, AppSettings, CaptionerProfile, PromptOptimizerProfile } from '../../types'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ProfileSelector } from './ProfileSelector'
import { NamedProfileSelector } from './NamedProfileSelector'
import { ApiProfileSection } from './ApiProfileSection'
import { OptimizerSection } from './OptimizerSection'
import { CaptionerSection } from './CaptionerSection'
import { FavoriteCategorySection } from './FavoriteCategorySection'
import { DataManagementSection } from './DataManagementSection'
import { getDefaultModelForMode } from './helpers'
import {
  collectReferencedImageIds,
  computeStorageStats,
  formatBytes,
  pruneOrphanImages,
  type StorageStats,
} from '../../lib/storageStats'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const favoriteCategories = useStore((s) => s.favoriteCategories)
  const updateFavoriteCategory = useStore((s) => s.updateFavoriteCategory)
  const deleteFavoriteCategory = useStore((s) => s.deleteFavoriteCategory)
  const moveFavoriteCategory = useStore((s) => s.moveFavoriteCategory)
  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const [timeoutInput, setTimeoutInput] = useState(String(getActiveApiProfile(settings).timeout))
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [optimizerTimeoutInput, setOptimizerTimeoutInput] = useState(
    String(getActiveOptimizerProfile(settings).timeout),
  )
  const [showOptimizerProfileMenu, setShowOptimizerProfileMenu] = useState(false)
  const [captionerTimeoutInput, setCaptionerTimeoutInput] = useState(
    String(getActiveCaptionerProfile(settings).timeout),
  )
  const [showCaptionerProfileMenu, setShowCaptionerProfileMenu] = useState(false)
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)

  const refreshStorageStats = useCallback(async () => {
    setStorageLoading(true)
    try {
      const { tasks, inputImages } = useStore.getState()
      const stats = await computeStorageStats(collectReferencedImageIds(tasks, inputImages))
      setStorageStats(stats)
    } finally {
      setStorageLoading(false)
    }
  }, [])

  const apiProxyAvailable = isApiProxyAvailable(readClientDevProxyConfig())
  const activeProfile = draft.profiles.find((profile) => profile.id === draft.activeProfileId) ?? draft.profiles[0] ?? getActiveApiProfile(draft)
  const activeOptimizerProfile =
    draft.optimizerProfiles.find((profile) => profile.id === draft.activeOptimizerProfileId) ??
    draft.optimizerProfiles[0]
  const activeCaptionerProfile =
    draft.captionerProfiles.find((profile) => profile.id === draft.activeCaptionerProfileId) ??
    draft.captionerProfiles[0]
  const apiProxyEnabled = apiProxyAvailable && activeProfile.provider === 'openai' && activeProfile.apiProxy

  const wasSettingsOpenRef = useRef(false)

  // 把 timeoutInput 折叠回 draft：在保存与 dirty 检测时用,确保 timeoutInput 中的改动也算数
  const buildFlushedDraft = useCallback((): AppSettings => {
    let next = draft

    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    if (normalizedTimeout !== activeProfile.timeout) {
      next = {
        ...next,
        profiles: next.profiles.map((profile) =>
          profile.id === activeProfile.id
            ? ({ ...profile, timeout: normalizedTimeout } as ApiProfile)
            : profile,
        ),
      }
    }

    const optimizerTimeoutRaw = Number(optimizerTimeoutInput)
    const normalizedOptimizerTimeout =
      optimizerTimeoutInput.trim() === '' || Number.isNaN(optimizerTimeoutRaw) || optimizerTimeoutRaw <= 0
        ? activeOptimizerProfile.timeout
        : optimizerTimeoutRaw
    if (normalizedOptimizerTimeout !== activeOptimizerProfile.timeout) {
      next = {
        ...next,
        optimizerProfiles: next.optimizerProfiles.map((profile) =>
          profile.id === activeOptimizerProfile.id
            ? { ...profile, timeout: normalizedOptimizerTimeout }
            : profile,
        ),
      }
    }

    const captionerTimeoutRaw = Number(captionerTimeoutInput)
    const normalizedCaptionerTimeout =
      captionerTimeoutInput.trim() === '' || Number.isNaN(captionerTimeoutRaw) || captionerTimeoutRaw <= 0
        ? activeCaptionerProfile.timeout
        : captionerTimeoutRaw
    if (normalizedCaptionerTimeout !== activeCaptionerProfile.timeout) {
      next = {
        ...next,
        captionerProfiles: next.captionerProfiles.map((profile) =>
          profile.id === activeCaptionerProfile.id
            ? { ...profile, timeout: normalizedCaptionerTimeout }
            : profile,
        ),
      }
    }

    return next
  }, [draft, activeProfile.id, activeProfile.timeout, activeOptimizerProfile.id, activeOptimizerProfile.timeout, activeCaptionerProfile.id, activeCaptionerProfile.timeout, timeoutInput, optimizerTimeoutInput, captionerTimeoutInput])

  const settingsJson = useMemo(() => JSON.stringify(settings), [settings])
  const isDirty = useMemo(
    () => JSON.stringify(buildFlushedDraft()) !== settingsJson,
    [buildFlushedDraft, settingsJson],
  )

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      return
    }
    if (wasSettingsOpenRef.current) return

    wasSettingsOpenRef.current = true
    const nextDraft = normalizeSettings(apiProxyAvailable ? settings : {
      ...settings,
      profiles: settings.profiles.map((profile) => ({ ...profile, apiProxy: false })),
    })
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(nextDraft).timeout))
    setCaptionerTimeoutInput(String(getActiveCaptionerProfile(nextDraft).timeout))
    void refreshStorageStats()
  }, [apiProxyAvailable, showSettings, settings, refreshStorageStats])

  useEffect(() => {
    setTimeoutInput(String(activeProfile.timeout))
  }, [activeProfile.id, activeProfile.timeout])

  useEffect(() => {
    setOptimizerTimeoutInput(String(activeOptimizerProfile.timeout))
  }, [activeOptimizerProfile.id, activeOptimizerProfile.timeout])

  useEffect(() => {
    setCaptionerTimeoutInput(String(activeCaptionerProfile.timeout))
  }, [activeCaptionerProfile.id, activeCaptionerProfile.timeout])

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedProfiles: ApiProfile[] = nextDraft.profiles.map((profile) => {
      const trimmedName = profile.name.trim() || (profile.id === DEFAULT_OPENAI_PROFILE_ID ? '默认' : '新配置')
      const trimmedTimeout = Number(profile.timeout) || DEFAULT_SETTINGS.timeout
      if (profile.provider === 'gemini') {
        return {
          ...profile,
          name: trimmedName,
          baseUrl: profile.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_GEMINI_BASE_URL,
          model: profile.model.trim() || DEFAULT_GEMINI_MODEL,
          timeout: trimmedTimeout,
        }
      }
      return {
        ...profile,
        name: trimmedName,
        baseUrl: normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl),
        model: profile.model.trim() || getDefaultModelForMode(profile.apiMode),
        timeout: trimmedTimeout,
        apiProxy: apiProxyAvailable ? profile.apiProxy : false,
      }
    })
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalizedOptimizerProfiles: PromptOptimizerProfile[] = nextDraft.optimizerProfiles.map((profile) =>
      normalizeOptimizerProfile({
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_OPTIMIZER_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
      }),
    )
    const fallbackOptimizer = createDefaultOptimizerProfile({ id: newId('optimizer') })
    const optimizerProfiles = normalizedOptimizerProfiles.length
      ? normalizedOptimizerProfiles
      : [fallbackOptimizer]
    const normalizedCaptionerProfiles: CaptionerProfile[] = nextDraft.captionerProfiles.map((profile) =>
      normalizeCaptionerProfile({
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_CAPTIONER_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl,
        apiKey: profile.apiKey.trim(),
        model: profile.model.trim(),
      }),
    )
    const fallbackCaptioner = createDefaultCaptionerProfile({ id: newId('captioner') })
    const captionerProfiles = normalizedCaptionerProfiles.length
      ? normalizedCaptionerProfiles
      : [fallbackCaptioner]
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
        ? nextDraft.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
      optimizerProfiles,
      activeOptimizerProfileId: optimizerProfiles.some((profile) => profile.id === nextDraft.activeOptimizerProfileId)
        ? nextDraft.activeOptimizerProfileId
        : (optimizerProfiles[0]?.id ?? fallbackOptimizer.id),
      captionerProfiles,
      activeCaptionerProfileId: captionerProfiles.some((profile) => profile.id === nextDraft.activeCaptionerProfileId)
        ? nextDraft.activeCaptionerProfileId
        : (captionerProfiles[0]?.id ?? fallbackCaptioner.id),
    })
    setDraft(normalizedDraft)
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(normalizedDraft).timeout))
    setCaptionerTimeoutInput(String(getActiveCaptionerProfile(normalizedDraft).timeout))
    setSettings(normalizedDraft)
  }

  const updateActiveProfile = (patch: Partial<ApiProfile>) => {
    setDraft((prev) => ({
      ...prev,
      profiles: prev.profiles.map((profile) =>
        profile.id === activeProfile.id ? ({ ...profile, ...patch } as ApiProfile) : profile,
      ),
    }))
  }

  const resetDraft = useCallback(() => {
    const fresh = normalizeSettings(settings)
    setDraft(fresh)
    setTimeoutInput(String(getActiveApiProfile(fresh).timeout))
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(fresh).timeout))
    setCaptionerTimeoutInput(String(getActiveCaptionerProfile(fresh).timeout))
  }, [settings])

  const handleClose = () => {
    if (!isDirty) {
      setShowSettings(false)
      return
    }
    setConfirmDialog({
      title: '放弃未保存的改动?',
      message: '设置面板有未保存的改动，关闭将丢失这些改动。是否继续?',
      confirmText: '放弃改动',
      tone: 'warning',
      action: () => {
        resetDraft()
        setShowSettings(false)
      },
    })
  }

  const handleSave = () => {
    commitSettings(buildFlushedDraft())
    showToast('设置已保存', 'success')
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' ? DEFAULT_SETTINGS.timeout : Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    if (normalizedTimeout !== activeProfile.timeout) {
      updateActiveProfile({ timeout: normalizedTimeout })
    }
  }, [activeProfile.id, activeProfile.timeout, timeoutInput])

  const panelRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(showSettings, handleClose)
  useLockBodyScroll(showSettings)
  useFocusTrap(showSettings, panelRef)

  const updateActiveOptimizerProfile = (patch: Partial<PromptOptimizerProfile>) => {
    setDraft((prev) => ({
      ...prev,
      optimizerProfiles: prev.optimizerProfiles.map((profile) =>
        profile.id === activeOptimizerProfile.id ? { ...profile, ...patch } : profile,
      ),
    }))
  }

  const updateActiveCaptionerProfile = (patch: Partial<CaptionerProfile>) => {
    setDraft((prev) => ({
      ...prev,
      captionerProfiles: prev.captionerProfiles.map((profile) =>
        profile.id === activeCaptionerProfile.id ? { ...profile, ...patch } : profile,
      ),
    }))
  }

  if (!showSettings) return null

  const runImport = async (file: File, mode: ImportMode) => {
    const imported = await importData(file, { mode })
    if (imported) {
      const nextDraft = normalizeSettings(useStore.getState().settings)
      setDraft(nextDraft)
      setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
      setOptimizerTimeoutInput(String(getActiveOptimizerProfile(nextDraft).timeout))
      setCaptionerTimeoutInput(String(getActiveCaptionerProfile(nextDraft).timeout))
      setShowProfileMenu(false)
    }
  }

  const handleClearAllData = async () => {
    await clearAllData()
    const nextDraft = normalizeSettings(useStore.getState().settings)
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setOptimizerTimeoutInput(String(getActiveOptimizerProfile(nextDraft).timeout))
    setCaptionerTimeoutInput(String(getActiveCaptionerProfile(nextDraft).timeout))
    setShowProfileMenu(false)
  }

  const createNewProfile = () => {
    const profile = createDefaultOpenAIProfile({ id: newId('openai'), name: '新配置' })
    setDraft(normalizeSettings({
      ...draft,
      profiles: [...draft.profiles, profile],
      activeProfileId: profile.id,
    }))
    setShowProfileMenu(false)
  }

  const switchProfile = (id: string) => {
    setDraft(normalizeSettings({ ...draft, activeProfileId: id }))
    setShowProfileMenu(false)
  }

  const deleteProfile = (id: string) => {
    if (draft.profiles.length <= 1) return
    const nextProfiles = draft.profiles.filter((item) => item.id !== id)
    setDraft(normalizeSettings({
      ...draft,
      profiles: nextProfiles,
      activeProfileId: draft.activeProfileId === id ? nextProfiles[0].id : draft.activeProfileId,
    }))
  }

  const createOptimizerProfile = () => {
    const profile = createDefaultOptimizerProfile({ id: newId('optimizer'), name: '新配置' })
    setDraft(normalizeSettings({
      ...draft,
      optimizerProfiles: [...draft.optimizerProfiles, profile],
      activeOptimizerProfileId: profile.id,
    }))
    setShowOptimizerProfileMenu(false)
  }

  const switchOptimizerProfile = (id: string) => {
    setDraft(normalizeSettings({ ...draft, activeOptimizerProfileId: id }))
    setShowOptimizerProfileMenu(false)
  }

  const deleteOptimizerProfile = (id: string) => {
    if (draft.optimizerProfiles.length <= 1) return
    const nextProfiles = draft.optimizerProfiles.filter((item) => item.id !== id)
    setDraft(normalizeSettings({
      ...draft,
      optimizerProfiles: nextProfiles,
      activeOptimizerProfileId:
        draft.activeOptimizerProfileId === id ? nextProfiles[0].id : draft.activeOptimizerProfileId,
    }))
  }

  const createCaptionerProfile = () => {
    const profile = createDefaultCaptionerProfile({ id: newId('captioner'), name: '新配置' })
    setDraft(normalizeSettings({
      ...draft,
      captionerProfiles: [...draft.captionerProfiles, profile],
      activeCaptionerProfileId: profile.id,
    }))
    setShowCaptionerProfileMenu(false)
  }

  const switchCaptionerProfile = (id: string) => {
    setDraft(normalizeSettings({ ...draft, activeCaptionerProfileId: id }))
    setShowCaptionerProfileMenu(false)
  }

  const deleteCaptionerProfile = (id: string) => {
    if (draft.captionerProfiles.length <= 1) return
    const nextProfiles = draft.captionerProfiles.filter((item) => item.id !== id)
    setDraft(normalizeSettings({
      ...draft,
      captionerProfiles: nextProfiles,
      activeCaptionerProfileId:
        draft.activeCaptionerProfileId === id ? nextProfiles[0].id : draft.activeCaptionerProfileId,
    }))
  }

  const handleDeleteCategory = (categoryId: string, categoryName: string) => {
    setConfirmDialog({
      title: '删除收藏分类',
      message: `确定要删除分类「${categoryName.trim() || '未命名分类'}」吗？使用此分类的记录会变为未分组收藏。`,
      confirmText: '删除分类',
      tone: 'warning',
      action: () => {
        void deleteFavoriteCategory(categoryId).catch((err) => {
          showToast(`删除分类失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
    })
  }

  const handlePruneOrphans = () => {
    if (!storageStats || storageStats.orphanCount === 0) return
    setConfirmDialog({
      title: '清理孤儿图片',
      message: `将删除 ${storageStats.orphanCount} 张无引用图片，约 ${formatBytes(storageStats.orphanBytes)}，不可恢复。是否继续？`,
      confirmText: '清理',
      tone: 'danger',
      action: () => {
        // 确认到执行之间用户可能又生成了图：重读最新引用集，cutoff=now 放过执行期间的新写入。
        void (async () => {
          const { tasks, inputImages } = useStore.getState()
          const refs = collectReferencedImageIds(tasks, inputImages)
          const { deletedCount, deletedBytes } = await pruneOrphanImages(refs, Date.now())
          showToast(`已清理 ${deletedCount} 张，释放约 ${formatBytes(deletedBytes)}`, 'success')
          await refreshStorageStats()
        })().catch((err) => {
          showToast(`清理失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
    })
  }

  return (
    <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md sm:max-w-lg md:max-w-2xl rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 overflow-y-auto max-h-[85vh] custom-scrollbar"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                习惯配置
              </h4>
            </div>
            <div className="space-y-4">
              <div className="block">
                <div className="mb-1 flex items-center justify-between">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">提交任务后清空输入框</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${draft.clearInputAfterSubmit ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    role="switch"
                    aria-checked={draft.clearInputAfterSubmit}
                    aria-label="提交任务后清空输入框"
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${draft.clearInputAfterSubmit ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div data-selectable-text className="text-xs text-gray-400 dark:text-gray-500">
                  开启后，提交成功创建任务时会清空提示词和参考图。
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                API 配置
              </h4>
              <ProfileSelector
                profiles={draft.profiles}
                activeProfileId={draft.activeProfileId}
                open={showProfileMenu}
                onOpenChange={setShowProfileMenu}
                onSelect={switchProfile}
                onCreate={createNewProfile}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.profiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => deleteProfile(id),
                })}
              />
            </div>
            <ApiProfileSection
              activeProfile={activeProfile}
              apiProxyAvailable={apiProxyAvailable}
              apiProxyEnabled={apiProxyEnabled}
              onUpdate={updateActiveProfile}
              timeoutInput={timeoutInput}
              onTimeoutChange={setTimeoutInput}
              onTimeoutBlur={commitTimeout}
            />
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                提示词优化 API
              </h4>
              <NamedProfileSelector
                profiles={draft.optimizerProfiles}
                activeProfileId={draft.activeOptimizerProfileId}
                open={showOptimizerProfileMenu}
                onOpenChange={setShowOptimizerProfileMenu}
                onSelect={switchOptimizerProfile}
                onCreate={createOptimizerProfile}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.optimizerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => deleteOptimizerProfile(id),
                })}
              />
            </div>
            <OptimizerSection
              optimizer={activeOptimizerProfile}
              onUpdate={updateActiveOptimizerProfile}
              timeoutInput={optimizerTimeoutInput}
              onTimeoutChange={setOptimizerTimeoutInput}
            />
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                反推提示词 API
              </h4>
              <NamedProfileSelector
                profiles={draft.captionerProfiles}
                activeProfileId={draft.activeCaptionerProfileId}
                open={showCaptionerProfileMenu}
                onOpenChange={setShowCaptionerProfileMenu}
                onSelect={switchCaptionerProfile}
                onCreate={createCaptionerProfile}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.captionerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => deleteCaptionerProfile(id),
                })}
              />
            </div>
            <CaptionerSection
              captioner={activeCaptionerProfile}
              onUpdate={updateActiveCaptionerProfile}
              timeoutInput={captionerTimeoutInput}
              onTimeoutChange={setCaptionerTimeoutInput}
            />
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              收藏分类
            </h4>
            <FavoriteCategorySection
              categories={favoriteCategories}
              onUpdate={updateFavoriteCategory}
              onMove={moveFavoriteCategory}
              onDelete={handleDeleteCategory}
            />
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              数据管理
            </h4>
            <DataManagementSection
              storageStats={storageStats}
              storageLoading={storageLoading}
              onPruneOrphans={handlePruneOrphans}
              onExport={() => exportData()}
              onImport={runImport}
              onClearAll={handleClearAllData}
              onConfirmReplaceImport={(proceed) =>
                setConfirmDialog({
                  title: '替换导入',
                  message: '替换导入会先清空本地任务记录和图片，再导入备份。设置会按安全规则合并，已有密钥不会被空密钥覆盖。',
                  confirmText: '选择备份',
                  tone: 'warning',
                  action: proceed,
                })
              }
              onConfirmClearAll={(proceed) =>
                setConfirmDialog({
                  title: '清空所有数据',
                  message: '确定要清空所有任务记录、图片数据和供应商配置吗？此操作不可恢复。',
                  action: proceed,
                })
              }
            />
          </section>

          <div className="pt-5 border-t border-gray-100 dark:border-white/[0.08] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty}
              className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
