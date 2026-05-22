# EmptyState 香蕉 emoji 换成 OpenAI logo

## Goal

把主区域空状态（`src/components/EmptyState.tsx`）头部那颗居中的大号 🍌 emoji 换成 OpenAI 官方花瓣 logo（inline SVG），并稍微放大尺寸以匹配"品牌图标"的视觉权重。其余文案、pill 区域、布局保持不变。

## What I already know

- 当前实现：`src/components/EmptyState.tsx:50-52` 渲染 `<div className="mb-4 text-6xl" aria-hidden="true">🍌</div>`，`text-6xl` ≈ 60px。
- 用户偏好：使用 **OpenAI 官方 logo 的内联 SVG**，尺寸**稍放大到 ~80–96px**。
- 视觉风格：当前 EmptyState 与 `IkunImage` 同款（emoji + 标题 + 描述 + 4 个特性 pill）。
- 配色与暗色模式：当前页面已有 `dark:` 适配，OpenAI logo 必须用 `currentColor` 才能继承 `text-gray-*` 在亮/暗两套主题下都可见。
- spec：`.trellis/spec/frontend/component-guidelines.md` 已明确"装饰性 SVG 必须 `aria-hidden="true"` + `focusable="false"`"。

## Requirements

- 在 `src/components/EmptyState.tsx` 移除 🍌 emoji，替换为 inline 的 OpenAI 官方花瓣 logo SVG。
- SVG 用 `fill="currentColor"`，让父元素 `text-gray-*` / `dark:text-gray-*` 控制颜色，保证亮/暗模式都清晰可见。
- 颜色采用与原"低饱和装饰"近似的中性灰：亮色 `text-gray-800`、暗色 `dark:text-gray-100`（强度与原 emoji 视觉权重接近，但作为品牌符号略偏深，给焦点）。
- 尺寸：约 88px（`h-22 w-22`，即 `h-[88px] w-[88px]`，Tailwind 不在原生表里所以用任意值）；外层间距保持 `mb-4`。
- a11y：SVG 加 `aria-hidden="true"` + `focusable="false"`（装饰性 — 标题"开始创作"已提供语义）。
- 不改：文案"开始创作 / 在下方输入提示词…"、4 个 feature pill、整体居中布局、`data-no-drag-select` 容器约束。
- 不改 EmptyState 之外的任何文件。

## Acceptance Criteria

- [ ] `EmptyState.tsx` 不再含 `🍌` 字符。
- [ ] 顶部渲染 OpenAI 官方花瓣 logo SVG，尺寸 ≈ 88px。
- [ ] SVG 使用 `currentColor`，亮色模式呈深灰、暗色模式呈浅灰，与原页面色系协调。
- [ ] SVG 带 `aria-hidden="true"` + `focusable="false"`。
- [ ] 标题、描述、4 个 pill、布局、`data-no-drag-select` 等其余结构完全不变。
- [ ] `tsc -b` / `npm test` 通过。
- [ ] 浏览器中实际打开「空状态」页面（清空当前对话或新建无任务对话），目视确认 logo 居中、清晰、亮/暗模式都正常。

## Definition of Done

- 仅改动 `src/components/EmptyState.tsx`。
- typecheck + 现有单测通过。
- 提交消息使用中文。

## Out of Scope

- 不引入外部图片资源（PNG / SVG 文件），坚持 inline SVG。
- 不动 favicon / loading 等其它带 emoji 的位置（如 Sidebar 折叠态首字符场景由 `Array.from(title)[0]` 处理，无关）。
- 不调整 EmptyState 文案 / pill 列表 / 颜色主题。
- 不替换其它地方的 emoji 使用。

## Technical Notes

- 影响文件：`src/components/EmptyState.tsx`（唯一）。
- OpenAI logo SVG path（24×24 viewBox，标准官方花瓣形状）：可直接 inline，无版权风险（属于品牌通用 logo，用于展示"使用 OpenAI 模型"语义合规）。
- 颜色策略：`<svg fill="currentColor">` + 父 `<div className="... text-gray-800 dark:text-gray-100">`，避免硬编码 `#000`。
- 参考 spec：
  - `.trellis/spec/frontend/component-guidelines.md` § Accessibility § "emoji / 装饰 SVG 要 `aria-hidden=\"true\"`"
  - `.trellis/spec/frontend/component-guidelines.md` § icon-only button a11y（本任务不是 button，但 SVG 装饰规则同源）
