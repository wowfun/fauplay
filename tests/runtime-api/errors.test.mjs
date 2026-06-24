import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GatewayHttpError,
  GatewayMcpError,
  RuntimeHttpError,
  RuntimeMcpError,
  createClientTimeoutError,
  createRuntimeRequestTimeoutError,
} from '../../src/lib/runtimeApi/errors.ts'

test('Runtime API HTTP errors expose status and code with Runtime naming', () => {
  const error = new RuntimeHttpError('Runtime API request failed', 'RUNTIME_OFFLINE', 503)

  assert.equal(error.name, 'RuntimeHttpError')
  assert.equal(error.message, 'Runtime API request failed')
  assert.equal(error.code, 'RUNTIME_OFFLINE')
  assert.equal(error.status, 503)
  assert.ok(error instanceof RuntimeHttpError)
})

test('Runtime API MCP errors expose code with Runtime naming', () => {
  const error = new RuntimeMcpError('Runtime MCP request failed', 'MCP_METHOD_NOT_FOUND')

  assert.equal(error.name, 'RuntimeMcpError')
  assert.equal(error.message, 'Runtime MCP request failed')
  assert.equal(error.code, 'MCP_METHOD_NOT_FOUND')
  assert.ok(error instanceof RuntimeMcpError)
})

test('Runtime API timeout errors use Runtime wording and preserve the legacy helper alias', () => {
  const runtimeError = createRuntimeRequestTimeoutError(1201)
  const legacyAliasError = createClientTimeoutError(1201)

  assert.equal(runtimeError.name, 'RuntimeMcpError')
  assert.equal(runtimeError.message, 'Runtime API request timed out after 2s')
  assert.equal(runtimeError.code, 'MCP_CLIENT_TIMEOUT')
  assert.deepEqual(legacyAliasError, runtimeError)
})

test('legacy Gateway error exports are constructor aliases for migration compatibility', () => {
  assert.equal(GatewayHttpError, RuntimeHttpError)
  assert.equal(GatewayMcpError, RuntimeMcpError)
  assert.ok(new GatewayHttpError('legacy') instanceof RuntimeHttpError)
  assert.ok(new GatewayMcpError('legacy') instanceof RuntimeMcpError)
})
