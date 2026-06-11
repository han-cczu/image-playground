import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { normalizeSettings } from '../../../lib/api/apiProfiles'
import type { AppSettings } from '../../../types'

/** 某一组配置在 AppSettings 中的切片视图 */
export interface ProfileSlice<P> {
  profiles: P[]
  activeId: string
}

export interface NamedProfileManagerOptions<P extends { id: string }> {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  /** 从 settings 取出本组 profiles 与激活 id(updateActive 时对 prev 重新取,保证连续输入不丢更新) */
  select: (settings: AppSettings) => ProfileSlice<P>
  /** 把新的 profiles / 激活 id 写回 settings 对应字段 */
  patch: (profiles: P[], activeId: string) => Partial<AppSettings>
  /** 新建配置的工厂(调用方负责 id 前缀与默认名「新配置」) */
  createProfile: () => P
  /** profiles 为空时的最终兜底解析(仅 API 配置需要,等价原 getActiveApiProfile 兜底) */
  resolveFallback?: (settings: AppSettings) => P
}

export interface NamedProfileManager<P extends { id: string }> {
  /** 当前激活 profile(优先匹配激活 id,缺失退到第一项,再退到 resolveFallback) */
  active: P
  showMenu: boolean
  setShowMenu: Dispatch<SetStateAction<boolean>>
  /** 函数式 setDraft 局部更新激活 profile,不过 normalizeSettings(与原实现一致) */
  updateActive: (patch: Partial<P>) => void
  create: () => void
  switchTo: (id: string) => void
  remove: (id: string) => void
}

/**
 * API / 提示词优化器 / 图说器三套「命名配置组」的共享管理逻辑:
 * 激活 profile 解析 + 更新 / 新建 / 切换 / 删除 + 下拉菜单开关状态。
 */
export function useNamedProfileManager<P extends { id: string }>(
  options: NamedProfileManagerOptions<P>,
): NamedProfileManager<P> {
  const { draft, setDraft, select, patch, createProfile, resolveFallback } = options
  const [showMenu, setShowMenu] = useState(false)

  const { profiles, activeId } = select(draft)
  const resolved = profiles.find((profile) => profile.id === activeId) ?? profiles[0]
  // resolveFallback 仅在 profiles 为空时惰性求值(与原 ?? 链一致)
  const active = resolved ?? (resolveFallback ? resolveFallback(draft) : resolved)

  const updateActive = (patchValue: Partial<P>) => {
    setDraft((prev) => {
      const slice = select(prev)
      return {
        ...prev,
        ...patch(
          slice.profiles.map((profile) =>
            profile.id === active.id ? { ...profile, ...patchValue } : profile,
          ),
          slice.activeId,
        ),
      }
    })
  }

  const create = () => {
    const profile = createProfile()
    setDraft(
      normalizeSettings({
        ...draft,
        ...patch([...profiles, profile], profile.id),
      }),
    )
    setShowMenu(false)
  }

  const switchTo = (id: string) => {
    setDraft(normalizeSettings({ ...draft, ...patch(profiles, id) }))
    setShowMenu(false)
  }

  // 删除不关闭下拉菜单(与原实现一致);仅剩一个配置时禁止删除
  const remove = (id: string) => {
    if (profiles.length <= 1) return
    const nextProfiles = profiles.filter((item) => item.id !== id)
    setDraft(
      normalizeSettings({
        ...draft,
        ...patch(nextProfiles, activeId === id ? nextProfiles[0].id : activeId),
      }),
    )
  }

  return { active, showMenu, setShowMenu, updateActive, create, switchTo, remove }
}
