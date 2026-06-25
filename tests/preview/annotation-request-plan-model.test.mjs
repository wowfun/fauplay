import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAnnotationFileTagsRequest,
  buildGlobalAnnotationTagOptionsRequest,
  buildAnnotationTagQueryRequest,
  createAnnotationTagQueryPageProgress,
  resolveAnnotationRequestTarget,
  resolveNextAnnotationTagQueryPageProgress,
} from '../../src/features/preview/lib/annotationRequestPlanModel.ts'

test('Annotation Request Plan Model resolves Remote Access roots before Runtime roots', () => {
  assert.deepEqual(resolveAnnotationRequestTarget({
    rootId: 'remote-ui-root',
    rootPath: '/local/fallback',
    remoteReadonlyActive: true,
    activeRemoteWorkspace: {
      uiRootId: 'remote-ui-root',
      configRootId: 'remote-config-root',
    },
  }), {
    kind: 'remote',
    rootId: 'remote-config-root',
  })

  assert.deepEqual(resolveAnnotationRequestTarget({
    rootId: 'local-root',
    rootPath: '/local/root',
    remoteReadonlyActive: true,
    activeRemoteWorkspace: {
      uiRootId: 'other-remote-root',
      configRootId: 'remote-config-root',
    },
  }), {
    kind: 'runtime',
    rootPath: '/local/root',
  })

  assert.deepEqual(resolveAnnotationRequestTarget({
    rootId: 'local-root',
    rootPath: null,
    remoteReadonlyActive: false,
    activeRemoteWorkspace: null,
  }), {
    kind: 'unavailable',
  })
})

test('Annotation Request Plan Model builds root and file tag requests for Runtime and Remote Access', () => {
  assert.deepEqual(buildAnnotationTagQueryRequest({
    target: { kind: 'runtime', rootPath: '/local/root' },
    page: 2,
    pageSize: 500,
  }), {
    transport: 'runtime',
    path: '/v1/data/tags/query',
    body: {
      rootPath: '/local/root',
      page: 2,
      size: 500,
      includeTagKeys: [],
      excludeTagKeys: [],
      includeMatchMode: 'or',
    },
  })

  assert.deepEqual(buildAnnotationTagQueryRequest({
    target: { kind: 'remote', rootId: 'remote-root' },
    page: 1,
    pageSize: 1000,
  }), {
    transport: 'remote',
    path: '/v1/remote/tags/query',
    body: {
      rootId: 'remote-root',
      page: 1,
      size: 1000,
      includeTagKeys: [],
      excludeTagKeys: [],
      includeMatchMode: 'or',
    },
  })

  assert.deepEqual(buildAnnotationFileTagsRequest({
    target: { kind: 'runtime', rootPath: '/local/root' },
    relativePath: 'albums/a.jpg',
  }), {
    transport: 'runtime',
    path: '/v1/data/tags/file',
    body: {
      rootPath: '/local/root',
      relativePath: 'albums/a.jpg',
    },
  })

  assert.deepEqual(buildAnnotationFileTagsRequest({
    target: { kind: 'remote', rootId: 'remote-root' },
    relativePath: 'albums/a.jpg',
  }), {
    transport: 'remote',
    path: '/v1/remote/tags/file',
    body: {
      rootId: 'remote-root',
      relativePath: 'albums/a.jpg',
    },
  })

  assert.equal(buildAnnotationTagQueryRequest({
    target: { kind: 'unavailable' },
    page: 1,
    pageSize: 1000,
  }), null)
  assert.equal(buildAnnotationFileTagsRequest({
    target: { kind: 'unavailable' },
    relativePath: 'albums/a.jpg',
  }), null)
})

test('Annotation Request Plan Model builds global tag option requests for the active access mode', () => {
  assert.deepEqual(buildGlobalAnnotationTagOptionsRequest({
    remoteReadonlyActive: true,
    activeRemoteWorkspace: {
      uiRootId: 'remote-ui-root',
      configRootId: 'remote-config-root',
    },
  }), {
    transport: 'remote',
    path: '/v1/remote/tags/options',
    body: {
      rootId: 'remote-config-root',
    },
  })

  assert.deepEqual(buildGlobalAnnotationTagOptionsRequest({
    remoteReadonlyActive: false,
    activeRemoteWorkspace: {
      uiRootId: 'remote-ui-root',
      configRootId: 'remote-config-root',
    },
  }), {
    transport: 'runtime',
    path: '/v1/data/tags/options',
    body: {},
  })

  assert.deepEqual(buildGlobalAnnotationTagOptionsRequest({
    remoteReadonlyActive: true,
    activeRemoteWorkspace: null,
  }), {
    transport: 'runtime',
    path: '/v1/data/tags/options',
    body: {},
  })
})

test('Annotation Request Plan Model advances and stops root tag query pages from Runtime results', () => {
  const firstPage = resolveNextAnnotationTagQueryPageProgress({
    progress: createAnnotationTagQueryPageProgress(),
    batchSize: 1000,
    itemsLoaded: 1000,
    resultTotal: 2500,
    pageSize: 1000,
    maxPage: 10000,
  })

  assert.deepEqual(firstPage, {
    page: 2,
    total: 2500,
    shouldContinue: true,
  })

  assert.deepEqual(resolveNextAnnotationTagQueryPageProgress({
    progress: firstPage,
    batchSize: 400,
    itemsLoaded: 1400,
    resultTotal: 2500,
    pageSize: 1000,
    maxPage: 10000,
  }), {
    page: 2,
    total: 2500,
    shouldContinue: false,
  })

  assert.deepEqual(resolveNextAnnotationTagQueryPageProgress({
    progress: createAnnotationTagQueryPageProgress(),
    batchSize: 1000,
    itemsLoaded: 1000,
    resultTotal: undefined,
    pageSize: 1000,
    maxPage: 10000,
  }), {
    page: 1,
    total: 1000,
    shouldContinue: false,
  })

  assert.deepEqual(resolveNextAnnotationTagQueryPageProgress({
    progress: {
      page: 10000,
      total: Number.POSITIVE_INFINITY,
      shouldContinue: true,
    },
    batchSize: 1000,
    itemsLoaded: 1000,
    resultTotal: 1000000,
    pageSize: 1000,
    maxPage: 10000,
  }), {
    page: 10000,
    total: 1000000,
    shouldContinue: false,
  })
})
