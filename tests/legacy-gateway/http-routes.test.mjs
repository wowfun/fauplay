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
  ['POST', '/v1/faces/detect-assets'],
  ['POST', '/v1/faces/detect-assets/jobs'],
  ['GET', '/v1/faces/detect-assets/jobs/job-1'],
  ['GET', '/v1/faces/detect-assets/jobs/job-1/items'],
  ['POST', '/v1/faces/detect-assets/jobs/job-1/cancel'],
  ['GET', '/v1/faces/crops/face-1'],
  ['POST', '/v1/faces/list-asset-faces'],
  ['POST', '/v1/faces/list-review-faces'],
  ['POST', '/v1/faces/list-people'],
  ['POST', '/v1/faces/rename-person'],
  ['POST', '/v1/faces/suggest-people'],
  ['POST', '/v1/faces/cluster-pending'],
  ['POST', '/v1/faces/merge-people'],
  ['POST', '/v1/faces/assign-faces'],
  ['POST', '/v1/faces/create-person-from-faces'],
  ['POST', '/v1/faces/unassign-faces'],
  ['POST', '/v1/faces/ignore-faces'],
  ['POST', '/v1/faces/restore-ignored-faces'],
  ['POST', '/v1/faces/requeue-faces'],
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
