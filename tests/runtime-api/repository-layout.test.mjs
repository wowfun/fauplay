import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(
  await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')
)

test('repository command surface exposes the legacy gateway only as a migration entrypoint', () => {
  const scripts = packageJson.scripts ?? {}

  assert.equal(scripts.gateway, undefined)
  assert.equal(scripts['test:gateway'], undefined)
  assert.equal(scripts['legacy-gateway'], 'node tools/legacy-gateway/index.mjs')
  assert.equal(scripts['test:legacy-gateway'], 'node --test tests/legacy-gateway/*.test.mjs')
})

test('package scripts do not point at the removed scripts directory', () => {
  const scripts = packageJson.scripts ?? {}

  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(
      /\bscripts\//.test(String(command)),
      false,
      `${name} still references the removed scripts directory`
    )
  }
})
