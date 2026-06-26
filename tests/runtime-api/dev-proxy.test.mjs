import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DEV_RUNTIME_TARGET,
  resolveRuntimeApiDevProxyConfig,
} from '../../src/lib/runtimeApi/devProxy.ts'

test('runtime API dev proxy sends local and Remote Access calls to Fauplay Runtime', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({
      FAUPLAY_DEV_PROXY_RUNTIME_API: '1',
    }),
    {
      '/v1/remote': {
        target: DEFAULT_DEV_RUNTIME_TARGET,
        changeOrigin: false,
      },
      '/v1': {
        target: DEFAULT_DEV_RUNTIME_TARGET,
        changeOrigin: false,
      },
    },
  )
})

test('runtime API dev proxy keeps only Remote Access routes on Fauplay Runtime by default', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({}),
    {
      '/v1/remote': {
        target: DEFAULT_DEV_RUNTIME_TARGET,
        changeOrigin: false,
      },
    },
  )
})

test('runtime API dev proxy ignores the removed all-gateway migration override', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({
      FAUPLAY_DEV_PROXY_RUNTIME_API: '1',
      FAUPLAY_DEV_PROXY_ALL_GATEWAY: 'true',
    }),
    {
      '/v1/remote': {
        target: DEFAULT_DEV_RUNTIME_TARGET,
        changeOrigin: false,
      },
      '/v1': {
        target: DEFAULT_DEV_RUNTIME_TARGET,
        changeOrigin: false,
      },
    },
  )
})

test('runtime API dev proxy accepts an explicit Runtime target', () => {
  assert.deepEqual(
    resolveRuntimeApiDevProxyConfig({
      FAUPLAY_DEV_PROXY_RUNTIME_API: 'yes',
      FAUPLAY_DEV_RUNTIME_TARGET: ' http://127.0.0.1:4311 ',
    }),
    {
      '/v1/remote': {
        target: 'http://127.0.0.1:4311',
        changeOrigin: false,
      },
      '/v1': {
        target: 'http://127.0.0.1:4311',
        changeOrigin: false,
      },
    },
  )
})
