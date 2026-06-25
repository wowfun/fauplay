import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDeleteUndoBatch,
  createDeleteUndoPreviewSnapshot,
  createDeleteUndoSnapshot,
} from '../../src/features/workspace/lib/deleteUndoSnapshot.ts'

function fileItem(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    lastModified: new Date('2026-01-02T03:04:05Z'),
    ...overrides,
  }
}

function filterState(overrides = {}) {
  return {
    search: '',
    type: 'all',
    hideEmptyFolders: false,
    sortBy: 'name',
    sortOrder: 'asc',
    annotationFilterMode: 'all',
    annotationIncludeMatchMode: 'or',
    annotationIncludeTagKeys: ['rating:favorite'],
    annotationExcludeTagKeys: ['status:rejected'],
    ...overrides,
  }
}

test('Delete Undo Snapshot captures a stable copy of workspace state', () => {
  const selectedFile = fileItem('albums/a.jpg')
  const previewFile = fileItem('albums/b.jpg')
  const projectionFile = fileItem('albums/c.jpg')
  const projectionTabs = [{
    id: 'projection-1',
    title: 'Projection',
    entry: 'manual',
    files: [projectionFile],
  }]
  const filter = filterState()
  const projectionSelectedPathsById = { 'projection-1': ['albums/c.jpg'] }
  const projectionFocusedPathById = { 'projection-1': 'albums/c.jpg' }
  const duplicateSelectionRuleByProjectionId = { 'projection-1': 'keep_newest' }

  const snapshot = createDeleteUndoSnapshot({
    rootId: 'root-1',
    rootName: '',
    rootPath: '/media/root',
    currentPath: 'albums',
    visitedAt: 1234,
    filter,
    isFlattenView: true,
    activeSurface: { kind: 'projection', tabId: 'projection-1' },
    directorySelectedPaths: ['albums/a.jpg'],
    directoryFocusedPath: 'albums/a.jpg',
    isResultPanelOpen: true,
    resultPanelDisplayMode: 'normal',
    resultPanelHeightPx: 320,
    lastNormalResultPanelHeightPx: 300,
    projectionTabs,
    activeProjectionTabId: 'projection-1',
    projectionSelectedPathsById,
    projectionFocusedPathById,
    duplicateSelectionRuleByProjectionId,
    preview: createDeleteUndoPreviewSnapshot({
      showPreviewPane: true,
      selectedFile,
      previewFile,
    }),
  })

  filter.annotationIncludeTagKeys.push('mutated')
  projectionTabs[0].files.push(fileItem('albums/d.jpg'))
  projectionSelectedPathsById['projection-1'].push('albums/d.jpg')
  projectionFocusedPathById['projection-1'] = 'albums/d.jpg'
  duplicateSelectionRuleByProjectionId['projection-1'] = 'keep_oldest'

  assert.equal(snapshot?.historyEntry.rootName, '根目录')
  assert.equal(snapshot?.historyEntry.visitedAt, 1234)
  assert.equal(snapshot?.rootPath, '/media/root')
  assert.deepEqual(snapshot?.filter.annotationIncludeTagKeys, ['rating:favorite'])
  assert.deepEqual(snapshot?.projectionTabs[0].files.map((file) => file.path), ['albums/c.jpg'])
  assert.deepEqual(snapshot?.projectionSelectedPathsById, { 'projection-1': ['albums/c.jpg'] })
  assert.deepEqual(snapshot?.projectionFocusedPathById, { 'projection-1': 'albums/c.jpg' })
  assert.deepEqual(snapshot?.duplicateSelectionRuleByProjectionId, { 'projection-1': 'keep_newest' })
  assert.notEqual(snapshot?.preview.selectedFile, selectedFile)
  assert.notEqual(snapshot?.preview.previewFile, previewFile)
})

test('Delete Undo Snapshot skips empty roots and creates batches only for restorable items', () => {
  assert.equal(createDeleteUndoSnapshot({
    rootId: '',
    rootName: 'Root',
    rootPath: '/media/root',
    currentPath: '',
    visitedAt: 1,
    filter: filterState(),
    isFlattenView: false,
    activeSurface: { kind: 'directory' },
    directorySelectedPaths: [],
    directoryFocusedPath: null,
    isResultPanelOpen: false,
    resultPanelDisplayMode: 'normal',
    resultPanelHeightPx: 300,
    lastNormalResultPanelHeightPx: 300,
    projectionTabs: [],
    activeProjectionTabId: null,
    projectionSelectedPathsById: {},
    projectionFocusedPathById: {},
    duplicateSelectionRuleByProjectionId: {},
    preview: createDeleteUndoPreviewSnapshot({
      showPreviewPane: false,
      selectedFile: null,
      previewFile: null,
    }),
  }), null)

  const snapshot = createDeleteUndoSnapshot({
    rootId: 'root-1',
    rootName: 'Root',
    rootPath: '/media/root',
    currentPath: '',
    visitedAt: 1,
    filter: filterState(),
    isFlattenView: false,
    activeSurface: { kind: 'directory' },
    directorySelectedPaths: [],
    directoryFocusedPath: null,
    isResultPanelOpen: false,
    resultPanelDisplayMode: 'normal',
    resultPanelHeightPx: 300,
    lastNormalResultPanelHeightPx: 300,
    projectionTabs: [],
    activeProjectionTabId: null,
    projectionSelectedPathsById: {},
    projectionFocusedPathById: {},
    duplicateSelectionRuleByProjectionId: {},
    preview: createDeleteUndoPreviewSnapshot({
      showPreviewPane: false,
      selectedFile: null,
      previewFile: null,
    }),
  })

  assert.equal(createDeleteUndoBatch({
    id: 'batch-empty',
    createdAt: 10,
    restoreItems: [],
    snapshot,
  }), null)

  assert.deepEqual(createDeleteUndoBatch({
    id: 'batch-1',
    createdAt: 11,
    restoreItems: [{
      sourceType: 'root_trash',
      originalAbsolutePath: '/media/root/a.jpg',
      absolutePath: '/media/root/.fauplay-trash/a.jpg',
    }],
    snapshot,
  }), {
    id: 'batch-1',
    createdAt: 11,
    deletedCount: 1,
    restoreItems: [{
      sourceType: 'root_trash',
      originalAbsolutePath: '/media/root/a.jpg',
      absolutePath: '/media/root/.fauplay-trash/a.jpg',
    }],
    snapshot,
  })
})
