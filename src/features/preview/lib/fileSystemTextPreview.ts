import type { TextPreviewPayload } from '../../../types'

interface FileSystemTextPreviewSource {
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export async function readFileSystemTextPreview(
  file: FileSystemTextPreviewSource,
  sizeLimitBytes: number,
): Promise<TextPreviewPayload> {
  if (file.size > sizeLimitBytes) {
    return {
      status: 'too_large',
      content: null,
      fileSizeBytes: file.size,
      sizeLimitBytes,
      error: null,
    }
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (containsNullByte(bytes)) {
      return {
        status: 'binary',
        content: null,
        fileSizeBytes: file.size,
        sizeLimitBytes,
        error: null,
      }
    }

    return {
      status: 'ready',
      content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      fileSizeBytes: file.size,
      sizeLimitBytes,
      error: null,
    }
  } catch (error) {
    return {
      status: 'error',
      content: null,
      fileSizeBytes: file.size,
      sizeLimitBytes,
      error: (error as Error).message,
    }
  }
}

function containsNullByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true
  }
  return false
}
