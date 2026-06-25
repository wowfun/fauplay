import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  areWorkspaceBrowserHistorySnapshotsEqual,
  buildWorkspaceBrowserHistoryUrl,
  createWorkspaceBrowserHistoryState,
  normalizeWorkspaceBrowserHistoryRestoreSnapshot,
  normalizeWorkspaceBrowserHistorySnapshot,
  parseWorkspaceBrowserHistorySnapshotFromState,
  parseWorkspaceBrowserHistorySnapshotFromUrl,
  resolveWorkspaceBrowserHistoryRestorePlan,
  serializeWorkspaceBrowserHistorySnapshot,
  type WorkspaceBrowserHistorySnapshot,
} from '@/features/workspace/lib/browserHistory'
import type { FileItem } from '@/types'

type WorkspaceAccessProvider = 'local-browser' | 'remote-readonly'

interface UseWorkspaceBrowserHistoryParams {
  accessProvider: WorkspaceAccessProvider
  rootId: string
  currentPath: string
  supportsPersistentPreviewPane: boolean
  filteredFiles: FileItem[]
  selectedFile: FileItem | null
  previewFile: FileItem | null
  showPreviewPane: boolean
  navigateToPath: (targetPath: string, options?: { resetFlattenView?: boolean }) => Promise<boolean>
  closePreviewModal: () => void
  closePreviewPane: () => void
  openFileInModal: (file: FileItem) => void
  openFileInPaneOrFullscreenFallback: (file: FileItem) => void
}

export function useWorkspaceBrowserHistory({
  accessProvider,
  rootId,
  currentPath,
  supportsPersistentPreviewPane,
  filteredFiles,
  selectedFile,
  previewFile,
  showPreviewPane,
  navigateToPath,
  closePreviewModal,
  closePreviewPane,
  openFileInModal,
  openFileInPaneOrFullscreenFallback,
}: UseWorkspaceBrowserHistoryParams): void {
  const [pendingBrowserHistoryRestore, setPendingBrowserHistoryRestore] =
    useState<WorkspaceBrowserHistorySnapshot | null>(null)
  const hasInitializedBrowserHistoryRef = useRef(false)
  const lastBrowserHistoryKeyRef = useRef<string | null>(null)

  const browserHistorySnapshot = useMemo<WorkspaceBrowserHistorySnapshot>(() => (
    normalizeWorkspaceBrowserHistorySnapshot({
      accessProvider,
      rootId,
      path: currentPath,
      previewPath: previewFile?.kind === 'file'
        ? previewFile.path
        : (showPreviewPane && selectedFile?.kind === 'file' ? selectedFile.path : null),
      previewSurface: previewFile?.kind === 'file'
        ? 'lightbox'
        : (showPreviewPane && selectedFile?.kind === 'file' ? 'pane' : null),
    })!
  ), [accessProvider, currentPath, previewFile, rootId, selectedFile, showPreviewPane])

  const browserHistoryKey = useMemo(
    () => serializeWorkspaceBrowserHistorySnapshot(browserHistorySnapshot),
    [browserHistorySnapshot],
  )

  const commitBrowserHistorySnapshot = useCallback((snapshot: WorkspaceBrowserHistorySnapshot) => {
    if (typeof window === 'undefined') {
      return
    }
    window.history.replaceState(
      createWorkspaceBrowserHistoryState(snapshot),
      '',
      buildWorkspaceBrowserHistoryUrl(window.location.href, snapshot),
    )
    lastBrowserHistoryKeyRef.current = serializeWorkspaceBrowserHistorySnapshot(snapshot)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (hasInitializedBrowserHistoryRef.current) {
      return
    }

    hasInitializedBrowserHistoryRef.current = true
    const initialSnapshot = parseWorkspaceBrowserHistorySnapshotFromState(window.history.state)
      ?? parseWorkspaceBrowserHistorySnapshotFromUrl(window.location.search)

    if (
      initialSnapshot
      && initialSnapshot.accessProvider === accessProvider
      && initialSnapshot.rootId === rootId
    ) {
      const normalizedInitialSnapshot = normalizeWorkspaceBrowserHistoryRestoreSnapshot({
        snapshot: initialSnapshot,
        supportsPersistentPreviewPane,
      })
      if (!areWorkspaceBrowserHistorySnapshotsEqual(normalizedInitialSnapshot, browserHistorySnapshot)) {
        setPendingBrowserHistoryRestore(normalizedInitialSnapshot)
        return
      }
    }

    commitBrowserHistorySnapshot(browserHistorySnapshot)
  }, [
    accessProvider,
    browserHistorySnapshot,
    commitBrowserHistorySnapshot,
    rootId,
    supportsPersistentPreviewPane,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handlePopState = (event: PopStateEvent) => {
      const requestedSnapshot = parseWorkspaceBrowserHistorySnapshotFromState(event.state)
        ?? parseWorkspaceBrowserHistorySnapshotFromUrl(window.location.search)
      if (
        !requestedSnapshot
        || requestedSnapshot.accessProvider !== accessProvider
        || requestedSnapshot.rootId !== rootId
      ) {
        return
      }

      setPendingBrowserHistoryRestore(normalizeWorkspaceBrowserHistoryRestoreSnapshot({
        snapshot: requestedSnapshot,
        supportsPersistentPreviewPane,
      }))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [accessProvider, rootId, supportsPersistentPreviewPane])

  useEffect(() => {
    if (!pendingBrowserHistoryRestore) {
      return
    }
    let cancelled = false
    const applyRestore = async () => {
      const plan = resolveWorkspaceBrowserHistoryRestorePlan({
        currentSnapshot: browserHistorySnapshot,
        pendingSnapshot: pendingBrowserHistoryRestore,
        currentPath,
        filteredFiles,
      })

      if (plan.kind === 'commit-current') {
        commitBrowserHistorySnapshot(browserHistorySnapshot)
        setPendingBrowserHistoryRestore(null)
        return
      }

      if (plan.kind === 'navigate') {
        const navigated = await navigateToPath(plan.path)
        if (!cancelled && !navigated) {
          commitBrowserHistorySnapshot(browserHistorySnapshot)
          setPendingBrowserHistoryRestore(null)
        }
        return
      }

      if (plan.kind === 'close-previews') {
        closePreviewModal()
        closePreviewPane()
        return
      }

      if (plan.kind === 'close-previews-and-commit-current') {
        closePreviewModal()
        closePreviewPane()
        if (!cancelled) {
          commitBrowserHistorySnapshot(browserHistorySnapshot)
          setPendingBrowserHistoryRestore(null)
        }
        return
      }

      if (plan.kind === 'open-lightbox') {
        closePreviewPane()
        openFileInModal(plan.file)
        return
      }

      closePreviewModal()
      openFileInPaneOrFullscreenFallback(plan.file)
    }

    void applyRestore()
    return () => {
      cancelled = true
    }
  }, [
    browserHistorySnapshot,
    closePreviewModal,
    closePreviewPane,
    commitBrowserHistorySnapshot,
    currentPath,
    filteredFiles,
    navigateToPath,
    openFileInModal,
    openFileInPaneOrFullscreenFallback,
    pendingBrowserHistoryRestore,
  ])

  useEffect(() => {
    if (!hasInitializedBrowserHistoryRef.current || pendingBrowserHistoryRestore) {
      return
    }
    if (browserHistoryKey === lastBrowserHistoryKeyRef.current) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }

    window.history.pushState(
      createWorkspaceBrowserHistoryState(browserHistorySnapshot),
      '',
      buildWorkspaceBrowserHistoryUrl(window.location.href, browserHistorySnapshot),
    )
    lastBrowserHistoryKeyRef.current = browserHistoryKey
  }, [browserHistoryKey, browserHistorySnapshot, pendingBrowserHistoryRestore])
}
