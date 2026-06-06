import type { AppState } from '../store'
import { exportData } from './exportImport'

/** 命令分组（也是面板里的展示顺序） */
export type CommandGroup = 'navigation' | 'conversation' | 'snippet' | 'provider' | 'theme' | 'action'

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  'navigation',
  'conversation',
  'snippet',
  'provider',
  'theme',
  'action',
]

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  navigation: '导航',
  conversation: '对话',
  snippet: '片段',
  provider: 'Provider',
  theme: '主题',
  action: '操作',
}

export interface Command {
  id: string
  title: string
  group: CommandGroup
  /** 模糊匹配的补充别名（英文/拼音），中文标题无「首字母」概念靠它兜底 */
  keywords?: string
  /** 是否当前可用（false 时不进候选）；省略=可用 */
  enabled?: boolean
  /** 命中标记（如当前主题/当前 profile），UI 显示勾 */
  active?: boolean
  run: () => void
}

/**
 * buildCommands 需要的 store 切片（useStore.getState() 即满足）。
 * 收窄到实际用到的字段，单测无需构造完整 AppState。
 */
export type CommandStore = Pick<
  AppState,
  | 'galleryView'
  | 'setGalleryView'
  | 'setShowSettings'
  | 'toggleSidebar'
  | 'conversations'
  | 'activeConversationId'
  | 'createConversation'
  | 'setActiveConversation'
  | 'settings'
  | 'setSettings'
  | 'prompt'
  | 'setPrompt'
  | 'snippets'
>

export interface CommandCtx {
  store: CommandStore
  /** 执行命令后关闭面板 */
  close: () => void
}

const THEME_OPTIONS: Array<{ value: 'light' | 'dark' | 'system'; title: string; keywords: string }> = [
  { value: 'light', title: '主题：浅色', keywords: 'theme light qianse liangse' },
  { value: 'dark', title: '主题：深色', keywords: 'theme dark shense anse' },
  { value: 'system', title: '主题：跟随系统', keywords: 'theme system auto follow xitong gensui' },
]

/**
 * 从当前 store 快照生成全部命令（含动态对话/profile 命令）。
 * 每条 run 内先执行 action 再 close；本函数为纯映射，需在组件内随 store 订阅重算以保持响应式。
 */
export function buildCommands(ctx: CommandCtx): Command[] {
  const { store, close } = ctx
  const commands: Command[] = []

  // ----- navigation -----
  commands.push({
    id: 'nav:gallery',
    title: store.galleryView ? '退出图库' : '打开图库',
    group: 'navigation',
    keywords: 'gallery images tuku tupianku',
    active: store.galleryView,
    run: () => {
      store.setGalleryView(!store.galleryView)
      close()
    },
  })
  commands.push({
    id: 'nav:settings',
    title: '打开设置',
    group: 'navigation',
    keywords: 'settings preferences config shezhi',
    run: () => {
      store.setShowSettings(true)
      close()
    },
  })
  commands.push({
    id: 'nav:sidebar',
    title: '折叠/展开侧栏',
    group: 'navigation',
    keywords: 'sidebar toggle collapse cebianlan celan',
    run: () => {
      store.toggleSidebar()
      close()
    },
  })

  // ----- conversation -----
  commands.push({
    id: 'conversation:new',
    title: '新建对话',
    group: 'conversation',
    keywords: 'new conversation create xinjian duihua',
    run: () => {
      store.createConversation()
      store.setGalleryView(false)
      close()
    },
  })
  for (const conversation of store.conversations) {
    commands.push({
      id: `conversation:switch:${conversation.id}`,
      title: `切换到：${conversation.title}`,
      group: 'conversation',
      keywords: 'switch conversation goto qiehuan duihua',
      active: conversation.id === store.activeConversationId,
      run: () => {
        store.setActiveConversation(conversation.id)
        store.setGalleryView(false)
        close()
      },
    })
  }

  // ----- snippet -----
  // 面板打开时 textarea 光标态不可得 → append 语义(光标处插入走底栏「片段」pill)
  for (const snippet of store.snippets) {
    commands.push({
      id: `snippet:insert:${snippet.id}`,
      title: `插入片段：${snippet.name}`,
      group: 'snippet',
      keywords: 'snippet insert prompt pianduan charu',
      run: () => {
        store.setPrompt(store.prompt + snippet.content)
        close()
      },
    })
  }

  // ----- provider -----
  for (const profile of store.settings.profiles) {
    commands.push({
      id: `provider:${profile.id}`,
      title: `Provider：${profile.name}`,
      group: 'provider',
      keywords: 'provider profile api switch qiehuan',
      active: profile.id === store.settings.activeProfileId,
      run: () => {
        store.setSettings({ activeProfileId: profile.id })
        close()
      },
    })
  }

  // ----- theme -----
  for (const option of THEME_OPTIONS) {
    commands.push({
      id: `theme:${option.value}`,
      title: option.title,
      group: 'theme',
      keywords: option.keywords,
      active: (store.settings.theme ?? 'light') === option.value,
      run: () => {
        store.setSettings({ theme: option.value })
        close()
      },
    })
  }

  // ----- action -----
  commands.push({
    id: 'action:export',
    title: '导出数据 ZIP',
    group: 'action',
    keywords: 'export zip backup download daochu beifen',
    run: () => {
      // exportData 内部自带 try/catch + toast，这里只需 fire-and-forget
      void exportData()
      close()
    },
  })

  return commands
}
