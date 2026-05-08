# 图片存储改为 Blob

## Goal

把 IndexedDB 中的图片主体从 data URL 字符串改为 Blob 存储，降低图片库变大后的序列化成本和内存压力。

## Requirements

- 新写入图片时，IndexedDB 保存 Blob 和 MIME，不再把图片主体长期保存为 data URL 字符串。
- 旧数据仍可读取。旧记录只有 `dataUrl` 时，读取路径要兼容。
- UI 调用方暂时保持 `dataUrl` 接口，避免一次性重写所有组件。
- `ensureImageCached` 继续返回 data URL，展示逻辑不变。
- 导出 ZIP 直接使用 Blob 字节，导入 ZIP 写回 Blob。
- 清理、删除、去重逻辑保持现有行为。

## Acceptance Criteria

- `npm run test` 通过。
- `npm run build` 通过。
- 旧 data URL 图片记录能继续展示。
- 新导入、上传、生成的图片以 Blob 存入 IndexedDB。
- 导出 ZIP 的图片文件仍可恢复。

## Out of Scope

- 组件层全面改用 object URL。
- 图片缩略图预生成。
- IndexedDB 版本迁移并强制重写旧记录。
- 存储配额管理 UI。
