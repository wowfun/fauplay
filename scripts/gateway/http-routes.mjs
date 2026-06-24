import { createMcpRuntimeError } from './mcp/runtime.mjs'
import {
  batchRebindPaths,
  ensureFileEntries,
  queryDuplicateFiles,
  detectAssets,
  createDetectAssetsJob,
  getDetectAssetsJob,
  cancelDetectAssetsJob,
  listDetectAssetsJobItems,
  assignFaces,
  bindAnnotationTag,
  callVisionInference,
  clusterPendingFaces,
  listRecycleItems,
  moveFilesToRecycle,
  createPersonFromFaces,
  getFileTags,
  readFileTextPreview,
  ignoreFaces,
  listAssetFaces,
  listPeople,
  listReviewFaces,
  listTagOptions,
  mergePeople,
  queryFilesByTags,
  requeueFaces,
  renamePerson,
  restoreRecycleItems,
  restoreIgnoredFaces,
  saveDetectedFaces,
  setAnnotationValue,
  suggestPeople,
  unassignFaces,
  unbindAnnotationTag,
  cleanupMissingFiles,
} from './data/core.mjs'

export function throwHttpGatewayRouteNotFound(pathname) {
  throw createMcpRuntimeError('MCP_METHOD_NOT_FOUND', `Not found: ${pathname}`, 404)
}

function throwHttpGatewayRouteOffline(pathname) {
  throw createMcpRuntimeError(
    'MCP_METHOD_NOT_FOUND',
    `Endpoint offline: ${pathname}`,
    404,
  )
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
  createExactHttpGatewayRoute('POST', '/v1/data/tags/file', ({ payload }) => getFileTags(payload)),
  createExactHttpGatewayRoute('POST', '/v1/data/tags/options', ({ payload }) => listTagOptions(payload)),
  createExactHttpGatewayRoute('POST', '/v1/data/tags/query', ({ payload }) => queryFilesByTags(payload)),
  createExactHttpGatewayRoute('PUT', '/v1/file-annotations', ({ payload }) => setAnnotationValue(payload)),
  createExactHttpGatewayRoute('POST', '/v1/file-annotations/tags/bind', ({ payload }) => bindAnnotationTag(payload)),
  createExactHttpGatewayRoute('POST', '/v1/file-annotations/tags/unbind', ({ payload }) => unbindAnnotationTag(payload)),
  createExactHttpGatewayRoute('PATCH', '/v1/files/relative-paths', ({ payload }) => batchRebindPaths(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/indexes', ({ payload }) => ensureFileEntries(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/duplicates/query', ({ payload }) => queryDuplicateFiles(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/missing/cleanups', ({ payload }) => cleanupMissingFiles(payload)),
  createExactHttpGatewayRoute('POST', '/v1/files/text-preview', ({ payload }) => readFileTextPreview(payload)),
  createExactHttpGatewayRoute('POST', '/v1/recycle/items/move', ({ payload }) => moveFilesToRecycle(payload)),
  createExactHttpGatewayRoute('POST', '/v1/recycle/items/list', ({ payload }) => listRecycleItems(payload)),
  createExactHttpGatewayRoute('POST', '/v1/recycle/items/restore', ({ payload }) => restoreRecycleItems(payload)),
  createExactHttpGatewayRoute('POST', '/v1/file-bindings/reconciliations', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createExactHttpGatewayRoute('POST', '/v1/file-bindings/cleanups', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createExactHttpGatewayRoute('POST', '/v1/faces/detect-asset', async ({ runtime, payload }) => {
    const inferred = await callVisionInference(runtime, payload)
    const persisted = await saveDetectedFaces({
      rootPath: inferred.rootPath,
      relativePath: inferred.relativePath,
      facePayloads: inferred.faces,
    })
    const runCluster = payload?.runCluster === true
    const hasVideoFaces = persisted.faces.some((face) => face?.mediaType === 'video')
    const cluster = runCluster && persisted.created > 0
      ? await clusterPendingFaces({
        limit: persisted.created,
        assetId: persisted.assetId,
        minFaces: hasVideoFaces ? 3 : 1,
      })
      : null
    return {
      ...persisted,
      inferenceDetected: inferred.detected,
      ...(cluster ? { cluster } : {}),
    }
  }),
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
  createExactHttpGatewayRoute('POST', '/v1/faces/list-people', ({ payload }) => listPeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/rename-person', ({ payload }) => renamePerson(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/merge-people', ({ payload }) => mergePeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/list-asset-faces', ({ payload }) => listAssetFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/list-review-faces', ({ payload }) => listReviewFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/suggest-people', ({ payload }) => suggestPeople(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/assign-faces', ({ payload }) => assignFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/create-person-from-faces', ({ payload }) => createPersonFromFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/unassign-faces', ({ payload }) => unassignFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/ignore-faces', ({ payload }) => ignoreFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/restore-ignored-faces', ({ payload }) => restoreIgnoredFaces(payload)),
  createExactHttpGatewayRoute('POST', '/v1/faces/requeue-faces', ({ payload }) => requeueFaces(payload)),
  createPrefixHttpGatewayRoute('POST', '/v1/local-data/', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/annotations/', ({ pathname }) => {
    throwHttpGatewayRouteOffline(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/data/tags/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/file-annotations/tags/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/files/duplicates/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/files/missing/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/file-bindings/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/faces/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
  createPrefixHttpGatewayRoute('POST', '/v1/recycle/', ({ pathname }) => {
    throwHttpGatewayRouteNotFound(pathname)
  }),
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
