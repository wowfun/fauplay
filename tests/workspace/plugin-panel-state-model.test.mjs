import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampToolPanelWidthPx,
  createEmptyPluginResultQueueState,
  createPluginWorkbenchState,
  readSameDurationScopeFromWorkbenchState,
  SAME_DURATION_SCOPE_OPTION_KEY,
  SAME_DURATION_TOOL_NAME,
} from '../../src/features/workspace/lib/pluginPanelStateModel.ts'

test('Plugin Panel State Model clamps tool panel widths', () => {
  assert.equal(clampToolPanelWidthPx(200), 320)
  assert.equal(clampToolPanelWidthPx(480), 480)
  assert.equal(clampToolPanelWidthPx(800), 640)
})

test('Plugin Panel State Model creates empty queue and workbench state', () => {
  assert.deepEqual(createEmptyPluginResultQueueState(), {
    byContextKey: {},
    contextOrder: [],
  })

  assert.deepEqual(createPluginWorkbenchState(), {
    activeToolName: null,
    optionValuesByTool: {},
  })
})

test('Plugin Panel State Model restores same-duration scope into preview workbench state', () => {
  const workbenchState = createPluginWorkbenchState('root')

  assert.deepEqual(workbenchState, {
    activeToolName: null,
    optionValuesByTool: {
      [SAME_DURATION_TOOL_NAME]: {
        [SAME_DURATION_SCOPE_OPTION_KEY]: 'root',
      },
    },
  })
  assert.equal(readSameDurationScopeFromWorkbenchState(workbenchState), 'root')
})

test('Plugin Panel State Model ignores unsupported same-duration scope values', () => {
  assert.deepEqual(createPluginWorkbenchState('workspace'), {
    activeToolName: null,
    optionValuesByTool: {},
  })

  assert.equal(readSameDurationScopeFromWorkbenchState({
    activeToolName: null,
    optionValuesByTool: {
      [SAME_DURATION_TOOL_NAME]: {
        [SAME_DURATION_SCOPE_OPTION_KEY]: 'workspace',
      },
    },
  }), null)
})
