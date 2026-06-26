import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import test from 'node:test'

test('Legacy Gateway no longer keeps local annotation rebind storage code', async () => {
  await assert.rejects(
    () => access(new URL('../../tools/legacy-gateway/data/bindings.mjs', import.meta.url), constants.F_OK),
    { code: 'ENOENT' },
  )

  const serverSource = await readFile(
    new URL('../../tools/legacy-gateway/server.mjs', import.meta.url),
    'utf8',
  )
  assert.equal(serverSource.includes('batchRebindPaths'), false)
})
