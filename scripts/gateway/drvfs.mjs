import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'

const SUDO_COMMAND_TIMEOUT_MS = 3000
const MAX_SUDO_OUTPUT_BUFFER = 1024 * 1024
const remountFailureByDrive = new Map()
const remountInFlightByDrive = new Map()
const execFileAsync = promisify(execFile)

function createDrvfsError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function getErrorDetail(error) {
  return `${error?.message || ''}\n${error?.stderr || ''}`.trim()
}

export function isNoSuchDeviceError(error) {
  return /No such device/i.test(getErrorDetail(error))
}

export function extractDrvfsMountTarget(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return null
  }

  const normalized = targetPath.trim().replace(/\\/g, '/')
  const linuxMatch = normalized.match(/^\/mnt\/([a-zA-Z])(?:\/|$)/)
  const windowsMatch = normalized.match(/^([a-zA-Z]):(?:\/|$)/)
  const driveValue = linuxMatch?.[1] ?? windowsMatch?.[1] ?? null
  if (!driveValue) {
    return null
  }

  const driveLower = driveValue.toLowerCase()
  return {
    driveLower,
    driveUpper: driveLower.toUpperCase(),
    mountPoint: `/mnt/${driveLower}`,
  }
}

function collectDrvfsTargets(candidatePaths) {
  const targets = []
  const seenDrives = new Set()
  const items = Array.isArray(candidatePaths) ? candidatePaths : [candidatePaths]
  for (const item of items) {
    const target = extractDrvfsMountTarget(item)
    if (!target || seenDrives.has(target.driveLower)) {
      continue
    }
    seenDrives.add(target.driveLower)
    targets.push(target)
  }
  return targets
}

function formatRemountTargets(targets) {
  return targets
    .map((target) => `${target.driveUpper}: at ${target.mountPoint}`)
    .join(', ')
}

async function mountDrvfsTarget(target, errorCode) {
  const previousFailure = remountFailureByDrive.get(target.driveLower)
  if (previousFailure) {
    throw createDrvfsError(
      errorCode,
      `Skip remount ${target.driveUpper}: previous remount failed. ${previousFailure}`
    )
  }

  const inFlight = remountInFlightByDrive.get(target.driveLower)
  if (inFlight) {
    return inFlight
  }

  const promise = (async () => {
    const sudoPassword = process.env.SUDO_PASSWORD
    if (typeof sudoPassword !== 'string' || !sudoPassword) {
      throw createDrvfsError(
        errorCode,
        `Missing SUDO_PASSWORD for drvfs remount: sudo -S mount -t drvfs ${target.driveUpper}: ${target.mountPoint}`
      )
    }

    try {
      await execFileAsync(
        'sudo',
        ['-S', 'mount', '-t', 'drvfs', `${target.driveUpper}:`, target.mountPoint],
        {
          input: `${sudoPassword}\n`,
          encoding: 'utf8',
          maxBuffer: MAX_SUDO_OUTPUT_BUFFER,
          timeout: SUDO_COMMAND_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        }
      )
      remountFailureByDrive.delete(target.driveLower)
    } catch (error) {
      const detail = getErrorDetail(error) || 'unknown remount error'
      const passwordHint = /password for/i.test(detail)
        ? ' Verify SUDO_PASSWORD is correct and can run sudo non-interactively.'
        : ''
      remountFailureByDrive.set(target.driveLower, detail)
      throw createDrvfsError(
        errorCode,
        `Failed to remount ${target.driveUpper}: at ${target.mountPoint}. ${detail}${passwordHint}`
      )
    }
  })()

  remountInFlightByDrive.set(target.driveLower, promise)

  try {
    await promise
  } finally {
    remountInFlightByDrive.delete(target.driveLower)
  }
}

export async function withDrvfsRetry(candidatePaths, actionName, action, options = {}) {
  const errorCode = typeof options.errorCode === 'string' && options.errorCode
    ? options.errorCode
    : 'MCP_TOOL_CALL_FAILED'
  const wrapRetryError = options.wrapRetryError !== false

  try {
    return await action()
  } catch (firstError) {
    if (!isNoSuchDeviceError(firstError)) {
      throw firstError
    }

    const targets = collectDrvfsTargets(candidatePaths)
    if (targets.length === 0) {
      throw firstError
    }

    for (const target of targets) {
      await mountDrvfsTarget(target, errorCode)
    }

    try {
      return await action()
    } catch (retryError) {
      if (!wrapRetryError) {
        throw retryError
      }

      throw createDrvfsError(
        errorCode,
        `Failed to ${actionName} after remount ${formatRemountTargets(targets)}. ${getErrorDetail(retryError) || 'unknown error'}`
      )
    }
  }
}

export async function statWithDrvfsRetry(targetPath, options) {
  return withDrvfsRetry([targetPath], 'stat path', () => fs.stat(targetPath, options))
}

export async function openWithDrvfsRetry(targetPath, flags) {
  return withDrvfsRetry([targetPath], 'open file', () => fs.open(targetPath, flags))
}

export async function execFileWithDrvfsRetry(command, args, options, candidatePaths = []) {
  const actionName = typeof command === 'string' && command.trim()
    ? `execute ${command.trim()}`
    : 'execute command'
  return withDrvfsRetry(
    [command, ...candidatePaths],
    actionName,
    () => execFileAsync(command, args, options)
  )
}
