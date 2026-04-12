import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PROJECT_ROOT = process.cwd()
const OUTPUT_DIRECTORY = path.resolve(PROJECT_ROOT, '.cache', 'dev-https')
const CA_KEY_PATH = path.join(OUTPUT_DIRECTORY, 'ca-key.pem')
const CA_CERT_PATH = path.join(OUTPUT_DIRECTORY, 'ca-cert.pem')
const CA_CERT_CRT_PATH = path.join(OUTPUT_DIRECTORY, 'ca-cert.crt')
const SERVER_KEY_PATH = path.join(OUTPUT_DIRECTORY, 'server-key.pem')
const SERVER_CERT_PATH = path.join(OUTPUT_DIRECTORY, 'server-cert.pem')
const SERVER_CSR_PATH = path.join(OUTPUT_DIRECTORY, 'server.csr')
const SERVER_EXT_PATH = path.join(OUTPUT_DIRECTORY, 'server-ext.cnf')
const SERVER_SERIAL_PATH = path.join(OUTPUT_DIRECTORY, 'ca-cert.srl')
const MANIFEST_PATH = path.join(OUTPUT_DIRECTORY, 'manifest.json')
const ROOT_CA_COMMON_NAME = 'Fauplay Local Dev CA'
const SERVER_COMMON_NAME = 'fauplay-local-dev'

function parseListArg(flagName) {
  const prefix = `${flagName}=`
  const value = process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length)
    .trim()

  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getLanIpv4Addresses() {
  const ipSet = new Set(['127.0.0.1'])
  let interfaces = {}

  try {
    interfaces = os.networkInterfaces()
  } catch {
    return [...ipSet]
  }

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry) continue
      if (entry.family !== 'IPv4') continue
      if (entry.internal) continue
      if (!entry.address) continue
      ipSet.add(entry.address)
    }
  }

  return [...ipSet].sort()
}

function getDnsNames(extraDnsNames) {
  const dnsSet = new Set(['localhost'])
  const machineHost = os.hostname().trim()
  if (machineHost) {
    dnsSet.add(machineHost)
    const shortHost = machineHost.split('.')[0]?.trim()
    if (shortHost) {
      dnsSet.add(shortHost)
    }
  }
  for (const item of extraDnsNames) {
    dnsSet.add(item)
  }
  return [...dnsSet].sort()
}

function buildServerExtensionConfig(dnsNames, ipAddresses) {
  const lines = [
    '[v3_server]',
    'basicConstraints = CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectAltName = @alt_names',
    '',
    '[alt_names]',
  ]

  let dnsIndex = 1
  for (const item of dnsNames) {
    lines.push(`DNS.${dnsIndex} = ${item}`)
    dnsIndex += 1
  }

  let ipIndex = 1
  for (const item of ipAddresses) {
    lines.push(`IP.${ipIndex} = ${item}`)
    ipIndex += 1
  }

  lines.push('')
  return lines.join('\n')
}

async function ensureOpenSslAvailable() {
  try {
    await execFileAsync('openssl', ['version'])
  } catch {
    throw new Error('openssl 不可用，无法生成本地 HTTPS 开发证书')
  }
}

async function ensureRootCa() {
  try {
    await fs.access(CA_KEY_PATH)
    await fs.access(CA_CERT_PATH)
    const rootCaPem = await fs.readFile(CA_CERT_PATH)
    await fs.writeFile(CA_CERT_CRT_PATH, rootCaPem)
    return
  } catch {
    // Create the local CA when it does not already exist.
  }

  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-new',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '3650',
    '-subj',
    `/CN=${ROOT_CA_COMMON_NAME}`,
    '-keyout',
    CA_KEY_PATH,
    '-out',
    CA_CERT_PATH,
    '-addext',
    'basicConstraints=critical,CA:true',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
    '-addext',
    'subjectKeyIdentifier=hash',
  ])

  const rootCaPem = await fs.readFile(CA_CERT_PATH)
  await fs.writeFile(CA_CERT_CRT_PATH, rootCaPem)
}

async function writeManifest(dnsNames, ipAddresses) {
  const suggestedUrls = ipAddresses.map((ipAddress) => `https://${ipAddress}:5173`)
  const manifest = {
    createdAt: new Date().toISOString(),
    outputDirectory: OUTPUT_DIRECTORY,
    caCertPath: CA_CERT_PATH,
    caCertCrtPath: CA_CERT_CRT_PATH,
    serverKeyPath: SERVER_KEY_PATH,
    serverCertPath: SERVER_CERT_PATH,
    dnsNames,
    ipAddresses,
    suggestedUrls,
  }
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function main() {
  await ensureOpenSslAvailable()
  await fs.mkdir(OUTPUT_DIRECTORY, { recursive: true })

  const extraDnsNames = parseListArg('--dns')
  const extraIpAddresses = parseListArg('--ip')
  const dnsNames = getDnsNames(extraDnsNames)
  const ipAddresses = [...new Set([...getLanIpv4Addresses(), ...extraIpAddresses])].sort()

  await ensureRootCa()

  const extensionConfig = buildServerExtensionConfig(dnsNames, ipAddresses)
  await fs.writeFile(SERVER_EXT_PATH, extensionConfig)

  await execFileAsync('openssl', [
    'req',
    '-new',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-subj',
    `/CN=${SERVER_COMMON_NAME}`,
    '-keyout',
    SERVER_KEY_PATH,
    '-out',
    SERVER_CSR_PATH,
  ])

  await execFileAsync('openssl', [
    'x509',
    '-req',
    '-in',
    SERVER_CSR_PATH,
    '-CA',
    CA_CERT_PATH,
    '-CAkey',
    CA_KEY_PATH,
    '-CAcreateserial',
    '-out',
    SERVER_CERT_PATH,
    '-days',
    '825',
    '-sha256',
    '-extfile',
    SERVER_EXT_PATH,
    '-extensions',
    'v3_server',
  ])

  await writeManifest(dnsNames, ipAddresses)

  console.log('[dev:https] Local CA and server certificate are ready.')
  console.log(`[dev:https]   CA cert : ${CA_CERT_PATH}`)
  console.log(`[dev:https]   Server cert: ${SERVER_CERT_PATH}`)
  console.log(`[dev:https]   Server key : ${SERVER_KEY_PATH}`)
  console.log('[dev:https] Trusted mobile devices should import and trust the local CA certificate:')
  console.log(`[dev:https]   ${CA_CERT_CRT_PATH}`)
  console.log('[dev:https] Suggested HTTPS dev URLs:')
  for (const ipAddress of ipAddresses) {
    console.log(`[dev:https]   https://${ipAddress}:5173`)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[dev:https] ${message}`)
  process.exitCode = 1
}).finally(async () => {
  await Promise.allSettled([
    fs.rm(SERVER_CSR_PATH, { force: true }),
    fs.rm(SERVER_SERIAL_PATH, { force: true }),
  ])
})
