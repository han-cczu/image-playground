import { useState, useRef, useEffect } from 'react'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { getImageFileMime, isImageFile } from '../../../lib/image/fileMime'

function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
}

function isFileTransfer(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files')
}

function hasDroppedFiles(dataTransfer: DataTransfer | null): boolean {
  return (dataTransfer?.files?.length ?? 0) > 0
}

function imageExtensionFromMime(mime: string): string {
  const normalized = mime.toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/svg+xml') return 'svg'
  return normalized.slice('image/'.length).split('+')[0] || 'png'
}

function getPastedImageFile(item: DataTransferItem): File | null {
  const file = item.getAsFile()
  if (!file) return null
  if (isImageFile(file)) return file
  const itemMime = item.type.trim().toLowerCase()
  if (!itemMime.startsWith('image/')) return null

  const name =
    file.name.trim() ||
    `pasted-image.${imageExtensionFromMime(itemMime)}`
  return new File([file], name, {
    type: getImageFileMime(file) ?? itemMime,
    lastModified: file.lastModified,
  })
}

export function useDragDropFiles(args: { onFiles: (files: File[]) => void }): {
  isDragging: boolean
} {
  const { onFiles } = args
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const onFilesRef = useLatestRef(onFiles)

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // 焦点在 InputBar 之外的可编辑元素(设置弹窗输入框、重命名框、其它弹窗文本域)时,
      // 不劫持图片粘贴——让目标元素自行处理,避免图片被错误塞进底栏参考图。
      const active = document.activeElement
      if (isEditableElement(active) && !active!.closest('[data-input-bar]')) return
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        const file = getPastedImageFile(item)
        if (file) imageFiles.push(file)
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        onFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [onFilesRef])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!isFileTransfer(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      setIsDragging(true)
    }

    const handleDragOver = (e: DragEvent) => {
      if (!isFileTransfer(e.dataTransfer) && dragCounter.current === 0) return
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!isFileTransfer(e.dataTransfer) && dragCounter.current === 0) return
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = Math.max(0, dragCounter.current - 1)
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      if (
        !isFileTransfer(e.dataTransfer) &&
        !hasDroppedFiles(e.dataTransfer) &&
        dragCounter.current === 0
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        onFilesRef.current(Array.from(files))
      }
    }

    // 拖出窗口外释放 / 窗口失焦时计数器可能失衡导致全屏遮罩卡住,兜底归零
    const resetDrag = () => {
      dragCounter.current = 0
      setIsDragging(false)
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)
    window.addEventListener('dragend', resetDrag)
    window.addEventListener('blur', resetDrag)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragend', resetDrag)
      window.removeEventListener('blur', resetDrag)
    }
  }, [onFilesRef])

  return { isDragging }
}
