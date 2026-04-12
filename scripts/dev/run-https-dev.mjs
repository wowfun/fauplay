import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PROJECT_ROOT = process.cwd()
const DEV_HTTPS_DIRECTORY = path.resolve(PROJECT_ROOT, '.cache', 'dev-https')
const SERVER_KEY_PATH = path.join(DEV_HTTPS_DIRECTORY, 'server-key.pem')
const SERVER_CERT_PATH = path.join(DEV_HTTPS_DIRECTORY, 'server-cert.pem')
const MANIFEST_PATH = path.join(DEV_HTTPS_DIRECTORY, 'manifest.json')
const VITE_BIN_PATH = path.resolve(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

function main() {
  if (!fs.existsSync(SERVER_KEY_PATH) || !fs.existsSync(SERVER_CERT_PATH)) {
    console.error('[dev:https] Missing local HTTPS certificate files.')
    console.error('[dev:https] Run `npm run dev:https:setup` first.')
    process.exit(1)
  }

  if (!fs.existsSync(VITE_BIN_PATH)) {
    console.error('[dev:https] Vite is not installed. Run `npm install` first.')
    process.exit(1)
  }

  console.log('[dev:https] Starting Vite with local HTTPS certificates.')
  if (fs.existsSync(MANIFEST_PATH)) {
    console.log(`[dev:https] Manifest: ${MANIFEST_PATH}`)
  }

  const forwardedArgs = process.argv.slice(2)
  const viteArgs = forwardedArgs.length > 0 ? forwardedArgs : ['--host', '0.0.0.0']

  const child = spawn(
    process.execPath,
    [VITE_BIN_PATH, ...viteArgs],
    {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        FAUPLAY_DEV_HTTPS: '1',
        FAUPLAY_DEV_PROXY_ALL_GATEWAY: '1',
        FAUPLAY_DEV_HTTPS_KEY: SERVER_KEY_PATH,
        FAUPLAY_DEV_HTTPS_CERT: SERVER_CERT_PATH,
        VITE_LOCAL_GATEWAY_BASE_URL: '/',
      },
    }
  )

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

main()
