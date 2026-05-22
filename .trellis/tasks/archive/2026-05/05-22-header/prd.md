# Header 移除历史、删除与设置按钮

## Goal

移除 Header 右上区域三个冗余/占位按钮，让顶栏只保留真正独占且即时可用的入口，减少噪音和误触风险。

## What I already know

- `src/components/Header.tsx:144-155` 历史按钮（🕐 时钟图标）：`onClick={placeholderClick}`，点击仅 `showToast('该功能即将推出', 'info')`，是占位无功能。
- `src/components/Header.tsx:157-170` 删除当前对话按钮（🗑 垃圾桶）：调 `deleteConversationWithTasks(activeConversation.id)`，但 Sidebar 每条对话条目已经挂了相同 action（`src/components/Sidebar/index.tsx:197`），功能重复且无二次确认，放在顶栏容易误触。
- `src/components/Header.tsx:172-198` 设置按钮（⚙️）：调 `setShowSettings(true)`，但 Sidebar 底部已存在等价入口（`src/components/Sidebar/index.tsx:206-211`），重复。
- 用户已确认："都去掉"，包括设置按钮。
- 删完后右上仅剩 ☀️ 主题切换。

## Requirements

- 删除 Header 右上的"历史"按钮（含其 SVG 和 `placeholderClick` 处理函数；该函数若再无引用一并清理）。
- 删除 Header 右上的"删除当前对话"按钮（含按钮 JSX、`handleDeleteActiveConversation`、`canDeleteActiveConversation`、`activeConversation` 派生值等）。
- 删除 Header 右上的"设置"按钮（含按钮 JSX 与对应 store 选择器引用）。
- 保留：☀️ 主题切换、移动端 hamburger、左侧模型/对话信息。
- 删除后清理不再使用的 import / store 选择器（候选：`ARCHIVE_CONVERSATION_ID`、`deleteConversationWithTasks`、`conversations`、`activeConversationId`、`showToast`、`setShowSettings`——以最终代码引用为准）。
- Sidebar 底部"设置"入口 (`src/components/Sidebar/index.tsx:206-211`) 必须保持可用；不要在本任务里改 Sidebar。

## Acceptance Criteria

- [ ] Header 右上仅剩 1 个按钮：☀️ 主题切换（桌面端 & 移动端一致）。
- [ ] 历史按钮 + 删除当前对话按钮 + 设置按钮 的 JSX、handler、派生状态全部从 `Header.tsx` 移除。
- [ ] `Header.tsx` 中不再保留任何不被使用的 import / 变量（TypeScript / lint 不报 unused）。
- [ ] Sidebar 底部"设置"按钮仍可正常打开设置弹窗；Sidebar 逐条对话删除入口行为未变。
- [ ] `npm run lint` / `npm run typecheck`（或对应脚本）通过。
- [ ] 浏览器中实际打开页面，确认顶栏右上仅剩主题图标；点击 Sidebar "设置"能正常弹出 SettingsModal；Sidebar 删除对话仍工作。

## Definition of Done

- 代码改动只限于 `src/components/Header.tsx`（如需调整其它文件，应在 PRD 中先说明原因）。
- Lint + typecheck 通过。
- 手动验证顶栏视觉与 Sidebar 删除行为。
- 提交消息使用中文。

## Out of Scope

- 不对 Sidebar 的删除入口加二次确认（独立改进，另起任务）。
- 不实现"历史"功能本身。
- 不调整顶栏其它元素的布局或样式（保持现状）。
- 不重构 store action。

## Technical Notes

- 影响文件：`src/components/Header.tsx`（唯一）。
- 需核对的 import / 选择器是否仍被使用：`ARCHIVE_CONVERSATION_ID`、`deleteConversationWithTasks`、`conversations`、`activeConversationId`、`showToast`、`setShowSettings`、`placeholderClick`、`getActiveApiProfile`（后者仍用于左侧模型/模式 chip，应保留）。
- Sidebar 删除入口：`src/components/Sidebar/index.tsx:197`，保持不动。
- Sidebar 设置入口：`src/components/Sidebar/index.tsx:206-211`，保持不动。
