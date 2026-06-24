import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMcpServerRegistry,
  formatMcpConfigSourceLog,
  resolveConfigPath,
} from '../../scripts/gateway/mcp-config.mjs'

describe('MCP config registry', () => {
  let tempDir = ''

  before(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-mcp-config-'))
  })

  after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('loads enabled stdio servers from an explicit config file', async () => {
    const configPath = path.join(tempDir, 'mcp.json')
    await writeFile(configPath, JSON.stringify({
      servers: {
        disabled: {
          disabled: true,
          command: 'node',
        },
        local: {
          type: 'stdio',
          command: 'node',
          args: ['server.mjs', 123, '--flag'],
          cwd: '.',
          env: {
            KEEP: 'yes',
            DROP: false,
          },
          callTimeoutMs: 1234,
        },
      },
    }), 'utf8')

    const result = await createMcpServerRegistry(configPath, {
      useGlobalConfig: false,
    })
    const { serverRegistry, configSources } = result

    assert.deepEqual(configSources, [{
      label: 'custom',
      path: configPath,
      loaded: true,
    }])
    assert.equal(serverRegistry.length, 1)
    assert.deepEqual(serverRegistry[0], {
      transport: 'stdio',
      sourceLabel: 'local',
      command: 'node',
      args: ['server.mjs', '--flag'],
      cwd: process.cwd(),
      env: {
        KEEP: 'yes',
      },
      callTimeoutMs: 1234,
      initTimeoutMs: undefined,
      restartWindowMs: undefined,
      maxCrashesInWindow: undefined,
      restartCooldownMs: undefined,
    })
  })

  test('formats config source logs consistently', () => {
    assert.equal(
      formatMcpConfigSourceLog({ label: 'global', path: '/tmp/mcp.json', loaded: false }),
      '[gateway]   - global: /tmp/mcp.json (missing, skipped)',
    )
  })

  test('resolves relative config paths from the project root', () => {
    assert.equal(resolveConfigPath('src/config/mcp.json'), path.resolve(process.cwd(), 'src/config/mcp.json'))
    assert.equal(resolveConfigPath('/tmp/mcp.json'), '/tmp/mcp.json')
  })
})
