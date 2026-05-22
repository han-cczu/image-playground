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

- ~~[BLOCKING] 清空作用范围~~ → **已锁定：两个都加 —— 仅清 prompt X + 重置全部 pill**
- ~~[PREFERENCE] UI 位置形态~~ → **已锁定：X 走 textarea 内部右上角 absolute；重置走底栏 pill 行右侧**

## Requirements

- R1. textarea 内右上角 `absolute` X 按钮，仅 `prompt.trim() !== ''` 时渲染
- R2. X 按钮点击：`setPrompt('')` + 触发 textarea autosize 归 1 行 + `textareaRef.current?.focus()`，**无确认弹窗**
- R3. 底栏 pill 行最右侧（设置按钮 group 之前）加"重置"pill，与现有 pill 视觉同款
- R4. 重置 pill 点击 → `setConfirmDialog`（信息含本次会清掉的内容），确认后调用 `setPrompt('') + clearInputImages() + 清 mask draft`
- R5. 重置 pill `disabled` 灰色：当 prompt 为空 + 参考图 0 张 + 无 mask draft 时
- R6. 两个按钮都带 `aria-label`
- R7. 不破坏现有"清空参考图"按钮（renderClearAllButton）与 `clearInputAfterSubmit` 自动清空逻辑

## Acceptance Criteria

- [ ] AC1 textarea 有文字 → 右上角出现 X；删空 → X 消失
- [ ] AC2 点 X → prompt 立即空、textarea 回到 1 行高度、textarea 重新聚焦、**无弹窗**
- [ ] AC3 底栏出现"重置"pill；无任何输入（prompt 空 + 0 图 + 无 mask）时 disable 灰色
- [ ] AC4 点重置 pill → 弹确认框（信息明确"将清空文字、N 张参考图、X 个遮罩，确认？"）→ 确认后全清
- [ ] AC5 "清空参考图"按钮 renderClearAllButton 行为不变
- [ ] AC6 暗色模式 + 移动端 < md 断点都正常
- [ ] AC7 a11y：两个按钮都有 aria-label

## Technical Approach

### 1. textarea 内部 X 按钮（`src/components/InputBar/index.tsx:1234-1245` 附近）

- 把 textarea 用 `<div className="relative flex-1">` 包起来
- 内部 `<button>` `absolute right-2 top-2`，仅 `prompt.trim().length > 0` 时渲染
- icon：14×14 X SVG，灰色 + hover 蓝/红
- onClick：
  ```ts
  setPrompt('')
  // 触发 autosize 归位
  requestAnimationFrame(() => adjustTextareaHeight())
  textareaRef.current?.focus()
  ```
- aria-label="清空输入"

### 2. 底栏"重置"pill（pill 行右侧）

- 找到 pill 行渲染处（screenshot 显示 5 个 pill：模型 / 风格 / 比例 / 分辨率 / 优化），右边是"上传"按钮 + 设置按钮
- 在设置按钮 group 之前插入新 pill
- 视觉与现有 pill 一致（`PILL_BASE` className）但 hover 色调走"危险"红色（与现有 renderClearAllButton 一致：`hover:bg-red-50/50 hover:text-red-500`）
- onClick：
  ```ts
  setConfirmDialog({
    title: '重置全部输入',
    message: `将清空文字${promptLen ? `（${promptLen} 字符）` : ''}` +
             `、${inputImages.length} 张参考图${maskDraft ? '、1 个遮罩' : ''}。继续？`,
    action: () => {
      setPrompt('')
      clearInputImages()
      // 清 mask draft
    },
  })
  ```
- disabled 条件：`prompt.trim() === '' && inputImages.length === 0 && !maskDraft`

### 3. 复用 store actions

- `setPrompt(value)` ✓ 已存在
- `clearInputImages()` ✓ 已存在
- `setMaskDraft(null)` 或 `clearMaskDraft()` —— 看 store 现有 API 名

不动 store schema、不加新 action。

## Decision (ADR-lite)

**Context**: 输入框删字符繁琐，已有"清空参考图"按钮但只覆盖图，不覆盖文字；本任务补 prompt 清空入口。

**Decision**: 两个独立入口 —— **textarea 内 X 处理高频低风险（文字）+ 底栏"重置" pill 处理低频高风险（全清）**。前者无确认，后者必确认；以 disable 状态 + 不同色调让用户感知风险级别。

**Consequences**:
- ✅ 高频路径 1 步、低频路径 2 步（确认），符合"误操作成本与确认强度成正比"原则
- ✅ 不动现有 renderClearAllButton（专管参考图，与重置 pill 互补，不冲突）
- ⚠️ pill 行多一个按钮，移动端横向空间已紧，需要确认 < md 断点不溢出

## Out of Scope (explicit)

- ❌ 撤销清空 / undo stack
- ❌ Ctrl+L 等键盘快捷键
- ❌ 修改 `clearInputAfterSubmit` 自动清空行为
- ❌ 替换/移除现有 renderClearAllButton（保持独立）
- ❌ 重新设计 textarea / submit 按钮区域 layout

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
