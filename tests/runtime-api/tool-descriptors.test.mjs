import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseRuntimeToolDescriptors,
  resolveRuntimeToolTimeoutMs,
} from '../../src/lib/runtimeApi/toolDescriptors.ts'

test('runtime tool descriptors normalize MCP annotations for plugin capability views', () => {
  assert.deepEqual(
    parseRuntimeToolDescriptors([
      {
        name: 'media.searchSameDurationVideos',
        annotations: {
          title: 'Same duration videos',
          mutation: false,
          icon: 'film',
          scopes: ['preview', 1, 'workspace'],
          toolOptions: [
            {
              key: 'mode',
              label: 'Mode',
              type: 'enum',
              defaultValue: 'strict',
              values: [
                { value: 'strict', label: 'Strict' },
                { value: '', label: 'Broken' },
              ],
              sendToTool: true,
              argumentKey: 'matchMode',
            },
            {
              key: 'dryRun',
              label: 'Dry run',
              type: 'boolean',
              defaultValue: true,
            },
            {
              key: 'query',
              label: 'Query',
              type: 'string',
              defaultValue: 'clip',
            },
            {
              key: 'invalid',
              label: 'Invalid',
              type: 'number',
            },
          ],
          toolActions: [
            {
              key: 'open',
              label: 'Open',
              description: 'Open matching files',
              intent: 'preview',
              arguments: { focus: true },
              visible: false,
            },
            {
              key: '',
              label: 'Skip',
            },
          ],
        },
      },
    ]),
    [
      {
        name: 'media.searchSameDurationVideos',
        title: 'Same duration videos',
        mutation: false,
        scopes: ['preview', 'workspace'],
        iconName: 'film',
        toolOptions: [
          {
            key: 'mode',
            label: 'Mode',
            type: 'enum',
            defaultValue: 'strict',
            values: [{ value: 'strict', label: 'Strict' }],
            sendToTool: true,
            argumentKey: 'matchMode',
          },
          {
            key: 'dryRun',
            label: 'Dry run',
            type: 'boolean',
            defaultValue: true,
            sendToTool: false,
          },
          {
            key: 'query',
            label: 'Query',
            type: 'string',
            defaultValue: 'clip',
            sendToTool: false,
          },
        ],
        toolActions: [
          {
            key: 'open',
            label: 'Open',
            description: 'Open matching files',
            intent: 'preview',
            arguments: { focus: true },
            visible: false,
          },
        ],
      },
    ],
  )
})

test('runtime tool descriptors reject entries without a tool name', () => {
  assert.deepEqual(
    parseRuntimeToolDescriptors([
      { title: 'Missing name' },
      null,
      'not a tool',
      { name: 'local.data', title: 'Local data' },
    ]),
    [
      {
        name: 'local.data',
        title: 'Local data',
        mutation: false,
        scopes: [],
        toolOptions: [],
        toolActions: [],
      },
    ],
  )
})

test('runtime tool timeout policy gives long-running plugin capabilities enough time', () => {
  assert.equal(resolveRuntimeToolTimeoutMs('ml.classifyFaces'), 120000)
  assert.equal(resolveRuntimeToolTimeoutMs('media.searchSameDurationVideos'), 20000)
  assert.equal(resolveRuntimeToolTimeoutMs('local.data'), 120000)
  assert.equal(resolveRuntimeToolTimeoutMs('meta.annotation'), 120000)
  assert.equal(resolveRuntimeToolTimeoutMs('workspace.reveal'), 5000)
  assert.equal(resolveRuntimeToolTimeoutMs('workspace.reveal', 1500), 1500)
})
