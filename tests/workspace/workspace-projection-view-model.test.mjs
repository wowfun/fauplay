import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWorkspaceProjectionViewModel,
} from '../../src/features/workspace/lib/workspaceProjectionViewModel.ts'

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

function projection(id, files) {
  return {
    id,
    title: id,
    entry: 'manual',
    files,
  }
}

test('Workspace Projection View Model derives active Result Projection surfaces and selections', () => {
  const directoryFiles = [
    directory('albums'),
    file('albums/root.jpg'),
  ]
  const duplicates = projection('duplicates', [
    file('duplicates/a.jpg'),
    directory('duplicates/folder'),
  ])
  const faceSources = projection('face-sources', [
    file('people/ada.jpg'),
  ])

  const projectionSurface = resolveWorkspaceProjectionViewModel({
    projectionTabs: [duplicates, faceSources],
    activeProjectionTabId: 'missing-tab',
    activeSurface: { kind: 'projection', tabId: 'face-sources' },
    filteredFiles: directoryFiles,
    directorySelectedPaths: ['albums/root.jpg'],
    projectionSelectedPathsById: {
      duplicates: ['duplicates/a.jpg'],
      'face-sources': ['people/ada.jpg'],
    },
    duplicateSelectionRuleByProjectionId: {
      duplicates: 'keep_newest',
    },
  })

  assert.equal(projectionSurface.activeProjectionTab, duplicates)
  assert.equal(projectionSurface.activeSurfaceProjection, faceSources)
  assert.deepEqual(projectionSurface.activeSurfaceFiles, faceSources.files)
  assert.deepEqual(projectionSurface.activeSurfaceFileItems, [faceSources.files[0]])
  assert.equal(projectionSurface.isDirectorySurfaceActive, false)
  assert.deepEqual(projectionSurface.projectionGridSelectedPaths, ['duplicates/a.jpg'])
  assert.equal(projectionSurface.activeDuplicateSelectionRule, 'keep_newest')
  assert.deepEqual(projectionSurface.activeSurfaceSelectedPaths, ['people/ada.jpg'])

  const directorySurface = resolveWorkspaceProjectionViewModel({
    projectionTabs: [],
    activeProjectionTabId: null,
    activeSurface: { kind: 'directory' },
    filteredFiles: directoryFiles,
    directorySelectedPaths: ['albums/root.jpg'],
    projectionSelectedPathsById: {},
    duplicateSelectionRuleByProjectionId: {},
  })

  assert.equal(directorySurface.activeProjectionTab, null)
  assert.equal(directorySurface.activeSurfaceProjection, null)
  assert.deepEqual(directorySurface.activeSurfaceFiles, directoryFiles)
  assert.deepEqual(directorySurface.activeSurfaceFileItems, [directoryFiles[1]])
  assert.equal(directorySurface.isDirectorySurfaceActive, true)
  assert.deepEqual(directorySurface.activeSurfaceSelectedPaths, ['albums/root.jpg'])
})
