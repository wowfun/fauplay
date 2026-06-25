import type { FaceRecord, FaceReviewBucket, PersonScope } from '../types.ts'
import type { PanelView, NoticeTone } from './peoplePanelText.ts'
import { resolvePeoplePanelFacesLoadPlan } from './peoplePanelModel.ts'

export interface PeoplePanelFaceApiContext {
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
}

export interface PeoplePanelFacesLoaders {
  listPersonFaces: (
    context: PeoplePanelFaceApiContext,
    options: { personId: string; scope: PersonScope },
  ) => Promise<FaceRecord[]>
  listReviewFaces: (
    context: PeoplePanelFaceApiContext,
    options: { scope: PersonScope; bucket: FaceReviewBucket; size: number },
  ) => Promise<FaceRecord[]>
}

export interface LoadPeoplePanelFacesParams {
  context: PeoplePanelFaceApiContext
  view: PanelView
  selectedPersonId: string | null
  readonly: boolean
  scope: PersonScope
  loaders: PeoplePanelFacesLoaders
}

export type PeoplePanelFacesLoadResult =
  | { kind: 'empty' }
  | { kind: 'loaded'; faces: FaceRecord[] }
  | { kind: 'failed'; message: string }

export interface PeoplePanelFacesLoadCommit {
  faces: FaceRecord[]
  notice: { tone: NoticeTone; message: string } | null
}

export async function loadPeoplePanelFaces({
  context,
  view,
  selectedPersonId,
  readonly,
  scope,
  loaders,
}: LoadPeoplePanelFacesParams): Promise<PeoplePanelFacesLoadResult> {
  try {
    const plan = resolvePeoplePanelFacesLoadPlan({
      view,
      selectedPersonId,
      readonly,
      scope,
    })
    if (plan.kind === 'empty') return { kind: 'empty' }
    if (plan.kind === 'person') {
      return {
        kind: 'loaded',
        faces: await loaders.listPersonFaces(context, {
          personId: plan.personId,
          scope: plan.scope,
        }),
      }
    }

    return {
      kind: 'loaded',
      faces: await loaders.listReviewFaces(context, {
        scope: plan.scope,
        bucket: plan.bucket,
        size: plan.size,
      }),
    }
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : '人脸列表读取失败',
    }
  }
}

export function resolvePeoplePanelFacesLoadCommit(
  result: PeoplePanelFacesLoadResult,
): PeoplePanelFacesLoadCommit {
  if (result.kind === 'loaded') {
    return {
      faces: result.faces,
      notice: null,
    }
  }
  if (result.kind === 'failed') {
    return {
      faces: [],
      notice: {
        tone: 'error',
        message: result.message,
      },
    }
  }
  return {
    faces: [],
    notice: null,
  }
}
