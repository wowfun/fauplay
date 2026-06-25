import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadGlobalAnnotationTagOptionRecords,
  loadAnnotationFileTags,
  loadAnnotationTagViews,
} from '../../src/features/preview/lib/annotationTagQueryLoader.ts'

function tagView(relativePath, value) {
  return {
    relativePath,
    tags: [{
      key: 'rating',
      value,
      source: 'meta.annotation',
      appliedAt: 10,
      updatedAt: 10,
    }],
  }
}

test('Annotation Tag Query Loader loads File Annotation tag views page by page', async () => {
  const requests = []
  const responses = [
    { items: [tagView('albums/a.jpg', '5'), tagView('albums/b.jpg', '4')], total: 3 },
    { items: [tagView('albums/c.jpg', '3')], total: 3 },
  ]

  const views = await loadAnnotationTagViews({
    target: { kind: 'runtime', rootPath: '/photos' },
    pageSize: 2,
    maxPage: 5,
    callAnnotationHttp: async (request) => {
      requests.push(request)
      return responses[requests.length - 1] ?? { items: [], total: 3 }
    },
  })

  assert.deepEqual(views.map((view) => view.relativePath), [
    'albums/a.jpg',
    'albums/b.jpg',
    'albums/c.jpg',
  ])
  assert.deepEqual(requests.map((request) => ({
    transport: request.transport,
    path: request.path,
    page: request.body.page,
    size: request.body.size,
    rootPath: request.body.rootPath,
  })), [
    {
      transport: 'runtime',
      path: '/v1/data/tags/query',
      page: 1,
      size: 2,
      rootPath: '/photos',
    },
    {
      transport: 'runtime',
      path: '/v1/data/tags/query',
      page: 2,
      size: 2,
      rootPath: '/photos',
    },
  ])
})

test('Annotation Tag Query Loader loads one File Annotation tag set through the request adapter', async () => {
  const requests = []
  const tags = [{
    key: 'subject',
    value: 'portrait',
    source: 'vision.face',
    appliedAt: 20,
    updatedAt: 20,
  }]

  const result = await loadAnnotationFileTags({
    target: { kind: 'remote', rootId: 'remote-root' },
    relativePath: 'albums/a.jpg',
    callAnnotationHttp: async (request) => {
      requests.push(request)
      return {
        file: {
          relativePath: 'albums/a.jpg',
          tags,
        },
      }
    },
  })

  assert.deepEqual(result, tags)
  assert.deepEqual(requests, [{
    transport: 'remote',
    path: '/v1/remote/tags/file',
    body: {
      rootId: 'remote-root',
      relativePath: 'albums/a.jpg',
    },
  }])
})

test('Annotation Tag Query Loader loads global Annotation Tag option records through the active access mode', async () => {
  const requests = []
  const optionRecord = {
    key: 'rating',
    value: '5',
    source: 'meta.annotation',
    appliedAt: 30,
    fileCount: 4,
  }

  const records = await loadGlobalAnnotationTagOptionRecords({
    remoteReadonlyActive: true,
    activeRemoteWorkspace: {
      uiRootId: 'remote-ui-root',
      configRootId: 'remote-config-root',
    },
    callAnnotationHttp: async (request) => {
      requests.push(request)
      return {
        options: [optionRecord],
      }
    },
  })

  assert.deepEqual(records, [optionRecord])
  assert.deepEqual(requests, [{
    transport: 'remote',
    path: '/v1/remote/tags/options',
    body: {
      rootId: 'remote-config-root',
    },
  }])
})
