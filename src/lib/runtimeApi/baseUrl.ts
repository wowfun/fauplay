export const DEFAULT_LOCAL_RUNTIME_BASE_URL = 'http://127.0.0.1:3211'

export interface RuntimeBaseUrlEnv {
  VITE_FAUPLAY_RUNTIME_BASE_URL?: string
  VITE_LOCAL_GATEWAY_BASE_URL?: string
}

export function resolveLocalRuntimeBaseUrl(
  env: RuntimeBaseUrlEnv,
  getCurrentOrigin: () => string,
): string {
  const configuredBaseUrl = firstConfiguredBaseUrl([
    env.VITE_FAUPLAY_RUNTIME_BASE_URL,
    env.VITE_LOCAL_GATEWAY_BASE_URL,
  ])

  if (configuredBaseUrl === '/' || configuredBaseUrl === 'same-origin') {
    return getCurrentOrigin()
  }

  return configuredBaseUrl
}

function firstConfiguredBaseUrl(candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = candidate?.trim()
    if (normalized) {
      return normalized
    }
  }

  return DEFAULT_LOCAL_RUNTIME_BASE_URL
}
