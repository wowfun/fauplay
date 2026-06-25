import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWorkspacePreviewCapabilityModel } from '../../src/features/workspace/lib/workspacePreviewCapabilityModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function tool(name, scopes = ['file']) {
  return {
    name,
    title: name,
    mutation: false,
    scopes,
    toolOptions: [],
    toolActions: [],
  }
}

test('Workspace Preview Capability Model uses the lightbox file as the active capability target', () => {
  const lightboxFile = file('clips/trailer.mp4')
  const paneFile = file('images/poster.jpg')

  const model = resolveWorkspacePreviewCapabilityModel({
    previewFile: lightboxFile,
    selectedFile: paneFile,
    showPreviewPane: true,
    pluginTools: [
      tool('local.data'),
      tool('fs.softDelete'),
    ],
  })

  assert.equal(model.activePreviewFile, lightboxFile)
  assert.equal(model.previewNavigationSurface, 'lightbox')
  assert.equal(model.hasActiveVideoPreview, true)
  assert.equal(model.canRunTagShortcuts, true)
  assert.equal(model.canSoftDelete, true)
})

test('Workspace Preview Capability Model uses the pane selection only while the pane is visible', () => {
  const paneFile = file('images/poster.jpg')

  assert.deepEqual(resolveWorkspacePreviewCapabilityModel({
    previewFile: null,
    selectedFile: paneFile,
    showPreviewPane: true,
    pluginTools: [],
  }), {
    activePreviewFile: paneFile,
    previewNavigationSurface: 'pane',
    hasActiveVideoPreview: false,
    canRunTagShortcuts: false,
    canSoftDelete: false,
  })

  assert.deepEqual(resolveWorkspacePreviewCapabilityModel({
    previewFile: null,
    selectedFile: paneFile,
    showPreviewPane: false,
    pluginTools: [
      tool('local.data'),
      tool('fs.softDelete'),
    ],
  }), {
    activePreviewFile: null,
    previewNavigationSurface: 'pane',
    hasActiveVideoPreview: false,
    canRunTagShortcuts: false,
    canSoftDelete: false,
  })
})

test('Workspace Preview Capability Model only enables file-scoped local capabilities for normal Root-relative files', () => {
  const pluginTools = [
    tool('local.data', ['directory']),
    tool('fs.softDelete'),
  ]

  assert.deepEqual(resolveWorkspacePreviewCapabilityModel({
    previewFile: file('/outside/root.jpg'),
    selectedFile: null,
    showPreviewPane: false,
    pluginTools,
  }), {
    activePreviewFile: file('/outside/root.jpg'),
    previewNavigationSurface: 'lightbox',
    hasActiveVideoPreview: false,
    canRunTagShortcuts: false,
    canSoftDelete: false,
  })

  assert.deepEqual(resolveWorkspacePreviewCapabilityModel({
    previewFile: file('trash/restored.jpg', { sourceType: 'root_trash' }),
    selectedFile: null,
    showPreviewPane: false,
    pluginTools,
  }), {
    activePreviewFile: file('trash/restored.jpg', { sourceType: 'root_trash' }),
    previewNavigationSurface: 'lightbox',
    hasActiveVideoPreview: false,
    canRunTagShortcuts: false,
    canSoftDelete: false,
  })

  assert.deepEqual(resolveWorkspacePreviewCapabilityModel({
    previewFile: file('images/normal.jpg'),
    selectedFile: null,
    showPreviewPane: false,
    pluginTools,
  }), {
    activePreviewFile: file('images/normal.jpg'),
    previewNavigationSurface: 'lightbox',
    hasActiveVideoPreview: false,
    canRunTagShortcuts: false,
    canSoftDelete: true,
  })
})
