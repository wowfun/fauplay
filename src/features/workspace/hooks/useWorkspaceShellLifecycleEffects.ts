import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { FilterState } from '@/types'
import {
  resolveWorkspaceAnnotationFilterGateIntent,
  resolveWorkspaceShellNavigationContextTransition,
} from '@/features/workspace/lib/workspaceShellInteractionModel'

interface UseWorkspaceShellLifecycleEffectsParams {
  currentPath: string
  rootId: string
  resetProjectionState: () => void
  setDirectorySelectedPaths: Dispatch<SetStateAction<string[]>>
  setDirectoryFocusedPath: Dispatch<SetStateAction<string | null>>
  isAnnotationFilterGateResolved: boolean
  isReviewFilterGateResolved: boolean
  showAnnotationFilterControls: boolean
  setFilter: Dispatch<SetStateAction<FilterState>>
}

export function useWorkspaceShellLifecycleEffects({
  currentPath,
  rootId,
  resetProjectionState,
  setDirectorySelectedPaths,
  setDirectoryFocusedPath,
  isAnnotationFilterGateResolved,
  isReviewFilterGateResolved,
  showAnnotationFilterControls,
  setFilter,
}: UseWorkspaceShellLifecycleEffectsParams): void {
  const previousNavigationContextRef = useRef({
    rootId,
    currentPath,
  })

  useEffect(() => {
    const previousNavigationContext = previousNavigationContextRef.current
    previousNavigationContextRef.current = {
      rootId,
      currentPath,
    }

    const transition = resolveWorkspaceShellNavigationContextTransition({
      previousRootId: previousNavigationContext.rootId,
      currentRootId: rootId,
      previousCurrentPath: previousNavigationContext.currentPath,
      currentPath,
    })

    if (transition.kind === 'none') return
    if (transition.kind === 'reset-workspace-surface') {
      resetProjectionState()
    }
    setDirectorySelectedPaths([])
    setDirectoryFocusedPath(null)
  }, [
    currentPath,
    resetProjectionState,
    rootId,
    setDirectoryFocusedPath,
    setDirectorySelectedPaths,
  ])

  useEffect(() => {
    setFilter((previous) => {
      const intent = resolveWorkspaceAnnotationFilterGateIntent({
        isAnnotationFilterGateResolved,
        isReviewFilterGateResolved,
        showAnnotationFilterControls,
        filter: previous,
      })
      return intent.kind === 'reset-annotation-filter' ? intent.filter : previous
    })
  }, [
    isAnnotationFilterGateResolved,
    isReviewFilterGateResolved,
    setFilter,
    showAnnotationFilterControls,
  ])
}
