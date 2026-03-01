import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function isWindowsPath(input) {
  return /^[a-zA-Z]:[\\/]/.test(input)
}

function hasUnsafeSegment(relativePath) {
  const segments = relativePath.split('/').filter(Boolean)
  return segments.some((segment) => segment === '..')
}

function joinTargetPath(rootPath, relativePath) {
  if (isWindowsPath(rootPath)) {
    const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
    return `${normalizedRoot}\\${relativePath.split('/').join('\\')}`
  }

  return path.resolve(rootPath, ...relativePath.split('/'))
}

async function toWindowsPath(targetPath) {
  if (isWindowsPath(targetPath)) return targetPath
  const { stdout } = await execFileAsync('wslpath', ['-w', targetPath])
  return stdout.trim()
}

async function launchExplorer(args, fallbackMessage) {
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('explorer.exe', args, {
        stdio: 'ignore',
      })

      child.once('error', reject)
      child.once('spawn', resolve)
    })
  } catch (error) {
    const message = `${error?.message || ''}\n${error?.stderr || ''}`
    const interopLikelyDisabled =
      message.includes('MZ') ||
      message.includes('No such device') ||
      message.includes('Syntax error: newline unexpected')

    if (interopLikelyDisabled) {
      throw new Error(
        'WSL Windows interop seems disabled. Enable it in /etc/wsl.conf: [interop] enabled=true, then run "wsl --shutdown" from Windows and reopen WSL.'
      )
    }

    throw new Error(message || fallbackMessage)
  }
}

async function resolveTargetPath(rootPath, relativePath) {
  if (!rootPath || !relativePath) {
    throw new Error('rootPath and relativePath are required')
  }

  if (hasUnsafeSegment(relativePath)) {
    throw new Error('relativePath contains unsafe segments')
  }

  const targetPath = joinTargetPath(rootPath, relativePath)
  return toWindowsPath(targetPath)
}

async function revealInExplorer(rootPath, relativePath) {
  const windowsPath = await resolveTargetPath(rootPath, relativePath)
  await launchExplorer(['/select,', windowsPath], 'Failed to open explorer')
}

async function openWithSystemDefaultApp(rootPath, relativePath) {
  const windowsPath = await resolveTargetPath(rootPath, relativePath)
  await launchExplorer([windowsPath], 'Failed to open explorer')
}

export function createRevealMcpServer() {
  return {
    async listTools() {
      return [
        {
          name: 'system.reveal',
          description: '在文件资源管理器中显示',
          inputSchema: {
            type: 'object',
            properties: {
              rootPath: { type: 'string' },
              relativePath: { type: 'string' },
            },
            required: ['rootPath', 'relativePath'],
            additionalProperties: false,
          },
          annotations: {
            title: '在文件资源管理器中显示',
            mutation: false,
            scopes: ['file'],
          },
        },
        {
          name: 'system.openDefault',
          description: '用系统默认应用打开',
          inputSchema: {
            type: 'object',
            properties: {
              rootPath: { type: 'string' },
              relativePath: { type: 'string' },
            },
            required: ['rootPath', 'relativePath'],
            additionalProperties: false,
          },
          annotations: {
            title: '用系统默认应用打开',
            mutation: false,
            scopes: ['file'],
          },
        },
      ]
    },

    async callTool(name, args) {
      const rootPath = args?.rootPath
      const relativePath = args?.relativePath

      if (!rootPath || !relativePath) {
        const error = new Error('rootPath and relativePath are required')
        error.code = 'MCP_INVALID_PARAMS'
        throw error
      }

      if (name === 'system.reveal') {
        await revealInExplorer(rootPath, relativePath)
        return { ok: true }
      }

      if (name === 'system.openDefault') {
        await openWithSystemDefaultApp(rootPath, relativePath)
        return { ok: true }
      }

      const error = new Error(`Unsupported tool: ${name}`)
      error.code = 'MCP_TOOL_NOT_FOUND'
      throw error
    },
  }
}
