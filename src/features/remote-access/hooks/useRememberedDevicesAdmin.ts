import { useCallback, useEffect, useState } from 'react'
import {
  loadRememberedDevicesAdmin,
  renameRememberedDeviceAdmin,
  revokeAllRememberedDevicesAdmin,
  revokeRememberedDeviceAdmin,
  type RememberedDeviceAdminEntry,
} from '@/lib/remoteAccess'
import { loadRuntimeCapabilities } from '@/lib/runtimeApi'
import {
  readRememberedDevicesAdminErrorMessage,
  resolveRememberedDevicesAdminEntryVisibility,
  resolveRememberedDevicesAdminStartupPlan,
} from '../lib/rememberedDevicesAdminModel'

interface UseRememberedDevicesAdminParams {
  isLoopbackUi: boolean
  shouldShowStartupScreen: boolean
}

export function useRememberedDevicesAdmin({
  isLoopbackUi,
  shouldShowStartupScreen,
}: UseRememberedDevicesAdminParams) {
  const [isLocalRuntimeOnline, setIsLocalRuntimeOnline] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState<RememberedDeviceAdminEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMutating, setIsMutating] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const nextItems = await loadRememberedDevicesAdmin()
      setItems(nextItems)
    } catch (refreshError) {
      setError(readRememberedDevicesAdminErrorMessage(refreshError, '读取已记住设备失败'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const plan = resolveRememberedDevicesAdminStartupPlan({
      isLoopbackUi,
      shouldShowStartupScreen,
    })
    if (plan.kind === 'close-admin') {
      setIsLocalRuntimeOnline(plan.isLocalRuntimeOnline)
      setIsOpen(plan.isOpen)
      return
    }

    let cancelled = false
    const refreshLocalRuntimeStatus = async () => {
      const snapshot = await loadRuntimeCapabilities()
      if (!cancelled) {
        setIsLocalRuntimeOnline(snapshot.online)
      }
    }

    void refreshLocalRuntimeStatus()
    return () => {
      cancelled = true
    }
  }, [isLoopbackUi, shouldShowStartupScreen])

  const open = useCallback(() => {
    if (!isLoopbackUi) return
    setIsOpen(true)
    void refresh()
  }, [isLoopbackUi, refresh])

  const close = useCallback(() => {
    setIsOpen(false)
    setError(null)
  }, [])

  const runMutation = useCallback((mutation: () => Promise<void>, fallbackMessage: string) => {
    const run = async () => {
      setIsMutating(true)
      setError(null)
      try {
        await mutation()
        await refresh()
      } catch (mutationError) {
        setError(readRememberedDevicesAdminErrorMessage(mutationError, fallbackMessage))
      } finally {
        setIsMutating(false)
      }
    }

    void run()
  }, [refresh])

  const rename = useCallback((deviceId: string, label: string) => {
    runMutation(
      () => renameRememberedDeviceAdmin(deviceId, label),
      '重命名设备失败',
    )
  }, [runMutation])

  const revoke = useCallback((deviceId: string) => {
    runMutation(
      () => revokeRememberedDeviceAdmin(deviceId),
      '撤销设备失败',
    )
  }, [runMutation])

  const revokeAll = useCallback(() => {
    runMutation(
      () => revokeAllRememberedDevicesAdmin(),
      '全部撤销失败',
    )
  }, [runMutation])

  return {
    isOpen,
    items,
    error,
    isLoading,
    isMutating,
    showEntry: resolveRememberedDevicesAdminEntryVisibility({
      isLoopbackUi,
      isLocalRuntimeOnline,
    }),
    open,
    close,
    rename,
    revoke,
    revokeAll,
    refresh,
  }
}
