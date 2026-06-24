import assert from 'node:assert/strict'
import test from 'node:test'
import { URL } from 'node:url'

import { RuntimeHttpError } from '../../src/lib/runtimeApi/errors.ts'
import { createFileAccessClient } from '../../src/lib/fileAccess.ts'

function searchParamsOf(url) {
  return Object.fromEntries(new URL(url).searchParams.entries())
}

test('File Access client builds local Runtime and Remote Access thumbnail URLs for items', () => {
  const client = createFileAccessClient({
    buildLocalRuntimeUrl: (endpointPath) => `http://127.0.0.1:3211${endpointPath}`,
    getSameOriginRuntimeBaseUrl: () => 'https://fauplay.test',
  })

  const localUrl = client.buildFileThumbnailUrlForItem({
    kind: 'file',
    name: 'photo.jpg',
    path: 'photo.jpg',
    absolutePath: '/Users/example/photo.jpg',
  }, { sizePreset: 'grid' })
  assert.equal(new URL(localUrl).origin, 'http://127.0.0.1:3211')
  assert.equal(new URL(localUrl).pathname, '/v1/files/thumbnail')
  assert.deepEqual(searchParamsOf(localUrl), {
    absolutePath: '/Users/example/photo.jpg',
    sizePreset: 'grid',
  })

  const remoteUrl = client.buildFileThumbnailUrlForItem({
    kind: 'file',
    name: 'remote.jpg',
    path: 'albums/remote.jpg',
    remoteRootId: 'remote-root',
  }, { sizePreset: 'wide' })
  assert.equal(new URL(remoteUrl).origin, 'https://fauplay.test')
  assert.equal(new URL(remoteUrl).pathname, '/v1/remote/files/thumbnail')
  assert.deepEqual(searchParamsOf(remoteUrl), {
    rootId: 'remote-root',
    relativePath: 'albums/remote.jpg',
    sizePreset: 'wide',
  })
})

test('File Access client builds Root-relative Runtime content URLs for Local Root items', () => {
  const client = createFileAccessClient({
    buildLocalRuntimeUrl: (endpointPath) => `http://127.0.0.1:3211${endpointPath}`,
  })

  const runtimeUrl = client.buildFileContentUrlForItem({
    kind: 'file',
    name: 'local.txt',
    path: 'docs/local.txt',
    absolutePath: '/Users/example/root/docs/local.txt',
    sourceRootPath: '/Users/example/root',
    sourceRelativePath: 'docs/local.txt',
  })
  assert.equal(new URL(runtimeUrl).origin, 'http://127.0.0.1:3211')
  assert.equal(new URL(runtimeUrl).pathname, '/v1/file-content')
  assert.deepEqual(searchParamsOf(runtimeUrl), {
    rootPath: '/Users/example/root',
    rootRelativePath: 'docs/local.txt',
  })

  const fallbackUrl = client.buildFileContentUrlForItem({
    kind: 'file',
    name: 'legacy.txt',
    path: '/Users/example/legacy.txt',
    absolutePath: '/Users/example/legacy.txt',
  })
  assert.equal(new URL(fallbackUrl).pathname, '/v1/files/content')
  assert.deepEqual(searchParamsOf(fallbackUrl), {
    absolutePath: '/Users/example/legacy.txt',
  })
})

test('File Access client loads text previews through local Runtime or Remote Access by file identity', async () => {
  const calls = []
  const client = createFileAccessClient({
    callLocalRuntimeHttp: async (endpointPath, body, timeoutMs, method) => {
      calls.push({ transport: 'local', endpointPath, body, timeoutMs, method })
      return { kind: 'text', content: 'local preview' }
    },
    callRemoteAccessHttp: async (endpointPath, body, timeoutMs, method) => {
      calls.push({ transport: 'remote', endpointPath, body, timeoutMs, method })
      return { kind: 'text', content: 'remote preview' }
    },
  })

  assert.deepEqual(
    await client.loadTextPreviewForItem({
      kind: 'file',
      name: 'runtime-local.txt',
      path: 'docs/runtime-local.txt',
      absolutePath: '/Users/example/root/docs/runtime-local.txt',
      sourceRootPath: '/Users/example/root',
      sourceRelativePath: 'docs/runtime-local.txt',
    }, 1024),
    { kind: 'text', content: 'local preview' },
  )
  assert.deepEqual(
    await client.loadTextPreviewForItem({
      kind: 'file',
      name: 'legacy-local.txt',
      path: 'legacy-local.txt',
      absolutePath: '/Users/example/legacy-local.txt',
    }, 1536),
    { kind: 'text', content: 'local preview' },
  )
  assert.deepEqual(
    await client.loadTextPreviewForItem({
      kind: 'file',
      name: 'remote.txt',
      path: 'docs/remote.txt',
      remoteRootId: 'remote-root',
    }, 2048),
    { kind: 'text', content: 'remote preview' },
  )

  assert.deepEqual(calls, [
    {
      transport: 'local',
      endpointPath: '/v1/text-preview?rootPath=%2FUsers%2Fexample%2Froot&rootRelativePath=docs%2Fruntime-local.txt&sizeLimitBytes=1024',
      body: undefined,
      timeoutMs: undefined,
      method: 'GET',
    },
    {
      transport: 'local',
      endpointPath: '/v1/files/text-preview',
      body: {
        absolutePath: '/Users/example/legacy-local.txt',
        sizeLimitBytes: 1536,
      },
      timeoutMs: undefined,
      method: undefined,
    },
    {
      transport: 'remote',
      endpointPath: '/v1/remote/files/text-preview',
      body: {
        rootId: 'remote-root',
        relativePath: 'docs/remote.txt',
        sizeLimitBytes: 2048,
      },
      timeoutMs: undefined,
      method: undefined,
    },
  ])

  await assert.rejects(
    () => client.loadTextPreviewForItem({ kind: 'file', name: 'missing.txt', path: 'missing.txt' }),
    (error) => {
      assert.ok(error instanceof RuntimeHttpError)
      assert.equal(error.code, 'FILE_PREVIEW_UNAVAILABLE')
      return true
    },
  )
})

test('File Access client builds local and Remote Access face crop URLs', () => {
  const client = createFileAccessClient({
    buildLocalRuntimeUrl: (endpointPath) => `http://127.0.0.1:3211${endpointPath}`,
    getLocalRuntimeBaseUrl: () => 'http://127.0.0.1:3211',
    getSameOriginRuntimeBaseUrl: () => 'https://fauplay.test',
    isRemoteReadonlyProviderActive: () => true,
    fromRemoteUiRootId: (rootId) => rootId === 'remote:root-a' ? 'root-a' : null,
    getActiveRemoteWorkspace: () => ({ configRootId: 'active-root' }),
  })

  const remoteUrl = client.buildFaceCropUrl(' face-1 ', {
    rootId: 'remote:root-a',
    size: 128.8,
    padding: 0.25,
  })
  assert.equal(new URL(remoteUrl).origin, 'https://fauplay.test')
  assert.equal(new URL(remoteUrl).pathname, '/v1/remote/faces/crops/face-1')
  assert.deepEqual(searchParamsOf(remoteUrl), {
    rootId: 'root-a',
    size: '128',
    padding: '0.25',
  })

  const localClient = createFileAccessClient({
    buildLocalRuntimeUrl: (endpointPath) => `http://127.0.0.1:3211${endpointPath}`,
    isRemoteReadonlyProviderActive: () => false,
  })
  assert.equal(
    localClient.buildFaceCropUrl('face-2'),
    'http://127.0.0.1:3211/v1/faces/crops/face-2',
  )
})
