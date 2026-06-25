import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readSuccessfulResultAbsolutePaths,
  resolveWorkspaceAbsoluteDeletePayload,
  resolveWorkspaceContextualTools,
  resolveWorkspaceMutationCommitParams,
  resolveWorkspacePluginDuplicateProjectionDismissIntent,
  resolveWorkspacePluginProjectionActivationIntent,
  resolveWorkspaceRecycleRestoreItems,
  resolveWorkspaceRelativeToolPayload,
  resolveWorkspaceToolArguments,
  resolveWorkspaceToolTargetState,
  resolveWorkspaceToolRunPlan,
} from '../../src/features/explorer/lib/workspacePluginHostModel.ts'

function file(path, overrides = {}) {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'file',
    ...overrides,
  }
}

function projection(id, overrides = {}) {
  return {
    id,
    title: id,
    entry: 'auto',
    files: [],
    ...overrides,
  }
}

function queueItem(id, overrides = {}) {
  return {
    id,
    contextKey: 'albums',
    toolName: 'vision.face',
    title: id,
    trigger: 'manual',
    status: 'success',
    startedAt: 1,
    collapsed: false,
    ...overrides,
  }
}

function tool(name, overrides = {}) {
  return {
    name,
    title: name,
    inputSchema: {},
    ...overrides,
  }
}

test('Workspace Plugin Host Model resolves shared Root-relative targets for Runtime tools', () => {
  assert.deepEqual(resolveWorkspaceRelativeToolPayload([
    file('albums/a.jpg', {
      sourceRootPath: '/media/root',
      sourceRelativePath: 'albums/a.jpg',
    }),
    file('albums/b.jpg', {
      sourceRootPath: '/media/root',
      sourceRelativePath: 'albums/b.jpg',
    }),
  ]), {
    rootPath: '/media/root',
    relativePaths: ['albums/a.jpg', 'albums/b.jpg'],
  })

  assert.deepEqual(resolveWorkspaceRelativeToolPayload([
    file('albums/a.jpg'),
  ]), {
    relativePaths: ['albums/a.jpg'],
  })

  assert.equal(resolveWorkspaceRelativeToolPayload([
    file('/media/root/a.jpg'),
  ]), null)

  assert.equal(resolveWorkspaceRelativeToolPayload([
    file('a.jpg', { sourceRootPath: '/root-a', sourceRelativePath: 'a.jpg' }),
    file('b.jpg', { sourceRootPath: '/root-b', sourceRelativePath: 'b.jpg' }),
  ]), null)
})

test('Workspace Plugin Host Model narrows Runtime tools by workspace context', () => {
  const tools = [
    tool('data.findDuplicateFiles'),
    tool('fs.restore'),
    tool('fs.softDelete'),
  ]

  assert.deepEqual(resolveWorkspaceContextualTools({
    currentPath: 'albums',
    tools,
  }).map((item) => item.name), [
    'data.findDuplicateFiles',
    'fs.softDelete',
  ])

  assert.deepEqual(resolveWorkspaceContextualTools({
    currentPath: '.trash/2026',
    tools,
  }).map((item) => item.name), [
    'fs.restore',
  ])
})

test('Workspace Plugin Host Model resolves Runtime tool arguments from selected workspace targets', () => {
  assert.deepEqual(resolveWorkspaceToolArguments({
    toolName: 'fs.softDelete',
    hasSelectedEntries: true,
    selectedEntryPaths: ['albums/a.jpg'],
    selectedDeleteAbsoluteArgs: {
      absolutePaths: ['/media/root/albums/a.jpg'],
    },
    selectedRestoreItems: null,
    relativeTargetArgs: {
      rootPath: '/media/root',
      relativePaths: ['albums/a.jpg'],
    },
    extraArgs: {
      dryRun: true,
    },
  }), {
    absolutePaths: ['/media/root/albums/a.jpg'],
    dryRun: true,
  })

  assert.deepEqual(resolveWorkspaceToolArguments({
    toolName: 'fs.restore',
    hasSelectedEntries: true,
    selectedEntryPaths: ['.trash/a.jpg'],
    selectedDeleteAbsoluteArgs: null,
    selectedRestoreItems: [
      {
        sourceType: 'root_trash',
        absolutePath: '/media/root/.trash/a.jpg',
      },
    ],
    relativeTargetArgs: null,
  }), {
    items: [
      {
        sourceType: 'root_trash',
        absolutePath: '/media/root/.trash/a.jpg',
      },
    ],
  })

  assert.deepEqual(resolveWorkspaceToolArguments({
    toolName: 'vision.face',
    hasSelectedEntries: false,
    selectedEntryPaths: [],
    selectedDeleteAbsoluteArgs: null,
    selectedRestoreItems: null,
    relativeTargetArgs: {
      rootPath: '/media/root',
      relativePaths: ['albums/a.jpg', 'albums/b.jpg'],
    },
    extraArgs: {
      operation: 'detectAssets',
    },
  }), {
    rootPath: '/media/root',
    relativePaths: ['albums/a.jpg', 'albums/b.jpg'],
    operation: 'detectAssets',
  })

  assert.equal(resolveWorkspaceToolArguments({
    toolName: 'fs.restore',
    hasSelectedEntries: false,
    selectedEntryPaths: [],
    selectedDeleteAbsoluteArgs: null,
    selectedRestoreItems: null,
    relativeTargetArgs: null,
  }), null)
})

test('Workspace Plugin Host Model derives tool target state from selection and visible files', () => {
  assert.deepEqual(resolveWorkspaceToolTargetState({
    visibleFiles: [
      file('albums/a.jpg', {
        sourceRootPath: '/media/root',
        sourceRelativePath: 'albums/a.jpg',
      }),
      file('albums/b', {
        kind: 'directory',
        sourceRootPath: '/media/root',
        sourceRelativePath: 'albums/b',
      }),
      file('albums/c.jpg', {
        sourceRootPath: '/media/root',
        sourceRelativePath: 'albums/c.jpg',
      }),
    ],
    selectedPaths: [],
    hasActiveProjection: false,
  }), {
    selectedEntries: [],
    selectedEntryPaths: [],
    selectedFileEntries: [],
    targetFileEntries: [
      file('albums/a.jpg', {
        sourceRootPath: '/media/root',
        sourceRelativePath: 'albums/a.jpg',
      }),
      file('albums/c.jpg', {
        sourceRootPath: '/media/root',
        sourceRelativePath: 'albums/c.jpg',
      }),
    ],
    relativeTargetArgs: {
      rootPath: '/media/root',
      relativePaths: ['albums/a.jpg', 'albums/c.jpg'],
    },
    selectedRestoreItems: null,
    selectedDeleteAbsoluteArgs: null,
    hasTargets: true,
    hasSelectedEntries: false,
    hasRenderableTargets: true,
  })

  assert.deepEqual(resolveWorkspaceToolTargetState({
    visibleFiles: [
      file('albums/a.jpg', {
        absolutePath: '/media/root/albums/a.jpg',
      }),
      file('albums/b.jpg', {
        absolutePath: '/media/root/albums/b.jpg',
      }),
    ],
    selectedPaths: ['albums/b.jpg'],
    hasActiveProjection: true,
  }), {
    selectedEntries: [
      file('albums/b.jpg', {
        absolutePath: '/media/root/albums/b.jpg',
      }),
    ],
    selectedEntryPaths: ['albums/b.jpg'],
    selectedFileEntries: [
      file('albums/b.jpg', {
        absolutePath: '/media/root/albums/b.jpg',
      }),
    ],
    targetFileEntries: [
      file('albums/b.jpg', {
        absolutePath: '/media/root/albums/b.jpg',
      }),
    ],
    relativeTargetArgs: {
      relativePaths: ['albums/b.jpg'],
    },
    selectedRestoreItems: null,
    selectedDeleteAbsoluteArgs: {
      absolutePaths: ['/media/root/albums/b.jpg'],
    },
    hasTargets: true,
    hasSelectedEntries: true,
    hasRenderableTargets: true,
  })
})

test('Workspace Plugin Host Model resolves tool run plans for Runtime and Face Scan Job execution', () => {
  const faceScanArgs = {
    operation: 'detectAssets',
    relativePaths: ['albums/a.jpg'],
  }

  assert.deepEqual(resolveWorkspaceToolRunPlan({
    source: 'rail',
    toolName: 'vision.face',
    additionalArgs: faceScanArgs,
  }), {
    kind: 'face-scan-job',
    additionalArgs: faceScanArgs,
  })

  assert.deepEqual(resolveWorkspaceToolRunPlan({
    source: 'workbench-action',
    toolName: 'vision.face',
    actionKey: 'detectVisibleAssets',
    actionLabel: '扫描当前目标媒体',
    additionalArgs: faceScanArgs,
  }), {
    kind: 'face-scan-job',
    additionalArgs: faceScanArgs,
  })

  assert.deepEqual(resolveWorkspaceToolRunPlan({
    source: 'custom-tool-call',
    toolName: 'vision.face',
    actionLabel: '重新扫描',
    additionalArgs: faceScanArgs,
  }), {
    kind: 'face-scan-job',
    additionalArgs: faceScanArgs,
  })

  assert.deepEqual(resolveWorkspaceToolRunPlan({
    source: 'workbench-action',
    toolName: 'data.findDuplicateFiles',
    actionKey: 'run',
    actionLabel: 'Find duplicates',
    additionalArgs: {
      relativePaths: ['albums/a.jpg'],
    },
  }), {
    kind: 'runtime-tool-call',
    actionKey: 'run',
    actionLabel: 'Find duplicates',
    additionalArgs: {
      relativePaths: ['albums/a.jpg'],
    },
  })

  assert.deepEqual(resolveWorkspaceToolRunPlan({
    source: 'rail',
    toolName: 'data.findDuplicateFiles',
    additionalArgs: null,
  }), {
    kind: 'none',
  })
})

test('Workspace Plugin Host Model activates the first unhandled auto Result Projection', () => {
  const firstProjection = projection('faces')
  const secondProjection = projection('duplicates')

  assert.deepEqual(resolveWorkspacePluginProjectionActivationIntent({
    queueItems: [
      queueItem('result-1', {
        toolName: 'vision.face',
        projection: firstProjection,
      }),
      queueItem('result-2', {
        toolName: 'data.findDuplicateFiles',
        projection: secondProjection,
      }),
    ],
    handledResultId: null,
  }), {
    kind: 'activate',
    resultId: 'result-1',
    toolName: 'vision.face',
    projection: firstProjection,
  })

  assert.deepEqual(resolveWorkspacePluginProjectionActivationIntent({
    queueItems: [
      queueItem('result-1', {
        toolName: 'vision.face',
        projection: firstProjection,
      }),
    ],
    handledResultId: 'result-1',
  }), {
    kind: 'none',
  })
})

test('Workspace Plugin Host Model dismisses stale Duplicate Set projections after an empty latest result', () => {
  const queueItems = [
    queueItem('result-2', {
      toolName: 'data.findDuplicateFiles',
      projection: undefined,
    }),
    queueItem('result-1', {
      toolName: 'data.findDuplicateFiles',
      projection: projection('old-duplicates'),
    }),
  ]

  assert.deepEqual(resolveWorkspacePluginProjectionActivationIntent({
    queueItems,
    handledResultId: null,
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolveWorkspacePluginDuplicateProjectionDismissIntent({
    queueItems,
    handledResultId: null,
  }), {
    kind: 'dismiss',
    resultId: 'result-2',
    toolName: 'data.findDuplicateFiles',
  })

  assert.deepEqual(resolveWorkspacePluginDuplicateProjectionDismissIntent({
    queueItems,
    handledResultId: 'result-2',
  }), {
    kind: 'none',
  })
})

test('Workspace Plugin Host Model resolves restore and absolute delete payloads', () => {
  assert.deepEqual(resolveWorkspaceRecycleRestoreItems([
    file('@trash/a.jpg', {
      sourceType: 'root_trash',
      absolutePath: '/media/root/.trash/a.jpg',
    }),
    file('@global/b.jpg', {
      sourceType: 'global_recycle',
      recycleId: 'recycle-b',
    }),
  ]), [
    {
      sourceType: 'root_trash',
      absolutePath: '/media/root/.trash/a.jpg',
    },
    {
      sourceType: 'global_recycle',
      recycleId: 'recycle-b',
    },
  ])

  assert.equal(resolveWorkspaceRecycleRestoreItems([
    file('albums/a.jpg'),
  ]), null)

  assert.deepEqual(resolveWorkspaceAbsoluteDeletePayload([
    file('albums/a.jpg', { absolutePath: '/media/root/albums/a.jpg' }),
    file('albums/b.jpg', { absolutePath: '/media/root/albums/b.jpg' }),
  ]), {
    absolutePaths: ['/media/root/albums/a.jpg', '/media/root/albums/b.jpg'],
  })

  assert.equal(resolveWorkspaceAbsoluteDeletePayload([
    file('albums/a.jpg'),
  ]), null)
})

test('Workspace Plugin Host Model derives soft delete mutation params from Runtime results and projection state', () => {
  const result = {
    result: {
      items: [
        {
          ok: true,
          absolutePath: '/media/root/albums/a.jpg',
          nextAbsolutePath: '/media/root/.trash/a.jpg',
        },
        {
          ok: true,
          absolutePath: '/media/root/albums/a.jpg',
          nextAbsolutePath: '/media/root/.trash/a-duplicate.jpg',
        },
        {
          ok: false,
          absolutePath: '/media/root/albums/failed.jpg',
        },
      ],
    },
  }

  assert.deepEqual(readSuccessfulResultAbsolutePaths(result.result), [
    '/media/root/albums/a.jpg',
  ])

  assert.deepEqual(resolveWorkspaceMutationCommitParams({
    toolName: 'fs.softDelete',
    result,
    selectedDeleteAbsoluteArgs: {
      absolutePaths: ['/media/root/albums/a.jpg', '/media/root/albums/b.jpg'],
    },
    activeProjectionId: 'projection-1',
    selectedFileEntries: [
      file('albums/a.jpg'),
      file('albums/b.jpg'),
    ],
  }), {
    mutationToolName: 'fs.softDelete',
    undoRestoreItems: [
      {
        sourceType: 'root_trash',
        originalAbsolutePath: '/media/root/albums/a.jpg',
        absolutePath: '/media/root/.trash/a.jpg',
      },
      {
        sourceType: 'root_trash',
        originalAbsolutePath: '/media/root/albums/a.jpg',
        absolutePath: '/media/root/.trash/a-duplicate.jpg',
      },
    ],
    deletedAbsolutePaths: ['/media/root/albums/a.jpg', '/media/root/albums/b.jpg'],
    projectionTabId: 'projection-1',
    deletedProjectionPaths: ['albums/a.jpg', 'albums/b.jpg'],
  })
})

test('Workspace Plugin Host Model leaves non-delete mutation params narrow', () => {
  assert.deepEqual(resolveWorkspaceMutationCommitParams({
    toolName: 'data.findDuplicateFiles',
    result: { result: { ok: true } },
    selectedDeleteAbsoluteArgs: null,
    activeProjectionId: null,
    selectedFileEntries: [],
  }), {
    mutationToolName: 'data.findDuplicateFiles',
  })
})
