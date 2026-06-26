import { createMcpRuntimeError } from './runtime-errors.mjs'

export function throwHttpGatewayRouteNotFound(pathname) {
  throw createMcpRuntimeError('MCP_METHOD_NOT_FOUND', `Not found: ${pathname}`, 404)
}

const httpGatewayRoutes = []

export function findHttpGatewayRoute(method, pathname) {
  return httpGatewayRoutes.find((route) => route.method === method && route.matches(pathname)) ?? null
}

export async function handleHttpGatewayRoute(runtime, method, pathname, payload, requestUrl) {
  const route = findHttpGatewayRoute(method, pathname)
  if (!route) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  return route.handler({
    runtime,
    pathname,
    payload,
    requestUrl,
  })
}
