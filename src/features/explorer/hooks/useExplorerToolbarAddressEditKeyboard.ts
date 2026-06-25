import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  resolveAddressEditKeyboardIntent,
  type AddressEditKeyboardAction,
  type AddressSuggestionItem,
} from '@/features/explorer/lib/addressPathModel'

interface UseExplorerToolbarAddressEditKeyboardParams {
  activeSuggestionIndex: number
  suggestions: AddressSuggestionItem[]
  onCancelEdit: () => void
  onDraftPathChange: (draftPath: string) => void
  onActiveSuggestionIndexChange: (activeIndex: number) => void
}

export function useExplorerToolbarAddressEditKeyboard({
  activeSuggestionIndex,
  suggestions,
  onCancelEdit,
  onDraftPathChange,
  onActiveSuggestionIndexChange,
}: UseExplorerToolbarAddressEditKeyboardParams) {
  return useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    const action = resolveAddressEditKeyboardAction(event.key)
    if (!action) return

    const intent = resolveAddressEditKeyboardIntent({
      action,
      activeIndex: activeSuggestionIndex,
      suggestionCount: suggestions.length,
    })
    if (intent.kind === 'none') return

    event.preventDefault()

    if (intent.kind === 'cancel-edit') {
      onCancelEdit()
      return
    }

    if (intent.kind === 'set-active-suggestion-index') {
      onActiveSuggestionIndexChange(intent.index)
      return
    }

    const target = suggestions[intent.index]
    if (!target) return
    onDraftPathChange(target.path)
    onActiveSuggestionIndexChange(intent.index)
  }, [
    activeSuggestionIndex,
    onActiveSuggestionIndexChange,
    onCancelEdit,
    onDraftPathChange,
    suggestions,
  ])
}

function resolveAddressEditKeyboardAction(key: string): AddressEditKeyboardAction | null {
  if (key === 'Escape') return 'cancel'
  if (key === 'ArrowDown') return 'move-next'
  if (key === 'ArrowUp') return 'move-previous'
  if (key === 'Tab') return 'complete'
  return null
}
