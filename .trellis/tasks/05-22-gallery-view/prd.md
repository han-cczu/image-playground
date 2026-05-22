# 图库视图：跨对话查看全部任务

## Goal

引入"图库"视图——一个跨对话的、聚合所有任务的入口。用户在 sidebar 点"图库"，
主区域切换到"全部 task 时间倒序"模式，不再被 activeConversationId 过滤。
解决目前只能逐个对话切换才能找到某次旧生成的痛点。

## What I already know

### 当前对话过滤路径

- `src/App.tsx:38-46` 计算 `tasksInActiveConversation`，把 `activeConversationId` 作为 `filterConversationId` 传给 `filterAndSortTasks`
- `src/components/TaskGrid.tsx:78` 独立订阅 `activeConversationId` 作 `filterConversationId`，自己再过滤一遍
- `src/lib/taskFilters.ts filterAndSortTasks` 接受 `filterConversationId` 参数：传非空就按对话过滤，理论上传 `null/undefined` 就跨对话

### 数据层 / 持久化

- `tasks` 走 IndexedDB（`putTask` / 等）
- `activeConversationId` / `searchQuery` 等 UI 状态在 zustand-persist 中
- 切换 activeConversationId 是已有 action `setActiveConversation`

### Sidebar 结构

- `src/components/Sidebar/index.tsx`：顶部 Logo + "新建对话"按钮 + 对话计数 + 对话列表
- 对话项渲染 `ConversationItem`（图标 + 标题 + 时间 + 任务数）

### 现有的"历史记录"对话

- `src/lib/conversations.ts:3` `ARCHIVE_CONVERSATION_ID = '__archive__'` 是兜底对话，固定 id 不可删
- "历史记录"装的是**升级前未归类的旧 task**（参考 D3 迁移策略），不是"全部 task"
- 图库 ≠ 历史记录：图库是**跨所有对话（含历史记录）**的视图，不替代任何现有对话

## Assumptions (temporary)

- A1 图库 MVP 复用 `TaskGrid` 渲染（不重新设计），关键差异仅在不传 `filterConversationId`
- A2 进入图库时**不清空** `activeConversationId`（保留对话状态，从图库切回某条对话时无需重新选）
- A3 图库视图状态用一个新字段 `galleryView: boolean`（而非用 activeConversationId === null 这种隐含表达），让代码意图明显
- A4 图库视图同样支持搜索 / status / 收藏 / 收藏分类筛选（这些筛选本就独立于对话）

## Open Questions

- ~~入口位置~~ → **已锁定：Sidebar 顶部独立按钮（Logo 下、新建对话上）**
- ~~task 卡片所属对话标签~~ → **已锁定：显示小色块（对话 color）+ 对话名（截断）**，点击可跳到对应对话
- ~~默认排序~~ → **已锁定：task.createdAt 倒序**

## Requirements

- R1 引入 `galleryView: boolean` zustand 字段，走 zustand-persist 持久化
- R2 进入图库：`App.tsx tasksInActiveConversation` memo 当 `galleryView === true` 时**不传 `filterConversationId`**；`TaskGrid` 内部同样判定
- R3 图库视图下 `EmptyState` 文案分支（"还没有任何任务"），不展示原"4 个 pill"装饰
- R4 图库视图仍支持搜索 / status / 收藏 / 收藏分类等横切筛选
- R5 图库 / 对话视图互斥：进入图库不清空 activeConversationId（保留状态），点击对话项/新建对话时 `setGalleryView(false)`
- R6 Sidebar 顶部新增"图库"按钮，位于 Logo 下、"新建对话"按钮上方；折叠态只显示 icon；激活时视觉高亮（与对话项 active 同款 ring/bg）
- R7 task 卡片在图库视图额外渲染"对话标签"：左侧 4px 圆点（取 conversation.color，无 color 用 pickFallbackColor fallback）+ 截断的对话名；hover 显示完整对话名，点击该标签**跳到对应对话视图**（setActiveConversation + setGalleryView(false)）
- R8 排序：图库视图复用 `filterAndSortTasks` 但确保 createdAt 倒序兜底（沿用现有 sort 逻辑，验证跨对话场景下行为正确）

## Acceptance Criteria

- [ ] AC1 Sidebar 顶部"图库"按钮可见、可点击；激活时视觉高亮
- [ ] AC2 点"图库"后主区域显示**全部** task（跨所有对话，含 archive），按 createdAt 倒序
- [ ] AC3 图库视图下点对话项 / 点新建对话 → 退出图库 + 切到该对话
- [ ] AC4 图库视图 EmptyState 文案恰当（不是"开始创作"+ pill，而是"还没有任何任务"之类全局空提示）
- [ ] AC5 图库视图下搜索 / status / 收藏 / 收藏分类筛选仍生效
- [ ] AC6 galleryView 状态持久化：刷新页面后视图保持
- [ ] AC7 旧用户首次打开（持久化无 galleryView 字段）按"对话视图"兜底，不抛错
- [ ] AC8 图库视图下 task 卡片显示"对话标签"（色块 + 对话名）；点该标签跳到对应对话视图
- [ ] AC9 单测覆盖 filterAndSortTasks 在 galleryView=true 时 filterConversationId 被忽略的行为
- [ ] AC10 暗色模式 + 移动端 < md 抽屉行为正常

## Definition of Done

- typecheck / test / build 全绿
- 至少一个单测覆盖"galleryView 状态下 filterConversationId 被忽略"
- 暗色模式 + 移动端 < md 抽屉行为正常
- 不引新依赖

## Out of Scope (explicit)

- ❌ 图库内特殊布局（瀑布流 / masonry / 大缩略图等）—— MVP 复用 TaskGrid 完整体验
- ❌ 图库内"按对话分组"折叠分组——MVP 统一时间倒序
- ❌ 跨对话搜索的特殊优化（搜索引擎全文索引、模糊匹配）——MVP 用现有搜索逻辑
- ❌ 图库批量操作（如批量分类、批量删除）—— 借现有 SelectionActionBar 即可，不专门增强
- ❌ 自动从图库推荐"相似 task"等智能功能

## Technical Notes

### 关键改动点

- `src/types.ts` —— `AppSettings` 或 store state 加 `galleryView: boolean`
- `src/store.ts` —— `setGalleryView(view: boolean)` action；持久化
- `src/App.tsx:38-46` —— `tasksInActiveConversation` memo 接 galleryView：true 时不传 filterConversationId
- `src/App.tsx:54-59` —— `showEmptyState` 判定接 galleryView，文案分支
- `src/components/TaskGrid.tsx:78` —— filterConversationId 改为条件订阅（galleryView 时返回 null）
- `src/components/Sidebar/index.tsx` —— 加图库入口按钮
- `src/components/Sidebar/ConversationItem.tsx` —— **不需要改**（图库不是对话）
- `src/components/EmptyState.tsx` —— 增加 galleryView 文案分支或新建 GalleryEmpty 组件

### 选择对话切换的副作用

进入图库时**不清空** activeConversationId；点击对话项 / 新建对话时 setGalleryView(false)。这样从图库切走时用户的对话状态保持。

### 性能

跨对话查看全部 task：当 task 总数 ~50 时无所谓；上千时 TaskGrid 现有的 render 可能要看是否有虚拟滚动。MVP 不优化，列入未来 follow-up。

## Technical Approach

### 1. store 字段 + action

`src/store.ts`：
```ts
interface State { galleryView: boolean; ... }
interface Actions { setGalleryView: (view: boolean) => void; ... }
// initial state: galleryView: false
// action: setGalleryView 直接 set
// persist 配置：把 galleryView 加入 zustand-persist 白名单（如果是白名单制）
```

### 2. App.tsx 接 galleryView

```tsx
const galleryView = useStore((s) => s.galleryView)

const tasksInActiveConversation = useMemo(() => {
  return filterAndSortTasks(tasks, {
    searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId,
    filterConversationId: galleryView ? undefined : activeConversationId,
  })
}, [tasks, searchQuery, filterStatus, filterFavorite, filterFavoriteCategoryId, activeConversationId, galleryView])

const showEmptyState = /* 现有 + galleryView 时也走全局空，但文案分支 */
```

### 3. TaskGrid 同步

`src/components/TaskGrid.tsx:78` 加 galleryView 订阅，`filterConversationId` 改为条件值。

### 4. EmptyState 文案分支

`src/components/EmptyState.tsx` 增加 `mode?: 'conversation' | 'gallery'` prop，gallery 模式简化文案 + 隐藏 pill。

### 5. Sidebar 图库按钮

`src/components/Sidebar/index.tsx`，Logo 容器下、"新建对话"按钮上插入：

```tsx
<button
  onClick={() => {
    useStore.getState().setGalleryView(true)
    onMobileClose()
  }}
  className={...同款 pill 样式...}
  aria-label="打开图库（全部任务）"
>
  <svg>{/* 图库 icon */}</svg>
  {!sidebarCollapsed && <span>图库</span>}
</button>
```

active 状态：`galleryView === true` 时加 ring/bg 高亮。

### 6. 对话项 / 新建对话 退出图库

`handleSelect` / `handleCreate` 调 `setGalleryView(false)` 后再切对话。

### 7. task 卡片对话标签（图库模式）

`src/components/TaskGrid.tsx` 或 `TaskCard`（取决于结构）增加 `showConversationTag` prop（galleryView 时为 true）。tag 渲染：

```tsx
<button
  onClick={(e) => { e.stopPropagation(); setActiveConversation(task.conversationId); setGalleryView(false) }}
  className="flex items-center gap-1 text-xs ..."
>
  <span className="h-2 w-2 rounded-full" style={{ background: conversationColor }} />
  <span className="truncate max-w-[120px]">{conversationTitle}</span>
</button>
```

需要从 conversations 派生 `conversationById` map 给 TaskGrid 用。

## Decision (ADR-lite)

**Context**: 跨对话查找历史 task 困难，需要"图库"聚合视图。

**Decision**: 引入显式 `galleryView: boolean` 字段（**不**用 `activeConversationId === null` 隐含表达），Sidebar 顶部独立入口（Logo 下、新建对话上），task 卡片附"所属对话"色块标签，默认 createdAt 倒序。

**Consequences**:
- ✅ 状态机清晰：`galleryView` 真值含义明确，未来加更多视图（如"收藏图库"）只需扩字段
- ✅ 不破坏对话隐喻：图库与对话是平级的"视图模式"，与"对话 vs 分类"的纵横正交关系一致
- ✅ 复用 TaskGrid 99% 逻辑，只追加 conversationTag 渲染分支
- ⚠️ task 卡片 UI 多一个标签元素，需要确认在密集列表里视觉不喧宾夺主
- ⚠️ 持久化字段新增需要 zustand-persist migration（旧用户兜底 false）

## Research References

（图库视图是常见 UX 模式，无需 trellis-research 调研）
