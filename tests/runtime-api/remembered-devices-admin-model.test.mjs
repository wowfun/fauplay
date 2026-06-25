import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readRememberedDevicesAdminErrorMessage,
  resolveRememberedDevicesAdminEntryVisibility,
  resolveRememberedDevicesAdminStartupPlan,
} from '../../src/features/remote-access/lib/rememberedDevicesAdminModel.ts'

test('Remembered Devices Admin Model checks local Runtime only from loopback startup', () => {
  assert.deepEqual(resolveRememberedDevicesAdminStartupPlan({
    isLoopbackUi: true,
    shouldShowStartupScreen: true,
  }), {
    kind: 'check-local-runtime',
  })

  assert.deepEqual(resolveRememberedDevicesAdminStartupPlan({
    isLoopbackUi: false,
    shouldShowStartupScreen: true,
  }), {
    kind: 'close-admin',
    isLocalRuntimeOnline: false,
    isOpen: false,
  })

  assert.deepEqual(resolveRememberedDevicesAdminStartupPlan({
    isLoopbackUi: true,
    shouldShowStartupScreen: false,
  }), {
    kind: 'close-admin',
    isLocalRuntimeOnline: false,
    isOpen: false,
  })
})

test('Remembered Devices Admin Model shows the admin entry only when loopback Runtime is online', () => {
  assert.equal(resolveRememberedDevicesAdminEntryVisibility({
    isLoopbackUi: true,
    isLocalRuntimeOnline: true,
  }), true)

  assert.equal(resolveRememberedDevicesAdminEntryVisibility({
    isLoopbackUi: true,
    isLocalRuntimeOnline: false,
  }), false)

  assert.equal(resolveRememberedDevicesAdminEntryVisibility({
    isLoopbackUi: false,
    isLocalRuntimeOnline: true,
  }), false)
})

test('Remembered Devices Admin Model reads admin error messages with operation fallbacks', () => {
  assert.equal(
    readRememberedDevicesAdminErrorMessage(new Error('Runtime offline'), '读取已记住设备失败'),
    'Runtime offline',
  )

  assert.equal(
    readRememberedDevicesAdminErrorMessage('unknown', '撤销设备失败'),
    '撤销设备失败',
  )
})
