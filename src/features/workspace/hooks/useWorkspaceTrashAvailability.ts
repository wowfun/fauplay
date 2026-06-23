import { useEffect, useState } from 'react'
import { getBoundRootPath } from '@/lib/reveal'
import {
  listRuntimeGlobalTrash,
  listRuntimeRootTrash,
} from '@/lib/runtimeApi'

interface UseWorkspaceTrashAvailabilityParams {
  accessProvider: 'local-browser' | 'remote-readonly'
  rootId: string | null | undefined
  refreshKey: unknown
}

export function useWorkspaceTrashAvailability({
  accessProvider,
  rootId,
  refreshKey,
}: UseWorkspaceTrashAvailabilityParams): boolean {
  const [hasTrashEntries, setHasTrashEntries] = useState(false)

  useEffect(() => {
    void refreshKey
    if (accessProvider === 'remote-readonly' || !rootId) {
      setHasTrashEntries(false)
      return
    }

    let disposed = false

    const refreshTrashAvailability = async () => {
      let hasRootTrashEntries = false
      const boundRootPath = getBoundRootPath(rootId)
      if (boundRootPath) {
        try {
          const listing = await listRuntimeRootTrash({ rootPath: boundRootPath, limit: 1 }, 120000)
          hasRootTrashEntries = listing.entries.length > 0
        } catch {
          hasRootTrashEntries = false
        }
      }

      try {
        const listing = await listRuntimeGlobalTrash({ limit: 1 }, 120000)
        if (!disposed) {
          setHasTrashEntries(hasRootTrashEntries || listing.entries.length > 0)
        }
      } catch {
        if (!disposed) {
          setHasTrashEntries(hasRootTrashEntries)
        }
      }
    }

    void refreshTrashAvailability()
    return () => {
      disposed = true
    }
  }, [accessProvider, refreshKey, rootId])

  return hasTrashEntries
}
