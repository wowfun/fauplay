import { isObjectArray, isStringArray, toArgsWithoutOperation } from './pathArgs'

export interface DispatchHttpRoute {
  method?: 'POST' | 'PUT' | 'PATCH'
  endpointPath: string
  payload: Record<string, unknown>
  timeoutMs?: number
}

export function resolveDispatchHttpRoute(toolName: string, args: Record<string, unknown>): DispatchHttpRoute | null {
  const operation = typeof args.operation === 'string' ? args.operation : ''
  const payload = toArgsWithoutOperation(args)

  if (toolName === 'local.data') {
    if (operation === 'setAnnotationValue') {
      return {
        method: 'PUT',
        endpointPath: '/v1/file-annotations',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'bindAnnotationTag') {
      return {
        method: 'POST',
        endpointPath: '/v1/file-annotations/tags/bind',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'unbindAnnotationTag') {
      return {
        method: 'POST',
        endpointPath: '/v1/file-annotations/tags/unbind',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'batchRebindPaths') {
      return {
        method: 'PATCH',
        endpointPath: '/v1/files/relative-paths',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'cleanupMissingFiles') {
      return {
        method: 'POST',
        endpointPath: '/v1/files/missing/cleanups',
        payload,
      }
    }
    if (operation === 'ensureFileEntries') {
      return {
        method: 'POST',
        endpointPath: '/v1/files/indexes',
        payload,
        timeoutMs: 120000,
      }
    }
    return null
  }

  if (toolName === 'data.findDuplicateFiles') {
    return {
      method: 'POST',
      endpointPath: '/v1/files/duplicates/query',
      payload,
      timeoutMs: 120000,
    }
  }

  if (toolName === 'vision.face') {
    if (operation === 'detectAsset') {
      return {
        endpointPath: '/v1/faces/detect-asset',
        payload,
        timeoutMs: 120000,
      }
    }
    if (operation === 'detectAssets') {
      return {
        endpointPath: '/v1/faces/detect-assets',
        payload,
        timeoutMs: 600000,
      }
    }
    if (operation === 'clusterPending') {
      return {
        endpointPath: '/v1/faces/cluster-pending',
        payload,
      }
    }
    if (operation === 'listPeople') {
      return {
        endpointPath: '/v1/faces/list-people',
        payload,
      }
    }
    if (operation === 'renamePerson') {
      return {
        endpointPath: '/v1/faces/rename-person',
        payload,
      }
    }
    if (operation === 'mergePeople') {
      return {
        endpointPath: '/v1/faces/merge-people',
        payload,
      }
    }
    if (operation === 'listAssetFaces') {
      return {
        endpointPath: '/v1/faces/list-asset-faces',
        payload,
      }
    }
    if (operation === 'listReviewFaces') {
      return {
        endpointPath: '/v1/faces/list-review-faces',
        payload,
      }
    }
    if (operation === 'suggestPeople') {
      return {
        endpointPath: '/v1/faces/suggest-people',
        payload,
      }
    }
    if (operation === 'assignFaces') {
      return {
        endpointPath: '/v1/faces/assign-faces',
        payload,
      }
    }
    if (operation === 'createPersonFromFaces') {
      return {
        endpointPath: '/v1/faces/create-person-from-faces',
        payload,
      }
    }
    if (operation === 'unassignFaces') {
      return {
        endpointPath: '/v1/faces/unassign-faces',
        payload,
      }
    }
    if (operation === 'ignoreFaces') {
      return {
        endpointPath: '/v1/faces/ignore-faces',
        payload,
      }
    }
    if (operation === 'restoreIgnoredFaces') {
      return {
        endpointPath: '/v1/faces/restore-ignored-faces',
        payload,
      }
    }
    if (operation === 'requeueFaces') {
      return {
        endpointPath: '/v1/faces/requeue-faces',
        payload,
      }
    }
    return null
  }

  if (toolName === 'data.tags') {
    if (operation === 'listFileTags') {
      return {
        endpointPath: '/v1/data/tags/file',
        payload,
      }
    }
    if (operation === 'listTagOptions') {
      return {
        endpointPath: '/v1/data/tags/options',
        payload,
      }
    }
    if (operation === 'queryFiles') {
      return {
        endpointPath: '/v1/data/tags/query',
        payload,
      }
    }
    return null
  }

  if (toolName === 'fs.softDelete' && isStringArray(args.absolutePaths)) {
    return {
      method: 'POST',
      endpointPath: '/v1/recycle/items/move',
      payload: {
        absolutePaths: args.absolutePaths,
        ...(typeof args.reason === 'string' && args.reason.trim() ? { reason: args.reason.trim() } : {}),
      },
      timeoutMs: 120000,
    }
  }

  if (toolName === 'fs.restore' && isObjectArray(args.items)) {
    return {
      method: 'POST',
      endpointPath: '/v1/recycle/items/restore',
      payload: {
        items: args.items,
      },
      timeoutMs: 120000,
    }
  }

  return null
}
