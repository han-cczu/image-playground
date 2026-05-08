# 用户可见标题去 GPT 化

## Goal

把用户可见的产品名从 `GPT Image Playground` 改为更中性的 `Image Playground`，避免在已支持 OpenAI 与 Gemini 多 Provider 后产生只支持 GPT Image 的误解。

## Requirements

- README 主标题改为 `Image Playground`。
- 浏览器标题、PWA 名称和 Header 展示名改为 `Image Playground`。
- OpenAI Images API 的模型说明中保留 `GPT Image`，因为这是模型族名称。
- 不改包名、IndexedDB 名、导出文件名前缀，避免破坏已有本地数据和备份习惯。

## Acceptance Criteria

- 用户可见品牌标题不再使用 `GPT Image Playground`。
- `npm run build` 通过。
