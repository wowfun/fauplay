import assert from 'node:assert/strict'
import test from 'node:test'

import { findHttpGatewayRoute } from '../../tools/legacy-gateway/http-routes.mjs'

const runtimeOwnedLocalRoutes = [
  ['POST', '/v1/data/tags/file'],
  ['POST', '/v1/data/tags/options'],
  ['POST', '/v1/data/tags/query'],
  ['PUT', '/v1/file-annotations'],
  ['POST', '/v1/file-annotations/tags/bind'],
  ['POST', '/v1/file-annotations/tags/unbind'],
  ['PATCH', '/v1/files/relative-paths'],
  ['POST', '/v1/files/indexes'],
  ['POST', '/v1/files/duplicates/query'],
  ['POST', '/v1/files/missing/cleanups'],
  ['POST', '/v1/files/text-preview'],
  ['POST', '/v1/recycle/items/move'],
  ['POST', '/v1/recycle/items/list'],
  ['POST', '/v1/recycle/items/restore'],
  ['POST', '/v1/faces/detect-asset'],
  ['POST', '/v1/faces/list-asset-faces'],
  ['POST', '/v1/faces/list-review-faces'],
  ['POST', '/v1/faces/list-people'],
  ['POST', '/v1/faces/rename-person'],
]

test('Legacy Gateway HTTP route registry does not expose Runtime-owned local capabilities', () => {
  for (const [method, pathname] of runtimeOwnedLocalRoutes) {
    assert.equal(
      findHttpGatewayRoute(method, pathname),
      null,
      `${method} ${pathname} should be owned by Fauplay Runtime`,
    )
  }
})

test('Legacy Gateway HTTP route registry keeps face migration routes online', () => {
  assert.notEqual(findHttpGatewayRoute('POST', '/v1/faces/detect-assets'), null)
  assert.notEqual(findHttpGatewayRoute('GET', '/v1/faces/detect-assets/jobs/job-1'), null)
})
