# 新建收藏分类支持选颜色

## Goal

在 `FavoriteCategoryMenu` 的"新建分类"输入区追加颜色选择（8 色预设色板），让用户创建分类时能指定颜色，而不是固定使用 `DEFAULT_FAVORITE_CATEGORY_COLOR`（橙色 `#f59e0b`）。

## What I already know

- 数据层已完备：`FavoriteCategory.color: string`，`FAVORITE_CATEGORY_COLORS` 是 8 色预设数组（橙/青/蓝/红/紫/绿/粉/灰）
- store action 已支持：`createFavoriteCategory({ name, color? }: { name: string; color?: string })`（`src/store.ts:327`），不传 color 时落到默认值
- 现状 UI：`FavoriteCategoryMenu.tsx:243-277` 的 `isCreating` 分支只有一个名字 input + 确认按钮，没有色板
- 已选交互形式：**预设色板**（不引入 HEX 输入 / 原生 color picker）
- 列表项展示颜色的样式参考：`<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />`（`FavoriteCategoryMenu.tsx:235`）

## Requirements

1. 点击"新建分类"按钮进入创建态时，输入框上方/下方展示 8 色预设色板，每色一个圆点按钮
2. 进入创建态时**按现有分类数轮转选默认色**：`FAVORITE_CATEGORY_COLORS[favoriteCategories.length % 8]`，让新分类倾向于和已有分类换色，减少撞色
3. 点击色板圆点切换当前选中颜色，选中态有明确视觉标识（如 ring 高亮 / 加粗边框）
4. 确认创建时把选中的 color 传给 `createFavoriteCategory({ name, color })`
5. 取消创建（Esc / 关闭菜单）时重置选中状态到第一个颜色

## Acceptance Criteria

- [ ] 新建分类时色板可见，8 个圆点按钮等宽排列
- [ ] 进入创建态时默认选中色 = `FAVORITE_CATEGORY_COLORS[favoriteCategories.length % 8]`，并有明显选中态
- [ ] 点击其他色板圆点能切换选中色
- [ ] 确认创建后，新分类列表项显示的小圆点颜色 = 用户所选
- [ ] Esc 关闭后再次打开，选中色重置为"按数量轮转"的当前默认色
- [ ] 不传 name 时仍走原"未命名分类"兜底逻辑，颜色仍按所选生效
- [ ] 列表里编辑已有分类的颜色 **不在本任务范围**（out of scope）

## Definition of Done

- 编辑 `src/components/FavoriteCategoryMenu.tsx` 完成 UI 改动
- Lint / typecheck 通过
- 浏览器手动验证：新建 → 选不同颜色 → 列表小圆点颜色正确

## Out of Scope

- 编辑已有分类的颜色（这是 update 流程，不是 create）
- 自定义 HEX 输入
- 原生 `<input type="color">`
- 色板顺序 / 颜色集本身的调整

## Technical Approach

在 `FavoriteCategoryMenu.tsx`：

1. 新增 `draftColor` state，初始化 / 重置时取 `FAVORITE_CATEGORY_COLORS[favoriteCategories.length % FAVORITE_CATEGORY_COLORS.length]`（注意用 store 里的真实数组长度，而非组件内 `categories` memo —— 后者可能含 `includeDefaultFallback` 注入的虚拟项）
2. `isCreating` 输入区从单行（input + 按钮）改为两行：上方 8 个圆点色板按钮，下方 input + 确认按钮
3. 圆点按钮：`h-5 w-5 rounded-full`，未选中用 1px 透明 ring，选中用 `ring-2 ring-offset-2 ring-blue-500`（或类似强视觉差）
4. `createCategory()` 调用改为 `createFavoriteCategory({ name, color: draftColor })`
5. `useEffect` 关闭菜单时一并重置 `draftColor`

## Decision (ADR-lite)

- **Context**: 用户希望新建分类时能选颜色，避免全部新分类挤在一个默认色上
- **Decision**: 用预设 8 色色板，不引入 HEX / 原生 picker；UI 改动局限在 `FavoriteCategoryMenu.tsx`
- **Consequences**: 颜色集受限于预设；将来若需扩展可直接改 `FAVORITE_CATEGORY_COLORS` 数组，UI 自适应

## Technical Notes

- 相关文件：
  - `src/components/FavoriteCategoryMenu.tsx`（唯一改动点）
  - `src/lib/favoriteCategories.ts`（只读：色板常量来源）
  - `src/store.ts:327`（只读：createFavoriteCategory 已支持 color）
- 复用列表项现有的 `rounded-full + style={{ backgroundColor }}` 模式
