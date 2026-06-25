import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPreviewFileNameRenamePlan,
  readPreviewLocalDataSetValueResult,
  resolvePreviewBatchRenameToolResult,
  resolvePreviewFileNameRenameActionPlan,
  splitPreviewFileName,
} from '../../src/features/preview/lib/previewFileEditModel.ts'

test('Preview File Edit Model splits the editable base name from the final extension', () => {
  assert.deepEqual(splitPreviewFileName('archive.tar.gz'), {
    baseName: 'archive.tar',
    extension: '.gz',
  })
  assert.deepEqual(splitPreviewFileName('.env'), {
    baseName: '.env',
    extension: '',
  })
})

test('Preview File Edit Model plans a base-name rename within the same parent path', () => {
  assert.deepEqual(
    createPreviewFileNameRenamePlan({
      name: 'IMG.0001.jpg',
      path: 'albums/raw/IMG.0001.jpg',
    }, 'cover'),
    {
      expectedRelativePath: 'albums/raw/cover.jpg',
      ruleArgs: {
        relativePaths: ['albums/raw/IMG.0001.jpg'],
        nameMask: '[N]',
        findText: 'IMG.0001',
        replaceText: 'cover',
        searchMode: 'plain',
      },
    },
  )
})

test('Preview File Edit Model treats an unchanged base name as a no-op rename', () => {
  assert.equal(
    createPreviewFileNameRenamePlan({
      name: 'photo.jpg',
      path: 'photo.jpg',
    }, 'photo'),
    null,
  )
})

test('Preview File Edit Model resolves file-name rename action plans', () => {
  assert.deepEqual(
    resolvePreviewFileNameRenameActionPlan({
      file: null,
      rootId: 'root-1',
      canRenameFileName: true,
      renameUnavailableReason: null,
      nextBaseName: 'cover',
    }),
    {
      ok: false,
      error: '当前项不可重命名',
    },
  )

  assert.deepEqual(
    resolvePreviewFileNameRenameActionPlan({
      file: {
        name: 'photo.jpg',
        path: 'photo.jpg',
        kind: 'file',
      },
      rootId: 'root-1',
      canRenameFileName: false,
      renameUnavailableReason: '重命名能力不可用（Runtime 未连接且未注册 fs.batchRename）',
      nextBaseName: 'cover',
    }),
    {
      ok: false,
      error: '重命名能力不可用（Runtime 未连接且未注册 fs.batchRename）',
    },
  )

  assert.deepEqual(
    resolvePreviewFileNameRenameActionPlan({
      file: {
        name: 'photo.jpg',
        path: 'albums/photo.jpg',
        kind: 'file',
      },
      rootId: 'root-1',
      canRenameFileName: true,
      renameUnavailableReason: null,
      nextBaseName: 'photo',
    }),
    {
      ok: true,
      kind: 'noop',
    },
  )

  assert.deepEqual(
    resolvePreviewFileNameRenameActionPlan({
      file: {
        name: 'photo.jpg',
        path: 'albums/photo.jpg',
        kind: 'file',
      },
      rootId: 'root-1',
      canRenameFileName: true,
      renameUnavailableReason: null,
      nextBaseName: 'cover',
    }),
    {
      ok: true,
      kind: 'rename',
      rootId: 'root-1',
      expectedRelativePath: 'albums/cover.jpg',
      dryRunArgs: {
        relativePaths: ['albums/photo.jpg'],
        nameMask: '[N]',
        findText: 'photo',
        replaceText: 'cover',
        searchMode: 'plain',
        confirm: false,
      },
      commitArgs: {
        relativePaths: ['albums/photo.jpg'],
        nameMask: '[N]',
        findText: 'photo',
        replaceText: 'cover',
        searchMode: 'plain',
        confirm: true,
      },
    },
  )
})

test('Preview File Edit Model resolves Runtime rename tool results', () => {
  const expectedRelativePath = 'albums/cover.jpg'

  assert.deepEqual(
    resolvePreviewBatchRenameToolResult({
      ok: true,
      result: {
        items: [
          {
            ok: true,
            skipped: false,
            nextRelativePath: expectedRelativePath,
          },
        ],
      },
    }, {
      expectedRelativePath,
      fallbackError: '重命名预演失败',
      invalidResultError: '重命名预演返回无效结果',
      requireExpectedRelativePath: true,
    }),
    { ok: true },
  )

  assert.deepEqual(
    resolvePreviewBatchRenameToolResult({
      ok: true,
      result: {
        items: [
          {
            ok: false,
            skipped: true,
            reasonCode: 'RENAME_TARGET_EXISTS',
          },
        ],
      },
    }, {
      expectedRelativePath,
      fallbackError: '重命名预演失败',
      invalidResultError: '重命名预演返回无效结果',
      requireExpectedRelativePath: true,
    }),
    { ok: false, error: '目标名称已存在' },
  )

  assert.deepEqual(
    resolvePreviewBatchRenameToolResult({
      ok: true,
      result: {
        items: [
          {
            ok: true,
            skipped: false,
            nextRelativePath: 'albums/other.jpg',
          },
        ],
      },
    }, {
      expectedRelativePath,
      fallbackError: '重命名提交失败',
      invalidResultError: '重命名提交返回无效结果',
      requireExpectedRelativePath: false,
    }),
    { ok: false, error: '目标名称已存在' },
  )
})

test('Preview File Edit Model reads successful local annotation value writes', () => {
  assert.deepEqual(
    readPreviewLocalDataSetValueResult({
      relativePath: 'albums/photo.jpg',
      fieldKey: 'rating',
      value: '5',
    }),
    {
      relativePath: 'albums/photo.jpg',
      fieldKey: 'rating',
      value: '5',
    },
  )

  assert.equal(
    readPreviewLocalDataSetValueResult({
      relativePath: 'albums/photo.jpg',
      fieldKey: 'rating',
      value: '',
    }),
    null,
  )
})
