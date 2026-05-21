# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Sidebar/popover 互斥、fixed 居中补偿、a11y 必备项、Array.from 取首字符等 | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Image task / favorite category / Conversation 三套 runtime contracts；bulk action / IDB upgrade 反模式 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | `src/lib/**` 禁 `window.*`；导出敏感字段强制脱敏；mobile drawer body lock、icon button aria-label、Esc+outside cleanup | Filled |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |
| [Service Worker](./service-worker.md) | `public/sw.js` 缓存策略与 kill-switch 逃生通道契约 | Filled |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
