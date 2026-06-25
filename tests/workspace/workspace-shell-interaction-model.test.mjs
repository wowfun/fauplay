import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWorkspaceAnnotationFilterGateIntent,
  resolveWorkspaceDirectoryEntryInteraction,
  resolveWorkspaceShellNavigationContextTransition,
  resolveWorkspaceShellPresentationTransition,
  resolveWorkspaceTrashNavigationIntent,
} from '../../src/features/workspace/lib/workspaceShellInteractionModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function directory(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'directory',
    ...overrides,
  }
}

function filter(overrides = {}) {
  return {
    search: '',
    type: 'all',
    hideEmptyFolders: true,
    sortBy: 'name',
    sortOrder: 'asc',
    annotationFilterMode: 'all',
    annotationIncludeMatchMode: 'or',
    annotationIncludeTagKeys: [],
    annotationExcludeTagKeys: [],
    ...overrides,
  }
}

test('Workspace Shell Interaction Model moves pane previews into the lightbox when compact shells cannot keep panes', () => {
  const selectedFile = file('albums/photo.jpg')

  assert.deepEqual(
    resolveWorkspaceShellPresentationTransition({
      previousShellKind: 'wide',
      currentShellKind: 'compact',
      supportsPersistentPreviewPane: false,
      showPreviewPane: true,
      selectedFile,
      previewFile: null,
    }),
    {
      kind: 'close-preview-pane',
      openFileInLightbox: selectedFile,
    },
  )
})

test('Workspace Shell Interaction Model only closes the pane when a lightbox preview already exists', () => {
  assert.deepEqual(
    resolveWorkspaceShellPresentationTransition({
      previousShellKind: 'wide',
      currentShellKind: 'compact',
      supportsPersistentPreviewPane: false,
      showPreviewPane: true,
      selectedFile: file('albums/pane.jpg'),
      previewFile: file('albums/lightbox.jpg'),
    }),
    {
      kind: 'close-preview-pane',
      openFileInLightbox: null,
    },
  )
})

test('Workspace Shell Interaction Model keeps previews unchanged when shell transition rules do not apply', () => {
  assert.deepEqual(
    resolveWorkspaceShellPresentationTransition({
      previousShellKind: 'wide',
      currentShellKind: 'wide',
      supportsPersistentPreviewPane: true,
      showPreviewPane: true,
      selectedFile: file('albums/photo.jpg'),
      previewFile: null,
    }),
    { kind: 'none' },
  )

  assert.deepEqual(
    resolveWorkspaceShellPresentationTransition({
      previousShellKind: 'compact',
      currentShellKind: 'wide',
      supportsPersistentPreviewPane: true,
      showPreviewPane: true,
      selectedFile: file('albums/photo.jpg'),
      previewFile: null,
    }),
    { kind: 'none' },
  )

  assert.deepEqual(
    resolveWorkspaceShellPresentationTransition({
      previousShellKind: 'wide',
      currentShellKind: 'compact',
      supportsPersistentPreviewPane: false,
      showPreviewPane: false,
      selectedFile: file('albums/photo.jpg'),
      previewFile: null,
    }),
    { kind: 'none' },
  )
})

test('Workspace Shell Interaction Model resolves directory surface entry interactions', () => {
  assert.deepEqual(
    resolveWorkspaceDirectoryEntryInteraction({
      kind: 'directory-name-click',
      dirName: 'Albums',
    }),
    {
      kind: 'navigate-directory',
      dirName: 'Albums',
    },
  )

  const photo = file('albums/photo.jpg')
  assert.deepEqual(
    resolveWorkspaceDirectoryEntryInteraction({
      kind: 'entry-click',
      item: photo,
    }),
    {
      kind: 'open-file',
      file: photo,
      focusedPath: 'albums/photo.jpg',
      target: 'primary',
    },
  )

  assert.deepEqual(
    resolveWorkspaceDirectoryEntryInteraction({
      kind: 'entry-double-click',
      item: photo,
    }),
    {
      kind: 'open-file',
      file: photo,
      focusedPath: 'albums/photo.jpg',
      target: 'secondary',
    },
  )
})

test('Workspace Shell Interaction Model preserves directory-entry click and double-click behavior', () => {
  assert.deepEqual(
    resolveWorkspaceDirectoryEntryInteraction({
      kind: 'entry-click',
      item: directory('albums'),
    }),
    {
      kind: 'navigate-directory',
      dirName: 'albums',
    },
  )

  assert.deepEqual(
    resolveWorkspaceDirectoryEntryInteraction({
      kind: 'entry-double-click',
      item: directory('albums'),
    }),
    { kind: 'none' },
  )
})

test('Workspace Shell Interaction Model resolves trash navigation availability', () => {
  assert.deepEqual(
    resolveWorkspaceTrashNavigationIntent({ hasTrashEntries: false }),
    { kind: 'none' },
  )

  assert.deepEqual(
    resolveWorkspaceTrashNavigationIntent({ hasTrashEntries: true }),
    {
      kind: 'navigate-to-path',
      path: '@trash',
      resetFlattenView: true,
    },
  )
})

test('Workspace Shell Interaction Model resolves shell surface resets from navigation context changes', () => {
  assert.deepEqual(
    resolveWorkspaceShellNavigationContextTransition({
      previousRootId: 'root-a',
      currentRootId: 'root-a',
      previousCurrentPath: 'albums',
      currentPath: 'albums/2026',
    }),
    { kind: 'reset-directory-surface' },
  )

  assert.deepEqual(
    resolveWorkspaceShellNavigationContextTransition({
      previousRootId: 'root-a',
      currentRootId: 'root-b',
      previousCurrentPath: 'albums',
      currentPath: 'albums',
    }),
    { kind: 'reset-workspace-surface' },
  )

  assert.deepEqual(
    resolveWorkspaceShellNavigationContextTransition({
      previousRootId: 'root-a',
      currentRootId: 'root-a',
      previousCurrentPath: 'albums',
      currentPath: 'albums',
    }),
    { kind: 'none' },
  )
})

test('Workspace Shell Interaction Model clears annotation filters when the filter controls are unavailable', () => {
  assert.deepEqual(
    resolveWorkspaceAnnotationFilterGateIntent({
      isAnnotationFilterGateResolved: true,
      isReviewFilterGateResolved: true,
      showAnnotationFilterControls: false,
      filter: filter({
        search: 'portrait',
        type: 'image',
        sortBy: 'annotationTime',
        sortOrder: 'desc',
        annotationFilterMode: 'boolean',
        annotationIncludeMatchMode: 'and',
        annotationIncludeTagKeys: ['person:ada'],
        annotationExcludeTagKeys: ['rating:reject'],
      }),
    }),
    {
      kind: 'reset-annotation-filter',
      filter: filter({
        search: 'portrait',
        type: 'image',
        sortBy: 'annotationTime',
        sortOrder: 'desc',
      }),
    },
  )

  assert.deepEqual(
    resolveWorkspaceAnnotationFilterGateIntent({
      isAnnotationFilterGateResolved: false,
      isReviewFilterGateResolved: true,
      showAnnotationFilterControls: false,
      filter: filter({
        annotationFilterMode: 'boolean',
        annotationIncludeTagKeys: ['person:ada'],
      }),
    }),
    { kind: 'none' },
  )

  assert.deepEqual(
    resolveWorkspaceAnnotationFilterGateIntent({
      isAnnotationFilterGateResolved: true,
      isReviewFilterGateResolved: true,
      showAnnotationFilterControls: true,
      filter: filter({
        annotationFilterMode: 'boolean',
        annotationIncludeTagKeys: ['person:ada'],
      }),
    }),
    { kind: 'none' },
  )
})
