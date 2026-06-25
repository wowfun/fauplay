import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readPeoplePanelPersonEditNotice,
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

test('People Panel Text reads person edit notices', () => {
  assert.deepEqual(readPeoplePanelPersonEditNotice('rename-person', 'success'), {
    tone: 'info',
    message: '人物名称已更新',
  })

  assert.deepEqual(readPeoplePanelPersonEditNotice('rename-person', 'error'), {
    tone: 'error',
    message: '人物重命名失败',
  })

  assert.deepEqual(readPeoplePanelPersonEditNotice('merge-person', 'success'), {
    tone: 'info',
    message: '人物已合并',
  })

  assert.deepEqual(readPeoplePanelPersonEditNotice('merge-person', 'error'), {
    tone: 'error',
    message: '人物合并失败',
  })

  assert.deepEqual(readPeoplePanelPersonEditNotice('load-merged-person-faces', 'error'), {
    tone: 'error',
    message: '人脸列表读取失败',
  })

  assert.deepEqual(readPeoplePanelPersonEditNotice('merge-person', 'error', new Error('target missing')), {
    tone: 'error',
    message: 'target missing',
  })
})
