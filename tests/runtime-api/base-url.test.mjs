import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLocalRuntimeBaseUrl } from '../../src/lib/runtimeApi/baseUrl.ts'

test('local runtime URL config uses the current application origin', () => {
  assert.equal(
    resolveLocalRuntimeBaseUrl(() => 'https://ui.local'),
    'https://ui.local',
  )
})
