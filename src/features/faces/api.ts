import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { fromRemoteUiRootId } from '@/lib/accessState'
import { callRemoteGatewayHttp } from '@/lib/gateway'
import type {
  FaceBoundingBox,
  FaceMediaType,
  FaceMutationItem,
  FaceMutationResult,
  FaceRecord,
  FaceReviewBucket,
  FaceStatus,
  PersonScope,
  PersonSuggestion,
  PersonSummary,
} from '@/features/faces/types'

export interface FaceApiContext {
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
}

function getRemoteReadonlyRootId(context: FaceApiContext): string | null {
  if (context.rootHandle) return null
  return fromRemoteUiRootId(context.rootId)
}

function assertLocalWritableFaceContext(context: FaceApiContext): void {
  if (getRemoteReadonlyRootId(context)) {
    throw new Error('远程只读模式不支持人物写操作')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback
}

function readFaceStatus(value: unknown): FaceStatus {
  return value === 'assigned'
    || value === 'unassigned'
    || value === 'deferred'
    || value === 'manual_unassigned'
    || value === 'ignored'
    ? value
    : 'unassigned'
}

function readFaceMediaType(value: unknown): FaceMediaType {
  return value === 'video' ? 'video' : 'image'
}

function readBoundingBox(value: unknown): FaceBoundingBox | null {
  if (!isRecord(value)) return null
  const x1 = readNumber(value.x1, NaN)
  const y1 = readNumber(value.y1, NaN)
  const x2 = readNumber(value.x2, NaN)
  const y2 = readNumber(value.y2, NaN)
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return null
  }
  return { x1, y1, x2, y2 }
}

async function callVisionFace<T = unknown>(
  context: FaceApiContext,
  additionalArgs: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  assertLocalWritableFaceContext(context)
  const result = await dispatchSystemTool({
    toolName: 'vision.face',
    rootHandle: context.rootHandle,
    rootId: context.rootId,
    additionalArgs,
    timeoutMs,
  })

  if (!result.ok) {
    throw new Error(result.error || 'vision.face 调用失败')
  }

  return result.result as T
}

function readPeopleItems(result: unknown): PersonSummary[] {
  if (!isRecord(result) || !Array.isArray(result.items)) return []
  return result.items.flatMap((item) => {
    if (!isRecord(item)) return []
    const personId = readString(item.personId)
    if (!personId) return []
    return [{
      personId,
      name: readString(item.name),
      faceCount: readNumber(item.faceCount, 0),
      globalFaceCount: readNumber(item.globalFaceCount, readNumber(item.faceCount, 0)),
      featureFaceId: readNullableString(item.featureFaceId),
      featureAssetPath: readNullableString(item.featureAssetPath),
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
    }]
  })
}

function readFaceItems(result: unknown): FaceRecord[] {
  if (!isRecord(result) || !Array.isArray(result.items)) return []
  return result.items.flatMap((item) => {
    if (!isRecord(item)) return []
    const faceId = readString(item.faceId)
    const assetId = readString(item.assetId)
    const boundingBox = readBoundingBox(item.boundingBox)
    if (!faceId || !assetId || !boundingBox) return []
    return [{
      faceId,
      assetId,
      assetPath: readNullableString(item.assetPath),
      boundingBox,
      score: readNumber(item.score, 0),
      status: readFaceStatus(item.status),
      mediaType: readFaceMediaType(item.mediaType),
      frameTsMs: typeof item.frameTsMs === 'number' ? item.frameTsMs : null,
      personId: readNullableString(item.personId),
      personName: readNullableString(item.personName),
      assignedBy: readNullableString(item.assignedBy),
      updatedAt: readNumber(item.updatedAt, 0),
    }]
  })
}

function readSuggestionItems(result: unknown): PersonSuggestion[] {
  if (!isRecord(result) || !Array.isArray(result.items)) return []
  return result.items.flatMap((item) => {
    if (!isRecord(item)) return []
    const personId = readString(item.personId)
    const supportingFace = isRecord(item.supportingFace) ? item.supportingFace : null
    const boundingBox = supportingFace ? readBoundingBox(supportingFace.boundingBox) : null
    if (!personId || !supportingFace || !boundingBox) return []
    return [{
      personId,
      name: readString(item.name),
      score: readNumber(item.score, 0),
      distance: readNumber(item.distance, 1),
      supportingFace: {
        faceId: readString(supportingFace.faceId),
        assetId: readString(supportingFace.assetId),
        assetPath: readNullableString(supportingFace.assetPath),
        mediaType: readFaceMediaType(supportingFace.mediaType),
        frameTsMs: typeof supportingFace.frameTsMs === 'number' ? supportingFace.frameTsMs : null,
        boundingBox,
      },
    }]
  })
}

function readMutationItems(result: unknown): FaceMutationItem[] {
  if (!isRecord(result) || !Array.isArray(result.items)) return []
  return result.items.flatMap((item) => {
    if (!isRecord(item)) return []
    const faceId = readString(item.faceId)
    if (!faceId) return []
    return [{
      faceId,
      ok: item.ok === true,
      previousStatus: item.previousStatus === null ? null : readFaceStatus(item.previousStatus),
      previousPersonId: readNullableString(item.previousPersonId),
      nextStatus: item.nextStatus === null ? null : readFaceStatus(item.nextStatus),
      nextPersonId: readNullableString(item.nextPersonId),
      reasonCode: readNullableString(item.reasonCode),
      error: readNullableString(item.error),
    }]
  })
}

function readMutationResult(result: unknown): FaceMutationResult {
  if (!isRecord(result)) {
    return {
      ok: false,
      action: '',
      total: 0,
      succeeded: 0,
      failed: 0,
      items: [],
    }
  }

  return {
    ok: result.ok !== false,
    action: readString(result.action),
    total: readNumber(result.total, 0),
    succeeded: readNumber(result.succeeded, 0),
    failed: readNumber(result.failed, 0),
    items: readMutationItems(result),
    targetPersonId: readNullableString(result.targetPersonId) ?? undefined,
    personId: readNullableString(result.personId),
  }
}

async function callRemoteReadonlyFaces<T = unknown>(
  context: FaceApiContext,
  endpointPath: string,
  body: Record<string, unknown> = {}
): Promise<T | null> {
  const rootId = getRemoteReadonlyRootId(context)
  if (!rootId) return null
  return callRemoteGatewayHttp<T>(endpointPath, {
    rootId,
    ...body,
  })
}

export async function listPeople(
  context: FaceApiContext,
  options: {
    scope: PersonScope
    query?: string
    page?: number
    size?: number
  }
): Promise<PersonSummary[]> {
  const remoteResult = await callRemoteReadonlyFaces(context, '/v1/remote/faces/list-people', {
    ...(options.query ? { query: options.query } : {}),
    ...(typeof options.page === 'number' ? { page: options.page } : {}),
    ...(typeof options.size === 'number' ? { size: options.size } : {}),
  })
  if (remoteResult) {
    return readPeopleItems(remoteResult)
  }

  const result = await callVisionFace(context, {
    operation: 'listPeople',
    scope: options.scope,
    page: options.page ?? 1,
    size: options.size ?? 200,
    ...(options.query ? { query: options.query } : {}),
  })
  return readPeopleItems(result)
}

export async function listPersonFaces(
  context: FaceApiContext,
  options: {
    personId: string
    scope: PersonScope
  }
): Promise<FaceRecord[]> {
  const remoteResult = await callRemoteReadonlyFaces(context, '/v1/remote/faces/list-person-faces', {
    personId: options.personId,
  })
  if (remoteResult) {
    return readFaceItems(remoteResult)
  }

  const result = await callVisionFace(context, {
    operation: 'listAssetFaces',
    personId: options.personId,
    scope: options.scope,
  })
  return readFaceItems(result)
}

export async function listFileFaces(
  context: FaceApiContext,
  options: {
    relativePath: string
  }
): Promise<FaceRecord[]> {
  const result = await callVisionFace(context, {
    operation: 'listAssetFaces',
    relativePath: options.relativePath,
  })
  return readFaceItems(result)
}

export async function listReviewFaces(
  context: FaceApiContext,
  options: {
    scope: PersonScope
    bucket: FaceReviewBucket
    page?: number
    size?: number
  }
): Promise<FaceRecord[]> {
  if (getRemoteReadonlyRootId(context)) {
    throw new Error('远程只读模式不支持未归属/忽略视图')
  }

  const result = await callVisionFace(context, {
    operation: 'listReviewFaces',
    scope: options.scope,
    bucket: options.bucket,
    page: options.page ?? 1,
    size: options.size ?? 300,
  })
  return readFaceItems(result)
}

export async function suggestPeople(
  context: FaceApiContext,
  options: {
    faceId: string
    candidateSize?: number
  }
): Promise<PersonSuggestion[]> {
  const result = await callVisionFace(context, {
    operation: 'suggestPeople',
    faceId: options.faceId,
    ...(typeof options.candidateSize === 'number' ? { candidateSize: options.candidateSize } : {}),
  })
  return readSuggestionItems(result)
}

export async function renamePerson(
  context: FaceApiContext,
  options: {
    personId: string
    name: string
  }
): Promise<void> {
  assertLocalWritableFaceContext(context)
  await callVisionFace(context, {
    operation: 'renamePerson',
    personId: options.personId,
    name: options.name,
  })
}

export async function mergePeople(
  context: FaceApiContext,
  options: {
    targetPersonId: string
    sourcePersonIds: string[]
  }
): Promise<void> {
  assertLocalWritableFaceContext(context)
  await callVisionFace(context, {
    operation: 'mergePeople',
    targetPersonId: options.targetPersonId,
    sourcePersonIds: options.sourcePersonIds,
  })
}

export async function assignFaces(
  context: FaceApiContext,
  options: {
    faceIds: string[]
    targetPersonId: string
  }
): Promise<FaceMutationResult> {
  assertLocalWritableFaceContext(context)
  const result = await callVisionFace(context, {
    operation: 'assignFaces',
    faceIds: options.faceIds,
    targetPersonId: options.targetPersonId,
  })
  return readMutationResult(result)
}

export async function createPersonFromFaces(
  context: FaceApiContext,
  options: {
    faceIds: string[]
    name?: string
  }
): Promise<FaceMutationResult> {
  assertLocalWritableFaceContext(context)
  const result = await callVisionFace(context, {
    operation: 'createPersonFromFaces',
    faceIds: options.faceIds,
    ...(typeof options.name === 'string' ? { name: options.name } : {}),
  })
  return readMutationResult(result)
}

export async function unassignFaces(
  context: FaceApiContext,
  options: {
    faceIds: string[]
  }
): Promise<FaceMutationResult> {
  assertLocalWritableFaceContext(context)
  const result = await callVisionFace(context, {
    operation: 'unassignFaces',
    faceIds: options.faceIds,
  })
  return readMutationResult(result)
}

export async function ignoreFaces(
  context: FaceApiContext,
  options: {
    faceIds: string[]
  }
): Promise<FaceMutationResult> {
  assertLocalWritableFaceContext(context)
  const result = await callVisionFace(context, {
    operation: 'ignoreFaces',
    faceIds: options.faceIds,
  })
  return readMutationResult(result)
}

export async function restoreIgnoredFaces(
  context: FaceApiContext,
  options: {
    faceIds: string[]
  }
): Promise<FaceMutationResult> {
  assertLocalWritableFaceContext(context)
  const result = await callVisionFace(context, {
    operation: 'restoreIgnoredFaces',
    faceIds: options.faceIds,
  })
  return readMutationResult(result)
}

export async function requeueFaces(
  context: FaceApiContext,
  options: {
    faceIds: string[]
  }
): Promise<FaceMutationResult> {
  assertLocalWritableFaceContext(context)
  const result = await callVisionFace(context, {
    operation: 'requeueFaces',
    faceIds: options.faceIds,
  })
  return readMutationResult(result)
}
