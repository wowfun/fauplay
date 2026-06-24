import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeRootRelativePath,
  resolveRuntimeFileLocator,
} from '../../src/lib/runtimeApi/fileLocator.ts'

test('Runtime File Locator resolves Local Root item identity', () => {
  assert.deepEqual(
    resolveRuntimeFileLocator({
      kind: 'file',
      name: 'photo.jpg',
      path: 'ignored/path.jpg',
      sourceRootPath: '/Users/example/root',
      sourceRelativePath: 'albums/photo.jpg',
    }),
    {
      rootPath: '/Users/example/root',
      rootRelativePath: 'albums/photo.jpg',
    },
  )

  assert.deepEqual(
    resolveRuntimeFileLocator({
      kind: 'file',
      name: 'photo.jpg',
      path: 'albums\\photo.jpg',
    }, '/Users/example/root'),
    {
      rootPath: '/Users/example/root',
      rootRelativePath: 'albums/photo.jpg',
    },
  )
})

test('Runtime File Locator rejects absolute paths as Root-relative Paths', () => {
  assert.equal(
    resolveRuntimeFileLocator({
      kind: 'file',
      name: 'outside.jpg',
      path: '/Users/example/outside.jpg',
    }, '/Users/example/root'),
    null,
  )

  assert.equal(
    resolveRuntimeFileLocator({
      kind: 'file',
      name: 'outside.jpg',
      path: 'C:\\Users\\example\\outside.jpg',
    }, 'C:\\Users\\example\\root'),
    null,
  )
})

test('Runtime File Locator normalizes display separators without escaping the Local Root', () => {
  assert.equal(normalizeRootRelativePath(' albums\\\\2026//photo.jpg '), 'albums/2026/photo.jpg')
  assert.equal(normalizeRootRelativePath('../outside.jpg'), '../outside.jpg')
})
