export type AnnotationFilterUiGateReason =
  | 'no_root'
  | 'missing_sidecar_dir'
  | 'missing_sidecar_file'
  | 'no_filterable_annotations'

export interface AnnotationFilterUiGateState {
  hasSidecarDir: boolean
  hasSidecarFile: boolean
  hasAnyFilterableAnnotation: boolean
}

export interface AnnotationFilterUiGate {
  isVisible: boolean
  reason: AnnotationFilterUiGateReason | null
}

export function resolveAnnotationFilterUiGate(
  gateState: AnnotationFilterUiGateState | null,
): AnnotationFilterUiGate {
  if (!gateState) {
    return {
      isVisible: false,
      reason: 'no_root',
    }
  }
  if (!gateState.hasSidecarDir) {
    return {
      isVisible: false,
      reason: 'missing_sidecar_dir',
    }
  }
  if (!gateState.hasSidecarFile) {
    return {
      isVisible: false,
      reason: 'missing_sidecar_file',
    }
  }
  if (!gateState.hasAnyFilterableAnnotation) {
    return {
      isVisible: false,
      reason: 'no_filterable_annotations',
    }
  }
  return {
    isVisible: true,
    reason: null,
  }
}
