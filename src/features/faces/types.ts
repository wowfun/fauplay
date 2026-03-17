export interface FaceBoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PreviewFaceOverlayItem {
  faceId: string
  assetPath: string
  boundingBox: FaceBoundingBox
  score: number
  status: string
  personId: string | null
  personName: string | null
}
