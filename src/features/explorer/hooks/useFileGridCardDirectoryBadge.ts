import { useEffect, useState } from 'react'
import { resolveFileGridCardDirectoryBadge } from '@/features/explorer/lib/fileGridCardModel'
import type { FileGridCardDirectoryBadge } from '@/features/explorer/lib/fileGridCardModel'
import { getDirectoryItemCount } from '@/lib/fileSystem'
import type { FileItem } from '@/types'

interface UseFileGridCardDirectoryBadgeParams {
  file: FileItem
  rootHandle: FileSystemDirectoryHandle | null
}

export function useFileGridCardDirectoryBadge({
  file,
  rootHandle,
}: UseFileGridCardDirectoryBadgeParams): FileGridCardDirectoryBadge {
  const [directoryItemCount, setDirectoryItemCount] = useState<number | null>(null)
  const directoryBadge = resolveFileGridCardDirectoryBadge({
    file,
    loadedDirectoryItemCount: directoryItemCount,
  })

  useEffect(() => {
    if (!directoryBadge.shouldLoadDirectoryItemCount || !rootHandle || file.kind !== 'directory') {
      setDirectoryItemCount(null)
      return
    }

    let cancelled = false

    const loadDirectoryItemCount = async () => {
      try {
        const count = await getDirectoryItemCount(rootHandle, file.path)
        if (!cancelled) {
          setDirectoryItemCount(count)
        }
      } catch {
        if (!cancelled) {
          setDirectoryItemCount(null)
        }
      }
    }

    loadDirectoryItemCount()

    return () => {
      cancelled = true
    }
  }, [directoryBadge.shouldLoadDirectoryItemCount, file.kind, file.path, rootHandle])

  return directoryBadge
}
