import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createMcpRuntimeError } from './mcp/runtime.mjs'

const PROJECT_ROOT = process.cwd()
export const DEFAULT_MCP_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'src', 'config', 'mcp.json')
const GLOBAL_MCP_CONFIG_PATH = path.join(os.homedir(), '.fauplay', 'global', 'mcp.json')

export function resolveConfigPath(configPath) {
  if (typeof configPath !== 'string' || !configPath.trim()) {
    return configPath
  }
  return path.isAbsolute(configPath) ? configPath : path.resolve(PROJECT_ROOT, configPath)
}

function toStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string')
}

function toStringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const next = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      next[key] = item
    }
  }

  return Object.keys(next).length > 0 ? next : undefined
}

function resolveCwd(projectDir, cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return undefined
  return path.isAbsolute(cwd) ? cwd : path.resolve(projectDir, cwd)
}

function toConfigObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

export function formatMcpConfigSourceLog(source) {
  const suffix = source.loaded ? '' : ' (missing, skipped)'
  return `[gateway]   - ${source.label}: ${source.path}${suffix}`
}

async function readMcpConfigFile(configPath, { allowMissing = false } = {}) {
  let raw = ''
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (allowMissing && error && typeof error === 'object' && error.code === 'ENOENT') {
      return null
    }
    throw createMcpRuntimeError('MCP_CONFIG_ERROR', `Failed to read MCP config: ${configPath}`, 500)
  }

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw createMcpRuntimeError('MCP_CONFIG_ERROR', `Invalid JSON in MCP config: ${configPath}`, 500)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createMcpRuntimeError('MCP_CONFIG_ERROR', `MCP config root must be an object: ${configPath}`, 500)
  }

  return parsed
}

function mergeMcpServerEntries(baseEntry, overrideEntry) {
  if (!baseEntry || typeof baseEntry !== 'object' || Array.isArray(baseEntry)) {
    return overrideEntry
  }
  if (!overrideEntry || typeof overrideEntry !== 'object' || Array.isArray(overrideEntry)) {
    return overrideEntry ?? baseEntry
  }
  return {
    ...baseEntry,
    ...overrideEntry,
  }
}

function mergeMcpConfig(baseConfig, overrideConfig) {
  const base = toConfigObject(baseConfig)
  const override = toConfigObject(overrideConfig)

  const merged = {
    ...base,
    ...override,
  }

  const baseServers = toConfigObject(base.servers)
  const overrideServers = toConfigObject(override.servers)
  const hasServers = Object.keys(baseServers).length > 0 || Object.keys(overrideServers).length > 0

  if (hasServers) {
    const mergedServers = {}
    const serverNames = new Set([...Object.keys(baseServers), ...Object.keys(overrideServers)])
    for (const name of serverNames) {
      mergedServers[name] = mergeMcpServerEntries(baseServers[name], overrideServers[name])
    }
    merged.servers = mergedServers
  }

  return merged
}

async function loadMcpServersFromConfig(configPath, { useGlobalConfig = true } = {}) {
  const resolvedConfigPath = resolveConfigPath(configPath)
  const configSources = []
  const baseConfig = await readMcpConfigFile(resolvedConfigPath)
  configSources.push({
    label: useGlobalConfig ? 'default' : 'custom',
    path: resolvedConfigPath,
    loaded: true,
  })
  const globalConfig = useGlobalConfig
    ? await readMcpConfigFile(GLOBAL_MCP_CONFIG_PATH, { allowMissing: true })
    : null
  if (useGlobalConfig) {
    configSources.push({
      label: 'global',
      path: GLOBAL_MCP_CONFIG_PATH,
      loaded: Boolean(globalConfig),
    })
  }
  const parsed = mergeMcpConfig(baseConfig, globalConfig)

  const servers = parsed.servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return {
      serverRegistry: [],
      configSources,
    }
  }

  const serversToLoad = []

  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    if (entry.disabled === true) {
      continue
    }

    const type = typeof entry.type === 'string' && entry.type ? entry.type : 'stdio'
    if (type !== 'stdio') {
      console.warn(`[gateway] Skip MCP server "${name}": unsupported type "${type}"`)
      continue
    }

    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    if (!command) {
      console.warn(`[gateway] Skip MCP server "${name}": missing command`)
      continue
    }

    serversToLoad.push({
      transport: 'stdio',
      sourceLabel: name,
      command,
      args: toStringArray(entry.args),
      cwd: resolveCwd(PROJECT_ROOT, entry.cwd),
      env: toStringRecord(entry.env),
      callTimeoutMs: entry.callTimeoutMs,
      initTimeoutMs: entry.initTimeoutMs,
      restartWindowMs: entry.restartWindowMs,
      maxCrashesInWindow: entry.maxCrashesInWindow,
      restartCooldownMs: entry.restartCooldownMs,
    })
  }

  return {
    serverRegistry: serversToLoad,
    configSources,
  }
}

export async function createMcpServerRegistry(configPath, options) {
  return loadMcpServersFromConfig(configPath, options)
}
