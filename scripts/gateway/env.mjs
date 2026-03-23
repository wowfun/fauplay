import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const GLOBAL_ENV_PATH = path.join(os.homedir(), '.fauplay', 'global', '.env')

function createEnvConfigError(message) {
  const error = new Error(message)
  error.code = 'MCP_CONFIG_ERROR'
  return error
}

function isValidEnvKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
}

function decodeDoubleQuotedValue(rawValue) {
  let decoded = ''
  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index]
    if (char !== '\\') {
      decoded += char
      continue
    }

    index += 1
    const escape = rawValue[index]
    if (typeof escape !== 'string') {
      decoded += '\\'
      break
    }

    if (escape === 'n') {
      decoded += '\n'
      continue
    }
    if (escape === 'r') {
      decoded += '\r'
      continue
    }
    if (escape === 't') {
      decoded += '\t'
      continue
    }

    decoded += escape
  }
  return decoded
}

function parseQuotedValue(rawValue, quote, lineNumber, filePath) {
  let closingIndex = -1
  let escaped = false

  for (let index = 1; index < rawValue.length; index += 1) {
    const char = rawValue[index]
    if (quote === '"' && char === '\\' && !escaped) {
      escaped = true
      continue
    }
    if (char === quote && !escaped) {
      closingIndex = index
      break
    }
    escaped = false
  }

  if (closingIndex < 0) {
    throw createEnvConfigError(`Invalid .env syntax at ${filePath}:${lineNumber}: missing closing quote`)
  }

  const body = rawValue.slice(1, closingIndex)
  const suffix = rawValue.slice(closingIndex + 1).trim()
  if (suffix && !suffix.startsWith('#')) {
    throw createEnvConfigError(`Invalid .env syntax at ${filePath}:${lineNumber}: unexpected trailing characters`)
  }

  if (quote === '"') {
    return decodeDoubleQuotedValue(body)
  }

  return body
}

function parseEnvValue(rawValue, lineNumber, filePath) {
  const trimmedLeading = rawValue.trimStart()
  if (!trimmedLeading) {
    return ''
  }

  const firstChar = trimmedLeading[0]
  if (firstChar === '"' || firstChar === "'") {
    return parseQuotedValue(trimmedLeading, firstChar, lineNumber, filePath)
  }

  const commentIndex = trimmedLeading.search(/\s#/)
  const value = commentIndex >= 0
    ? trimmedLeading.slice(0, commentIndex).trimEnd()
    : trimmedLeading.trimEnd()
  return value
}

function parseEnvFile(raw, filePath) {
  const entries = {}
  const normalizedRaw = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw
  const lines = normalizedRaw.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = lines[index]
    const trimmed = sourceLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    let working = sourceLine.trimStart()
    if (working.startsWith('export ')) {
      working = working.slice('export '.length)
    }

    const equalsIndex = working.indexOf('=')
    if (equalsIndex < 0) {
      throw createEnvConfigError(`Invalid .env syntax at ${filePath}:${index + 1}: missing "="`)
    }

    const key = working.slice(0, equalsIndex).trim()
    if (!isValidEnvKey(key)) {
      throw createEnvConfigError(`Invalid .env syntax at ${filePath}:${index + 1}: invalid key "${key}"`)
    }

    const rawValue = working.slice(equalsIndex + 1)
    entries[key] = parseEnvValue(rawValue, index + 1, filePath)
  }

  return entries
}

export async function loadGlobalEnvFile() {
  let raw = ''
  try {
    raw = await readFile(GLOBAL_ENV_PATH, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        path: GLOBAL_ENV_PATH,
        loaded: false,
        count: 0,
      }
    }
    throw createEnvConfigError(`Failed to read global env file: ${GLOBAL_ENV_PATH}`)
  }

  const entries = parseEnvFile(raw, GLOBAL_ENV_PATH)
  for (const [key, value] of Object.entries(entries)) {
    process.env[key] = value
  }

  return {
    path: GLOBAL_ENV_PATH,
    loaded: true,
    count: Object.keys(entries).length,
  }
}
