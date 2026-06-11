import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { isApiProxyAvailable, readClientDevProxyConfig } from '../../lib/api/devProxy'
import { useStore, exportData, importData, clearAllData } from '../../store'
import type { ImportMode } from '../../lib/exportImport'
import {
  createDefaultOpenAIProfile,
  createDefaultOptimizerProfile,
  createDefaultCaptionerProfile,
  DEFAULT_SETTINGS,
  BATCH_CONCURRENCY_MAX,
  BATCH_CONCURRENCY_MIN,
  getActiveApiProfile,
  getActiveOptimizerProfile,
  getActiveCaptionerProfile,
  normalizeSettings,
} from '../../lib/api/apiProfiles'
import type { ApiProfile, AppSettings, CaptionerProfile, PromptOptimizerProfile } from '../../types'
import Modal, { ModalCloseButton, ModalTitle } from '../Modal'
import { ProfileSelector } from './ProfileSelector'
import { NamedProfileSelector } from './NamedProfileSelector'
import { ApiProfileSection } from './ApiProfileSection'
import { OptimizerSection } from './OptimizerSection'
import { CaptionerSection } from './CaptionerSection'
import { FavoriteCategorySection } from './FavoriteCategorySection'
import { DataManagementSection } from './DataManagementSection'
import {
  applyTimeoutToProfiles,
  ensureProfilesWithActive,
  normalizeApiProfilesForSave,
  normalizeCaptionerProfilesForSave,
  normalizeOptimizerProfilesForSave,
} from './helpers'
import { normalizeTimeoutInput } from './timeout'
import { useNamedProfileManager } from './hooks/useNamedProfileManager'
import { useTimeoutInput } from './hooks/useTimeoutInput'
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

  // 三套配置组(API / 优化器 / 图说器)共用同一个参数化管理 hook:
  // 激活解析 / 更新 / 新建 / 切换 / 删除 / 下拉菜单开关
  const apiManager = useNamedProfileManager<ApiProfile>({
    draft,
    setDraft,
    select: (s) => ({ profiles: s.profiles, activeId: s.activeProfileId }),
    patch: (profiles, activeId) => ({ profiles, activeProfileId: activeId }),
    createProfile: () => createDefaultOpenAIProfile({ id: newId('openai'), name: '新配置' }),
    resolveFallback: getActiveApiProfile,
  })
  const optimizerManager = useNamedProfileManager<PromptOptimizerProfile>({
    draft,
    setDraft,
    select: (s) => ({ profiles: s.optimizerProfiles, activeId: s.activeOptimizerProfileId }),
    patch: (profiles, activeId) => ({ optimizerProfiles: profiles, activeOptimizerProfileId: activeId }),
    createProfile: () => createDefaultOptimizerProfile({ id: newId('optimizer'), name: '新配置' }),
  })
  const captionerManager = useNamedProfileManager<CaptionerProfile>({
    draft,
    setDraft,
    select: (s) => ({ profiles: s.captionerProfiles, activeId: s.activeCaptionerProfileId }),
    patch: (profiles, activeId) => ({ captionerProfiles: profiles, activeCaptionerProfileId: activeId }),
    createProfile: () => createDefaultCaptionerProfile({ id: newId('captioner'), name: '新配置' }),
  })
  const activeProfile = apiManager.active
  const activeOptimizerProfile = optimizerManager.active
  const activeCaptionerProfile = captionerManager.active
  const apiProxyEnabled = apiProxyAvailable && activeProfile.provider === 'openai' && activeProfile.apiProxy

  // 三套 timeout 输入框共用同一个 hook:字符串输入态 + 激活项变化回写 + 保存/脏检测时 flush。
  // flush 语义差异:API 配置历史上放行 0/负数,优化器/图说器回退到当前值。
  const apiTimeout = useTimeoutInput({
    initialTimeout: getActiveApiProfile(settings).timeout,
    activeId: activeProfile.id,
    activeTimeout: activeProfile.timeout,
  })
  const optimizerTimeout = useTimeoutInput({
    initialTimeout: getActiveOptimizerProfile(settings).timeout,
    activeId: activeOptimizerProfile.id,
    activeTimeout: activeOptimizerProfile.timeout,
    rejectNonPositiveOnFlush: true,
  })
  const captionerTimeout = useTimeoutInput({
    initialTimeout: getActiveCaptionerProfile(settings).timeout,
    activeId: activeCaptionerProfile.id,
    activeTimeout: activeCaptionerProfile.timeout,
    rejectNonPositiveOnFlush: true,
  })

  const wasSettingsOpenRef = useRef(false)

  // 把 timeoutInput 折叠回 draft:在保存与 dirty 检测时用,确保 timeoutInput 中的改动也算数
  const buildFlushedDraft = useCallback((): AppSettings => {
    let next = draft

    const normalizedTimeout = apiTimeout.flush()
    if (normalizedTimeout !== activeProfile.timeout) {
      next = {
        ...next,
        profiles: applyTimeoutToProfiles(next.profiles, activeProfile.id, normalizedTimeout),
      }
    }

    const normalizedOptimizerTimeout = optimizerTimeout.flush()
    if (normalizedOptimizerTimeout !== activeOptimizerProfile.timeout) {
      next = {
        ...next,
        optimizerProfiles: applyTimeoutToProfiles(
          next.optimizerProfiles,
          activeOptimizerProfile.id,
          normalizedOptimizerTimeout,
        ),
      }
    }

    const normalizedCaptionerTimeout = captionerTimeout.flush()
    if (normalizedCaptionerTimeout !== activeCaptionerProfile.timeout) {
      next = {
        ...next,
        captionerProfiles: applyTimeoutToProfiles(
          next.captionerProfiles,
          activeCaptionerProfile.id,
          normalizedCaptionerTimeout,
        ),
      }
    }

    return next
  }, [draft, activeProfile.id, activeProfile.timeout, activeOptimizerProfile.id, activeOptimizerProfile.timeout, activeCaptionerProfile.id, activeCaptionerProfile.timeout, apiTimeout, optimizerTimeout, captionerTimeout])

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
    apiTimeout.reset(getActiveApiProfile(nextDraft).timeout)
    optimizerTimeout.reset(getActiveOptimizerProfile(nextDraft).timeout)
    captionerTimeout.reset(getActiveCaptionerProfile(nextDraft).timeout)
    void refreshStorageStats()
  }, [apiProxyAvailable, showSettings, settings, refreshStorageStats, apiTimeout, optimizerTimeout, captionerTimeout])

  const commitSettings = (nextDraft: AppSettings) => {
    const api = ensureProfilesWithActive(
      normalizeApiProfilesForSave(nextDraft.profiles, apiProxyAvailable),
      createDefaultOpenAIProfile({ id: newId('openai') }),
      nextDraft.activeProfileId,
    )
    const optimizer = ensureProfilesWithActive(
      normalizeOptimizerProfilesForSave(nextDraft.optimizerProfiles),
      createDefaultOptimizerProfile({ id: newId('optimizer') }),
      nextDraft.activeOptimizerProfileId,
    )
    const captioner = ensureProfilesWithActive(
      normalizeCaptionerProfilesForSave(nextDraft.captionerProfiles),
      createDefaultCaptionerProfile({ id: newId('captioner') }),
      nextDraft.activeCaptionerProfileId,
    )
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      profiles: api.profiles,
      activeProfileId: api.activeId,
      optimizerProfiles: optimizer.profiles,
      activeOptimizerProfileId: optimizer.activeId,
      captionerProfiles: captioner.profiles,
      activeCaptionerProfileId: captioner.activeId,
    })
    setDraft(normalizedDraft)
    // 保持原行为:保存后只回写优化器/图说器输入框;API 输入框由失焦提交与同步 effect 维护
    optimizerTimeout.reset(getActiveOptimizerProfile(normalizedDraft).timeout)
    captionerTimeout.reset(getActiveCaptionerProfile(normalizedDraft).timeout)
    setSettings(normalizedDraft)
  }

  const updateActiveProfile = apiManager.updateActive

  const resetDraft = useCallback(() => {
    const fresh = normalizeSettings(settings)
    setDraft(fresh)
    apiTimeout.reset(getActiveApiProfile(fresh).timeout)
    optimizerTimeout.reset(getActiveOptimizerProfile(fresh).timeout)
    captionerTimeout.reset(getActiveCaptionerProfile(fresh).timeout)
  }, [settings, apiTimeout, optimizerTimeout, captionerTimeout])

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

  // API 配置 timeout 失焦提交:空串兜全局默认值(而非当前激活值),非数字兜当前激活值,
  // 0/负数原样放行 —— 与保存 flush 的语义差异是历史行为,保持不变
  const commitTimeout = useCallback(() => {
    const normalizedTimeout =
      apiTimeout.value.trim() === ''
        ? DEFAULT_SETTINGS.timeout
        : normalizeTimeoutInput(apiTimeout.value, activeProfile.timeout)
    apiTimeout.reset(normalizedTimeout)
    if (normalizedTimeout !== activeProfile.timeout) {
      updateActiveProfile({ timeout: normalizedTimeout })
    }
  }, [activeProfile.timeout, apiTimeout, updateActiveProfile])

  if (!showSettings) return null

  const runImport = async (file: File, mode: ImportMode) => {
    const imported = await importData(file, { mode })
    if (imported) {
      const nextDraft = normalizeSettings(useStore.getState().settings)
      setDraft(nextDraft)
      apiTimeout.reset(getActiveApiProfile(nextDraft).timeout)
      optimizerTimeout.reset(getActiveOptimizerProfile(nextDraft).timeout)
      captionerTimeout.reset(getActiveCaptionerProfile(nextDraft).timeout)
      apiManager.setShowMenu(false)
    }
  }

  const handleClearAllData = async () => {
    await clearAllData()
    const nextDraft = normalizeSettings(useStore.getState().settings)
    setDraft(nextDraft)
    apiTimeout.reset(getActiveApiProfile(nextDraft).timeout)
    optimizerTimeout.reset(getActiveOptimizerProfile(nextDraft).timeout)
    captionerTimeout.reset(getActiveCaptionerProfile(nextDraft).timeout)
    apiManager.setShowMenu(false)
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
    <Modal
      onClose={handleClose}
      ariaLabel="设置"
      containerClassName="z-[70] items-center"
      panelClassName="w-full max-w-md sm:max-w-lg md:max-w-2xl p-5 overflow-y-auto max-h-[85vh] custom-scrollbar"
    >
        <div className="mb-5 flex items-center justify-between gap-4">
          <ModalTitle>
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </ModalTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <ModalCloseButton onClick={handleClose} />
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
              <div className="block">
                <div className="mb-1 flex items-center justify-between">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">批量并发上限</span>
                  {/* select 离散下拉:直接 setDraft 进脏检测闭环,不必像 timeout 那样接 string-state flush */}
                  <select
                    value={draft.batchConcurrency}
                    onChange={(e) => setDraft({ ...draft, batchConcurrency: Number(e.target.value) })}
                    aria-label="批量并发上限"
                    className="rounded-lg border border-gray-200/70 bg-white/60 px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/40"
                  >
                    {Array.from(
                      { length: BATCH_CONCURRENCY_MAX - BATCH_CONCURRENCY_MIN + 1 },
                      (_, i) => BATCH_CONCURRENCY_MIN + i,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div data-selectable-text className="text-xs text-gray-400 dark:text-gray-500">
                  批量提交(通配 / 参数网格 / 补跑)同时进行的任务数,调整后对新批次生效。
                  {activeProfile.provider === 'openai' && activeProfile.codexCli ? (
                    <span className="text-amber-500 dark:text-amber-400">
                      {' '}当前 Codex CLI 兼容模式下,多图(n&gt;1)会再按图拆分并发,实际请求数约为本值×单批图数,过高易触发上游 429。
                    </span>
                  ) : (
                    ' 过高可能触发上游限流(429)。'
                  )}
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
                open={apiManager.showMenu}
                onOpenChange={apiManager.setShowMenu}
                onSelect={apiManager.switchTo}
                onCreate={apiManager.create}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.profiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => apiManager.remove(id),
                })}
              />
            </div>
            <ApiProfileSection
              activeProfile={activeProfile}
              apiProxyAvailable={apiProxyAvailable}
              apiProxyEnabled={apiProxyEnabled}
              onUpdate={updateActiveProfile}
              timeoutInput={apiTimeout.value}
              onTimeoutChange={apiTimeout.setValue}
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
                open={optimizerManager.showMenu}
                onOpenChange={optimizerManager.setShowMenu}
                onSelect={optimizerManager.switchTo}
                onCreate={optimizerManager.create}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.optimizerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => optimizerManager.remove(id),
                })}
              />
            </div>
            <OptimizerSection
              optimizer={activeOptimizerProfile}
              onUpdate={optimizerManager.updateActive}
              timeoutInput={optimizerTimeout.value}
              onTimeoutChange={optimizerTimeout.setValue}
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
                open={captionerManager.showMenu}
                onOpenChange={captionerManager.setShowMenu}
                onSelect={captionerManager.switchTo}
                onCreate={captionerManager.create}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.captionerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => captionerManager.remove(id),
                })}
              />
            </div>
            <CaptionerSection
              captioner={activeCaptionerProfile}
              onUpdate={captionerManager.updateActive}
              timeoutInput={captionerTimeout.value}
              onTimeoutChange={captionerTimeout.setValue}
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
    </Modal>
  )
}
