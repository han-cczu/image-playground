# 版本号改为 v0.1.0

## Goal

把项目版本号从沿用原项目的 `0.2.22` 改为 `0.1.0`（用户的第一个版本）。

## Requirements

- `package.json` 的 `version` 字段：`0.2.22` → `0.1.0`
- `package-lock.json` 中的 version 字段（2 处镜像）同步更新

## Open Questions

- [x] ~~SW 缓存名同步改 v0.1.0?~~ → **是**

## Additional Requirements (decided)

- `public/sw.js` 中 `CACHE_NAME` 由 `image-playground-v0.1.5` 改为 `image-playground-v0.1.0`

## Acceptance Criteria

- [ ] `package.json` version = "0.1.0"
- [ ] `package-lock.json` 两处 version 都为 "0.1.0"
- [ ] `npm run build` 通过
- [ ] `npx tsc --noEmit` 通过

## Out of Scope

- changelog
- git tag

## Technical Notes

- `__APP_VERSION__` 在 `vite.config.ts` 是从 package.json 读取的，自动同步
