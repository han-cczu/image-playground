# 高级参数图标改 Sliders Horizontal —— 消除与侧边栏"设置"的撞图

## Goal

InputBar 的"高级参数"按钮当前用的是 lucide gear/cog SVG，和侧边栏底部"设置"按钮**完全相同的图标**，造成语义冲突。改用 `sliders-horizontal` 图标，更直观表达"参数调节"含义，并与"设置"语义区分开。

## What I already know

- 高级参数按钮：`src/components/InputBar/index.tsx:1423-1448`，注释 `{/* 高级参数齿轮 */}` 也要一并改
- 侧边栏设置按钮：`src/components/Sidebar/index.tsx:286-305`，用同款 gear SVG
- 两处 SVG path 内容相同（lucide cog：`circle cx=12 cy=12 r=3` + 齿轮路径）
- 项目内 icon 全部 inline 写法，无 icon 库依赖
- 现有按钮属性：`className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"`

## Requirements

1. 把 `src/components/InputBar/index.tsx:1437-1440` 的齿轮 SVG path 替换为 lucide `sliders-horizontal` 的 9 条 line
2. 顺手更新 line 1423 的中文注释 `{/* 高级参数齿轮 */}` → `{/* 高级参数 */}`，避免注释和实现脱节
3. 保持外层 `<button>` 所有属性不变：`aria-label="高级参数"`、`title="高级参数（quality / format / 数量 等）"`、ring-1 active 态等
4. 保持 `<svg>` 容器属性不变：`className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"`
5. 侧边栏的"设置"按钮**不动**（语义本身就是 settings，齿轮合适）

## Acceptance Criteria

- [ ] InputBar 高级参数按钮渲染为三条水平调节条 + 6 个调节柄的 sliders 图标
- [ ] 与侧边栏"设置"按钮视觉上完全可区分，不再撞图
- [ ] 按钮悬停 / active ring / dark mode 样式保持不变
- [ ] aria-label / title 文案保持不变
- [ ] 注释更新为不带"齿轮"字样
- [ ] 侧边栏"设置"按钮图标无任何改动

## Definition of Done

- 编辑 `src/components/InputBar/index.tsx` 完成 SVG path 替换
- `npx tsc -b` 通过
- `npx vitest run` 通过
- 浏览器手动验证：底栏图标视觉变化 + 与设置图标对比

## Technical Approach

替换 SVG path 内容。Lucide `sliders-horizontal` 的 9 条 line：

```jsx
<line x1="21" x2="14" y1="4" y2="4" />
<line x1="10" x2="3" y1="4" y2="4" />
<line x1="21" x2="12" y1="12" y2="12" />
<line x1="8" x2="3" y1="12" y2="12" />
<line x1="21" x2="16" y1="20" y2="20" />
<line x1="12" x2="3" y1="20" y2="20" />
<line x1="14" x2="14" y1="2" y2="6" />
<line x1="8" x2="8" y1="10" y2="14" />
<line x1="16" x2="16" y1="18" y2="22" />
```

## Decision (ADR-lite)

- **Context**: 高级参数按钮和侧边栏设置按钮共用 lucide-cog，语义混淆
- **Decision**: 用 lucide `sliders-horizontal` 替换 InputBar 侧的图标；侧边栏设置保留齿轮
- **Consequences**: 视觉语义清晰，"齿轮=应用设置"、"sliders=参数调节"的常规心智模型成立。无运行时影响，纯视觉改动

## Out of Scope

- 重写为 icon component / 引入 lucide-react 等 icon 库
- 调整侧边栏"设置"按钮图标
- 调整其他按钮图标
- 调整按钮尺寸 / 形状 / 配色

## Technical Notes

- 唯一改动文件：`src/components/InputBar/index.tsx`
- 改动范围：line 1423 注释 + line 1437-1440 SVG path
- 参考：lucide-icons `sliders-horizontal`（https://lucide.dev/icons/sliders-horizontal）
- 项目无 icon 库依赖，inline SVG 是既有约定
