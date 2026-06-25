import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewPanelCapabilityModel } from '../../src/features/preview/lib/previewPanelCapabilityModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function directory(path) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'directory',
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

function resolve(overrides = {}) {
  return resolvePreviewPanelCapabilityModel({
    file: file('albums/a.jpg'),
    rootId: 'root-1',
    rootHandleAvailable: true,
    boundRootPath: '/media/root',
    canAccessThroughCurrentRoot: true,
    shouldUseFileAccess: false,
    previewActionTools: [
      tool('fs.batchRename'),
      tool('local.data'),
      tool('vision.face'),
    ],
    ...overrides,
  })
}

test('Preview Panel Capability Model enables local file capabilities for normal Local Root files', () => {
  assert.deepEqual(resolve(), {
    canUseAnnotationContext: true,
    hasBatchRenameTool: true,
    canUseRuntimeRootMove: true,
    hasVisionFaceTool: true,
    hasLocalDataTool: true,
    renameUnavailableReason: null,
    canRenameFileName: true,
    annotationTagManageUnavailableReason: null,
    canManageAnnotationTags: true,
  })
})

test('Preview Panel Capability Model rejects directories and Root Trash entries with explicit reasons', () => {
  assert.deepEqual(resolve({ file: directory('albums') }), {
    canUseAnnotationContext: false,
    hasBatchRenameTool: true,
    canUseRuntimeRootMove: false,
    hasVisionFaceTool: false,
    hasLocalDataTool: false,
    renameUnavailableReason: '当前项不可重命名',
    canRenameFileName: false,
    annotationTagManageUnavailableReason: '当前项不可管理标签',
    canManageAnnotationTags: false,
  })

  assert.deepEqual(resolve({ file: file('trash/a.jpg', { sourceType: 'root_trash' }) }), {
    canUseAnnotationContext: false,
    hasBatchRenameTool: true,
    canUseRuntimeRootMove: false,
    hasVisionFaceTool: false,
    hasLocalDataTool: false,
    renameUnavailableReason: '当前结果项不支持重命名',
    canRenameFileName: false,
    annotationTagManageUnavailableReason: '当前结果项不支持标签管理',
    canManageAnnotationTags: false,
  })
})

test('Preview Panel Capability Model explains missing Runtime and Plugin Capability dependencies', () => {
  assert.equal(resolve({
    rootHandleAvailable: false,
    boundRootPath: null,
    previewActionTools: [],
  }).renameUnavailableReason, '工具上下文不完整')

  assert.equal(resolve({
    rootHandleAvailable: true,
    shouldUseFileAccess: true,
    previewActionTools: [],
  }).renameUnavailableReason, '重命名能力不可用（Runtime 未连接且未注册 fs.batchRename）')

  assert.equal(resolve({
    rootHandleAvailable: true,
    previewActionTools: [tool('local.data', ['directory'])],
  }).annotationTagManageUnavailableReason, '标签管理能力不可用（Runtime 未连接或未注册 local.data）')
})
