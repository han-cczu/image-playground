# UI 改造：IkunImage 风格 + 引入对话概念

## Goal

模仿截图 IkunImage 的 UI 形态，把 image-playground 从「单页 grid + 底栏」改造为「左 sidebar 对话列表 + 主区域单对话视图 + 底栏」的结构。
顶层引入 **Conversation** 作为新的组织单位，每条 Task 归属于某个 Conversation。
现有 TaskGrid 不丢功能，迁到右侧/抽屉作为「对话内生成结果」的承载。

## What I already know

- 当前结构（`src/App.tsx:84-103`）：`<Header /> + <main>{SearchBar, TaskGrid}</main> + <InputBar />` + 一堆模态。
- 持久化分两层：
  - zustand-persist key=`image-playground`（`src/store.ts:434-446`），只存 settings / favoriteCategories / params / prompt / inputImages(id) / dismissedCodexCliPrompts。
  - **tasks 走 IndexedDB**（`src/lib/db.ts`、`putTask`），通过 `initStore` 加载（`src/lib/taskRuntime.ts`）。
- `TaskRecord`（`src/types.ts:106-146`）字段成熟，包含 favoriteCategoryId、sortOrder、isFavorite 等，但**没有** conversationId 字段。
- `InputBar/` 现有功能远比截图丰富：ParamRow 含 quality / output_format / moderation / n 等；SelectionActionBar 是多选批量操作。
- Header 当前只有「主题切换 + 设置」；截图有 4 个图标（暗色 / 历史 / 删除 / 设置）。
- 截图的 4 个特性 pill（10 种宽高比 / 1K-2K-4K / 8 种风格 / AI 提示词优化）：宽高比与 1K-2K-4K 对应 `params.size`；「8 种风格预设」当前**没有**；「AI 提示词优化」对应已有 `PromptOptimizerModal`。
- 收藏分类（`favoriteCategories`）是已有的「分组」概念，与「对话」语义不同但实现可类比。
- 项目支持 PWA + Service Worker（`public/sw.js`），有移动端入口（viewport-fit=cover、apple-mobile-web-app-*）。

## Assumptions (temporary, to validate)

- A1 移动端不展示常驻 sidebar，改用顶部「对话切换」按钮 + 抽屉。
- A2 每次"新建对话"会创建一个空 Conversation，提交的 task 自动归属到当前 active conversation。
- A3 历史已有的 task（旧数据）一次性迁移到一个名为「历史记录」或「默认对话」的 Conversation。
- A4 Conversation 数据存 IndexedDB（与 tasks 同层），不进 zustand-persist。
- A5 删除 Conversation 时，其下 task 全部删除（与 IkunImage 行为一致），但要二次确认。
- A6 截图「8 种风格预设」属于增量功能，先占位（pill 仅装饰），不在本任务实现。

## Decisions

- **D1 MVP 范围 = MVP-A 完整版**：多对话 CRUD + IndexedDB 升级迁移 + 桌面 sidebar + 移动抽屉 + 空状态 + 底栏重构 + Header 4 图标。
- **D2 底栏参数策略 = 只暴露截图 5 项 + 高级弹出**：默认底栏暴露 模型 / 风格 / 比例 / 分辨率 / 优化 + 上传 + 输入；其他（quality / output_format / output_compression / moderation / n / codexCli 等）收到一个「高级参数」弹出面板（点击底栏一个齿轮按钮触发）。注意：「风格」当前 store 没有对应字段，pill 只显示「无风格」，业务实现仍 out of scope（沿 D6）。
- **D3 迁移策略 = 按 favoriteCategory 切分**：每个 favoriteCategory → 一个 Conversation（title 复用分类 name，附带 color 作 sidebar 色条）；未收藏 task → 「历史记录」conversation。**favoriteCategory 实体保留**，作为 task 上的横切标签字段，迁移后仍可用（但 sidebar 不再以分类组织，sidebar 是 conversation）。
- **D4 桌面 sidebar = 可折叠为窄条（仅图标）**：默认展开；折叠态保留 Logo / 新建对话 / 列表项的图标（图标用对话标题首字符或 favoriteCategory 颜色圆点）。状态写入 zustand-persist。
- **D5 对话标题策略 = 首条 prompt 截断**：新对话未提交时显示「新对话」；首条 task 提交后，取 prompt 前 N 字（拟定 24）写入 title；用户可手动重命名（双击或菜单项）。
- **D6 右下角悬浮按钮 = 不实现**（out of scope）。

## Requirements (evolving)

- R1 引入 `Conversation` 实体，包含 id、title、createdAt、updatedAt、taskCount 等。
- R2 左侧（桌面端）常驻 sidebar，含 Logo + 新建对话 + 对话计数 + 列表项（标题 + 相对时间）。
- R3 主区域：顶栏（当前模型 + 模式徽标 + 右上动作）+ 内容区（空状态 / TaskGrid）+ 底栏（参数 + 输入）。
- R4 空状态：emoji + 标题 + 描述 + 4 个特性 pill。
- R5 持久化兼容：旧版用户打开后无数据丢失，旧 task 全部可见。
- R6 移动端 sidebar 折叠为抽屉（具体形态待 Q2/Q5 答完确认）。

## Acceptance Criteria (evolving)

- [ ] AC1 旧版用户首次打开：每个 favoriteCategory 都成为一个 Conversation，title=分类 name；未收藏 task 进入「历史记录」对话；所有 task 在迁移后均有 conversationId，且原 favoriteCategoryId 字段保留。
- [ ] AC2 桌面端 sidebar 在 ≥ md 断点常驻；点击列表项切换对话，主区域只显示该对话的 task；折叠态只显示图标且仍可切换。
- [ ] AC3 新建对话 → 自动激活 → 主区域显示空状态；输入并提交后，新 task 归属该对话；首条 prompt 提交后对话 title 自动改为 prompt 前 24 字。
- [ ] AC4 删除对话二次确认；删除后其下 task 全部从 IndexedDB + zustand 删除；「历史记录」对话不可删除（兜底）。
- [ ] AC5 移动端 < md 断点 sidebar 折叠为抽屉，靠左上 hamburger 打开；抽屉打开时主区域加遮罩；不影响输入与提交。
- [ ] AC6 视觉与截图整体接近：Logo + 副标题（IkunImage 副本可改为「Image Playground」品牌）、新建对话按钮、列表项样式（标题 + 相对时间）、底栏 5 个 pill 风格、空状态 emoji + 标题 + 描述 + 4 pill。
- [ ] AC7 底栏「高级参数」弹出能完整设置 quality / output_format / output_compression / moderation / n；不在弹出里的参数保持现有默认；提交时所有参数仍参与请求。
- [ ] AC8 sidebar 折叠/展开状态、activeConversationId 持久化（zustand-persist 或同等机制）；刷新后状态保留。

## Definition of Done

- 单元测试覆盖：Conversation CRUD、task 归属切换、数据迁移函数。
- `npm run test` / typecheck / build 全绿。
- 旧持久化数据手测可加载（IndexedDB 不破坏）。
- 移动端 viewport 至少 360px 宽度无横向滚动。
- 必要时更新 `.trellis/spec/frontend/` 的相关 spec。

## Out of Scope (explicit)

- ❌ 「8 种风格预设」业务实现（pill 仅装饰；底栏「风格」选择器仅显示「无风格」占位）。
- ❌ 跨对话搜索（搜索默认只搜当前对话）。
- ❌ 对话导出/导入（沿用现有全量导出格式，导出包内携带 conversations 数组即可）。
- ❌ Conversation AI 自动命名。
- ❌ 右下角悬浮按钮（D6）。
- ❌ 多 tab 同步 activeConversationId 的实时广播（StorageEvent / BroadcastChannel）。

## Technical Notes

- 关键文件：
  - `src/App.tsx`：根布局（要插 sidebar 槽位）。
  - `src/store.ts`：新增 conversations / activeConversationId / 对话 CRUD action。
  - `src/types.ts`：新增 `Conversation` 接口，`TaskRecord` 增 `conversationId?: string`。
  - `src/lib/db.ts`：新增 conversations object store + 迁移逻辑（旧 task 注入 conversationId）。
  - `src/lib/taskFilters.ts`：增加按 conversationId 过滤。
  - `src/lib/taskRuntime.ts`：`submitTask` 写入当前 activeConversationId。
  - `src/components/`：新建 `Sidebar/`、改 `Header`、改 `TaskGrid`（按 conversation 过滤）、可能拆 `EmptyState`。
- 持久化迁移：IndexedDB 升级（`db.ts` 中的 `version`）→ 创建 conversations store → onupgradeneeded 时遍历 tasks，全部分配到「默认对话」。
- 风险：
  - 数据迁移失败会导致旧 task 不可见 → 必须有回滚或保底（迁移失败时仍按"无 conversationId"展示在默认对话里）。
  - 移动端布局复杂，断点和抽屉过渡需要仔细测试。
- 现有的 `favoriteCategories` 不要被混淆为 conversation，二者并存（分类是横切，对话是纵切）。

## Research References

(待补：若 Q5 决定简化底栏到 5 个参数，需研究 IkunImage 类产品的参数收纳方式 — 但目前先按用户偏好走，不强制 research-first。)
