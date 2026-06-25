import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolvePreviewPluginContextModel,
  resolvePreviewPluginToolArguments,
  resolvePreviewPluginToolRunnable,
} from '../../src/features/preview/lib/previewPluginContextModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function tool(name) {
  return {
    name,
    title: name,
    mutation: false,
    scopes: ['file'],
    toolOptions: [],
    toolActions: [],
  }
}

test('Preview Plugin Context Model builds normal Local Root context', () => {
  const model = resolvePreviewPluginContextModel({
    file: file('albums/display.jpg', {
      sourceRelativePath: 'source/actual.jpg',
      sourceRootPath: '/media/root',
    }),
    rootId: 'root-1',
    currentBoundRootPath: '/media/root',
    previewActionTools: [
      tool('fs.restore'),
      tool('local.data'),
      tool('fs.softDelete'),
    ],
  })

  assert.deepEqual(model.previewBaseArguments, {
    relativePath: 'source/actual.jpg',
    rootPath: '/media/root',
  })
  assert.equal(model.hasRelativeToolContext, true)
  assert.equal(model.isTrashContext, false)
  assert.deepEqual(
    model.contextualTools.map((item) => item.name),
    ['local.data', 'fs.softDelete'],
  )
})

test('Preview Plugin Context Model narrows tools for trash and cross-root projection contexts', () => {
  const trashModel = resolvePreviewPluginContextModel({
    file: file('.trash/a.jpg', {
      sourceType: 'root_trash',
      recycleId: 'recycle-1',
      absolutePath: '/media/root/.trash/a.jpg',
    }),
    rootId: 'root-1',
    currentBoundRootPath: '/media/root',
    previewActionTools: [
      tool('local.data'),
      tool('fs.restore'),
      tool('fs.softDelete'),
    ],
  })

  assert.equal(trashModel.isTrashContext, true)
  assert.deepEqual(
    trashModel.contextualTools.map((item) => item.name),
    ['fs.restore'],
  )
  assert.deepEqual(trashModel.previewBaseArguments, {
    items: [{
      sourceType: 'root_trash',
      recycleId: 'recycle-1',
      absolutePath: '/media/root/.trash/a.jpg',
    }],
  })

  const crossRootModel = resolvePreviewPluginContextModel({
    file: file('shared/a.jpg', {
      sourceRootPath: '/other/root',
    }),
    rootId: 'root-1',
    currentBoundRootPath: '/media/root',
    previewActionTools: [
      tool('local.data'),
      tool('data.findDuplicateFiles'),
      tool('fs.softDelete'),
      tool('fs.restore'),
    ],
  })

  assert.equal(crossRootModel.isCrossRootProjection, true)
  assert.deepEqual(
    crossRootModel.contextualTools.map((item) => item.name),
    ['data.findDuplicateFiles', 'fs.softDelete'],
  )
})

test('Preview Plugin Context Model resolves runnable tools and call arguments', () => {
  const absoluteOnlyFile = file('/external/a.jpg', {
    absolutePath: '/external/a.jpg',
  })
  const absoluteOnlyModel = resolvePreviewPluginContextModel({
    file: absoluteOnlyFile,
    rootId: 'root-1',
    currentBoundRootPath: '/media/root',
    previewActionTools: [
      tool('local.data'),
      tool('fs.softDelete'),
    ],
  })

  assert.equal(resolvePreviewPluginToolRunnable({
    file: absoluteOnlyFile,
    previewBaseArguments: absoluteOnlyModel.previewBaseArguments,
    tool: tool('local.data'),
  }), false)
  assert.equal(resolvePreviewPluginToolRunnable({
    file: absoluteOnlyFile,
    previewBaseArguments: absoluteOnlyModel.previewBaseArguments,
    tool: tool('fs.softDelete'),
  }), true)
  assert.deepEqual(resolvePreviewPluginToolArguments({
    file: absoluteOnlyFile,
    previewBaseArguments: absoluteOnlyModel.previewBaseArguments,
    tool: tool('fs.softDelete'),
    extraArgs: { confirm: true },
  }), {
    absolutePaths: ['/external/a.jpg'],
    confirm: true,
  })

  const trashFile = file('.trash/a.jpg', {
    sourceType: 'root_trash',
    recycleId: 'recycle-1',
  })
  const trashModel = resolvePreviewPluginContextModel({
    file: trashFile,
    rootId: 'root-1',
    currentBoundRootPath: '/media/root',
    previewActionTools: [tool('fs.restore')],
  })

  assert.equal(resolvePreviewPluginToolRunnable({
    file: trashFile,
    previewBaseArguments: trashModel.previewBaseArguments,
    tool: tool('local.data'),
  }), false)
  assert.equal(resolvePreviewPluginToolRunnable({
    file: trashFile,
    previewBaseArguments: trashModel.previewBaseArguments,
    tool: tool('fs.restore'),
  }), true)
  assert.deepEqual(resolvePreviewPluginToolArguments({
    file: trashFile,
    previewBaseArguments: trashModel.previewBaseArguments,
    tool: tool('fs.restore'),
  }), {
    items: [{
      sourceType: 'root_trash',
      recycleId: 'recycle-1',
    }],
  })
})
