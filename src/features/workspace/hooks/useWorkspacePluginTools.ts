import { useEffect, useState } from 'react'
import type { GatewayCapabilitiesSnapshot, GatewayToolDescriptor } from '@/lib/gateway'

const GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS = 15000

interface UseWorkspacePluginToolsParams {
  accessProvider: 'local-browser' | 'remote-readonly'
}

export function useWorkspacePluginTools({
  accessProvider,
}: UseWorkspacePluginToolsParams): GatewayToolDescriptor[] {
  const [pluginTools, setPluginTools] = useState<GatewayToolDescriptor[]>([])

  useEffect(() => {
    if (accessProvider === 'remote-readonly') {
      setPluginTools([])
      return () => {}
    }

    let disposed = false
    let refreshTimerId: number | null = null
    let loadSnapshot: (() => Promise<GatewayCapabilitiesSnapshot>) | null = null

    const refreshCapabilities = async () => {
      try {
        if (!loadSnapshot) {
          const module = await import('@/lib/gateway')
          loadSnapshot = module.loadGatewayCapabilities
        }
        const snapshot = await loadSnapshot()
        if (disposed) return
        setPluginTools(snapshot.online ? snapshot.tools : [])
      } catch {
        if (!disposed) {
          setPluginTools([])
        }
      }
    }

    void refreshCapabilities()
    refreshTimerId = window.setInterval(() => {
      void refreshCapabilities()
    }, GATEWAY_CAPABILITY_REFRESH_INTERVAL_MS)

    return () => {
      disposed = true
      if (refreshTimerId !== null) {
        window.clearInterval(refreshTimerId)
      }
    }
  }, [accessProvider])

  return pluginTools
}
