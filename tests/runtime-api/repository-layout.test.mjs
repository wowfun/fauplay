import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(
  await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')
)
const runtimeCargoToml = await readFile(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../crates/fauplay-runtime/Cargo.toml'),
  'utf8'
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

test('repository command surface starts the Rust-owned Fauplay service', async () => {
  const scripts = packageJson.scripts ?? {}

  assert.equal(scripts.dev, undefined)
  assert.equal(scripts['dev:web'], undefined)
  assert.equal(scripts['dev:https'], undefined)
  assert.equal(scripts['dev:web:https'], undefined)
  assert.equal(scripts['dev:https:setup'], undefined)
  assert.equal(scripts['runtime:serve'], undefined)
  assert.equal(scripts['runtime:cli'], undefined)
  assert.equal(scripts.start, 'cargo run -p fauplay-runtime --bin fauplay --')

  assert.match(runtimeCargoToml, /\[\[bin\]\]\s*name = "fauplay"\s*path = "src\/main\.rs"/)
  assert.doesNotMatch(runtimeCargoToml, /\[\[bin\]\][\s\S]*?name = "fauplay-runtime"/)

  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(
      /\btools\/dev\//.test(String(command)),
      false,
      `${name} still references removed development startup helpers`
    )
  }

  await assert.rejects(
    () => access(resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/dev/run-dev.mjs')),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    () => access(resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/dev/run-https-dev.mjs')),
    { code: 'ENOENT' },
  )
  await assert.rejects(
    () => access(resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/dev/setup-https-dev.mjs')),
    { code: 'ENOENT' },
  )
})
