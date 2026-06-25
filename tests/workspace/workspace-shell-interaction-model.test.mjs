import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWorkspaceDirectoryEntryInteraction,
  resolveWorkspaceShellPresentationTransition,
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
