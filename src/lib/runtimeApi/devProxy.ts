export const DEFAULT_DEV_RUNTIME_TARGET = 'http://127.0.0.1:3211'

export interface RuntimeApiDevProxyEnv {
  FAUPLAY_DEV_PROXY_RUNTIME_API?: string
  FAUPLAY_DEV_RUNTIME_TARGET?: string
}

export interface RuntimeApiDevProxyRoute {
  target: string
  changeOrigin: false
}

export type RuntimeApiDevProxyConfig = Record<string, RuntimeApiDevProxyRoute>

export function resolveRuntimeApiDevProxyConfig(
  env: RuntimeApiDevProxyEnv,
): RuntimeApiDevProxyConfig {
  const runtimeTarget = env.FAUPLAY_DEV_RUNTIME_TARGET?.trim() || DEFAULT_DEV_RUNTIME_TARGET

  if (isTruthyEnv(env.FAUPLAY_DEV_PROXY_RUNTIME_API)) {
    return {
      '/v1/remote': proxyRoute(runtimeTarget),
      '/v1': proxyRoute(runtimeTarget),
    }
  }

  return {
    '/v1/remote': proxyRoute(runtimeTarget),
  }
}

function proxyRoute(target: string): RuntimeApiDevProxyRoute {
  return {
    target,
    changeOrigin: false,
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}
