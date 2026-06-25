import { getActiveRemoteWorkspace, isRemoteReadonlyProviderActive } from '@/lib/accessState'
import { callRemoteAccessHttp } from '@/lib/remoteAccess'
import { ensureRootPath } from '@/lib/reveal'
import { callRuntimeHttp } from '@/lib/runtimeApi'
import {
  resolveAnnotationRequestTarget,
  type AnnotationHttpRequest,
  type AnnotationRequestTarget,
} from '@/features/preview/lib/annotationRequestPlanModel'

export function resolveAnnotationTarget(
  rootId: string,
  rootHandle: FileSystemDirectoryHandle | null,
  rootLabel?: string | null
): AnnotationRequestTarget {
  const remoteReadonlyActive = isRemoteReadonlyProviderActive()
  const activeRemoteWorkspace = getActiveRemoteWorkspace()
  const remoteTarget = resolveAnnotationRequestTarget({
    rootId,
    rootPath: null,
    remoteReadonlyActive,
    activeRemoteWorkspace,
  })
  if (remoteTarget.kind === 'remote') {
    return remoteTarget
  }

  const resolvedRootPath = ensureRootPath({
    rootLabel: rootLabel || rootHandle?.name || 'current-folder',
    rootId,
    promptIfMissing: false,
  })

  return resolveAnnotationRequestTarget({
    rootId,
    rootPath: resolvedRootPath,
    remoteReadonlyActive: false,
    activeRemoteWorkspace: null,
  })
}

export function callAnnotationHttp<T>(request: AnnotationHttpRequest): Promise<T> {
  return request.transport === 'remote'
    ? callRemoteAccessHttp<T>(request.path, request.body)
    : callRuntimeHttp<T>(request.path, request.body)
}
