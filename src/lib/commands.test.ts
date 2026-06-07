import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCommands, COMMAND_GROUP_ORDER, type CommandCtx, type CommandStore } from './commands'

vi.mock('./exportImport', () => ({
  exportData: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./taskRuntime', () => ({
  cancelAllRunning: vi.fn(() => ({ aborted: 1, skipped: 2 })),
}))

import { exportData } from './exportImport'
import { cancelAllRunning } from './taskRuntime'

function makeStore(overrides: Partial<CommandStore> = {}): CommandStore {
  return {
    galleryView: false,
    setGalleryView: vi.fn(),
    setShowSettings: vi.fn(),
    toggleSidebar: vi.fn(),
    conversations: [],
    activeConversationId: null,
    createConversation: vi.fn(() => 'conv-new'),
    setActiveConversation: vi.fn(),
    settings: {
      theme: 'light',
      profiles: [],
      activeProfileId: '',
    } as unknown as CommandStore['settings'],
    setSettings: vi.fn(),
    prompt: '',
    setPrompt: vi.fn(),
    snippets: [],
    hasRunningTasks: false,
    showToast: vi.fn(),
    ...overrides,
  }
}

function makeCtx(overrides: Partial<CommandStore> = {}): CommandCtx & { store: CommandStore } {
  return { store: makeStore(overrides), close: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildCommands', () => {
  it('produces the static command set when there are no conversations/profiles', () => {
    const commands = buildCommands(makeCtx())
    const ids = commands.map((c) => c.id)
    expect(ids).toEqual([
      'nav:gallery',
      'nav:settings',
      'nav:sidebar',
      'conversation:new',
      'theme:light',
      'theme:dark',
      'theme:system',
      'action:export',
    ])
  })

  it('only uses groups known to the display order', () => {
    const commands = buildCommands(makeCtx())
    for (const c of commands) {
      expect(COMMAND_GROUP_ORDER).toContain(c.group)
    }
  })

  it('creates one switch command per conversation and marks the active one', () => {
    const ctx = makeCtx({
      conversations: [
        { id: 'c1', title: '猫猫实验', createdAt: 1, updatedAt: 1 },
        { id: 'c2', title: '风景', createdAt: 2, updatedAt: 2 },
        { id: '__archive__', title: '历史记录', createdAt: 0, updatedAt: 0 },
      ],
      activeConversationId: 'c2',
    })
    const switches = buildCommands(ctx).filter((c) => c.id.startsWith('conversation:switch:'))
    expect(switches.map((c) => c.title)).toEqual(['切换到：猫猫实验', '切换到：风景', '切换到：历史记录'])
    expect(switches.map((c) => c.active)).toEqual([false, true, false])
  })

  it('creates one provider command per profile and marks the active one', () => {
    const ctx = makeCtx({
      settings: {
        theme: 'light',
        activeProfileId: 'p1',
        profiles: [
          { id: 'p1', name: 'Gemini 主力' },
          { id: 'p2', name: 'OpenAI 备用' },
        ],
      } as unknown as CommandStore['settings'],
    })
    const providers = buildCommands(ctx).filter((c) => c.group === 'provider')
    expect(providers.map((c) => c.title)).toEqual(['Provider：Gemini 主力', 'Provider：OpenAI 备用'])
    expect(providers.map((c) => c.active)).toEqual([true, false])
  })

  it('marks the current theme as active, defaulting to light when unset', () => {
    const dark = buildCommands(makeCtx({
      settings: { theme: 'dark', profiles: [], activeProfileId: '' } as unknown as CommandStore['settings'],
    }))
    expect(dark.find((c) => c.id === 'theme:dark')!.active).toBe(true)
    expect(dark.find((c) => c.id === 'theme:light')!.active).toBe(false)

    const unset = buildCommands(makeCtx({
      settings: { profiles: [], activeProfileId: '' } as unknown as CommandStore['settings'],
    }))
    expect(unset.find((c) => c.id === 'theme:light')!.active).toBe(true)
  })

  it('flips the gallery command title/active with galleryView', () => {
    const closed = buildCommands(makeCtx()).find((c) => c.id === 'nav:gallery')!
    expect(closed.title).toBe('打开图库')
    expect(closed.active).toBe(false)

    const open = buildCommands(makeCtx({ galleryView: true })).find((c) => c.id === 'nav:gallery')!
    expect(open.title).toBe('退出图库')
    expect(open.active).toBe(true)
  })

  describe('run wiring（每条 run 触发对应 action 并 close）', () => {
    it('nav:gallery toggles galleryView', () => {
      const ctx = makeCtx({ galleryView: true })
      buildCommands(ctx).find((c) => c.id === 'nav:gallery')!.run()
      expect(ctx.store.setGalleryView).toHaveBeenCalledWith(false)
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('nav:settings opens settings', () => {
      const ctx = makeCtx()
      buildCommands(ctx).find((c) => c.id === 'nav:settings')!.run()
      expect(ctx.store.setShowSettings).toHaveBeenCalledWith(true)
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('nav:sidebar toggles the sidebar', () => {
      const ctx = makeCtx()
      buildCommands(ctx).find((c) => c.id === 'nav:sidebar')!.run()
      expect(ctx.store.toggleSidebar).toHaveBeenCalledTimes(1)
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('conversation:new creates a conversation and leaves gallery view', () => {
      const ctx = makeCtx({ galleryView: true })
      buildCommands(ctx).find((c) => c.id === 'conversation:new')!.run()
      expect(ctx.store.createConversation).toHaveBeenCalledTimes(1)
      expect(ctx.store.setGalleryView).toHaveBeenCalledWith(false)
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('conversation:switch activates the conversation and leaves gallery view', () => {
      const ctx = makeCtx({
        conversations: [{ id: 'c1', title: 'T', createdAt: 1, updatedAt: 1 }],
        galleryView: true,
      })
      buildCommands(ctx).find((c) => c.id === 'conversation:switch:c1')!.run()
      expect(ctx.store.setActiveConversation).toHaveBeenCalledWith('c1')
      expect(ctx.store.setGalleryView).toHaveBeenCalledWith(false)
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('provider command switches the active profile', () => {
      const ctx = makeCtx({
        settings: {
          theme: 'light',
          activeProfileId: 'p1',
          profiles: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
        } as unknown as CommandStore['settings'],
      })
      buildCommands(ctx).find((c) => c.id === 'provider:p2')!.run()
      expect(ctx.store.setSettings).toHaveBeenCalledWith({ activeProfileId: 'p2' })
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('theme command sets the theme', () => {
      const ctx = makeCtx()
      buildCommands(ctx).find((c) => c.id === 'theme:dark')!.run()
      expect(ctx.store.setSettings).toHaveBeenCalledWith({ theme: 'dark' })
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('snippet command appends content to the prompt (palette has no caret context)', () => {
      const ctx = makeCtx({
        prompt: '一只猫,',
        snippets: [{ id: 'snip-1', name: '光线', content: '{晨光|黄昏}', createdAt: 1, updatedAt: 1, sortOrder: 0 }],
      })
      const cmd = buildCommands(ctx).find((c) => c.id === 'snippet:insert:snip-1')!
      expect(cmd.title).toBe('插入片段：光线')
      expect(cmd.group).toBe('snippet')
      cmd.run()
      expect(ctx.store.setPrompt).toHaveBeenCalledWith('一只猫,{晨光|黄昏}')
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('action:export fires exportData and closes immediately', () => {
      const ctx = makeCtx()
      buildCommands(ctx).find((c) => c.id === 'action:export')!.run()
      expect(exportData).toHaveBeenCalledTimes(1)
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('action:cancel-running appears only with running tasks and reports counts', () => {
      // 无在途任务:命令不出现
      expect(
        buildCommands(makeCtx()).find((c) => c.id === 'action:cancel-running'),
      ).toBeUndefined()

      // 有在途任务:命令出现,run 调 cancelAllRunning 并 toast 细分计数
      const ctx = makeCtx({ hasRunningTasks: true })
      const cmd = buildCommands(ctx).find((c) => c.id === 'action:cancel-running')!
      expect(cmd.group).toBe('action')
      cmd.run()
      expect(cancelAllRunning).toHaveBeenCalledTimes(1)
      expect(ctx.store.showToast).toHaveBeenCalledWith(
        '已取消 3 条:中止 1 条在途、跳过 2 条排队',
        'success',
      )
      expect(ctx.close).toHaveBeenCalledTimes(1)
    })
  })
})
