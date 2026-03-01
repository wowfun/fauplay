import { useCallback, useEffect, useState } from 'react'
import { loadGatewayCapabilities } from '@/lib/gateway'
import type { GatewayToolDescriptor } from '@/lib/gateway'

const REFRESH_INTERVAL_MS = 15000

export function useGatewayCapabilities() {
  const [isGatewayOnline, setIsGatewayOnline] = useState(false)
  const [tools, setTools] = useState<GatewayToolDescriptor[]>([])

  const refresh = useCallback(async () => {
    const snapshot = await loadGatewayCapabilities()
    setIsGatewayOnline(snapshot.online)
    setTools(snapshot.online ? snapshot.tools : [])
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

  return {
    isGatewayOnline,
    tools,
    refresh,
  }
}
