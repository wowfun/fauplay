import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readPeoplePanelSourceActionNotice,
} from '../../src/features/faces/lib/peoplePanelText.ts'

test('People Panel Text reads source action notices', () => {
  assert.deepEqual(readPeoplePanelSourceActionNotice('open-source', 'unavailable'), {
    tone: 'error',
    message: '当前上下文不支持打开来源文件',
  })

  assert.deepEqual(readPeoplePanelSourceActionNotice('open-source', 'rejected'), {
    tone: 'error',
    message: '该人脸来源不在当前 Root 内，暂不支持跳转',
  })

  assert.deepEqual(readPeoplePanelSourceActionNotice('open-source', 'error', new Error('missing file')), {
    tone: 'error',
    message: 'missing file',
  })

  assert.deepEqual(readPeoplePanelSourceActionNotice('project-sources', 'unavailable'), {
    tone: 'error',
    message: '当前上下文不支持投射源文件',
  })

  assert.deepEqual(readPeoplePanelSourceActionNotice('project-sources', 'rejected'), {
    tone: 'error',
    message: '没有可投射的源文件',
  })

  assert.deepEqual(readPeoplePanelSourceActionNotice('project-sources', 'error'), {
    tone: 'error',
    message: '源文件投射失败',
  })
})
