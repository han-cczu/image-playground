/**
 * 全局环境光晕层。
 *
 * 坐在 body 背景（gray-50 / gray-950）之上、所有内容之下（fixed + -z-10），
 * 仅在卡片与空白的「负空间」透出，营造电影感氛围。纯装饰、不可交互。
 *
 * - 明暗分级：亮色 opacity 极低（只做淡淡染色，避免显脏），暗色更明显。
 * - 缓慢漂移由 .glow-blob-* 驱动；prefers-reduced-motion 下自动静止（见 index.css）。
 */
export default function AmbientGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* 左上：蓝 */}
      <div className="glow-blob-a absolute -left-[10%] -top-[15%] h-[45vw] w-[45vw] rounded-full bg-blue-400/15 blur-[100px] dark:bg-blue-600/25" />
      {/* 右下：紫 */}
      <div className="glow-blob-b absolute -right-[12%] -bottom-[10%] h-[42vw] w-[42vw] rounded-full bg-violet-400/[0.12] blur-[100px] dark:bg-violet-600/[0.22]" />
      {/* 中下：靛（垫在悬浮 InputBar 附近） */}
      <div className="glow-blob-c absolute bottom-[2%] left-1/2 h-[34vw] w-[34vw] -translate-x-1/2 rounded-full bg-indigo-400/[0.12] blur-[100px] dark:bg-indigo-600/20" />
    </div>
  )
}
