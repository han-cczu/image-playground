# Bulk Move Favorites Across Categories

## Goal

让用户在多选模式下，能把"已收藏在 A 分类"的多条记录批量挪到另一分类，而不必先批量取消再批量收藏。是上一个 `custom-favorite-categories` 任务的最后一公里 UX 闭环。

## Requirements

- 已收藏多选状态下，收藏槽位用 `FavoriteCategoryMenu` 渲染（**实心**黄星 trigger），单击弹出菜单。
- 菜单顶部新增一个红色"取消收藏"项，点击触发现有 `handleClearFavorite` 流程。
- 菜单下方照常列出分类、`+ 新建分类`。
- 复用现有 store action（`setTaskFavoriteCategory` / `clearTaskFavorite`），不引入新 action。
- toolbar 不增宽、不改其他槽位。

## Acceptance Criteria

- [ ] 选中 N 条已收藏（可分布在不同分类）：从 toolbar 点星 → 选目标分类 X → 弹确认对话框 → 确认后 N 条 `favoriteCategoryId` 全部更新为 X，`isFavorite=true` 不变。
- [ ] 选中 N 条已收藏：从 toolbar 点星 → 选菜单顶部"取消收藏"→ 弹确认对话框 → 确认后 N 条 `isFavorite=false` 且 `favoriteCategoryId=null`。
- [ ] 选中全部已在目标分类 X 时，挪类操作短路（不弹对话框、不写库）—— 复用 `handleSetFavoriteCategory` 中已有的 `allInTarget` 短路。
- [ ] 未收藏多选时，收藏槽 UI 行为不变（外框黄星 + 分类菜单，无"取消收藏"项）。
- [ ] 桌面 + 移动宽度下 toolbar 仍是单行圆角胶囊，不溢出。
- [ ] `npm run build` 与 `npm test` 通过；现有 favorite category 相关测试继续 green。

## Definition of Done

- 改动文件：`SelectionActionBar.tsx` + `FavoriteCategoryMenu.tsx`，不超出此范围。
- spec 更新：`FavoriteCategoryMenu` 新增 `includeClearFavorite` / `onClearFavorite` props，在 `frontend/component-guidelines.md` 或 `frontend/state-management.md` 任一处简注（trellis-check / update-spec 阶段决定）。
- 移除上一个 prd 已无关的 UX Options / Open Questions 章节。

## Technical Approach

- **`FavoriteCategoryMenu.tsx`** 扩展 props：
  ```ts
  includeClearFavorite?: boolean
  clearFavoriteLabel?: string  // 默认"取消收藏"
  onClearFavorite?: () => void
  ```
  当 `includeClearFavorite && onClearFavorite` 同时存在时，菜单顶部条件渲染一个红色项（`text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10`），下方分隔线后跟现有 `includeAll` / `includeUnassigned` / 分类列表 / 新建分类。
  点击触发 `onClearFavorite()` 并关闭菜单（不调用 `onSelect`，语义分离）。

- **`SelectionActionBar.tsx`**：
  - 删除 `allSelectedFavorite ? <ClearStarButton /> : <FavoriteCategoryMenu />` 的二选一分支。
  - 统一渲染 `<FavoriteCategoryMenu>`，trigger 的 `fill` 由 `allSelectedFavorite` 控制（`fill="currentColor"` vs `fill="none"`）。
  - 已收藏多选时给菜单传 `includeClearFavorite onClearFavorite={handleClearFavorite}`；未收藏多选时不传。
  - 选目标分类的回调仍是 `handleSetFavoriteCategory`，复用其 `allInTarget` 短路。

## Decision (ADR-lite)

**Context**: 已收藏多选状态下，原 UI 把收藏槽用作"单按钮直接取消"，挪类只能"先取消再收藏"，与 store 层已经支持的批量挪类能力不匹配。

**Decision**: 采用 Option A（二合一菜单）—— 已收藏多选时也用 `FavoriteCategoryMenu`，菜单顶部加红色"取消收藏"项。

**Consequences**:
- 优点：toolbar 不增宽；和未收藏多选的入口结构对齐；批量挪类的高频路径只要两步（点星 → 选分类）。
- 代价：已收藏多选下，单击星不再直接清，多一步（点星 → 选"取消收藏"）；与 TaskCard 单卡片"已收藏点星直接清"的行为不对称。后者本轮不动，作为可能的 follow-up。

## Out of Scope (explicit)

- TaskCard 单卡片"已收藏点星"行为变更。
- DetailModal 中分类编辑 UI 变更。
- 批量挪类失败时的聚合 toast（沿用现有 per-task error via `updateTaskInStore`）。
- 跨任务的"分类合并 / 拆分"。

## Technical Notes

- `src/components/InputBar/SelectionActionBar.tsx:79-143` 为改动主战场。
- `src/components/FavoriteCategoryMenu.tsx:215-263` 是菜单 body 渲染段，"取消收藏"项插入到 `includeAll` / `includeUnassigned` 之前。
- store 层 `setTaskFavoriteCategory` / `clearTaskFavorite` 不动；`handleSetFavoriteCategory` 的 `allInTarget` 短路在上一个任务已修正，本任务直接复用。
- spec `frontend/state-management.md` 中"Favorite category contracts"已覆盖批量操作语义；本任务的 UI 改动不破坏，但 `FavoriteCategoryMenu` 新 props 可在 component-guidelines 备一笔。
