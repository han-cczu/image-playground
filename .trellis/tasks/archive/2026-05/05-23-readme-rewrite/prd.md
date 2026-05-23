# README 完全重写

## Goal

把项目 README 从"增量同步功能"模式切换到**完全重写**：保持现有信息密度（部署细节、API 表都留在 README 内），但重新组织 hierarchy、加 "Why Image Playground" 段落、用 `<details>` 折叠长列表降低首屏视觉负担、补 Quickstart 三路径、加截图占位、整体文案润色一遍。

## Requirements

### 结构（新版章节顺序，自上而下）

1. **Hero** —— 名称 / 一句话定位 / 在线 demo CTA + Docker 自部署 CTA + 截图占位注释
2. **Why Image Playground** —— 3-5 bullet 说清差异化（本地数据 / 对话式 / 16 参考图 / 遮罩 / Codex CLI / 自部署）
3. **Quickstart** —— 三条路径：在线试用 / 本地 dev / Docker 一行，各带最短命令
4. **核心特性** —— 5 大块用 `<details><summary>` 折叠，默认折叠
5. **API 配置与 URL 传参** —— 保留 Provider 表 + URL 参数表，文案润色
6. **本地开发与构建** —— 保留，文案润色
7. **Docker 部署** —— 保留 4 种方式 + 维护章节，4 种方式各用 `<details>` 折叠步骤；顶层保留对比速查表
8. **技术栈** —— 保留，简化排版

### 内容规则

- 中文为主（项目内 commit / journal / 注释都是中文）
- 不引入新构建步骤、不拆 README.zh-CN.md
- 截图全部用 `<!-- screenshot: 描述 -->` 占位注释，由用户后续补
- 不杜撰内容：所有特性 / 命令 / 部署模式必须能在现有 README / 仓库里找到对应事实
- 在线 demo 链接、CF Workers 与 Docker 关系、kill-switch 机制等关键事实点不丢失
- 不加 LICENSE / CONTRIBUTING 段落（仓库内无此文件）

## Acceptance Criteria

- [ ] README.md 完全重写完成，行数 ≈ 现状（±20%，仍约 250-340 行）
- [ ] 新增 "Why Image Playground" 段落，3-5 bullet
- [ ] 新增 Quickstart 段落（在 Features 之前），含三种使用路径
- [ ] 核心特性 5 大块用 `<details><summary>` 折叠
- [ ] Docker 部署 4 种方式各用 `<details>` 折叠（对比速查表仍展开）
- [ ] 截图占位用 `<!-- screenshot: ... -->` 注释，未引入实际不存在的图片路径
- [ ] 所有原有事实点保留：在线 demo URL / Docker 4 模式 / kill-switch / Codex CLI / Gemini provider / IndexedDB 本地存储 / dev-proxy / URL 传参 / 模型刷新
- [ ] 在 GitHub / IDE Markdown preview 下渲染正常（`<details>` / 表格 / 代码块工作）
- [ ] 没有未填占位符（除截图 `<!-- screenshot: -->` 注释）

## Definition of Done

- `README.md` 重写完成
- Markdown 渲染检查（`<details>` 在 GitHub 支持原生）
- 主要链接（demo / CF Workers / Docker）可点
- 文案中文为主、术语一致（沿用现有：API URL / Profile / Provider / Codex CLI 模式 / kill-switch）

## Technical Approach

**单文件重写**：直接 Write 整份 `README.md`。新版结构图示：

```
# Image Playground
> 一句话定位

[Live demo] [Docker self-host]

<!-- screenshot: 主界面（对话 + 生成卡片 + 底栏） -->

---

## Why Image Playground
- 本地优先
- 对话式
- 16 参考图 + 遮罩
- Codex CLI / URL 集成
- Docker 自部署友好

---

## Quickstart
### 在线试用 ...
### 本地开发 ...
### Docker 一键 ...

---

## ✨ 核心特性
<details><summary>🎨 图像生成与编辑</summary>...</details>
<details><summary>🗂️ 历史与画廊</summary>...</details>
<details><summary>⚙️ 参数与配置</summary>...</details>
<details><summary>🔌 API 兼容增强</summary>...</details>
<details><summary>🔒 隐私与本地优先</summary>...</details>

---

## 🛠️ API 配置与 URL 传参 ...

## 🚀 本地开发与构建 ...

## 🐳 Docker 部署
对比速查表（展开）
<details><summary>方式 A：单容器</summary>...</details>
<details><summary>方式 B：docker-compose 全栈</summary>...</details>
<details><summary>方式 C：HTTP + IP 直连</summary>...</details>
<details><summary>方式 D：sslip.io HTTPS over IP</summary>...</details>
<details><summary>维护与升级</summary>...</details>

---

## 💻 技术栈
```

## Decision (ADR-lite)

- **Context**: 当前 README 285 行扁平结构，特性 + 部署细节都展开，刷新页面后用户被长列表淹没；同步式更新积累的内容缺乏 narrative。
- **Decision**: 选"开发者友好型"重写——保留现有信息密度（不外拆 docs/），但用 `<details>` 折叠 + Quickstart 前置 + Why 段落改善首屏；保持单文件中文 README，不做双语。
- **Consequences**: 首屏更短、新读者能 30 秒理解项目，但需依赖 GitHub 对 `<details>` 的原生支持（已支持）。代价是某些纯文本场景下 details 折叠的内容看起来是平铺的——可接受。

## Out of Scope

- 项目代码改动（纯文档任务）
- 实际截图素材制作（占位由用户后续补）
- 单独 docs/ 站点
- 英文版 / 双语 README
- LICENSE / CONTRIBUTING / CHANGELOG 文件创建

## Technical Notes

- 现有 README：`README.md`（285 行）
- 现有 README 5 大特性块都需要保留实质内容，仅外层包 `<details>`
- 在线 demo：https://image-playground.diaohan111.workers.dev/
- 项目 metadata：`package.json` 中 `name: "image-playground"`
- GitHub `<details>` 渲染：原生支持，summary 内可放 emoji / markdown，summary 后 markdown 需空一行才解析
- 最近一次 README 改动：commit `fa6ca96 docs(readme): 同步近期 8 项功能 + 修 2 处错误指引`
