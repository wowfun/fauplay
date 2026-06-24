import { useEffect, useState } from 'react'
import {
  loadRuntimeCapabilities,
  type RuntimeToolDescriptor,
} from '@/lib/runtimeApi'

const RUNTIME_CAPABILITY_REFRESH_INTERVAL_MS = 15000

interface UseWorkspacePluginToolsParams {
  accessProvider: 'local-browser' | 'remote-readonly'
}

export function useWorkspacePluginTools({
  accessProvider,
}: UseWorkspacePluginToolsParams): RuntimeToolDescriptor[] {
  const [pluginTools, setPluginTools] = useState<RuntimeToolDescriptor[]>([])

  useEffect(() => {
    if (accessProvider === 'remote-readonly') {
      setPluginTools([])
      return () => {}
    }

    let disposed = false
    let refreshTimerId: number | null = null

    const refreshCapabilities = async () => {
      try {
        const snapshot = await loadRuntimeCapabilities()
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
    }, RUNTIME_CAPABILITY_REFRESH_INTERVAL_MS)

    return () => {
      disposed = true
      if (refreshTimerId !== null) {
        window.clearInterval(refreshTimerId)
      }
    }
  }, [accessProvider])

  return pluginTools
}
