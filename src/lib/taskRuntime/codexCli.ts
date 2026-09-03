/**
 * Codex CLI 兼容模式的检测提示(taskRuntime 拆分轮,见 shared.ts 头注释)。
 */
import type { AppSettings } from '../../types'
import { useStore } from '../../store'
import { getActiveApiProfile } from '../api/apiProfiles'
import { DISMISSED_CODEX_CLI_PROMPT_KEY_PREFIX } from '../../store/persist'

/**
 * 「已忽略 Codex CLI 提示」的记录键。按 profile.id + baseUrl 而不是 baseUrl + apiKey:
 * 这条记录会随 zustand-persist 落进 localStorage,旧格式等于把密钥明文长期留在盘上(改 key、删 profile
 * 都不会清);而「是否 Codex CLI」由接口来源决定,与密钥无关,同一端点换 key 也不该重新弹。
 * profile.id 由 apiProfiles 归一化保证唯一且稳定。带版本前缀以便恢复时识别并丢弃旧格式条目。
 */
export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${DISMISSED_CODEX_CLI_PROMPT_KEY_PREFIX}${profile.id}\n${profile.baseUrl}`
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return
  // 任务完成的异步回调里弹出:用户可能正对着「删除对话 / 批量删除」的确认框,setConfirmDialog 会把它顶掉。
  // 非用户手势路径遇到已有弹窗就让位——promptKey 未 dismiss,下一次成功仍会再提示,不丢机会。
  if (!force && state.confirmDialog) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}
