import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadGatewayCapabilities } from '@/lib/gateway'

const REFRESH_INTERVAL_MS = 15000

export function useGatewayCapabilities() {
  const [isGatewayOnline, setIsGatewayOnline] = useState(false)
  const [toolNames, setToolNames] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const snapshot = await loadGatewayCapabilities()
    setIsGatewayOnline(snapshot.online)
    setToolNames(snapshot.tools.map((tool) => tool.name))
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

  const toolSet = useMemo(() => new Set(toolNames), [toolNames])

  const supportsTool = useCallback((toolName: string): boolean => {
    if (!isGatewayOnline) return true
    return toolSet.has(toolName)
  }, [toolSet, isGatewayOnline])

  return {
    isGatewayOnline,
    toolNames,
    supportsTool,
    refresh,
  }
}
