import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { isApiProxyAvailable, readClientDevProxyConfig } from '../../lib/api/devProxy'
import { useStore, exportData, importData, clearAllData } from '../../store'
import type { ImportMode } from '../../lib/exportImport'
import {
  createDefaultOpenAIProfile,
  createDefaultOptimizerProfile,
  createDefaultCaptionerProfile,
  DEFAULT_SETTINGS,
  AUTO_RETRY_MAX_LIMIT,
  AUTO_RETRY_MIN,
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
import { getInFlightImageIds } from '../../lib/inFlightImages'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const SETTINGS_SECTIONS = [
  { id: 'api', label: '图像 API', description: '管理图像生成与编辑接口，保存后用于新任务。' },
  { id: 'optimizer', label: '提示词优化', description: '独立配置用于润色提示词的文本模型。' },
  { id: 'captioner', label: '反推提示词', description: '独立配置用于理解图片的视觉模型。' },
  { id: 'runtime', label: '运行参数', description: '调整创作习惯、批量并发和自动重试。' },
  { id: 'favorites', label: '收藏分类', description: '分类修改即时生效，无需点击保存。' },
  { id: 'appearance', label: '外观', description: '选择适合当前环境的界面主题，保存后生效。' },
  { id: 'data', label: '数据管理', description: '导入和清理会即时执行，无需点击保存。' },
] as const

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

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
  const [activeSection, setActiveSection] = useState<SettingsSection>('api')
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const storageStatsRequestRef = useRef(0)
  const sectionScrollRef = useRef<HTMLDivElement>(null)

  const refreshStorageStats = useCallback(async () => {
    const requestId = ++storageStatsRequestRef.current
    setStorageLoading(true)
    try {
      const { tasks, inputImages } = useStore.getState()
      const stats = await computeStorageStats(collectReferencedImageIds(tasks, inputImages))
      if (storageStatsRequestRef.current !== requestId) return
      setStorageStats(stats)
    } catch (err) {
      if (storageStatsRequestRef.current !== requestId) return
      setStorageStats(null)
      useStore
        .getState()
        .showToast(`统计本地占用失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      if (storageStatsRequestRef.current === requestId) setStorageLoading(false)
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
    patch: (profiles, activeId) => ({
      optimizerProfiles: profiles,
      activeOptimizerProfileId: activeId,
    }),
    createProfile: () => createDefaultOptimizerProfile({ id: newId('optimizer'), name: '新配置' }),
  })
  const captionerManager = useNamedProfileManager<CaptionerProfile>({
    draft,
    setDraft,
    select: (s) => ({ profiles: s.captionerProfiles, activeId: s.activeCaptionerProfileId }),
    patch: (profiles, activeId) => ({
      captionerProfiles: profiles,
      activeCaptionerProfileId: activeId,
    }),
    createProfile: () => createDefaultCaptionerProfile({ id: newId('captioner'), name: '新配置' }),
  })
  const changeSection = (section: SettingsSection) => {
    // 分类切换仅关闭临时浮层；三组配置与超时草稿留在当前容器中。
    apiManager.setShowMenu(false)
    optimizerManager.setShowMenu(false)
    captionerManager.setShowMenu(false)
    setActiveSection(section)
    if (sectionScrollRef.current) sectionScrollRef.current.scrollTop = 0
  }

  const activeProfile = apiManager.active
  const activeOptimizerProfile = optimizerManager.active
  const activeCaptionerProfile = captionerManager.active
  const apiProxyEnabled =
    apiProxyAvailable && activeProfile.provider === 'openai' && activeProfile.apiProxy

  // 三套 timeout 输入框共用同一个 hook:字符串输入态 + 激活项变化回写 + 保存/脏检测时 flush。
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
  }, [
    draft,
    activeProfile.id,
    activeProfile.timeout,
    activeOptimizerProfile.id,
    activeOptimizerProfile.timeout,
    activeCaptionerProfile.id,
    activeCaptionerProfile.timeout,
    apiTimeout,
    optimizerTimeout,
    captionerTimeout,
  ])

  // 基线与 draft 同口径:代理不可用的环境里 draft 会把所有 profile.apiProxy 置 false(见打开面板的 effect),
  // 若基线仍是持久化里的 apiProxy=true,面板一打开就「已修改」——保存按钮亮起、关闭还要确认「放弃改动」
  const settingsJson = useMemo(
    () =>
      JSON.stringify(
        normalizeSettings(
          apiProxyAvailable
            ? settings
            : {
                ...settings,
                profiles: settings.profiles.map((profile) => ({ ...profile, apiProxy: false })),
              },
        ),
      ),
    [settings, apiProxyAvailable],
  )
  const isDirty = useMemo(
    () => JSON.stringify(buildFlushedDraft()) !== settingsJson,
    [buildFlushedDraft, settingsJson],
  )

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      storageStatsRequestRef.current += 1
      return
    }
    if (wasSettingsOpenRef.current) return

    wasSettingsOpenRef.current = true
    setActiveSection('api')
    const nextDraft = normalizeSettings(
      apiProxyAvailable
        ? settings
        : {
            ...settings,
            profiles: settings.profiles.map((profile) => ({ ...profile, apiProxy: false })),
          },
    )
    setDraft(nextDraft)
    apiTimeout.reset(getActiveApiProfile(nextDraft).timeout)
    optimizerTimeout.reset(getActiveOptimizerProfile(nextDraft).timeout)
    captionerTimeout.reset(getActiveCaptionerProfile(nextDraft).timeout)
    void refreshStorageStats()
  }, [
    apiProxyAvailable,
    showSettings,
    settings,
    refreshStorageStats,
    apiTimeout,
    optimizerTimeout,
    captionerTimeout,
  ])

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

  // API 配置 timeout 失焦提交:空串兜全局默认值(而非当前激活值),非数字/非正数兜当前激活值
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
      await refreshStorageStats()
    }
  }

  const handleClearAllData = async () => {
    try {
      await clearAllData()
    } finally {
      const nextDraft = normalizeSettings(useStore.getState().settings)
      setDraft(nextDraft)
      apiTimeout.reset(getActiveApiProfile(nextDraft).timeout)
      optimizerTimeout.reset(getActiveOptimizerProfile(nextDraft).timeout)
      captionerTimeout.reset(getActiveCaptionerProfile(nextDraft).timeout)
      apiManager.setShowMenu(false)
      await refreshStorageStats()
    }
  }

  const handleDeleteCategory = (categoryId: string, categoryName: string) => {
    setConfirmDialog({
      title: '删除收藏分类',
      message: `确定要删除分类「${categoryName.trim() || '未命名分类'}」吗？使用此分类的记录会变为未分组收藏。`,
      confirmText: '删除分类',
      tone: 'warning',
      action: () =>
        deleteFavoriteCategory(categoryId).catch((err) => {
          useStore
            .getState()
            .showToast(`删除分类失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        }),
    })
  }

  const handlePruneOrphans = () => {
    if (!storageStats || storageStats.orphanCount === 0) return
    setConfirmDialog({
      title: '清理孤儿图片',
      message: `将删除 ${storageStats.orphanCount} 张无引用图片，约 ${formatBytes(storageStats.orphanBytes)}，不可恢复。是否继续？`,
      confirmText: '清理',
      tone: 'danger',
      action: async () => {
        // 确认到执行之间用户可能又生成了图：重读最新引用集，cutoff=now 放过执行期间的新写入。
        try {
          const { tasks, inputImages } = useStore.getState()
          const refs = collectReferencedImageIds(tasks, inputImages)
          // 已落库、任务记录尚未引用的在途输出图/遮罩图不是孤儿(点击时刻的引用集看不到它们)
          for (const id of getInFlightImageIds()) refs.add(id)
          const { deletedCount, deletedBytes } = await pruneOrphanImages(refs, Date.now())
          useStore
            .getState()
            .showToast(`已清理 ${deletedCount} 张，释放约 ${formatBytes(deletedBytes)}`, 'success')
          await refreshStorageStats()
        } catch (err) {
          useStore
            .getState()
            .showToast(`清理失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        }
      },
    })
  }

  return (
    <Modal
      onClose={handleClose}
      ariaLabel="设置"
      containerClassName="z-[70] items-center"
      panelClassName="flex h-[min(760px,90dvh)] w-full max-w-[960px] flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-4 md:px-6">
        <ModalTitle>
          <svg
            className="w-5 h-5 text-brand-ink"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          设置
        </ModalTitle>
        <div className="flex items-center gap-3">
          <span className="text-xs text-content-subtle dark:text-content-subtle font-mono select-none">
            v{__APP_VERSION__}
          </span>
          <ModalCloseButton onClick={handleClose} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="shrink-0 border-b border-line px-4 py-3 md:hidden">
          <label
            htmlFor="settings-section"
            className="mb-2 block text-xs font-medium text-content-muted"
          >
            设置分类
          </label>
          <select
            id="settings-section"
            value={activeSection}
            onChange={(event) => changeSection(event.target.value as SettingsSection)}
            className="ui-field w-full"
          >
            {SETTINGS_SECTIONS.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </select>
        </div>
        <nav
          aria-label="设置分类"
          className="hidden w-[168px] shrink-0 space-y-1 overflow-y-auto border-r border-line bg-surface-muted p-3 md:block"
        >
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={activeSection === section.id ? 'page' : undefined}
              onClick={() => changeSection(section.id)}
              className={`flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${activeSection === section.id ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-content-muted hover:bg-surface hover:text-content'}`}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <div
          ref={sectionScrollRef}
          className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6"
        >
          <p className="mb-6 rounded-xl bg-surface-muted px-4 py-3 text-sm leading-6 text-content-muted">
            {SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.description}
          </p>
          {activeSection === 'runtime' && (
            <section aria-label="运行参数" className="min-w-0 space-y-5">
              <div className="mb-4 flex items-center justify-between gap-3 relative">
                <h4 className="text-base font-semibold text-content dark:text-content">
                  创作与任务
                </h4>
              </div>
              <div className="space-y-4">
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-xs text-content-muted dark:text-content-muted">
                      提交任务后清空输入框
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-3 ${draft.clearInputAfterSubmit ? 'bg-brand' : 'bg-surface-raised dark:bg-surface-raised'}`}
                      role="switch"
                      aria-checked={draft.clearInputAfterSubmit}
                      aria-label="提交任务后清空输入框"
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${draft.clearInputAfterSubmit ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                      />
                    </button>
                  </div>
                  <div
                    data-selectable-text
                    className="text-xs text-content-subtle dark:text-content-subtle"
                  >
                    开启后，提交成功创建任务时会清空提示词和参考图。
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-xs text-content-muted dark:text-content-muted">
                      批量并发上限
                    </span>
                    {/* select 离散下拉:直接 setDraft 进脏检测闭环,不必像 timeout 那样接 string-state flush */}
                    <select
                      value={draft.batchConcurrency}
                      onChange={(e) =>
                        setDraft({ ...draft, batchConcurrency: Number(e.target.value) })
                      }
                      aria-label="批量并发上限"
                      className="ui-field min-h-11 w-24 px-3 text-base md:text-sm"
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
                  <div
                    data-selectable-text
                    className="text-xs text-content-subtle dark:text-content-subtle"
                  >
                    批量提交(通配 / 参数网格 / 补跑)同时进行的任务数,调整后对新批次生效。
                    {activeProfile.provider === 'openai' && activeProfile.codexCli ? (
                      <span className="text-amber-500 dark:text-amber-400">
                        {' '}
                        当前 Codex CLI
                        兼容模式下,多图(n&gt;1)会再按图拆分并发,实际请求数约为本值×单批图数,过高易触发上游
                        429。
                      </span>
                    ) : (
                      ' 过高可能触发上游限流(429)。'
                    )}
                  </div>
                </div>
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-xs text-content-muted dark:text-content-muted">
                      瞬时失败自动重试
                    </span>
                    {/* select 离散下拉:同批量并发上限,直接 setDraft 进脏检测闭环 */}
                    <select
                      value={draft.autoRetryMax}
                      onChange={(e) => setDraft({ ...draft, autoRetryMax: Number(e.target.value) })}
                      aria-label="瞬时失败自动重试次数"
                      className="ui-field min-h-11 w-24 px-3 text-base md:text-sm"
                    >
                      {Array.from(
                        { length: AUTO_RETRY_MAX_LIMIT - AUTO_RETRY_MIN + 1 },
                        (_, i) => AUTO_RETRY_MIN + i,
                      ).map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? '关闭' : `${n} 次`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    data-selectable-text
                    className="text-xs text-content-subtle dark:text-content-subtle"
                  >
                    限流(429)、服务端错误(5xx)、超时与网络中断按指数退避自动重试;参数错误、
                    内容拦截等不重试。调整后对新任务生效。
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === 'api' && (
            <section aria-label="图像 API" className="min-w-0 space-y-5">
              <div className="mb-4 flex items-center justify-between gap-3 relative">
                <h4 className="text-base font-semibold text-content dark:text-content">API 配置</h4>
                <ProfileSelector
                  profiles={draft.profiles}
                  activeProfileId={draft.activeProfileId}
                  showProviderBadge
                  open={apiManager.showMenu}
                  onOpenChange={apiManager.setShowMenu}
                  onSelect={apiManager.switchTo}
                  onCreate={apiManager.create}
                  onDelete={(id) =>
                    setConfirmDialog({
                      title: '删除配置',
                      message: `确定要删除配置「${draft.profiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                      action: () => apiManager.remove(id),
                    })
                  }
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
          )}

          {activeSection === 'optimizer' && (
            <section aria-label="提示词优化" className="min-w-0 space-y-5">
              <div className="mb-4 flex items-center justify-between gap-3 relative">
                <h4 className="text-base font-semibold text-content dark:text-content">
                  提示词优化 API
                </h4>
                <ProfileSelector
                  profiles={draft.optimizerProfiles}
                  activeProfileId={draft.activeOptimizerProfileId}
                  open={optimizerManager.showMenu}
                  onOpenChange={optimizerManager.setShowMenu}
                  onSelect={optimizerManager.switchTo}
                  onCreate={optimizerManager.create}
                  onDelete={(id) =>
                    setConfirmDialog({
                      title: '删除配置',
                      message: `确定要删除配置「${draft.optimizerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                      action: () => optimizerManager.remove(id),
                    })
                  }
                />
              </div>
              <OptimizerSection
                optimizer={activeOptimizerProfile}
                onUpdate={optimizerManager.updateActive}
                timeoutInput={optimizerTimeout.value}
                onTimeoutChange={optimizerTimeout.setValue}
              />
            </section>
          )}

          {activeSection === 'captioner' && (
            <section aria-label="反推提示词" className="min-w-0 space-y-5">
              <div className="mb-4 flex items-center justify-between gap-3 relative">
                <h4 className="text-base font-semibold text-content dark:text-content">
                  反推提示词 API
                </h4>
                <ProfileSelector
                  profiles={draft.captionerProfiles}
                  activeProfileId={draft.activeCaptionerProfileId}
                  open={captionerManager.showMenu}
                  onOpenChange={captionerManager.setShowMenu}
                  onSelect={captionerManager.switchTo}
                  onCreate={captionerManager.create}
                  onDelete={(id) =>
                    setConfirmDialog({
                      title: '删除配置',
                      message: `确定要删除配置「${draft.captionerProfiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                      action: () => captionerManager.remove(id),
                    })
                  }
                />
              </div>
              <CaptionerSection
                captioner={activeCaptionerProfile}
                onUpdate={captionerManager.updateActive}
                timeoutInput={captionerTimeout.value}
                onTimeoutChange={captionerTimeout.setValue}
              />
            </section>
          )}

          {activeSection === 'favorites' && (
            <section aria-label="收藏分类" className="min-w-0 space-y-5">
              <h4 className="mb-4 text-base font-semibold text-content dark:text-content">
                收藏分类
              </h4>
              <FavoriteCategorySection
                categories={favoriteCategories}
                onUpdate={updateFavoriteCategory}
                onMove={moveFavoriteCategory}
                onDelete={handleDeleteCategory}
              />
            </section>
          )}

          {/* 数据操作可能跨分类继续运行，保留挂载以维护 busy 和导入文件选择状态。 */}
          <section
            hidden={activeSection !== 'data'}
            aria-label="数据管理"
            className="min-w-0 space-y-5"
          >
            <h4 className="mb-4 text-base font-semibold text-content dark:text-content">
              数据管理
            </h4>
            <DataManagementSection
              storageStats={storageStats}
              storageLoading={storageLoading}
              onPruneOrphans={handlePruneOrphans}
              onExport={() => exportData()}
              onImport={runImport}
              onClearAll={handleClearAllData}
              onConfirmMergeImport={(proceed) => {
                // 导入成功后面板会用 store 里的设置重建 draft,未保存的改动会被静默丢掉:有改动先确认
                if (!isDirty) {
                  void proceed()
                  return
                }
                setConfirmDialog({
                  title: '合并导入',
                  message:
                    '设置面板里有未保存的改动，导入完成后会被备份里的设置覆盖并丢失。是否继续？',
                  confirmText: '放弃改动并选择备份',
                  tone: 'warning',
                  action: proceed,
                })
              }}
              onConfirmReplaceImport={(proceed) =>
                setConfirmDialog({
                  title: '替换导入',
                  message: `替换导入会先清空本地任务记录和图片，再导入备份。设置会按安全规则合并，已有密钥不会被空密钥覆盖。${isDirty ? '面板里未保存的改动也会丢失。' : ''}`,
                  confirmText: '选择备份',
                  tone: 'warning',
                  action: proceed,
                })
              }
              onConfirmClearAll={(proceed) =>
                setConfirmDialog({
                  title: '清空所有数据',
                  message: '确定要清空所有任务记录、图片数据和供应商配置吗？此操作不可恢复。',
                  // 不可恢复操作:确认键延迟启用,防止连点误触
                  minConfirmDelayMs: 800,
                  action: proceed,
                })
              }
            />
          </section>

          {activeSection === 'appearance' && (
            <section aria-label="外观" className="space-y-5">
              <fieldset>
                <legend className="mb-4 text-base font-semibold text-content">界面主题</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      { value: 'light', label: '浅色', description: '明亮清晰的创作空间' },
                      { value: 'dark', label: '深色', description: '适合低光环境' },
                      { value: 'system', label: '跟随系统', description: '随设备外观自动切换' },
                    ] as const
                  ).map((theme) => (
                    <label
                      key={theme.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${draft.theme === theme.value ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-muted'}`}
                    >
                      <input
                        type="radio"
                        name="settings-theme"
                        value={theme.value}
                        checked={draft.theme === theme.value}
                        onChange={() => setDraft({ ...draft, theme: theme.value })}
                        className="mt-1 h-4 w-4 shrink-0 accent-brand"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-content">
                          {theme.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-content-muted">
                          {theme.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-4 py-4 md:px-6">
        <p className="text-xs text-content-muted" aria-live="polite">
          {isDirty ? '有未保存的设置' : '设置已同步'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="ui-button bg-surface-muted text-content hover:bg-surface-raised"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty}
            className="ui-button bg-brand text-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}
