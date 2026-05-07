# 设置面板加手动保存按钮

## Goal

把当前设置面板的"自动保存"行为改为"全字段手动保存"。所有字段编辑只更新本地 draft,点击「保存」按钮才一次性写入 store。关闭面板时若有未保存改动,需弹确认对话框。

## What I already know

当前 `src/components/SettingsModal.tsx` 的保存行为(已读全文):

| 字段类型 | 当前保存时机 | 入口函数 |
|---|---|---|
| 文本框(name/baseUrl/apiKey/model) | 失焦 onBlur | `commitActiveProfilePatch` |
| 超时输入 | 失焦 onBlur + 关闭面板时 | `commitTimeout` / `handleClose` |
| 下拉(provider/apiMode) | 变更时立即 | `updateActiveProfile(patch, true)` |
| 开关(codexCli/apiProxy/clearInputAfterSubmit) | 点击时立即 | `commitSettings(...)` 或 `updateActiveProfile(patch, true)` |
| Profile 切换/删除/新建 | 操作时立即 | `commitSettings` 直接调用 |
| 模型列表点击 | 立即 | `commitActiveProfilePatch({ model })` |

核心机制:
- 组件持有 `draft: AppSettings` 本地副本
- 所有编辑先改 draft(`updateActiveProfile(patch, false)`)
- 真正写入 store 的是 `commitSettings(...)`,内部调 `setSettings(normalizedDraft)`
- store 被 zustand `persist` 中间件持久化到 localStorage

也就是说,**「自动保存」目前只意味着自动调 `commitSettings`**。要改成手动,就把所有自动调用断掉,统一收到一个保存按钮上。

## Requirements

- 设置面板底部加「保存」按钮(主色),点击触发 `commitSettings(draft)`
- 改任何字段(文本/开关/下拉/Profile 增删/模型选择)都**只更新 draft**,不立即写入 store
- 关闭面板(X / Esc / 点遮罩)时,若 `draft !== settings`,弹"放弃未保存改动?"确认对话框
- `draft === settings` 时,「保存」按钮置灰且不响应
- 保存成功后显示 toast `"设置已保存"`
- 数据管理区(导入/导出/清空所有数据)仍立即生效——它们直接操作 store/IndexedDB,与 draft 解耦,行为与原来一致

## Acceptance Criteria

- [ ] 面板底部出现「保存」主色按钮
- [ ] 文本框输入 → 关闭面板 → 不写入 store(刷新后仍是旧值)
- [ ] 文本框输入 → 点保存 → 写入 store + 显示 toast
- [ ] 开关/下拉/Profile 操作同上,均只改 draft
- [ ] 有改动时关闭/Esc → 弹确认对话框,确认后丢弃改动
- [ ] 无改动时关闭/Esc → 直接关闭,无确认
- [ ] 「保存」按钮在无改动时灰显
- [ ] tsc 通过
- [ ] 现有测试 43/43 通过

## Definition of Done

- TypeScript 类型检查通过
- 现有 vitest 全部通过
- 手动验证 5 个 happy-path:文本输入保存、文本输入丢弃、开关保存、Profile 增删保存、关闭无改动直接关
- README 无需更新(感知改动,API 不变)

## Technical Approach

1. **draft 已存在**:组件 `useState<AppSettings>(normalizeSettings(settings))` 已经是本地草稿,改动即可
2. **断开自动 commit**:
   - `updateActiveProfile` 第二个参数 `commit` 永远为 false(或干脆删掉这个参数)
   - `commitActiveProfilePatch` 的所有调用方改成只更新 draft
   - 直接调 `commitSettings(...)` 的位置(profile 切换/删除/新建/codexCli/apiProxy/clearInputAfterSubmit toggle)改成更新 draft
3. **加保存按钮**:在面板内合适位置(数据管理区上方或与关闭按钮同行)放一个主色按钮
4. **dirty 检测**:`useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings])`(Settings 数据量小,JSON.stringify 够用,~1ms)
5. **handleClose 改造**:dirty 时通过 `setConfirmDialog` 弹确认,确认后 `setDraft(normalizeSettings(settings))` 重置 + 关闭
6. **Esc / 遮罩点击**:复用 handleClose 即可
7. **保存按钮**:`commitSettings(draft)` + `useStore.getState().showToast('设置已保存', 'success')`
8. **导入后**:仍重新 sync draft(导入直接改 store,draft 应该跟随;现有 `handleImport` 已这样做)
9. **clearAllData**:同上,清空后从 store 重新 sync draft

## Decision (ADR-lite)

**Context**: 当前自动保存让用户对"何时生效"缺乏控制,在文本框还没失焦时其他逻辑可能已经读到旧值;开关/下拉的"立即生效"与文本的"失焦生效"混在一起,行为不一致。

**Decision**: 全字段统一为手动保存,加显式 Save 按钮 + 关闭时未保存确认。

**Consequences**:
- 优点:行为一致、用户控制感强、避免误触发(改一个开关再后悔)
- 缺点:多一步操作;新用户可能忘了点保存就关闭了
- 风险缓解:无改动时不弹确认;dirty 时弹确认对话框,提示"放弃改动?"避免误丢

## Out of Scope

- 「撤销」按钮(用户选了 A 不要 C)
- 自动保存草稿到 localStorage(刷新仍丢)
- 把 draft 模式抽成通用 hook
- 给「保存」按钮加加载态/动画

## Technical Notes

- 唯一改动文件:`src/components/SettingsModal.tsx`(704 行)
- `dismissedCodexCliPrompts` 不属于 settings,不受影响
- `useCloseOnEscape(showSettings, handleClose)` 已经把 Esc 接到 handleClose,改造 handleClose 即可
- 现有遮罩点击 `onClick={handleClose}` 也走同一路径
- 关于 handleClose 中现有的 timeoutInput flush 逻辑:改成手动后,timeoutInput 也得 flush 到 draft(而不是直接 commit)
