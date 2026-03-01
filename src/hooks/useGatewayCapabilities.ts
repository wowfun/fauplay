import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadGatewayCapabilities } from '@/lib/gateway'

const REFRESH_INTERVAL_MS = 15000

export function useGatewayCapabilities() {
  const [isGatewayOnline, setIsGatewayOnline] = useState(false)
  const [actionIds, setActionIds] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const snapshot = await loadGatewayCapabilities()
    setIsGatewayOnline(snapshot.online)
    setActionIds(snapshot.actions.map((action) => action.actionId))
  }, [])

  useEffect(() => {
    void refresh()
    const timerId = window.setInterval(() => {
      void refresh()
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timerId)
    }
  }, [refresh])

  const actionSet = useMemo(() => new Set(actionIds), [actionIds])

  const supportsAction = useCallback((actionId: string): boolean => {
    if (!isGatewayOnline) return true
    return actionSet.has(actionId)
  }, [actionSet, isGatewayOnline])

  return {
    isGatewayOnline,
    actionIds,
    supportsAction,
    refresh,
  }
}
