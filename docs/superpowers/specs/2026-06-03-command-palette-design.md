# 命令面板(Ctrl/⌘+K)设计

- 日期：2026-06-03
- 状态：待评审
- 范围：新增一个键盘驱动的命令面板,`Ctrl/⌘+K` 打开,模糊搜索后快速执行常用操作(切对话 / 切 Provider / 切主题 / 开图库 / 开设置 / 新建对话 / 导出等)。功能已多,给一个统一入口。

## 1. 背景与目标

应用现有能力分散在多处:sidebar(对话/图库/设置)、Header(主题)、底栏 pill(模型/风格/网格…)、设置面板(profile)。重度使用者频繁在对话、profile、主题间切换,鼠标路径长。

**目标**:`Ctrl/⌘+K` 唤出命令面板,输入关键词模糊匹配,↑↓ 选择、Enter 执行、Esc 关闭。命令直接映射到既有 store action,几乎零业务新增。

## 2. 现状盘点

- **无全局键盘快捷键**:`App.tsx` 仅监听 `dragstart`(防图片拖拽),`Ctrl+K` 无冲突;textarea / 各组件未绑定 `Ctrl+K`。
- **可映射的 store action(均已存在)**:
  - 导航/视图:`setGalleryView`、`toggleSidebar`、`setActiveConversation`(配合 `conversations` 列表)、`setShowSettings`、`setShowPromptOptimizer`
  - 创建:`createConversation`
  - Provider:`setSettings({ activeProfileId })`(配合 `settings.profiles`)
  - 主题:`setSettings({ theme: 'light' | 'dark' | 'system' })`
  - 导出:`exportData`(store re-export)
- **可复用面板基建**:`useFocusTrap` / `useCloseOnEscape` / `useLockBodyScroll`(`src/hooks/`),与 SettingsModal/DetailModal 同款;Select/Toast 等视觉。
- **UI 状态模式**:`ui` slice 用 `showSettings` 等布尔 + setter;命令面板新增同款 `showCommandPalette`。

## 3. 采用方案

**命令注册表(数据驱动)+ 单一面板组件 + 全局快捷键。** 命令是「标题 + 分组 + 关键词 + `run()`」的数据,由一个工厂 `buildCommands(ctx)` 从当前 store 快照生成(含动态命令:每个对话、每个 profile 各一条)。面板只负责「过滤 + 渲染 + 键盘导航 + 执行」。

不引第三方(命令面板库 / fuzzy 库):模糊匹配自写轻量子序列算法(纯函数、可测);面板复用现有 hooks。

## 4. 详细设计

### 4.1 模糊匹配(新建 `src/lib/fuzzyMatch.ts`,纯函数)

```ts
/** 子序列模糊匹配:query 的字符按序出现在 text 中即命中。返回得分(越大越好)+ 命中下标;不命中返回 null。 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null
```
- 大小写不敏感;空 query 命中所有(score 0)。
- 评分偏好:连续命中、词首命中加权(便于「nc」匹配「**N**ew **C**onversation / 新建对话」需配 keywords)。
- `indices` 供高亮(可选渲染)。
- 中文标题:中文无「首字母」概念,靠 `keywords` 补英文/拼音别名(如 `'新建对话'` 配 `keywords: 'new conversation xinjian'`)。

### 4.2 命令注册表(新建 `src/lib/commands.ts`)

```ts
export type CommandGroup = 'navigation' | 'action' | 'theme' | 'provider' | 'conversation'

export interface Command {
  id: string
  title: string
  group: CommandGroup
  keywords?: string
  /** 是否当前可用(false 时不进候选);省略=可用 */
  enabled?: boolean
  /** 命中标记(如当前主题/当前 profile),UI 显示勾 */
  active?: boolean
  run: () => void
}

export interface CommandCtx {
  store: AppState           // useStore.getState()
  close: () => void         // 执行后关闭面板
}

/** 从当前 store 快照生成全部命令(含动态对话/profile 命令)。 */
export function buildCommands(ctx: CommandCtx): Command[]
```

命令清单(MVP):
- **navigation**:打开/退出图库(`setGalleryView`,`active` 反映当前)、打开设置(`setShowSettings(true)`)、折叠/展开侧栏(`toggleSidebar`)
- **conversation**:新建对话(`createConversation`)+ 每个非 archive 对话一条「切换到：<标题>」(`setActiveConversation(id)` + `setGalleryView(false)`,`active`=当前对话)
- **provider**:每个 profile 一条「Provider：<名称>」(`setSettings({ activeProfileId })`,`active`=当前)
- **theme**:浅色 / 深色 / 跟随系统(`setSettings({ theme })`,`active`=当前)
- **action**:导出数据 ZIP(`exportData()`)

每条 `run` 内先执行 action 再 `ctx.close()`。`exportData` 等异步用 `void`。

### 4.3 UI 状态(`src/store/slices/ui.ts`)

新增 `showCommandPalette: boolean` + `setShowCommandPalette(v)`,与 `showSettings` 同款。不进 `partialize`(瞬态)。

### 4.4 面板组件(新建 `src/components/CommandPalette.tsx`)

- `showCommandPalette` 为 false 时返回 null。
- 顶部输入框(自动 focus)+ 下方分组命令列表。
- 本地 `query` state;`commands = useMemo(buildCommands(...))`(依赖 store 相关切片);`filtered = commands.filter(c => c.enabled !== false).map(c => ({c, m: fuzzyMatch(query, c.title + ' ' + (c.keywords??'))})).filter(m).sort(by score)`。
- 键盘:↑↓ 移动高亮(`activeIndex`)、Enter 执行高亮项的 `run`、Esc 关闭。复用 `useFocusTrap`(panelRef)、`useCloseOnEscape`、`useLockBodyScroll`。
- 鼠标:hover 设高亮、点击执行。
- 分组标题(导航/对话/Provider/主题/操作);`active` 项右侧显示勾。
- 空结果占位「无匹配命令」。
- 样式沿用暗色光晕 + 圆角弹层(对齐 SettingsModal/StylePickerPopover 的 `bg-white/95 ... backdrop-blur-xl`),居中靠上(类 Spotlight)。

### 4.5 全局快捷键 + 挂载(`src/App.tsx`)

- `useEffect` 挂 `keydown`:`(e.ctrlKey || e.metaKey) && e.key === 'k'` → `e.preventDefault()` + `setShowCommandPalette(true)`(再次按下可 toggle 关闭)。不拦截 textarea 内其它键。
- 在 modal 区渲染 `<CommandPalette />`(与其它 modal 并列,`ErrorBoundary region="modal"`)。
- 移动端入口(可选,MVP 可不做):Header 放一个搜索图标按钮调 `setShowCommandPalette(true)`,复用同面板。

## 5. 边界与错误处理

- **动态命令响应式**:`buildCommands` 在组件内基于 `useStore` 订阅的切片重算(对话/profile 变化即刷新),不快照一次了事。
- **archive 对话**:「切换到」命令包含 archive(「历史记录」),但不提供「重命名/删除 archive」命令(那些 action 本就拒绝 archive)。
- **导出等异步命令**:`run` 内 `void exportData().catch(...)`,失败走既有 toast。
- **与现有快捷键避让**:仅 `Ctrl/⌘+K`;面板内 ↑↓/Enter/Esc 在面板 focus 时生效,不影响全局。
- **面板打开时**:`useLockBodyScroll` 锁滚动;Esc 关闭(`useCloseOnEscape`)。
- **命令过多**:profile/对话多时列表长 → 靠模糊搜索收敛 + 列表区 `max-h` 滚动。

## 6. 测试计划

- `fuzzyMatch.test.ts`(纯函数):子序列命中/不命中、大小写不敏感、空 query 全命中、连续/词首加权排序、indices 正确。
- `commands.test.ts`:`buildCommands` 给定 store 快照产出预期命令(对话/profile 动态条数、`active` 标记、`enabled`、`run` 调用正确 action —— 用 mock ctx 验证 run 触发对应 setter)。
- 端到端(Playwright):`Ctrl+K` 打开 → 输入「深色」→ Enter → 主题切换;输入对话名 → 切换;Esc 关闭。
- `tsc` / `eslint` / `vitest` 全绿。

## 7. 非目标(本期)

- 不做模型切换命令(模型列表需异步从 API 拉,`useModelList`,复杂度高 → 后续)。
- 不做命令历史/最近使用排序、不做自定义快捷键绑定。
- 不做「提交生成 / 优化 / 反推」等依赖输入态的命令(语义重,易误触发)。
- 不做拼音全量索引(仅靠手填 `keywords` 英文别名)。
- 移动端入口图标可延后(面板本身桌面优先)。

## 8. 落地顺序

1. `lib/fuzzyMatch.ts` + 测试(纯函数,零风险先行)。
2. `lib/commands.ts` `buildCommands` + 测试。
3. `ui` slice 加 `showCommandPalette`。
4. `CommandPalette.tsx`(输入 + 过滤 + 键盘导航 + 分组渲染)。
5. `App.tsx` 全局 `Ctrl/⌘+K` + 挂载。
6. （可选）Header 移动端入口。
