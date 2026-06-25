import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveWorkspaceShellRenderPlan,
} from '../../src/features/workspace/lib/workspaceShellRenderModel.ts'

function presentationProfile(overrides = {}) {
  return {
    viewportMode: 'wide',
    inputMode: 'keyboard',
    accessMode: 'full-access',
    shellKind: 'wide',
    primaryFileOpenTarget: 'pane',
    supportsPersistentPreviewPane: true,
    toolbarKind: 'wide',
    peoplePanelKind: 'side-panel',
    resultPanelKind: 'bottom-panel',
    previewNavigationUi: {
      showButtons: false,
      enableImageSwipe: false,
    },
    previewHeaderTitleMode: 'actionable',
    showPreviewUnavailableReasons: true,
    pluginRegionKind: 'sidebar',
    ...overrides,
  }
}

test('Workspace Shell Render Model routes wide shells through the wide layout preview configuration', () => {
  assert.deepEqual(
    resolveWorkspaceShellRenderPlan({
      presentationProfile: presentationProfile({
        previewHeaderTitleMode: 'static',
        showPreviewUnavailableReasons: false,
      }),
      canNavigatePreviewBackward: true,
      canNavigatePreviewForward: true,
    }),
    {
      kind: 'wide',
      previewHeaderTitleMode: 'static',
      showPreviewUnavailableReasons: false,
    },
  )
})

test('Workspace Shell Render Model routes compact shells with preview navigation availability', () => {
  assert.deepEqual(
    resolveWorkspaceShellRenderPlan({
      presentationProfile: presentationProfile({
        viewportMode: 'compact',
        shellKind: 'compact',
        primaryFileOpenTarget: 'fullscreen',
        supportsPersistentPreviewPane: false,
        toolbarKind: 'compact',
        peoplePanelKind: 'overlay',
        resultPanelKind: 'overlay',
        pluginRegionKind: 'overlay',
      }),
      canNavigatePreviewBackward: true,
      canNavigatePreviewForward: false,
    }),
    {
      kind: 'compact',
      canNavigatePreviewBackward: true,
      canNavigatePreviewForward: false,
    },
  )
})
