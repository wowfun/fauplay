import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isWorkspaceFaceScanJobTerminal,
  resolveWorkspaceFaceScanJobErrorPlan,
  resolveWorkspaceFaceScanJobFinishPlan,
  resolveWorkspaceFaceScanJobCancelPlan,
  resolveWorkspaceFaceScanJobPollPath,
  resolveWorkspaceFaceScanJobStartPlan,
  shouldRefreshAfterWorkspaceFaceScanJob,
  toWorkspaceFaceScanJobErrorMessage,
  toWorkspaceFaceScanJobProgress,
  toWorkspaceFaceScanJobResult,
} from '../../src/features/explorer/lib/workspaceFaceScanJobModel.ts'

test('Workspace Face Scan Job Model builds a Runtime job start plan', () => {
  assert.deepEqual(resolveWorkspaceFaceScanJobStartPlan({
    toolName: 'vision.face',
    toolTitle: 'Face detection',
    actionLabel: '扫描当前目标媒体',
    additionalArgs: {
      relativePaths: ['albums/a.jpg', 'albums/b.jpg'],
      operation: 'detectAssets',
    },
    resolvedRootPath: '/media/root',
    queueItemId: 'vision.face-1',
    startedAt: 123,
    requestSignature: 'signature-1',
  }), {
    queueItemId: 'vision.face-1',
    title: 'Face detection · 扫描当前目标媒体',
    requestArgs: {
      relativePaths: ['albums/a.jpg', 'albums/b.jpg'],
      operation: 'detectAssets',
      rootPath: '/media/root',
    },
    requestSignature: 'signature-1',
    startedAt: 123,
    missingRootPathError: null,
    initialProgress: {
      current: 0,
      total: 2,
      message: '提交人脸扫描任务...',
      cancelable: false,
    },
  })

  assert.deepEqual(resolveWorkspaceFaceScanJobStartPlan({
    toolName: 'vision.face',
    toolTitle: '',
    actionLabel: '扫描当前目标媒体',
    additionalArgs: {
      rootPath: ' /provided/root ',
      relativePaths: 'albums/a.jpg',
    },
    resolvedRootPath: '',
    queueItemId: 'vision.face-2',
    startedAt: 456,
    requestSignature: null,
  }), {
    queueItemId: 'vision.face-2',
    title: 'vision.face · 扫描当前目标媒体',
    requestArgs: {
      rootPath: '/provided/root',
      relativePaths: 'albums/a.jpg',
    },
    requestSignature: 'vision.face-2:face-scan-job',
    startedAt: 456,
    missingRootPathError: null,
    initialProgress: {
      current: 0,
      total: 0,
      message: '提交人脸扫描任务...',
      cancelable: false,
    },
  })
})

test('Workspace Face Scan Job Model builds a Runtime job cancel plan', () => {
  assert.deepEqual(resolveWorkspaceFaceScanJobCancelPlan({
    item: {
      id: 'queue-1',
      progress: {
        jobId: 'job/from progress',
      },
    },
    trackedJobId: 'tracked-job',
  }), {
    jobId: 'job/from progress',
    endpointPath: '/v1/faces/detect-assets/jobs/job%2Ffrom%20progress/cancel',
    cancelProgress: {
      jobId: 'job/from progress',
      cancelRequested: true,
      cancelable: false,
      message: '正在取消人脸扫描任务...',
    },
  })

  assert.deepEqual(resolveWorkspaceFaceScanJobCancelPlan({
    item: {
      id: 'queue-2',
      progress: {},
    },
    trackedJobId: 'tracked-job',
  }), {
    jobId: 'tracked-job',
    endpointPath: '/v1/faces/detect-assets/jobs/tracked-job/cancel',
    cancelProgress: {
      jobId: 'tracked-job',
      cancelRequested: true,
      cancelable: false,
      message: '正在取消人脸扫描任务...',
    },
  })

  assert.equal(resolveWorkspaceFaceScanJobCancelPlan({
    item: {
      id: 'queue-3',
    },
    trackedJobId: undefined,
  }), null)
})

test('Workspace Face Scan Job Model builds Runtime poll and finish plans', () => {
  assert.equal(
    resolveWorkspaceFaceScanJobPollPath('job/from runtime'),
    '/v1/faces/detect-assets/jobs/job%2Ffrom%20runtime'
  )

  assert.deepEqual(resolveWorkspaceFaceScanJobFinishPlan({
    contextKey: 'albums',
    queueItemId: 'queue-1',
    snapshot: {
      jobId: 'job-1',
      status: 'succeeded',
      processed: 2,
      detectedFaces: 3,
    },
    finishedAt: 789,
  }), {
    contextKey: 'albums',
    queueItemId: 'queue-1',
    status: 'success',
    result: {
      ok: true,
      jobId: 'job-1',
      status: 'succeeded',
      total: 0,
      unique: 0,
      processed: 2,
      scanned: 0,
      skipped: 0,
      failed: 0,
      detectedFaces: 3,
      preCluster: null,
      postCluster: null,
      recentItems: [],
      failureSummary: [],
      error: null,
    },
    finishedAt: 789,
  })

  assert.deepEqual(resolveWorkspaceFaceScanJobFinishPlan({
    contextKey: 'albums',
    queueItemId: 'queue-2',
    snapshot: {
      status: 'failed',
      error: '模型加载失败',
    },
    finishedAt: 790,
  }), {
    contextKey: 'albums',
    queueItemId: 'queue-2',
    status: 'error',
    error: '模型加载失败',
    errorCode: 'FACE_SCAN_JOB_FAILED',
    finishedAt: 790,
  })
})

test('Workspace Face Scan Job Model builds Runtime job error plans', () => {
  assert.deepEqual(resolveWorkspaceFaceScanJobErrorPlan({
    contextKey: 'albums',
    queueItemId: 'queue-1',
    error: new Error('提交失败'),
    finishedAt: 791,
  }), {
    contextKey: 'albums',
    queueItemId: 'queue-1',
    status: 'error',
    error: '提交失败',
    errorCode: 'FACE_SCAN_JOB_ERROR',
    finishedAt: 791,
  })
})

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
