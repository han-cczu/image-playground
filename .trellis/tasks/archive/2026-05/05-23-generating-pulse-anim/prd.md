# 补完 task 生成时的脉冲边框动画

## Goal

`TaskCard.tsx:226` running 状态卡片挂着 className `generating`，但项目里 grep
不到任何 CSS 规则把它绑定到 `src/index.css:84-87` 已定义的 `pulse-border` keyframe。
结果"卡片边框脉冲闪烁"的设计意图没落实——线上只看到 spinner + 静态蓝色边框。
本任务给 `.generating` class 加一条 CSS 规则把 keyframe 绑上，让动画真正生效。

## What I already know

### 现状（Q&A 阶段已确认）

- `src/components/TaskCard.tsx:226` running 状态 className 含 `generating`，但项目无 .generating 规则
- `src/index.css:84-87` 已定义 `@keyframes pulse-border`：
  ```css
  @keyframes pulse-border {
    0%, 100% { border-color: #3b82f6; }   /* 蓝 */
    50%      { border-color: #93c5fd; }   /* 浅蓝 */
  }
  ```
- 同卡片的 `animate-spin` spinner + 运行时计时器都已正常工作，本任务只补"边框脉冲"这一层
- 卡片本身已有 `border-blue-400` 静态色 + `transition-[box-shadow,border-color,background-color,transform]`——脉冲动画会接管 border-color

### 设计意图溯源

`generating` className 名 + `pulse-border` keyframe 名 + keyframe 颜色（blue-500 ↔ blue-300）三者命名高度一致，明确就是给"running task 卡片边框闪蓝色"用的，只是绑定 CSS 规则没写。

## Assumptions (temporary)

- A1 动画只作用于 task 卡片 running 态，不影响其他用到蓝色边框的元素
- A2 动画速度 1.5s `ease-in-out` infinite——比 spinner 略慢，二者节奏不冲突，目视柔和
- A3 暗色模式沿用现有 keyframe 颜色（蓝色在明暗主题下都可见，不需要 dark: 变体）

## Open Questions

- [PREFERENCE] 动画速度：1.5s（推荐，柔和）/ 1s（更明显）/ 2s（更柔和但接近静态）

## Requirements (evolving)

- R1 `src/index.css` 新增一条 `.generating` 规则，绑定 `pulse-border` keyframe
- R2 不动 `@keyframes pulse-border` 本身（颜色已合理）
- R3 不动 `TaskCard.tsx`（className 已经在了）
- R4 不引入新依赖、不改其他文件

## Acceptance Criteria

- [ ] AC1 生成中的卡片边框颜色在蓝（#3b82f6）和浅蓝（#93c5fd）之间循环闪烁
- [ ] AC2 完成后（task.status 离开 running）class `generating` 被移除，动画停止，边框回到静态色
- [ ] AC3 与已有 `animate-spin` spinner 同屏不冲突 / 不闪屏
- [ ] AC4 暗色模式下脉冲可见且不刺眼
- [ ] AC5 typecheck / build 通过（无 CSS lint 报错）

## Definition of Done

- typecheck / `npm test` / `npm run build` 全绿
- 手动跑一次生成任务，肉眼确认边框确实在闪
- 不引新依赖、不动除 index.css 外的文件

## Out of Scope

- ❌ 不改 keyframe 颜色（命名约定保留，与现有蓝色 brand 一致）
- ❌ 不加 spinner / 计时器的其他装饰
- ❌ 不做"已完成 task 闪一下成功色"等额外反馈
- ❌ 不动 task 卡片整体 layout

## Technical Approach

`src/index.css:87` 之后追加：

```css
.generating {
  animation: pulse-border 1.5s ease-in-out infinite;
}
```

注意：`.generating` 与 `border-blue-400` 共存——keyframe 的 `border-color` 会被
浏览器视为 animation 控制下的属性，每帧覆盖 utility class 的静态色；动画结束
（class 被 React 移除）后边框瞬间回到 `border-blue-400` 之外的状态（实际上 task
完成后 className 改用 `border-gray-200` 等，不存在残留）。

## Decision (ADR-lite)

**Context**: Q&A 中发现 `.generating` 是死 className，`pulse-border` keyframe
是死 keyframe，两者从未连接。

**Decision**: 加一条 3 行 CSS 规则把它们接上。不重命名、不调颜色、不改 keyframe。
保持现有命名约定的"设计意图考古"价值。

**Consequences**:
- ✅ 生成中卡片视觉反馈更立体（边框闪 + spinner 转 + 计时器递增 三层节奏）
- ✅ 修复死代码意图
- ⚠️ 动画对低端设备（移动端 webview）有轻微 GPU 负担——但 border-color 属性比
  transform 更轻，几乎不可察觉

## Research References

（CSS keyframe 接 class 是标准模式，无需 trellis-research 调研）
