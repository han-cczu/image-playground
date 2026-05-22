# 底栏一键清空：减少多次手动删除输入的负担

## Goal

底栏 textarea 输入完几十个字符后想换内容，目前只能 Ctrl+A 选中再删除——这条手感差。
加一个清空按钮让用户一键把 prompt（以及可能的参考图）清掉。

## What I already know

### 现状

- **prompt 文字**：`src/components/InputBar/index.tsx:1236-1245` 是纯 textarea 绑定 `prompt` zustand state，旁边只有发送按钮，**没有清空入口**
- **参考图**：已有"清空全部"按钮（`L912 renderClearAllButton`），在缩略图区域条件渲染（仅当 `inputImages.length > 0`），带 `setConfirmDialog` 二次确认
- **mask draft**：与参考图绑定，清空参考图时一并处理
- **`clearInputAfterSubmit` 设置**：提交成功后**自动**清空，但这是被动的，用户当前问题是"还没提交想换 prompt"时也需要清空

### 数据层

- `setPrompt('')` 已存在（store action）
- `clearInputImages()` 已存在
- 都是 zustand actions，调用零副作用，能任意触发

### UI 风格

- 现有"清空参考图"按钮是 52×52 dashed border + 垃圾桶 icon + "清空" 文字
- 现有的 input X 清空按钮模式（Search 框、上传 cancel 等）项目里没见到统一约定

### 截图上下文

- 用户截图箭头指向 textarea 右侧（textarea 与"上传"按钮的交界处）
- 截图里没有上传图片 → 推测主要痛点是 **清空 prompt 文字**

## Assumptions (temporary, to validate)

- A1 MVP 范围：清空 **prompt 文字 + 参考图 + mask draft**（用户一次清光当前未提交状态）
- A2 UX 形态：textarea 内部右侧加 X 按钮（类似浏览器搜索框的清空 X），仅在 `prompt` 非空时显示
- A3 不二次确认（与参考图清空不同；prompt 文字误删成本低，按"现代输入框"约定不弹确认）
- A4 触发后 textarea 立即聚焦，便于用户连续输入

## Open Questions

- [BLOCKING] 清空作用范围：仅 prompt 文字 / prompt + 参考图（参考图已有清空按钮）/ 整个输入区"一键重置"
- [PREFERENCE] UI 位置形态：textarea 内 X 按钮 / textarea 旁独立 icon button / 底栏右侧另加 pill

## Requirements (evolving)

待 Open Questions 确认后填充。已锁定方向：

- R1. 至少能一键清空 prompt 文字
- R2. 清空动作即时生效，无 loading 状态
- R3. 不破坏现有"清空参考图"按钮和 `clearInputAfterSubmit` 自动清空逻辑
- R4. 触发后 textarea 自动聚焦
- R5. 暗色模式样式 + a11y 一致（aria-label / icon-only button 规范）

## Acceptance Criteria (evolving)

- [ ] AC1 textarea 有内容时清空按钮可见，无内容时**不显示**（避免视觉噪音）
- [ ] AC2 点击后 prompt 立即变空、textarea 高度回到 1 行
- [ ] AC3 触发后 textarea 自动聚焦
- [ ] AC4 不影响"清空参考图"原按钮的可见性 / 行为
- [ ] AC5 a11y：icon-only button 必带 aria-label

## Definition of Done

- typecheck / test / build 全绿
- 不引入新依赖
- 暗色模式 + 桌面/移动断点各看一遍
- 不动 store schema（仅复用已有 actions）

## Out of Scope (explicit)

- ❌ 替换/移除现有"清空参考图"按钮（保持独立）
- ❌ 添加"撤销清空"撤回机制（YAGNI；与 `clearInputAfterSubmit` 一样不可撤销）
- ❌ 修改 `clearInputAfterSubmit` 设置行为
- ❌ 重新设计整个 textarea / submit 按钮区域 layout

## Technical Notes

### 候选 UX 形态对比

**A. textarea 内部右侧 X（最现代）**
- absolute 定位 X 按钮到 textarea 容器右上 / 右中
- 仅 `prompt.trim() !== ''` 时显示，淡入
- 缺点：textarea `resize-none` 单行/多行高度变化时 X 位置要跟随；且会"叠"在文字上，长 prompt 时占字符空间

**B. textarea 旁独立 icon button（最稳）**
- 与 submit 按钮同行，左边加个小尺寸（比如 36×36 vs 44×44）的清空按钮，仅文字非空时渲染
- 视觉重量轻于 submit，色调灰
- 缺点：消耗一些行宽空间

**C. 底栏 pill 行右侧加"清空"pill**
- 与现有"优化"、"上传"pill 同行
- 显式可见，发现性高
- 缺点：清空 prompt 是"反向"动作，与其它 pill"配置/增加"的语义不一致；点击空 prompt 时无意义

### 关键文件

- `src/components/InputBar/index.tsx` —— 唯一改动文件
- `src/store.ts` —— 已有 setPrompt / clearInputImages action，不需要改 schema

### 风险

- textarea autosize 路径（`adjustTextareaHeight`）在 setPrompt('') 后是否会自动归位？需要确认（可能需要手动触发）
- 移动端 textarea 内部 X 按钮可能误触虚拟键盘相关行为

## Research References

（清空按钮是常见 UX，无需 trellis-research 调研）
