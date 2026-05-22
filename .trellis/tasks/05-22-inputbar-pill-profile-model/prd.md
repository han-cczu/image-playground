# InputBar 模型 pill：选当前 profile 的可选 model（两段式）

## Goal

把 InputBar 底部"模型 pill"打开的菜单从"切换 profile"升级为"两段式菜单"——上半段列出**当前 active profile 的可选 model**（API 拉取 + 会话内缓存），下半段保留原有"切换 profile"功能。让用户能在不进设置页的情况下，快速把 profile.model 改成 API 真正可用的某个 model。

## What I already know

- 当前实现：`src/components/InputBar/index.tsx::ModelMenu` 只列出已配置的 profiles，点击切 `activeProfileId`。
- 已有 `src/lib/api/listModels.ts::listModels(profile: OpenAIProfile)` 拉取 `GET {baseUrl}/models`，返回去重排序的 model id 数组。**只支持 OpenAI profile**。
- 已在 `src/components/SettingsModal.tsx` 内部使用：`fetchModelList` + `modelList / modelListLoading / modelListError` 三态。可复用同款逻辑，但**不抽公共 hook**（避免本任务扩大范围）。
- Profile 类型：`OpenAIProfile`（带 `apiKey / apiMode / codexCli / apiProxy`）vs `GeminiProfile`（只有 base fields）。
- 用户选择：菜单为两段式；API 拉取在点 pill 时触发，会话内按 profile 缓存（同 profile 后续不重拉）。

## Requirements

### 菜单结构（自上而下）

1. **当前 profile 的可选 model 区**（标题示意："当前 profile 可用模型 · {profile.name}"）
   - 仅当 `activeProfile.provider === 'openai'` 时渲染。
   - 三态：
     - **loading**：显示一行 "正在加载…" + spinner（首次打开 / 缓存未命中时）。
     - **error**：显示错误信息一行（截断到 ~120 字符）+ "重试" 按钮，触发重新拉取。
     - **success**：纵向列出 model id，每项点击后 `setSettings({ profiles: profiles.map(p => p.id === activeProfileId ? { ...p, model } : p) })` 并关闭菜单。
       - 当前 `profile.model` 的项要高亮（蓝底，复用现有 active 样式）。
       - 如果 `profile.model` 不在 API 返回列表里，**把它额外置顶展示**，标注"（当前·不在 API 列表）"，让用户能看到自己当前用的是什么。
   - **Gemini profile**：本区不渲染，改显示一行提示 "Gemini 暂不支持自动拉取模型列表，请在设置中手填 model"。
   - **OpenAI profile 但缺 apiKey**：显示一行 "请先在设置中补全 API Key" + 一个"打开设置"按钮（复用现有底部 "打开设置进行更多配置" 的行为）。

2. **分隔线**

3. **profile 切换区**（保留现有"选择 API 配置" 区块全部能力，复用现有 list 与样式；标题改为 "切换其他配置"）

4. **底部 "打开设置进行更多配置" 按钮**（保留）

### 缓存策略

- 缓存键：`profile.id`（不再区分 apiKey/baseUrl 的细粒度变更——用户改了这些后下次打开就是新 profile id 或继续旧 id 都不影响 MVP；如果出现 stale 体验，加"刷新"按钮逃生即可，见下）。
- 缓存位置：`ModelMenu` 组件 / 上层 InputBar 用 `useRef<Map<profileId, string[]>>` 或独立 `useState`，**不写入 zustand**（避免影响其它消费者）。
- 缓存 invalidation：success 区右上角加一个小 "🔄 刷新" 按钮，点击强制重拉并覆盖缓存。
- 会话刷新即清空（不 persist）。

### 切换行为

- 点 model 项 → 写回 `activeProfile.model` → 关菜单。
- 点其它 profile → 仍 `setActiveProfileId(id)` → 关菜单（保留旧行为）。

### a11y / 样式

- 菜单容器仍是 `role="dialog" aria-modal="true"`，`aria-label` 更新为 "选择当前模型或切换配置"。
- 复用现有 Esc / outside-click / cleanup（已存在）。
- icon-only "刷新" 按钮必须 `aria-label`。
- 装饰 SVG `aria-hidden="true"`。

## Acceptance Criteria

- [ ] OpenAI profile 下，点 pill：菜单上半显示从 API 拉取的 model 列表（loading → success）；点某项后 `profile.model` 更新、pill 文案随之变化、菜单关闭。
- [ ] Gemini profile 下，点 pill：上半段显示"Gemini 暂不支持…"占位，下半段 profile 切换仍能用。
- [ ] OpenAI profile 缺 apiKey 时，上半段显示"请先补 API Key"，点按钮能打开 SettingsModal。
- [ ] API 拉取失败时，显示错误 + "重试"按钮，重试能成功（mock 验证）。
- [ ] 同一 profile 再次打开菜单不重新拉取（缓存命中）；切到其它 profile 再切回，仍命中缓存。
- [ ] 点"🔄 刷新" 强制重拉。
- [ ] `profile.model` 不在 API 列表里时，仍置顶展示并标注"（当前·不在 API 列表）"。
- [ ] 下半段 profile 切换功能与现状完全一致。
- [ ] `tsc -b` + `npm test` 通过。
- [ ] 浏览器目视：菜单视觉风格与原 ModelMenu 一致，dark mode 正常，Esc / outside-click 正常关闭。

## Definition of Done

- 仅改 `src/components/InputBar/index.tsx`（如必要可改类型/工具文件，但需说明）。
- typecheck + 现有单测通过；不要求新增单测（菜单交互纯 UI、依赖网络，按现有约定不强制 RTL 测试）。
- 提交消息中文。

## Out of Scope

- 不抽公共"model list fetcher" hook（SettingsModal 与 InputBar 各自持一份，待两处稳定后再考虑抽象）。
- 不实现 Gemini 的 model 列表拉取（需要不同 API 路径与鉴权，独立任务）。
- 不修改 `listModels` 签名或缓存语义到 lib 层。
- 不持久化缓存（每次刷新页面重拉是合理的）。
- 不重做 InputBar pill 的视觉样式 / 不动其它 pill。
- 不抽 ModelMenu 文件（仍内嵌于 `InputBar/index.tsx`，与现状一致）。

## Technical Notes

- 影响文件主体：`src/components/InputBar/index.tsx`（`ModelMenu` 重写为两段式 + 拉取状态）。
- 复用：`src/lib/api/listModels.ts`、`getActiveApiProfile`、`useStore.setSettings`、`useStore.setShowSettings`。
- 现有 spec 命中：
  - `.trellis/spec/frontend/component-guidelines.md` § "Pattern: Mutually-exclusive popovers via single `openMenu` state"（保持 openMenu 互斥）+ § "Required: drawer / popover Esc + outside-click + cleanup"（已遵守）+ § "icon-only button aria-label"（刷新按钮）。
  - `.trellis/spec/frontend/state-management.md` § "单字段订阅"（不要解构整个 store）。
  - `.trellis/spec/frontend/quality-guidelines.md` § "icon-only button aria-label" / § "drawer & popover Esc + outside-click"。
- 写回 profile.model：
  ```ts
  const nextProfiles = settings.profiles.map((p) =>
    p.id === activeProfileId ? { ...p, model } : p
  )
  setSettings({ profiles: nextProfiles })
  ```
- 状态机内部用 union type：`type ModelListState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success', list: string[] } | { kind: 'error', msg: string }`。
- 缓存：`const cacheRef = useRef<Map<string, string[]>>(new Map())`。
- 切到新 profile 时 `useEffect` 检查 cacheRef，命中则 state 直接到 success，否则触发 fetch。
