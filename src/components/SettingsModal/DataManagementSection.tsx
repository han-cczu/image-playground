import { useRef, useState } from 'react'
import type { ImportMode } from '../../lib/exportImport'
import { formatBytes, type ImageSourceBucket, type StorageStats } from '../../lib/storageStats'

export interface DataManagementSectionProps {
  storageStats: StorageStats | null
  storageLoading: boolean
  onPruneOrphans: () => void
  onExport: () => void
  onImport: (file: File, mode: ImportMode) => Promise<void>
  onClearAll: () => void
  onConfirmReplaceImport: (proceed: () => void) => void
  onConfirmClearAll: (proceed: () => void) => void
}

const SOURCE_LABELS: { key: ImageSourceBucket; label: string }[] = [
  { key: 'upload', label: '上传' },
  { key: 'generated', label: '生成' },
  { key: 'mask', label: '遮罩' },
  { key: 'unknown', label: '其它' },
]

export function DataManagementSection({
  storageStats,
  storageLoading,
  onPruneOrphans,
  onExport,
  onImport,
  onClearAll,
  onConfirmReplaceImport,
  onConfirmClearAll,
}: DataManagementSectionProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [pendingImportMode, setPendingImportMode] = useState<ImportMode>('merge')

  const selectImportFile = (mode: ImportMode) => {
    setPendingImportMode(mode)
    importInputRef.current?.click()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await onImport(file, pendingImportMode)
    }
    e.target.value = ''
    setPendingImportMode('merge')
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gray-50/60 dark:bg-white/[0.03] p-3 space-y-2.5">
        {storageLoading || !storageStats ? (
          <div className="text-xs text-gray-400 dark:text-gray-500">正在统计本地占用…</div>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-gray-700 dark:text-gray-200">本地图片占用</span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {formatBytes(storageStats.totalBytes)} · {storageStats.imageCount} 张
              </span>
            </div>

            {storageStats.quota && storageStats.quota.quota > 0 && (
              <div className="space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-blue-500/80"
                    style={{
                      width: `${Math.min(100, (storageStats.quota.usage / storageStats.quota.quota) * 100).toFixed(1)}%`,
                    }}
                  />
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">
                  浏览器已用 {formatBytes(storageStats.quota.usage)} / {formatBytes(storageStats.quota.quota)}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {SOURCE_LABELS.map(({ key, label }) => {
                const bucket = storageStats.bySource[key]
                if (!bucket.count) return null
                return (
                  <span
                    key={key}
                    className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
                  >
                    {label} {bucket.count}·{formatBytes(bucket.bytes)}
                  </span>
                )
              })}
            </div>

            <div className="flex items-center justify-between pt-0.5">
              {storageStats.orphanCount > 0 ? (
                <>
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {storageStats.orphanCount} 张孤儿图 · 约 {formatBytes(storageStats.orphanBytes)}
                  </span>
                  <button
                    onClick={onPruneOrphans}
                    className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-600 transition hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                  >
                    清理
                  </button>
                </>
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500">无可清理的孤儿图</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onExport}
          className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          导出
        </button>
        <button
          onClick={() => selectImportFile('merge')}
          className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          合并导入
        </button>
        <button
          onClick={() =>
            onConfirmReplaceImport(() => selectImportFile('replace'))
          }
          className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 4.34L4 6.68M4 15a8 8 0 0013.66 4.66L20 17.32" />
          </svg>
          替换导入
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleImport}
        />
      </div>
      <button
        onClick={() => onConfirmClearAll(onClearAll)}
        className="w-full rounded-xl border border-red-200/80 bg-red-50/50 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-100/80 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
      >
        清空所有数据
      </button>
    </div>
  )
}
