import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeRootRelativePath,
  resolveProjectionSelectedPathsByIdUpdate,
} from '../../src/features/workspace/lib/projectionTabRecords.ts'

test('Projection Tab Records Model normalizes Root-relative Paths and clears empty tab selections', () => {
  assert.equal(normalizeRootRelativePath('/albums//raw/one.jpg'), 'albums/raw/one.jpg')

  assert.deepEqual(
    resolveProjectionSelectedPathsByIdUpdate({
      duplicates: ['albums/raw/one.jpg'],
      faces: ['faces/two.jpg'],
    }, 'duplicates', []),
    {
      faces: ['faces/two.jpg'],
    },
  )
})
