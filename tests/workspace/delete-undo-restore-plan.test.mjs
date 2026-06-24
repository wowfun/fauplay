import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDeleteUndoRestoreResult } from '../../src/features/workspace/lib/deleteUndoRestorePlan.ts'

function fileItem(path, absolutePath) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    absolutePath,
    sourceRootPath: '/root',
    sourceRelativePath: path,
  }
}

function snapshot() {
  return {
    historyEntry: {
      rootId: 'root-1',
      rootName: 'Root',
      path: '',
      visitedAt: 100,
    },
    rootPath: '/root',
    currentPath: '',
    filter: {
      search: '',
      type: 'all',
      hideEmptyFolders: false,
      sortBy: 'name',
      sortOrder: 'asc',
      annotationFilterMode: 'all',
      annotationIncludeMatchMode: 'or',
      annotationIncludeTagKeys: [],
      annotationExcludeTagKeys: [],
    },
    isFlattenView: false,
    activeSurface: {
      kind: 'projection',
      tabId: 'projection-1',
    },
    directorySelectedPaths: ['a.jpg', 'b.jpg'],
    directoryFocusedPath: 'b.jpg',
    isResultPanelOpen: true,
    resultPanelDisplayMode: 'normal',
    resultPanelHeightPx: 300,
    lastNormalResultPanelHeightPx: 300,
    projectionTabs: [
      {
        id: 'projection-1',
        title: 'Deleted files',
        entry: 'manual',
        files: [
          fileItem('a.jpg', '/root/a.jpg'),
          fileItem('b.jpg', '/root/b.jpg'),
        ],
      },
    ],
    activeProjectionTabId: 'projection-1',
    projectionSelectedPathsById: {
      'projection-1': ['a.jpg', 'b.jpg'],
    },
    projectionFocusedPathById: {
      'projection-1': 'b.jpg',
    },
    duplicateSelectionRuleByProjectionId: {},
    preview: {
      showPreviewPane: true,
      selectedFile: fileItem('b.jpg', '/root/b.jpg'),
      previewFile: fileItem('a.jpg', '/root/a.jpg'),
    },
  }
}

test('Delete Undo Restore Result keeps failed items retryable after a partial Runtime restore', () => {
  const restoreItems = [
    {
      sourceType: 'root_trash',
      originalAbsolutePath: '/root/a.jpg',
      absolutePath: '/root/.trash/a.jpg',
    },
    {
      sourceType: 'root_trash',
      originalAbsolutePath: '/root/b.jpg',
      absolutePath: '/root/.trash/b.jpg',
    },
  ]
  const batch = {
    id: 'batch-1',
    createdAt: 1,
    deletedCount: 2,
    restoreItems,
    snapshot: snapshot(),
  }
  const olderBatch = {
    id: 'older-batch',
    createdAt: 0,
    deletedCount: 1,
    restoreItems: [],
    snapshot: snapshot(),
  }

  const result = resolveDeleteUndoRestoreResult({
    batch,
    remainingUndoBatches: [olderBatch],
    response: {
      items: [
        {
          ok: true,
          nextAbsolutePath: '/root/a-restored.jpg',
        },
        {
          ok: false,
          error: 'target exists',
        },
      ],
    },
    retryBatchMetadata: {
      id: 'retry-batch',
      createdAt: 2,
    },
  })

  assert.equal(result.restoredCount, 1)
  assert.deepEqual(result.restoredAbsolutePaths, ['/root/a-restored.jpg'])
  assert.equal(result.failedRetryBatch?.id, 'retry-batch')
  assert.equal(result.failedRetryBatch?.deletedCount, 1)
  assert.deepEqual(result.failedRetryBatch?.restoreItems, [restoreItems[1]])
  assert.deepEqual(result.undoBatches.map((item) => item.id), ['retry-batch', 'older-batch'])
  assert.deepEqual(
    result.failedRetryBatch?.snapshot.projectionTabs[0]?.files.map((item) => item.path),
    ['a-restored.jpg', 'b.jpg'],
  )
  assert.deepEqual(
    result.restoredSnapshot.projectionTabs[0]?.files.map((item) => item.path),
    ['a-restored.jpg'],
  )
  assert.equal(result.restoredSnapshot.preview.selectedFile, null)
  assert.equal(result.restoredSnapshot.preview.previewFile?.path, 'a-restored.jpg')
})

test('Delete Undo Restore Result removes the current batch after every item is restored', () => {
  const restoreItems = [
    {
      sourceType: 'root_trash',
      originalAbsolutePath: '/root/a.jpg',
      absolutePath: '/root/.trash/a.jpg',
    },
    {
      sourceType: 'root_trash',
      originalAbsolutePath: '/root/b.jpg',
      absolutePath: '/root/.trash/b.jpg',
    },
  ]
  const batch = {
    id: 'batch-1',
    createdAt: 1,
    deletedCount: 2,
    restoreItems,
    snapshot: snapshot(),
  }
  const olderBatch = {
    id: 'older-batch',
    createdAt: 0,
    deletedCount: 1,
    restoreItems: [],
    snapshot: snapshot(),
  }

  const result = resolveDeleteUndoRestoreResult({
    batch,
    remainingUndoBatches: [olderBatch],
    response: {
      items: [
        {
          ok: true,
          nextAbsolutePath: '/root/a-restored.jpg',
        },
        {
          ok: true,
          nextAbsolutePath: '/root/b-restored.jpg',
        },
      ],
    },
    retryBatchMetadata: {
      id: 'unused-retry-batch',
      createdAt: 2,
    },
  })

  assert.equal(result.restoredCount, 2)
  assert.equal(result.failedRetryBatch, null)
  assert.deepEqual(result.undoBatches.map((item) => item.id), ['older-batch'])
  assert.deepEqual(result.restoredAbsolutePaths, ['/root/a-restored.jpg', '/root/b-restored.jpg'])
  assert.deepEqual(
    result.restoredSnapshot.projectionTabs[0]?.files.map((item) => item.path),
    ['a-restored.jpg', 'b-restored.jpg'],
  )
  assert.equal(result.restoredSnapshot.preview.selectedFile?.path, 'b-restored.jpg')
  assert.equal(result.restoredSnapshot.preview.previewFile?.path, 'a-restored.jpg')
})
