import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DEV_GATEWAY_TARGET,
  DEFAULT_DEV_RUNTIME_TARGET,
  resolveRuntimeApiDevProxyConfig,
} from '../../src/lib/runtimeApi/devProxy.ts'

test('runtime API dev proxy sends local Runtime API calls to Fauplay Runtime while remote routes stay on the legacy gateway', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({
      FAUPLAY_DEV_PROXY_RUNTIME_API: '1',
    }),
    {
      '/v1/remote': {
        target: DEFAULT_DEV_GATEWAY_TARGET,
        changeOrigin: false,
      },
      '/v1': {
        target: DEFAULT_DEV_RUNTIME_TARGET,
        changeOrigin: false,
      },
    },
  )
})

test('runtime API dev proxy keeps only remote routes on the legacy gateway by default', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({}),
    {
      '/v1/remote': {
        target: DEFAULT_DEV_GATEWAY_TARGET,
        changeOrigin: false,
      },
    },
  )
})

test('runtime API dev proxy keeps a legacy all-gateway override for migration checks', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({
      FAUPLAY_DEV_PROXY_RUNTIME_API: '1',
      FAUPLAY_DEV_PROXY_ALL_GATEWAY: 'true',
    }),
    {
      '/v1': {
        target: DEFAULT_DEV_GATEWAY_TARGET,
        changeOrigin: false,
      },
    },
  )
})

test('runtime API dev proxy accepts explicit Runtime and gateway targets', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({
      FAUPLAY_DEV_PROXY_RUNTIME_API: 'yes',
      FAUPLAY_DEV_RUNTIME_TARGET: ' http://127.0.0.1:4311 ',
      FAUPLAY_DEV_GATEWAY_TARGET: ' http://127.0.0.1:4310 ',
    }),
    {
      '/v1/remote': {
        target: 'http://127.0.0.1:4310',
        changeOrigin: false,
      },
      '/v1': {
        target: 'http://127.0.0.1:4311',
        changeOrigin: false,
      },
    },
  )
})
