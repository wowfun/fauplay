import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewPluginWorkbenchTool,
} from '../../src/features/preview/lib/previewPluginWorkbenchModel.ts'

function tool(name, toolActions) {
  return {
    name,
    title: name,
    mutation: false,
    scopes: ['file'],
    toolOptions: [],
    toolActions,
  }
}

test('Preview Plugin Workbench Model hides file-entry maintenance from local data actions', () => {
  const localDataTool = tool('local.data', [
    {
      key: 'ensure',
      label: 'Ensure file entries',
      arguments: { operation: 'ensureFileEntries' },
    },
    {
      key: 'bind',
      label: 'Bind tag',
      arguments: { operation: 'bindAnnotationTag' },
    },
  ])

  assert.deepEqual(
    resolvePreviewPluginWorkbenchTool({
      tool: localDataTool,
      previewKind: 'image',
    })?.toolActions.map((action) => action.key),
    ['bind'],
  )
})

test('Preview Plugin Workbench Model adds a face detection and clustering primary action for media previews', () => {
  const faceTool = tool('vision.face', [
    {
      key: 'detectOnly',
      label: '检测人脸',
      arguments: { operation: 'detectAsset' },
    },
  ])

  assert.deepEqual(resolvePreviewPluginWorkbenchTool({
    tool: faceTool,
    previewKind: 'image',
  })?.toolActions[0], {
    key: 'detectAssetRunCluster',
    label: '检测并识别人脸',
    description: '对当前图片执行检测并立即执行人物归属',
    intent: 'primary',
    arguments: {
      operation: 'detectAsset',
      runCluster: true,
    },
  })

  assert.equal(resolvePreviewPluginWorkbenchTool({
    tool: faceTool,
    previewKind: 'video',
  })?.toolActions[0].description, '对当前视频抽帧检测并立即执行人物归属')

  assert.equal(
    resolvePreviewPluginWorkbenchTool({
      tool: faceTool,
      previewKind: 'text',
    }),
    faceTool,
  )
})
