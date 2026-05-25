# 提示词优化器多配置（multi-profile）设计

- 日期：2026-05-25
- 状态：待评审
- 范围：让「提示词优化 API」从单一配置升级为「多个可切换的命名配置」，与图像生成 API 的 profile 体验一致。

## 1. 背景与目标

图像生成 API 已有完整的多配置系统：`AppSettings.profiles: ApiProfile[]` + `activeProfileId`，通过 `ProfileSelector` 下拉新建 / 切换 / 删除，每个配置可选 OpenAI / Gemini 服务商类型。

提示词优化器目前只是**单个**配置 `AppSettings.promptOptimizer: PromptOptimizerConfig`，固定走 OpenAI 兼容 chat completions，在 `OptimizerSection` 内联编辑，无法保存/切换多套。

**目标**：给优化器也加一套多配置系统——多个命名配置可切换。

**明确不做**：优化器配置仍只有一种服务商类型（OpenAI 兼容 chat completions）。**不**为优化器引入 Gemini / 服务商类型选择（与图像 API 不同；这是用户已确认的范围边界）。

## 2. 现状盘点

- 类型：`PromptOptimizerConfig { baseUrl, apiKey, model, timeout, systemPrompt }`（`src/types.ts`）。
- 归一化：`normalizePromptOptimizer` / `createDefaultPromptOptimizer` / `DEFAULT_OPTIMIZER_*`（`src/lib/api/apiProfiles.ts`）；`normalizeSettings` 内 `promptOptimizer: normalizePromptOptimizer(record.promptOptimizer)`。
- UI：`OptimizerSection`（编辑单配置，含模型列表下拉、timeout、systemPrompt）；在 `SettingsModal/index.tsx` 的「提示词优化 API」`<section>` 中渲染，timeout 输入框 `optimizerTimeoutInput` 在 index.tsx 做 dirty 检测。
- 消费方（**仅两处**，都只读 `settings.promptOptimizer`）：
  - `PromptOptimizerModal.tsx`：执行优化调用。
  - `InputBar/index.tsx:94`：`optimizerKeyConfigured = Boolean(settings.promptOptimizer.apiKey.trim())`，控制优化按钮可用性。
- 无 URL 查询参数 bootstrap 路径涉及优化器（`urlBootstrap.ts` 不含 optimizer）。
- 导入导出：`redactSettingsForExport` 清空 `promptOptimizer.apiKey`；`mergeImportedSettings` 目前只合并图像 profiles，不涉及优化器。

## 3. 采用方案

**平行的多配置系统，`promptOptimizer` 字段保留为「当前激活优化器配置」的派生镜像。**

理由：完全复刻图像 API 既有的「flat 镜像字段 + profiles[]」模式 → **两个消费方零改动**，import/export 与现有测试依赖的 `promptOptimizer` 字段继续存在。风险最低、与既有架构同构。

（已否决：方案 B「彻底用 profiles 取代镜像字段、消费方改用 helper」churn 大收益小；方案 C「抽象图像与优化器共享的 profile 机制」会动到正在工作的图像代码，按 YAGNI 否决。）

选择器：**新建独立的 `OptimizerProfileSelector` 组件**，不复用 / 不改动图像的 `ProfileSelector`（后者带 OpenAI/Gemini 服务商徽标，优化器无服务商概念）。

## 4. 详细设计

### 4.1 数据模型（`src/types.ts`）

```ts
export interface PromptOptimizerProfile extends PromptOptimizerConfig {
  id: string
  name: string
}
```

`AppSettings` 新增两个字段，并保留 `promptOptimizer` 作为镜像：

```ts
export interface AppSettings {
  // ...既有字段...
  promptOptimizer: PromptOptimizerConfig          // 派生镜像 = 当前激活的优化器配置
  optimizerProfiles: PromptOptimizerProfile[]      // 新增
  activeOptimizerProfileId: string                 // 新增
}
```

### 4.2 归一化与迁移（`src/lib/api/apiProfiles.ts`）

新增常量 / 函数：

- `DEFAULT_OPTIMIZER_PROFILE_ID = 'default-optimizer'`
- `createDefaultOptimizerProfile(overrides?): PromptOptimizerProfile`
  - 默认 `{ id: DEFAULT_OPTIMIZER_PROFILE_ID, name: '默认', ...createDefaultPromptOptimizer() }`，可被 overrides 覆盖（新建额外配置时传 `{ id: 生成, name: '新配置' }`）。
- `normalizeOptimizerProfile(input): PromptOptimizerProfile`
  - 复用 `normalizePromptOptimizer` 处理 config 字段；`id`：非空字符串否则生成；`name`：非空字符串否则 `'新配置'`。
- `getActiveOptimizerProfile(settings): PromptOptimizerProfile` 辅助函数（供需要时使用；消费方仍走 `promptOptimizer` 镜像）。

`normalizeSettings` 增加迁移逻辑（与图像 profiles 的迁移同构）：

1. `optimizerProfiles`：
   - 若 `record.optimizerProfiles` 是非空数组 → 逐项 `normalizeOptimizerProfile`。
   - 否则（**老用户：只有单 `promptOptimizer`，无 `optimizerProfiles`**）→ 用 `normalizePromptOptimizer(record.promptOptimizer)` 建**单个**默认配置 `[{ id: DEFAULT_OPTIMIZER_PROFILE_ID, name: '默认', ...迁移值 }]`。**老用户无感迁移，原配置变成"默认"配置。**
2. `activeOptimizerProfileId`：`record` 值且能在 `optimizerProfiles` 中命中则用之，否则取 `optimizerProfiles[0].id`。
3. `promptOptimizer`（镜像）：从激活的优化器配置派生 `{ baseUrl, apiKey, model, timeout, systemPrompt }`。

`DEFAULT_SETTINGS` 经 `normalizeSettings` 后自然带上 `optimizerProfiles: [默认]` 与 `activeOptimizerProfileId`。

### 4.3 导入导出

- `redactSettingsForExport`（`exportImport.ts`）：除已有的 `promptOptimizer.apiKey` 清空外，对 `optimizerProfiles` 逐项清空 `apiKey`。
- `mergeImportedSettings`（`apiProfiles.ts`）：增加优化器配置的合并，与图像 profiles 同构：
  - `getOptimizerProfileDedupKey(profile)`：以 `baseUrl(去尾斜杠/小写) + apiKey + model` 为身份（`systemPrompt` 不计入身份，避免近重复配置膨胀）。
  - `dedupeOptimizerProfiles` 去重导入项。
  - `hasOnlyDefaultOptimizerProfiles(current)`：current 仅含一个未改动的默认优化器配置 → 全量采用导入的优化器配置；否则把导入项中**非重复**者追加，并分配新 id；`activeOptimizerProfileId` 保持 current 的。
  - 通过 `normalizeSettings({ ...current, optimizerProfiles, activeOptimizerProfileId })` 收口。

### 4.4 选择器组件（新建 `src/components/SettingsModal/OptimizerProfileSelector.tsx`）

结构参照 `ProfileSelector`，但**去掉服务商徽标**：

- Props：`profiles: PromptOptimizerProfile[]`、`activeProfileId`、`open`、`onOpenChange`、`onSelect`、`onCreate`、`onDelete`。
- 渲染：当前配置名 + 下拉（「创建新配置」按钮、配置列表、`profiles.length > 1` 时每项带删除按钮）。
- 样式沿用 `ProfileSelector` 的 className，保证与图像 API 区块视觉一致。

### 4.5 `OptimizerSection`（`src/components/SettingsModal/OptimizerSection.tsx`）

- props 的 `optimizer` 类型由 `AppSettings['promptOptimizer']` 改为 `PromptOptimizerProfile`（superset，现有字段读取不受影响）。
- 在最上方新增「配置名称」输入框（参照 `ApiProfileSection` 的 `name` 字段），`onChange` → `onUpdate({ name })`。
- `onUpdate` 类型放宽为 `Partial<PromptOptimizerProfile>`。
- 模型列表缓存重置的 `useEffect` 依赖增加 `optimizer.id`（切换配置时清缓存，对齐 `ApiProfileSection`）。
- 其余（模型下拉、timeout、systemPrompt、reset 默认 systemPrompt）逻辑不变。

### 4.6 `SettingsModal/index.tsx`

镜像图像 API 的配置管理（与既有 `activeProfile` 相关逻辑并列新增一套 optimizer 版）：

- 派生 `activeOptimizerProfile = draft.optimizerProfiles.find(id===activeOptimizerProfileId) ?? draft.optimizerProfiles[0]`。
- 新增 state `showOptimizerProfileMenu`。
- `optimizerTimeoutInput` 改为跟踪 `activeOptimizerProfile.timeout`；新增 `useEffect`：`activeOptimizerProfile.id` 变化时重置该输入框（对齐图像的 timeout 重置）。
- `buildFlushedDraft`：把 `optimizerTimeoutInput` 折叠进**激活的优化器配置**（而非 `promptOptimizer` 镜像）。
- `updatePromptOptimizer` → 重命名/改写为 `updateActiveOptimizerProfile(patch: Partial<PromptOptimizerProfile>)`：仅 patch `draft.optimizerProfiles` 中激活项（**不触碰 `draft.promptOptimizer` 镜像**，保存时由 `normalizeSettings` 重新派生）。
- 新增 `createOptimizerProfile` / `switchOptimizerProfile` / `deleteOptimizerProfile`（与图像版同构，删除时 `length<=1` 直接返回，切换 active）。
- `commitSettings`：归一化 `optimizerProfiles`（trim name/baseUrl/apiKey/model、timeout 兜底），校正 `activeOptimizerProfileId`；`promptOptimizer` 镜像由 `normalizeSettings` 派生。删除原先对单 `promptOptimizer` 的 trim 块。
- `resetDraft` / `runImport` / `handleClearAllData` 等处的 `setOptimizerTimeoutInput(... promptOptimizer.timeout)` 改为读激活优化器配置的 timeout。
- 「提示词优化 API」`<section>` 的标题行加入 `<OptimizerProfileSelector .../>`（布局对齐「API 配置」区块的标题 + 选择器）；`<OptimizerSection optimizer={activeOptimizerProfile} onUpdate={updateActiveOptimizerProfile} .../>`。
- 删除确认走既有 `setConfirmDialog` 模式。

### 4.7 dirty 检测说明（无需特殊处理）

`isDirty` 比较 `buildFlushedDraft()` 与 `settings` 的 JSON。打开面板时 `draft = normalizeSettings(settings)` 故初始相等。编辑优化器配置只改 `draft.optimizerProfiles` / `activeOptimizerProfileId`（均参与比较）→ 改动即 dirty，撤销即恢复。`draft.promptOptimizer` 镜像在编辑期保持不变（= settings 镜像），不产生误判。此行为与图像 profiles 编辑时 flat 字段保持 stale 的现状一致。保存时 `commitSettings → normalizeSettings` 统一从激活配置重派生镜像，最终落库正确。

## 5. 消费方（不改动）

- `PromptOptimizerModal.tsx`：继续读 `settings.promptOptimizer`（= 激活优化器配置镜像）。
- `InputBar/index.tsx`：继续读 `settings.promptOptimizer.apiKey`。

## 6. 边界与错误处理

- 老数据（无 `optimizerProfiles`）→ 迁移为单「默认」配置，零丢失。
- 至少保留一个优化器配置：删除到仅剩 1 个时禁用删除（UI + `deleteOptimizerProfile` 双重保护）。
- 激活 id 失效（导入/删除后）→ `normalizeSettings` 兜底回 `optimizerProfiles[0]`。
- 空 apiKey 不在保存时硬校验（维持现状）；运行时由 `optimizePromptStream` 抛「未配置 API Key」。

## 7. 测试计划

- `apiProfiles.test.ts`：
  - 老数据迁移：`{ promptOptimizer: {...} }`（无 `optimizerProfiles`）→ 单默认配置 + 镜像派生正确。
  - 多配置归一化：`activeOptimizerProfileId` 命中 / 失效兜底。
  - `mergeImportedSettings`：fresh（仅默认）→ 全量采用；非 fresh → 去重追加 + 新 id；active 保持。
- `exportImport.test.ts`：`redactSettingsForExport` 清空每个优化器配置的 apiKey（扩展现有断言）。
- 既有 `optimizePromptApi.test.ts` 不变（签名仍是 `PromptOptimizerConfig`）。
- 全量 `npm run lint` + `npm run test` + `tsc` 通过。

## 8. 非目标

- 不为优化器引入 Gemini / 服务商类型切换。
- 不重构图像 API 的 `ProfileSelector` / profile 机制（不共享、不泛化）。
- 不新增 URL 查询参数 bootstrap。
- 不改优化器请求协议（仍 OpenAI 兼容 chat completions 流式）。
