import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveRuntimeApiDevProxyConfig } from './src/lib/runtimeApi/devProxy'

const DEV_HTTPS_DIRECTORY = path.resolve(__dirname, '.cache', 'dev-https')
const DEFAULT_DEV_HTTPS_CERT_PATH = path.join(DEV_HTTPS_DIRECTORY, 'server-cert.pem')
const DEFAULT_DEV_HTTPS_KEY_PATH = path.join(DEV_HTTPS_DIRECTORY, 'server-key.pem')

function isTruthyEnv(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function resolveDevHttpsOptions() {
  if (!isTruthyEnv(process.env.FAUPLAY_DEV_HTTPS)) {
    return undefined
  }

  const certPath = process.env.FAUPLAY_DEV_HTTPS_CERT?.trim() || DEFAULT_DEV_HTTPS_CERT_PATH
  const keyPath = process.env.FAUPLAY_DEV_HTTPS_KEY?.trim() || DEFAULT_DEV_HTTPS_KEY_PATH

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    throw new Error(
      [
        'FAUPLAY_DEV_HTTPS is enabled but the local HTTPS certificate files are missing.',
        `Expected cert: ${certPath}`,
        `Expected key: ${keyPath}`,
        'Run `pnpm run dev:https:setup` first, then retry `pnpm run dev:https`.',
      ].join('\n')
    )
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  }
}

export default defineConfig(() => {
  const https = resolveDevHttpsOptions()

  return {
    plugins: [react()],
    server: {
      https,
      proxy: resolveRuntimeApiDevProxyConfig(process.env),
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/App.tsx',
          './src/index.css',
          './src/layouts/DirectorySelectionLayout.tsx',
          './src/hooks/useFileSystem.ts',
          './src/lib/fileSystem.ts',
          './src/ui/Button.tsx',
          './src/features/workspace/components/WorkspaceShell.tsx',
          './src/layouts/ExplorerWorkspaceLayout.tsx',
          './src/features/explorer/components/FileBrowserGrid.tsx',
          './src/features/explorer/components/FileGridViewport.tsx',
          './src/features/explorer/components/ExplorerToolbar.tsx',
        ],
      },
    },
    preview: https ? { https } : undefined,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
