import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addAnnotationQuickTagDraftField,
  addAnnotationQuickTagDraftValue,
  createEmptyAnnotationQuickTagDraftSchema,
  moveAnnotationQuickTagDraftField,
  moveAnnotationQuickTagDraftValue,
  removeAnnotationQuickTagDraftField,
  removeAnnotationQuickTagDraftValue,
  resolveAnnotationQuickTagValueButtons,
  updateAnnotationQuickTagDraftField,
  updateAnnotationQuickTagDraftValue,
} from '../../src/features/plugin-runtime/lib/annotationQuickTagDraftModel.ts'

test('Annotation Quick Tag Draft Model edits fields and values immutably', () => {
  const empty = createEmptyAnnotationQuickTagDraftSchema()
  const withFirstField = addAnnotationQuickTagDraftField(empty)
  const withSecondField = addAnnotationQuickTagDraftField(withFirstField)
  const renamed = updateAnnotationQuickTagDraftField(withSecondField, 0, {
    key: 'rating',
    label: 'Rating',
  })
  const withExtraValue = addAnnotationQuickTagDraftValue(renamed, 0)
  const withUpdatedValue = updateAnnotationQuickTagDraftValue(withExtraValue, 0, 1, 'good')
  const movedValue = moveAnnotationQuickTagDraftValue(withUpdatedValue, 0, 1, 0)
  const movedField = moveAnnotationQuickTagDraftField(movedValue, 1, 0)
  const removedValue = removeAnnotationQuickTagDraftValue(movedField, 1, 1)
  const removedField = removeAnnotationQuickTagDraftField(removedValue, 0)

  assert.deepEqual(empty, {
    version: 1,
    fields: [],
  })
  assert.deepEqual(removedField, {
    version: 1,
    defaultActiveFieldKey: 'rating',
    fields: [
      {
        key: 'rating',
        label: 'Rating',
        values: ['good'],
      },
    ],
  })
})

test('Annotation Quick Tag Draft Model keeps active field valid after removal', () => {
  const schema = {
    version: 1,
    defaultActiveFieldKey: 'second',
    fields: [
      { key: 'first', label: 'First', values: ['a'] },
      { key: 'second', label: 'Second', values: ['b'] },
      { key: 'third', label: 'Third', values: ['c'] },
    ],
  }

  assert.deepEqual(removeAnnotationQuickTagDraftField(schema, 1), {
    version: 1,
    defaultActiveFieldKey: 'first',
    fields: [
      { key: 'first', label: 'First', values: ['a'] },
      { key: 'third', label: 'Third', values: ['c'] },
    ],
  })
})

test('Annotation Quick Tag Draft Model resolves digit value buttons from the active field', () => {
  assert.deepEqual(resolveAnnotationQuickTagValueButtons(null), [])
  assert.deepEqual(resolveAnnotationQuickTagValueButtons({
    key: 'rating',
    label: 'Rating',
    values: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ignored'],
  }), [
    { digit: '0', value: '0' },
    { digit: '1', value: '1' },
    { digit: '2', value: '2' },
    { digit: '3', value: '3' },
    { digit: '4', value: '4' },
    { digit: '5', value: '5' },
    { digit: '6', value: '6' },
    { digit: '7', value: '7' },
    { digit: '8', value: '8' },
    { digit: '9', value: '9' },
  ])
})
