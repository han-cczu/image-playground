import { useStore } from '../../store'
import type { AppState } from '../../store'

/**
 * 新手引导自动触发:仅真·新用户首跑弹一次。
 * 判定抽成纯函数可单测;maybeStartTour 由 App 在 initStore() resolve 后调用
 * (tasks 走 IDB 异步,老用户判定必须等数据就位)。
 */

export type AutoStartVerdict = 'start' | 'exempt' | 'none'

type AutoStartState = Pick<
  AppState,
  'hasSeenTour' | 'settings' | 'tasks' | 'confirmDialog' | 'showSettings' | 'showCommandPalette'
>

export function shouldAutoStartTour(state: AutoStartState): AutoStartVerdict {
  if (state.hasSeenTour) return 'none'
  // 老用户豁免:任一 profile 配过 key(顶层 apiKey 只镜像 active profile,会漏判)或已有任务。
  // URL 分享链(#apiKey)在 initStore 前写入 key → 同样豁免,属预期(被引导而来的用户有人带)。
  const isVeteran =
    state.settings.profiles.some((p) => p.apiKey.trim() !== '') || state.tasks.length > 0
  if (isVeteran) return 'exempt'
  // 弹窗互斥:确认框/设置/命令面板打开时不抢屏(纯新用户首屏一般不会撞上,兜底)
  if (state.confirmDialog || state.showSettings || state.showCommandPalette) return 'none'
  return 'start'
}

// 模块级 once 守卫:StrictMode 双挂载会让 App 的 effect 跑两次。
// 注意现行 initStore() 自身并无 inflight 守卫(双调用是既有的正交问题),这里不依赖它。
let tourBootChecked = false

/** 仅测试用:vitest 同 worker 多用例共享模块实例,once 标记会跨用例残留 */
export function resetTourAutoStartForTest(): void {
  tourBootChecked = false
}

export function maybeStartTour(): void {
  if (tourBootChecked) return
  tourBootChecked = true
  const state = useStore.getState()
  switch (shouldAutoStartTour(state)) {
    case 'exempt':
      // 静默豁免:置已看标记,避免之后每次启动都重复评估
      state.setHasSeenTour(true)
      return
    case 'start':
      state.setTourStep(0)
      state.setTourActive(true)
      return
    case 'none':
      return
  }
}
