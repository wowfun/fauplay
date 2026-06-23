import { useEffect, useState } from 'react'
import {
  loadAddressPathHistory,
  saveAddressPathHistory,
  upsertAddressPathHistory,
} from '@/features/workspace/lib/addressPathHistory'
import type { AddressPathHistoryEntry } from '@/types'

interface UseWorkspacePathHistoryParams {
  storageNamespace: string
  rootId: string
  rootName: string
  currentPath: string
}

export function useWorkspacePathHistory({
  storageNamespace,
  rootId,
  rootName,
  currentPath,
}: UseWorkspacePathHistoryParams): AddressPathHistoryEntry[] {
  const [recentPathHistory, setRecentPathHistory] = useState<AddressPathHistoryEntry[]>(() => (
    loadAddressPathHistory(storageNamespace)
  ))

  useEffect(() => {
    if (!rootId) return
    setRecentPathHistory((previous) => upsertAddressPathHistory(previous, {
      rootId,
      rootName: rootName || '根目录',
      path: currentPath,
    }))
  }, [currentPath, rootId, rootName])

  useEffect(() => {
    saveAddressPathHistory(storageNamespace, recentPathHistory)
  }, [recentPathHistory, storageNamespace])

  return recentPathHistory
}
