import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(
  await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')
)

test('repository command surface no longer exposes the legacy gateway', () => {
  const scripts = packageJson.scripts ?? {}

  assert.equal(scripts.gateway, undefined)
  assert.equal(scripts['test:gateway'], undefined)
  assert.equal(scripts['legacy-gateway'], undefined)
  assert.equal(scripts['test:legacy-gateway'], undefined)
  assert.equal(String(scripts.test).includes('tests/legacy-gateway'), false)
})

test('repository no longer keeps the legacy gateway code or tests', async () => {
  await assert.rejects(
    () => access(resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/legacy-gateway')),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    () => access(resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/legacy-gateway')),
    { code: 'ENOENT' },
  )
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
