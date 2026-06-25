import {
  buildAnnotationFileTagsRequest,
  buildAnnotationTagQueryRequest,
  buildGlobalAnnotationTagOptionsRequest,
  createAnnotationTagQueryPageProgress,
  resolveNextAnnotationTagQueryPageProgress,
  type AnnotationRemoteWorkspaceIdentity,
  type AnnotationHttpRequest,
  type AnnotationRequestTarget,
} from './annotationRequestPlanModel.ts'
import {
  readAnnotationTagOptionsFromResult,
  readAnnotationTagViewsFromResult,
  type AnnotationGatewayTagOptionRecord,
  type AnnotationGatewayTagRecord,
  type AnnotationGatewayFileTagView,
} from './annotationTagModel.ts'

const DEFAULT_TAG_QUERY_PAGE_SIZE = 1000
const DEFAULT_TAG_QUERY_MAX_PAGE = 10000

interface GatewayTagQueryResult {
  items?: AnnotationGatewayFileTagView[]
  total?: number
}

interface GatewayFileTagResult {
  file?: AnnotationGatewayFileTagView | null
}

export type AnnotationHttpCaller = <T>(request: AnnotationHttpRequest) => Promise<T>

export interface LoadAnnotationTagViewsParams {
  target: AnnotationRequestTarget
  callAnnotationHttp: AnnotationHttpCaller
  pageSize?: number
  maxPage?: number
}

export interface LoadAnnotationFileTagsParams {
  target: AnnotationRequestTarget
  relativePath: string
  callAnnotationHttp: AnnotationHttpCaller
}

export interface LoadGlobalAnnotationTagOptionRecordsParams {
  remoteReadonlyActive: boolean
  activeRemoteWorkspace: AnnotationRemoteWorkspaceIdentity | null
  callAnnotationHttp: AnnotationHttpCaller
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function loadAnnotationTagViews({
  target,
  callAnnotationHttp,
  pageSize = DEFAULT_TAG_QUERY_PAGE_SIZE,
  maxPage = DEFAULT_TAG_QUERY_MAX_PAGE,
}: LoadAnnotationTagViewsParams): Promise<AnnotationGatewayFileTagView[]> {
  let progress = createAnnotationTagQueryPageProgress()
  const items: AnnotationGatewayFileTagView[] = []

  while (progress.shouldContinue) {
    const request = buildAnnotationTagQueryRequest({
      target,
      page: progress.page,
      pageSize,
    })
    if (!request) return items

    const result = await callAnnotationHttp<GatewayTagQueryResult>(request)
    const batch = readAnnotationTagViewsFromResult(result)
    items.push(...batch)

    progress = resolveNextAnnotationTagQueryPageProgress({
      progress,
      batchSize: batch.length,
      itemsLoaded: items.length,
      resultTotal: result.total,
      pageSize,
      maxPage,
    })
  }

  return items
}

export async function loadAnnotationFileTags({
  target,
  relativePath,
  callAnnotationHttp,
}: LoadAnnotationFileTagsParams): Promise<AnnotationGatewayTagRecord[]> {
  const request = buildAnnotationFileTagsRequest({
    target,
    relativePath,
  })
  if (!request) return []

  const result = await callAnnotationHttp<GatewayFileTagResult>(request)
  const fileView = isRecord(result.file) ? result.file : null
  return fileView && Array.isArray(fileView.tags) ? fileView.tags : []
}

export async function loadGlobalAnnotationTagOptionRecords({
  remoteReadonlyActive,
  activeRemoteWorkspace,
  callAnnotationHttp,
}: LoadGlobalAnnotationTagOptionRecordsParams): Promise<AnnotationGatewayTagOptionRecord[]> {
  const request = buildGlobalAnnotationTagOptionsRequest({
    remoteReadonlyActive,
    activeRemoteWorkspace,
  })
  const result = await callAnnotationHttp(request)
  return readAnnotationTagOptionsFromResult(result)
}
