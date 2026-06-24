import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LOCAL_RUNTIME_BASE_URL,
  resolveLocalRuntimeBaseUrl,
} from '../../src/lib/runtimeApi/baseUrl.ts'

test('local runtime URL config prefers the Fauplay Runtime env var', () => {
  assert.equal(
    resolveLocalRuntimeBaseUrl({
      VITE_FAUPLAY_RUNTIME_BASE_URL: ' http://127.0.0.1:4100 ',
      VITE_LOCAL_GATEWAY_BASE_URL: 'http://127.0.0.1:3210',
    }, () => 'https://ui.local'),
    'http://127.0.0.1:4100',
  )
})

test('local runtime URL config keeps the legacy gateway env var as a migration fallback', () => {
  assert.equal(
    resolveLocalRuntimeBaseUrl({
      VITE_FAUPLAY_RUNTIME_BASE_URL: ' ',
      VITE_LOCAL_GATEWAY_BASE_URL: ' http://127.0.0.1:3210 ',
    }, () => 'https://ui.local'),
    'http://127.0.0.1:3210',
  )
})

test('local runtime URL config defaults to the Rust runtime port', () => {
  assert.equal(
    resolveLocalRuntimeBaseUrl({}, () => 'https://ui.local'),
    DEFAULT_LOCAL_RUNTIME_BASE_URL,
  )
  assert.equal(DEFAULT_LOCAL_RUNTIME_BASE_URL, 'http://127.0.0.1:3211')
})

test('local runtime URL config supports same-origin adapters', () => {
  assert.equal(
    resolveLocalRuntimeBaseUrl({
      VITE_FAUPLAY_RUNTIME_BASE_URL: 'same-origin',
    }, () => 'https://ui.local'),
    'https://ui.local',
  )

  assert.equal(
    resolveLocalRuntimeBaseUrl({
      VITE_FAUPLAY_RUNTIME_BASE_URL: '/',
    }, () => 'https://ui.local'),
    'https://ui.local',
  )
})
