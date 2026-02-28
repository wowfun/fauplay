import http from 'node:http'
import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PORT = Number(process.env.FAUPLAY_REVEAL_PORT || 3210)
const HOST = '127.0.0.1'

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

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

async function revealInExplorer(rootPath, relativePath) {
  if (!rootPath || !relativePath) {
    throw new Error('rootPath and relativePath are required')
  }

  if (hasUnsafeSegment(relativePath)) {
    throw new Error('relativePath contains unsafe segments')
  }

  const targetPath = joinTargetPath(rootPath, relativePath)
  const windowsPath = await toWindowsPath(targetPath)
  try {
    // explorer.exe /select, "X:\\path\\to\\file.ext"
    await new Promise((resolve, reject) => {
      const child = spawn('explorer.exe', ['/select,', windowsPath], {
        stdio: 'ignore',
      })

      child.once('error', reject)
      // explorer.exe may exit with non-zero even when window opens successfully.
      // treat successful spawn as success to avoid false negatives in UI.
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

    throw new Error(message || 'Failed to open explorer')
  }
}

async function openWithSystemDefaultApp(rootPath, relativePath) {
  if (!rootPath || !relativePath) {
    throw new Error('rootPath and relativePath are required')
  }

  if (hasUnsafeSegment(relativePath)) {
    throw new Error('relativePath contains unsafe segments')
  }

  const targetPath = joinTargetPath(rootPath, relativePath)
  const windowsPath = await toWindowsPath(targetPath)
  try {
    // explorer.exe <filePath> opens file with system-associated app.
    await new Promise((resolve, reject) => {
      const child = spawn('explorer.exe', [windowsPath], {
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

    throw new Error(message || 'Failed to open explorer')
  }
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST' || (req.url !== '/reveal' && req.url !== '/open')) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })

  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}')
      if (req.url === '/open') {
        await openWithSystemDefaultApp(payload.rootPath, payload.relativePath)
      } else {
        await revealInExplorer(payload.rootPath, payload.relativePath)
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (error) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: error.message }))
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`Reveal helper listening on http://${HOST}:${PORT}`)
})
