# Sidebar 折叠态 Logo hover 显示展开角标

## Goal

Sidebar 折叠态下 Logo 本身就是"展开"入口，但缺一个显式视觉提示——hover 时只有蓝色 ring，用户不一定知道"点这里能展开"。在折叠态 Logo 右下角叠加一个 hover-only 的 `>` chevron 角标，明确告诉用户这是一个可点击的展开入口。

## What I already know

- 当前折叠态 Logo 实现：`src/components/Sidebar/index.tsx:41-53` — `<button>` 包住 Logo inner（紫色渐变方块），`hover:ring-2 ring-blue-300` 当前唯一视觉提示。
- 展开态：Logo 旁单独有 `<` 折叠按钮（line 172-184），与本任务无关。
- Logo inner 紫色方块尺寸 `h-8 w-8`（32px），button 外加 `p-0.5` padding（即可点击区域约 36×36）。
- 用户指定：折叠态 Logo **hover 时**叠加一个 `>` **角标**（corner badge），不要常驻显示。
- spec 命中点：装饰 SVG 必须 `aria-hidden`、a11y 已由现有 `aria-label="展开 sidebar"` 提供，本任务不增减语义。

## Requirements

- 在 `src/components/Sidebar/index.tsx::Logo` 折叠态分支的 button 内，叠加一个绝对定位的 chevron 角标：
  - **位置**：紫色方块的**右下角**（`absolute -bottom-1 -right-1` 或类似）
  - **形态**：小圆形 badge（直径约 14–16px），白底（dark 模式下深灰底）+ 1px 边框/阴影做"浮起"感，内嵌 `>` 箭头（chevron-right，SVG，10px 大小）
  - **可见性**：默认 `opacity-0`，button hover 时 `group-hover:opacity-100`；用 `transition-opacity duration-150` 做柔和淡入
  - **a11y**：badge 整体加 `aria-hidden="true"`（button 的 `aria-label="展开 sidebar"` 已经表达语义，角标只是视觉装饰）；内部 SVG `focusable="false"`
- 现有 hover ring 视觉是否保留：**保留**（角标只是叠加，不替换 ring；两者一起出现，强化反馈）
- 不改展开态、不改 Logo 文字部分、不动其它布局

## Acceptance Criteria

- [ ] 折叠态下，鼠标移到 Logo 上：紫色方块右下角淡入一个白色（dark: 深色）小圆形 `>` 角标
- [ ] 移开鼠标后角标淡出消失
- [ ] hover 蓝色 ring 仍然保留
- [ ] 展开态 Logo 不出现角标（仅 collapsed 分支渲染）
- [ ] 角标 `aria-hidden="true"`，不污染 screen reader 输出
- [ ] dark 模式下角标对比度合适、可见
- [ ] `npx tsc -b` + `npm test` 通过
- [ ] 浏览器目视：hover/移开过渡顺滑、角标不影响 Logo 主体视觉、移动端抽屉折叠态行为不被破坏

## Definition of Done

- 仅改 `src/components/Sidebar/index.tsx::Logo`（必要时给 button 加 `group` 类启用 group-hover）
- typecheck + 现有单测通过
- 提交消息中文

## Out of Scope

- 不重做折叠态整体交互（不引入 hover 展条等其它形态）
- 不动展开态 `<` 折叠按钮
- 不改 Logo 文字 / 渐变配色 / 图标
- 不改 Sidebar 宽度 / 折叠态布局

## Technical Notes

- 影响文件：`src/components/Sidebar/index.tsx`（仅 `Logo` 函数 collapsed 分支）
- 实现要点：
  - 给 collapsed button 加 `group relative`，给角标加 `absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150`
  - 角标容器：`h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-white/10 flex items-center justify-center`
  - 内嵌 chevron SVG：`<svg className="h-2.5 w-2.5 text-gray-600 dark:text-gray-300" ...><path d="M9 6l6 6-6 6" /></svg>` (chevron-right 24×24 viewBox)
  - `aria-hidden="true"` 加在角标外层 span
- spec 参考：
  - `.trellis/spec/frontend/component-guidelines.md` § Accessibility § 装饰 SVG `aria-hidden="true"`
  - 现有 `aria-label="展开 sidebar"` 已满足 icon-only button a11y 要求
