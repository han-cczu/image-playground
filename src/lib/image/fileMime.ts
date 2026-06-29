const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

const GENERIC_FILE_MIME = new Set(['', 'application/octet-stream'])

export function getImageFileMime(file: Pick<File, 'name' | 'type'>): string | null {
  const mime = file.type.trim().toLowerCase()
  if (mime.startsWith('image/')) return mime
  if (!GENERIC_FILE_MIME.has(mime)) return null

  const extension = file.name.split('.').pop()?.trim().toLowerCase()
  if (!extension || extension === file.name.toLowerCase()) return null
  return IMAGE_MIME_BY_EXTENSION[extension] ?? null
}

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return getImageFileMime(file) !== null
}

export function fileToImageDataUrl(file: File): Promise<string> {
  return blobToDataUrlWithType(file, getImageFileMime(file) ?? file.type)
}

function blobToDataUrlWithType(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      if (!mime || blob.type.toLowerCase() === mime.toLowerCase()) {
        resolve(result)
        return
      }
      resolve(
        result.replace(/^data:([^,]*),/, (_match, meta: string) => {
          const suffix = meta.includes(';') ? meta.slice(meta.indexOf(';')) : ''
          return `data:${mime}${suffix},`
        }),
      )
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
