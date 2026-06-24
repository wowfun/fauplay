import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseByteRangeHeader,
  sendFileStreamResponse,
} from '../../scripts/gateway/file-stream-response.mjs'

describe('file stream responses', () => {
  let tempDir = ''
  let filePath = ''
  let server = null
  let baseUrl = ''

  before(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'fauplay-file-stream-'))
    filePath = path.join(tempDir, 'sample.txt')
    await writeFile(filePath, 'abcdef', 'utf8')

    server = http.createServer(async (req, res) => {
      try {
        await sendFileStreamResponse(req, res, filePath, 'text/plain', 6, {
          cacheControl: 'private, max-age=1',
          lastModifiedMs: 1700000000000,
        })
      } catch (error) {
        res.statusCode = 500
        res.end(error instanceof Error ? error.message : 'server error')
      }
    })
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    await rm(tempDir, { recursive: true, force: true })
  })

  test('streams the full file when no byte range is requested', async () => {
    const response = await globalThis.fetch(baseUrl)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/plain')
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(response.headers.get('content-length'), '6')
    assert.equal(response.headers.get('cache-control'), 'private, max-age=1')
    assert.equal(await response.text(), 'abcdef')
  })

  test('streams a requested file content range', async () => {
    const response = await globalThis.fetch(baseUrl, {
      headers: {
        range: 'bytes=1-3',
      },
    })

    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/6')
    assert.equal(response.headers.get('content-length'), '3')
    assert.equal(await response.text(), 'bcd')
  })

  test('rejects invalid byte ranges with content-range metadata', async () => {
    const response = await globalThis.fetch(baseUrl, {
      headers: {
        range: 'bytes=9-10',
      },
    })

    assert.equal(response.status, 416)
    assert.equal(response.headers.get('content-range'), 'bytes */6')
    assert.equal(await response.text(), '')
  })

  test('parses suffix and open-ended ranges', () => {
    assert.deepEqual(parseByteRangeHeader('bytes=-2', 6), { start: 4, end: 5 })
    assert.deepEqual(parseByteRangeHeader('bytes=2-', 6), { start: 2, end: 5 })
    assert.deepEqual(parseByteRangeHeader('bytes=4-2', 6), { invalid: true })
    assert.equal(parseByteRangeHeader('', 6), null)
  })
})
