const GATEWAY_BASE_URL = 'http://127.0.0.1:3210'
const HEALTH_ENDPOINT = `${GATEWAY_BASE_URL}/v1/health`
const CAPABILITIES_ENDPOINT = `${GATEWAY_BASE_URL}/v1/capabilities`

export interface GatewayActionDescriptor {
  actionId: string
  title: string
  mutation: boolean
  scopes: string[]
}

interface GatewayCapabilitiesResponse {
  ok?: boolean
  data?: {
    actions?: GatewayActionDescriptor[]
  }
}

interface GatewayHealthResponse {
  ok?: boolean
}

export interface GatewayCapabilitiesSnapshot {
  online: boolean
  actions: GatewayActionDescriptor[]
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Gateway request failed: ${response.status}`)
    }
    return response.json()
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function loadGatewayCapabilities(timeoutMs: number = 2000): Promise<GatewayCapabilitiesSnapshot> {
  try {
    const health = (await fetchJsonWithTimeout(HEALTH_ENDPOINT, timeoutMs)) as GatewayHealthResponse
    if (!health.ok) {
      return { online: false, actions: [] }
    }

    const capabilities = (await fetchJsonWithTimeout(
      CAPABILITIES_ENDPOINT,
      timeoutMs
    )) as GatewayCapabilitiesResponse
    if (!capabilities.ok) {
      return { online: true, actions: [] }
    }

    const actions = Array.isArray(capabilities.data?.actions) ? capabilities.data.actions : []
    return { online: true, actions }
  } catch {
    return { online: false, actions: [] }
  }
}
