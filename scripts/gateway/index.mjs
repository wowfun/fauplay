import { startGatewayServer } from './server.mjs'

const args = process.argv.slice(2)
const enableLegacyRoutes = !args.includes('--no-legacy')

startGatewayServer({ enableLegacyRoutes })
