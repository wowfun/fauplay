import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
  type AnnotationFilterTagOption,
} from '@/types'
import {
  getAnnotationDisplayStoreVersion,
  getRootAnnotationFilterTagOptions,
  isAnnotationFilterUiGateResolved,
  isAnnotationFilterUiVisible,
  preloadAnnotationDisplaySnapshot,
  subscribeAnnotationDisplayStore,
} from '@/features/preview/utils/annotationDisplayStore'
import {
  getReviewFilterTagStoreVersion,
  getRootReviewFilterTagOptions,
  isReviewFilterTagSnapshotReady,
  preloadReviewFilterTagSnapshot,
  subscribeReviewFilterTagStore,
} from '@/features/faces/utils/reviewFilterTagStore'

interface UseWorkspaceAnnotationFilterOptionsParams {
  rootId: string
  rootHandle: FileSystemDirectoryHandle | null
  rootName: string
}

interface WorkspaceAnnotationFilterOptions {
  annotationDisplayStoreVersion: number
  reviewFilterTagStoreVersion: number
  isAnnotationFilterGateResolved: boolean
  isReviewFilterGateResolved: boolean
  showAnnotationFilterControls: boolean
  annotationFilterTagOptions: AnnotationFilterTagOption[]
  refreshFilterTagSnapshots: () => Promise<void>
  handleOpenAnnotationFilterPanel: () => void
}

export function useWorkspaceAnnotationFilterOptions({
  rootId,
  rootHandle,
  rootName,
}: UseWorkspaceAnnotationFilterOptionsParams): WorkspaceAnnotationFilterOptions {
  const annotationDisplayStoreVersion = useSyncExternalStore(
    subscribeAnnotationDisplayStore,
    getAnnotationDisplayStoreVersion,
    getAnnotationDisplayStoreVersion
  )
  const reviewFilterTagStoreVersion = useSyncExternalStore(
    subscribeReviewFilterTagStore,
    getReviewFilterTagStoreVersion,
    getReviewFilterTagStoreVersion
  )

  const isAnnotationFilterGateResolved = isAnnotationFilterUiGateResolved(rootId)
  const isReviewFilterGateResolved = isReviewFilterTagSnapshotReady(rootId)
  const annotationTagFilterVisible = isAnnotationFilterUiVisible(rootId)
  const reviewFilterTagOptions = useMemo<AnnotationFilterTagOption[]>(() => {
    void reviewFilterTagStoreVersion
    return getRootReviewFilterTagOptions(rootId)
  }, [reviewFilterTagStoreVersion, rootId])
  const showAnnotationFilterControls = annotationTagFilterVisible || reviewFilterTagOptions.length > 0
  const annotationFilterTagOptions = useMemo<AnnotationFilterTagOption[]>(() => {
    void annotationDisplayStoreVersion
    void reviewFilterTagStoreVersion
    if (!showAnnotationFilterControls) return []
    const rootTagOptions = getRootAnnotationFilterTagOptions(rootId)
    const specialOptions: AnnotationFilterTagOption[] = []
    if (annotationTagFilterVisible) {
      specialOptions.push({
        tagKey: ANNOTATION_FILTER_UNANNOTATED_TAG_KEY,
        key: '',
        value: '未标注',
        sources: [],
        hasMetaAnnotation: false,
        representativeSource: '',
      })
    }
    return [
      ...specialOptions,
      ...reviewFilterTagOptions,
      ...rootTagOptions,
    ]
  }, [
    annotationDisplayStoreVersion,
    annotationTagFilterVisible,
    reviewFilterTagOptions,
    reviewFilterTagStoreVersion,
    rootId,
    showAnnotationFilterControls,
  ])

  const refreshFilterTagSnapshots = useCallback(async () => {
    if (!rootId) return
    await Promise.all([
      preloadAnnotationDisplaySnapshot({
        rootId,
        rootHandle,
        rootLabel: rootName,
        force: true,
      }),
      preloadReviewFilterTagSnapshot({
        rootId,
        rootHandle,
        force: true,
      }),
    ])
  }, [rootHandle, rootId, rootName])

  const handleOpenAnnotationFilterPanel = useCallback(() => {
    void refreshFilterTagSnapshots()
  }, [refreshFilterTagSnapshots])

  return {
    annotationDisplayStoreVersion,
    reviewFilterTagStoreVersion,
    isAnnotationFilterGateResolved,
    isReviewFilterGateResolved,
    showAnnotationFilterControls,
    annotationFilterTagOptions,
    refreshFilterTagSnapshots,
    handleOpenAnnotationFilterPanel,
  }
}

export function preloadWorkspaceAnnotationFilterSnapshots({
  rootId,
  rootHandle,
  rootName,
}: UseWorkspaceAnnotationFilterOptionsParams): Promise<void> {
  return Promise.all([
    preloadAnnotationDisplaySnapshot({
      rootId,
      rootHandle,
      rootLabel: rootName,
    }),
    preloadReviewFilterTagSnapshot({
      rootId,
      rootHandle,
    }),
  ]).then(() => {})
}
