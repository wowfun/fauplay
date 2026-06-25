export type AnnotationRequestTransport = 'runtime' | 'remote'

export type AnnotationRequestTarget =
  | { kind: 'runtime'; rootPath: string }
  | { kind: 'remote'; rootId: string }
  | { kind: 'unavailable' }

export interface AnnotationRemoteWorkspaceIdentity {
  uiRootId: string
  configRootId: string
}

export interface ResolveAnnotationRequestTargetParams {
  rootId: string
  rootPath: string | null
  remoteReadonlyActive: boolean
  activeRemoteWorkspace: AnnotationRemoteWorkspaceIdentity | null
}

export interface AnnotationHttpRequest {
  transport: AnnotationRequestTransport
  path: string
  body: Record<string, unknown>
}

export interface BuildAnnotationTagQueryRequestParams {
  target: AnnotationRequestTarget
  page: number
  pageSize: number
}

export interface BuildAnnotationFileTagsRequestParams {
  target: AnnotationRequestTarget
  relativePath: string
}

export interface BuildGlobalAnnotationTagOptionsRequestParams {
  remoteReadonlyActive: boolean
  activeRemoteWorkspace: AnnotationRemoteWorkspaceIdentity | null
}

export interface AnnotationTagQueryPageProgress {
  page: number
  total: number
  shouldContinue: boolean
}

export interface ResolveNextAnnotationTagQueryPageProgressParams {
  progress: AnnotationTagQueryPageProgress
  batchSize: number
  itemsLoaded: number
  resultTotal: unknown
  pageSize: number
  maxPage: number
}

export function createAnnotationTagQueryPageProgress(): AnnotationTagQueryPageProgress {
  return {
    page: 1,
    total: Number.POSITIVE_INFINITY,
    shouldContinue: true,
  }
}

export function resolveNextAnnotationTagQueryPageProgress({
  progress,
  batchSize,
  itemsLoaded,
  resultTotal,
  pageSize,
  maxPage,
}: ResolveNextAnnotationTagQueryPageProgressParams): AnnotationTagQueryPageProgress {
  const numericTotal = Number(resultTotal)
  const total = Number.isFinite(numericTotal) && numericTotal >= 0
    ? numericTotal
    : itemsLoaded

  if (batchSize < pageSize || itemsLoaded >= total || progress.page >= maxPage) {
    return {
      page: progress.page,
      total,
      shouldContinue: false,
    }
  }

  return {
    page: progress.page + 1,
    total,
    shouldContinue: true,
  }
}

export function resolveAnnotationRequestTarget({
  rootId,
  rootPath,
  remoteReadonlyActive,
  activeRemoteWorkspace,
}: ResolveAnnotationRequestTargetParams): AnnotationRequestTarget {
  const remoteRootId = activeRemoteWorkspace?.configRootId?.trim() ?? ''
  if (
    remoteReadonlyActive
    && activeRemoteWorkspace?.uiRootId === rootId
    && remoteRootId
  ) {
    return {
      kind: 'remote',
      rootId: remoteRootId,
    }
  }

  const normalizedRootPath = rootPath?.trim() ?? ''
  if (normalizedRootPath) {
    return {
      kind: 'runtime',
      rootPath: normalizedRootPath,
    }
  }

  return {
    kind: 'unavailable',
  }
}

export function buildAnnotationTagQueryRequest({
  target,
  page,
  pageSize,
}: BuildAnnotationTagQueryRequestParams): AnnotationHttpRequest | null {
  if (target.kind === 'unavailable') return null

  const sharedBody = {
    page,
    size: pageSize,
    includeTagKeys: [],
    excludeTagKeys: [],
    includeMatchMode: 'or',
  }

  if (target.kind === 'remote') {
    return {
      transport: 'remote',
      path: '/v1/remote/tags/query',
      body: {
        rootId: target.rootId,
        ...sharedBody,
      },
    }
  }

  return {
    transport: 'runtime',
    path: '/v1/data/tags/query',
    body: {
      rootPath: target.rootPath,
      ...sharedBody,
    },
  }
}

export function buildAnnotationFileTagsRequest({
  target,
  relativePath,
}: BuildAnnotationFileTagsRequestParams): AnnotationHttpRequest | null {
  if (target.kind === 'unavailable') return null

  if (target.kind === 'remote') {
    return {
      transport: 'remote',
      path: '/v1/remote/tags/file',
      body: {
        rootId: target.rootId,
        relativePath,
      },
    }
  }

  return {
    transport: 'runtime',
    path: '/v1/data/tags/file',
    body: {
      rootPath: target.rootPath,
      relativePath,
    },
  }
}

export function buildGlobalAnnotationTagOptionsRequest({
  remoteReadonlyActive,
  activeRemoteWorkspace,
}: BuildGlobalAnnotationTagOptionsRequestParams): AnnotationHttpRequest {
  const remoteRootId = activeRemoteWorkspace?.configRootId?.trim() ?? ''
  if (remoteReadonlyActive && remoteRootId) {
    return {
      transport: 'remote',
      path: '/v1/remote/tags/options',
      body: {
        rootId: remoteRootId,
      },
    }
  }

  return {
    transport: 'runtime',
    path: '/v1/data/tags/options',
    body: {},
  }
}
