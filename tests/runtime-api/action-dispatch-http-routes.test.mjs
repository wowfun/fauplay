import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDispatchHttpRoute } from '../../src/lib/actionDispatcher/httpRoutes.ts'

test('Dispatch HTTP Routes leave Duplicate Files on the Runtime dispatcher', () => {
  assert.equal(
    resolveDispatchHttpRoute('data.findDuplicateFiles', {
      rootPath: '/media/root',
      searchScope: 'root',
      relativePath: 'albums/a.jpg',
    }),
    null,
  )
})

test('Dispatch HTTP Routes still map File Annotation operations to Runtime API routes', () => {
  assert.deepEqual(
    resolveDispatchHttpRoute('local.data', {
      operation: 'setAnnotationValue',
      rootPath: '/media/root',
      relativePath: 'albums/a.jpg',
      key: 'rating',
      value: '5',
    }),
    {
      method: 'PUT',
      endpointPath: '/v1/file-annotations',
      payload: {
        rootPath: '/media/root',
        relativePath: 'albums/a.jpg',
        key: 'rating',
        value: '5',
      },
      timeoutMs: 120000,
    },
  )
})

test('Dispatch HTTP Routes keep Root-relative annotation rebinds on the Runtime API', () => {
  assert.deepEqual(
    resolveDispatchHttpRoute('local.data', {
      operation: 'batchRebindPaths',
      rootPath: '/media/root',
      mappings: [
        {
          fromRelativePath: 'albums/old.jpg',
          toRelativePath: 'albums/new.jpg',
        },
      ],
    }),
    {
      method: 'PATCH',
      endpointPath: '/v1/files/relative-paths',
      payload: {
        rootPath: '/media/root',
        mappings: [
          {
            fromRelativePath: 'albums/old.jpg',
            toRelativePath: 'albums/new.jpg',
          },
        ],
      },
      timeoutMs: 120000,
    },
  )
})
