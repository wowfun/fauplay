import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewPluginShortcutIntent } from '../../src/features/preview/lib/previewPluginShortcutIntentModel.ts'

function resolve(overrides = {}) {
  return resolvePreviewPluginShortcutIntent({
    event: {
      defaultPrevented: false,
      repeat: false,
      isTypingTarget: false,
      key: 'x',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      matchesSoftDeleteShortcut: false,
      matchesAnnotationDigitShortcut: false,
    },
    fileKind: 'file',
    enableAnnotationTagShortcutOwner: true,
    enableContinuousAutoRunOwner: true,
    annotationToolAvailable: true,
    softDeleteToolAvailable: true,
    matchedTagShortcut: null,
    activeDigitAssignment: null,
    ...overrides,
  })
}

test('Preview Plugin Shortcut Intent Model resolves Annotation Tag shortcut binding', () => {
  assert.deepEqual(resolve({
    matchedTagShortcut: {
      key: 'rating',
      value: '5',
      alreadyBound: false,
    },
  }), {
    kind: 'run-annotation-tool',
    actionLabel: 'rating=5',
    additionalArgs: {
      operation: 'bindAnnotationTag',
      key: 'rating',
      value: '5',
    },
  })

  assert.deepEqual(resolve({
    matchedTagShortcut: {
      key: 'rating',
      value: '5',
      alreadyBound: true,
    },
  }), {
    kind: 'consume',
  })
})

test('Preview Plugin Shortcut Intent Model resolves soft delete before digit assignment', () => {
  assert.deepEqual(resolve({
    event: {
      defaultPrevented: false,
      repeat: false,
      isTypingTarget: false,
      key: '1',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      matchesSoftDeleteShortcut: true,
      matchesAnnotationDigitShortcut: true,
    },
    activeDigitAssignment: {
      fieldKey: 'rating',
      valueByDigit: {
        '1': '1',
      },
    },
  }), {
    kind: 'run-soft-delete-tool',
  })
})

test('Preview Plugin Shortcut Intent Model resolves digit Annotation assignment', () => {
  assert.deepEqual(resolve({
    event: {
      defaultPrevented: false,
      repeat: false,
      isTypingTarget: false,
      key: '3',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      matchesSoftDeleteShortcut: false,
      matchesAnnotationDigitShortcut: true,
    },
    activeDigitAssignment: {
      fieldKey: 'rating',
      valueByDigit: {
        '3': '3',
      },
    },
  }), {
    kind: 'run-annotation-tool',
    actionLabel: 'rating=3',
    additionalArgs: {
      operation: 'setAnnotationValue',
      fieldKey: 'rating',
      value: '3',
      source: 'hotkey',
    },
  })

  assert.deepEqual(resolve({
    event: {
      defaultPrevented: false,
      repeat: false,
      isTypingTarget: false,
      key: '3',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      matchesSoftDeleteShortcut: false,
      matchesAnnotationDigitShortcut: true,
    },
    activeDigitAssignment: {
      fieldKey: 'rating',
      valueByDigit: {
        '3': '3',
      },
    },
  }), {
    kind: 'none',
  })
})

test('Preview Plugin Shortcut Intent Model ignores unavailable shortcut contexts', () => {
  assert.deepEqual(resolve({
    event: {
      defaultPrevented: false,
      repeat: false,
      isTypingTarget: true,
      key: 'x',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      matchesSoftDeleteShortcut: true,
      matchesAnnotationDigitShortcut: false,
    },
  }), {
    kind: 'none',
  })

  assert.deepEqual(resolve({
    fileKind: 'directory',
    matchedTagShortcut: {
      key: 'rating',
      value: '5',
      alreadyBound: false,
    },
  }), {
    kind: 'none',
  })
})
