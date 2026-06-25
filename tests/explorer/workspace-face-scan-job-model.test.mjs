import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isWorkspaceFaceScanJobTerminal,
  shouldRefreshAfterWorkspaceFaceScanJob,
  toWorkspaceFaceScanJobErrorMessage,
  toWorkspaceFaceScanJobProgress,
  toWorkspaceFaceScanJobResult,
} from '../../src/features/explorer/lib/workspaceFaceScanJobModel.ts'

test('Workspace Face Scan Job Model maps Runtime snapshots to queue progress', () => {
  assert.deepEqual(toWorkspaceFaceScanJobProgress({
    jobId: 'job-1',
    status: 'running',
    processed: 4,
    total: 10,
    currentPath: 'albums/a.jpg',
    batchIndex: 2,
    batchCount: 5,
    scanned: 6,
    skipped: 1,
    failed: 0,
    detectedFaces: 7,
  }), {
    jobId: 'job-1',
    status: 'running',
    current: 4,
    total: 10,
    currentPath: 'albums/a.jpg',
    batchIndex: 2,
    batchCount: 5,
    scanned: 6,
    skipped: 1,
    failed: 0,
    detectedFaces: 7,
    cancelable: true,
    cancelRequested: false,
    message: '人脸扫描扫描中: 4/10',
  })

  assert.deepEqual(toWorkspaceFaceScanJobProgress({
    status: 'canceling',
    processed: -1,
    total: -10,
    currentPath: 42,
    scanned: -3,
    skipped: -4,
    failed: -5,
    detectedFaces: -6,
  }, {
    message: '正在取消人脸扫描任务...',
  }), {
    jobId: undefined,
    status: 'canceling',
    current: 0,
    total: 0,
    currentPath: null,
    batchIndex: undefined,
    batchCount: undefined,
    scanned: 0,
    skipped: 0,
    failed: 0,
    detectedFaces: 0,
    cancelable: false,
    cancelRequested: true,
    message: '正在取消人脸扫描任务...',
  })
})

test('Workspace Face Scan Job Model resolves terminal status, result payload, refresh, and errors', () => {
  assert.equal(isWorkspaceFaceScanJobTerminal('queued'), false)
  assert.equal(isWorkspaceFaceScanJobTerminal('running'), false)
  assert.equal(isWorkspaceFaceScanJobTerminal('canceling'), false)
  assert.equal(isWorkspaceFaceScanJobTerminal('canceled'), true)
  assert.equal(isWorkspaceFaceScanJobTerminal('succeeded'), true)
  assert.equal(isWorkspaceFaceScanJobTerminal('failed'), true)

  assert.deepEqual(toWorkspaceFaceScanJobResult({
    jobId: 'job-2',
    status: 'succeeded',
    total: 4,
    unique: 3,
    processed: 4,
    scanned: 4,
    skipped: 1,
    failed: 0,
    detectedFaces: 8,
    preCluster: { clusters: 2 },
    postCluster: { clusters: 3 },
    recentItems: [{ path: 'a.jpg' }],
    failureSummary: [],
  }), {
    ok: true,
    jobId: 'job-2',
    status: 'succeeded',
    total: 4,
    unique: 3,
    processed: 4,
    scanned: 4,
    skipped: 1,
    failed: 0,
    detectedFaces: 8,
    preCluster: { clusters: 2 },
    postCluster: { clusters: 3 },
    recentItems: [{ path: 'a.jpg' }],
    failureSummary: [],
    error: null,
  })

  assert.deepEqual(toWorkspaceFaceScanJobResult({
    jobId: 'job-3',
    status: 'failed',
    error: '模型加载失败',
  }), {
    ok: false,
    jobId: 'job-3',
    status: 'failed',
    total: 0,
    unique: 0,
    processed: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    detectedFaces: 0,
    preCluster: null,
    postCluster: null,
    recentItems: [],
    failureSummary: [],
    error: '模型加载失败',
  })

  assert.equal(shouldRefreshAfterWorkspaceFaceScanJob({ processed: 0, scanned: 0, detectedFaces: 0 }), false)
  assert.equal(shouldRefreshAfterWorkspaceFaceScanJob({ processed: 1 }), true)
  assert.equal(shouldRefreshAfterWorkspaceFaceScanJob({ scanned: 1 }), true)
  assert.equal(shouldRefreshAfterWorkspaceFaceScanJob({ detectedFaces: 1 }), true)

  assert.equal(toWorkspaceFaceScanJobErrorMessage(new Error('提交失败')), '提交失败')
  assert.equal(toWorkspaceFaceScanJobErrorMessage('bad'), '工具调用失败')
})
