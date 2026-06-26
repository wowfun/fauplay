import { loadGlobalEnvFile } from './env.mjs'

try {
  await loadGlobalEnvFile()
  const { startGatewayServer } = await import('./server.mjs')
  await startGatewayServer()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
