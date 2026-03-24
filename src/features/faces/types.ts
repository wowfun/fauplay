export interface FaceBoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type PersonScope = 'global' | 'root'
export type FaceReviewBucket = 'unassigned' | 'ignored'
export type FaceStatus = 'assigned' | 'unassigned' | 'deferred' | 'manual_unassigned' | 'ignored'

export interface PreviewFaceOverlayItem {
  faceId: string
  assetPath: string
  boundingBox: FaceBoundingBox
  score: number
  status: FaceStatus
  personId: string | null
  personName: string | null
}

export interface PersonSummary {
  personId: string
  name: string
  faceCount: number
  globalFaceCount: number
  featureFaceId: string | null
  featureAssetPath: string | null
  updatedAt: number | null
}

export interface FaceRecord {
  faceId: string
  assetId: string
  assetPath: string | null
  boundingBox: FaceBoundingBox
  score: number
  status: FaceStatus
  personId: string | null
  personName: string | null
  assignedBy: string | null
  updatedAt: number
}

export interface PersonSuggestion {
  personId: string
  name: string
  score: number
  distance: number
  supportingFace: {
    faceId: string
    assetId: string
    assetPath: string | null
    boundingBox: FaceBoundingBox
  }
}

export interface FaceMutationItem {
  faceId: string
  ok: boolean
  previousStatus: FaceStatus | null
  previousPersonId: string | null
  nextStatus: FaceStatus | null
  nextPersonId: string | null
  reasonCode: string | null
  error: string | null
}

export interface FaceMutationResult {
  ok: boolean
  action: string
  total: number
  succeeded: number
  failed: number
  items: FaceMutationItem[]
  targetPersonId?: string
  personId?: string | null
}
