import { createMcpRuntimeError } from './runtime-errors.mjs'
import {
  detectAssets,
  createDetectAssetsJob,
  getDetectAssetsJob,
  cancelDetectAssetsJob,
  listDetectAssetsJobItems,
  clusterPendingFaces,
  mergePeople,
  suggestPeople,
} from './data/core.mjs'

export function throwHttpGatewayRouteNotFound(pathname) {
  throw createMcpRuntimeError('MCP_METHOD_NOT_FOUND', `Not found: ${pathname}`, 404)
}

function createExactHttpGatewayRoute(method, pathname, handler) {
  return {
    method,
    matches(candidatePathname) {
      return candidatePathname === pathname
    },
    handler,
  }
}

function createPrefixHttpGatewayRoute(method, prefix, handler) {
  return {
    method,
    matches(candidatePathname) {
      return candidatePathname.startsWith(prefix)
    },
    handler,
  }
}

function parseFaceScanJobPath(pathname) {
  const prefix = '/v1/faces/detect-assets/jobs/'
  if (!pathname.startsWith(prefix)) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  const suffix = pathname.slice(prefix.length)
  const parts = suffix.split('/').filter(Boolean)
  if (parts.length > 2) {
    throwHttpGatewayRouteNotFound(pathname)
  }
  const jobId = parts.length > 0 ? decodeURIComponent(parts[0]) : ''
  if (!jobId) {
    throw createMcpRuntimeError('MCP_INVALID_PARAMS', 'jobId is required', 400)
  }
  return {
    jobId,
    action: parts[1] || '',
  }
}

const httpGatewayRoutes = [
  createExactHttpGatewayRoute('POST', '/v1/faces/detect-assets', ({ runtime, payload }) => detectAssets(runtime, payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/detect-assets/jobs', ({ runtime, payload }) => createDetectAssetsJob(runtime, payload)),
  createPrefixHttpGatewayRoute('GET', '/v1/faces/detect-assets/jobs/', ({ pathname, requestUrl }) => {
    const { jobId, action } = parseFaceScanJobPath(pathname)
    if (!action) {
      return getDetectAssetsJob(jobId)
    }
    if (action === 'items') {
      return listDetectAssetsJobItems(jobId, {
        offset: requestUrl.searchParams.get('offset'),
        limit: requestUrl.searchParams.get('limit'),
      })
    }
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/faces/detect-assets/jobs/', ({ pathname }) => {
    const { jobId, action } = parseFaceScanJobPath(pathname)
    if (action === 'cancel') {
      return cancelDetectAssetsJob(jobId)
    }
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createExactHttpGatewayRoute('POST', '/v1/faces/cluster-pending', ({ payload }) => clusterPendingFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/merge-people', ({ payload }) => mergePeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/suggest-people', ({ payload }) => suggestPeople(payload)),
]

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
