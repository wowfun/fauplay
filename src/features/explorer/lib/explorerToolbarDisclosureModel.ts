export type ExplorerToolbarAddressBarMode = 'breadcrumb' | 'edit'

export interface ExplorerToolbarDisclosureState {
  addressBarMode: ExplorerToolbarAddressBarMode
  draftPath: string
  editError: string | null
  openSegmentPath: string | null
  isHistoryOpen: boolean
  isFavoritesOpen: boolean
  isHelpOpen: boolean
}

export type ExplorerToolbarDisclosureAction =
  | { type: 'current-path-changed' }
  | { type: 'enter-edit' }
  | { type: 'cancel-edit' }
  | { type: 'outside-address-click' }
  | { type: 'toggle-segment'; path: string }
  | { type: 'toggle-history' }
  | { type: 'toggle-favorites' }
  | { type: 'toggle-help' }
  | { type: 'close-help' }
  | { type: 'segment-navigation-committed' }
  | { type: 'history-navigation-committed' }
  | { type: 'favorite-navigation-committed' }

export interface ResolveExplorerToolbarDisclosureStateParams {
  state: ExplorerToolbarDisclosureState
  currentPath: string
  action: ExplorerToolbarDisclosureAction
}

export function createExplorerToolbarDisclosureState(currentPath: string): ExplorerToolbarDisclosureState {
  return {
    addressBarMode: 'breadcrumb',
    draftPath: currentPath,
    editError: null,
    openSegmentPath: null,
    isHistoryOpen: false,
    isFavoritesOpen: false,
    isHelpOpen: false,
  }
}

export function resolveExplorerToolbarDisclosureState({
  state,
  currentPath,
  action,
}: ResolveExplorerToolbarDisclosureStateParams): ExplorerToolbarDisclosureState {
  if (action.type === 'current-path-changed') {
    return {
      ...state,
      ...(state.addressBarMode === 'breadcrumb'
        ? {
          draftPath: currentPath,
          editError: null,
        }
        : {}),
      openSegmentPath: null,
      isHistoryOpen: false,
      isFavoritesOpen: false,
      isHelpOpen: false,
    }
  }

  if (action.type === 'enter-edit') {
    return {
      ...closeAllDisclosures(state),
      addressBarMode: 'edit',
      draftPath: currentPath,
      editError: null,
    }
  }

  if (action.type === 'cancel-edit') {
    return {
      ...state,
      addressBarMode: 'breadcrumb',
      draftPath: currentPath,
      editError: null,
    }
  }

  if (action.type === 'outside-address-click') {
    return {
      ...closeAddressDisclosures(state),
      ...(state.addressBarMode === 'edit'
        ? {
          addressBarMode: 'breadcrumb' as const,
          draftPath: currentPath,
          editError: null,
        }
        : {}),
    }
  }

  if (action.type === 'toggle-segment') {
    return {
      ...closeAllDisclosures(state),
      openSegmentPath: state.openSegmentPath === action.path ? null : action.path,
    }
  }

  if (action.type === 'toggle-history') {
    return {
      ...closeAllDisclosures(state),
      isHistoryOpen: !state.isHistoryOpen,
    }
  }

  if (action.type === 'toggle-favorites') {
    return {
      ...closeAllDisclosures(state),
      isFavoritesOpen: !state.isFavoritesOpen,
    }
  }

  if (action.type === 'toggle-help') {
    return {
      ...closeAllDisclosures(state),
      isHelpOpen: !state.isHelpOpen,
    }
  }

  if (action.type === 'close-help') {
    return {
      ...state,
      isHelpOpen: false,
    }
  }

  if (action.type === 'segment-navigation-committed') {
    return {
      ...state,
      addressBarMode: 'breadcrumb',
      openSegmentPath: null,
    }
  }

  if (action.type === 'history-navigation-committed') {
    return {
      ...state,
      addressBarMode: 'breadcrumb',
      isHistoryOpen: false,
    }
  }

  return {
    ...state,
    addressBarMode: 'breadcrumb',
    isFavoritesOpen: false,
  }
}

function closeAllDisclosures(state: ExplorerToolbarDisclosureState): ExplorerToolbarDisclosureState {
  return {
    ...state,
    openSegmentPath: null,
    isHistoryOpen: false,
    isFavoritesOpen: false,
    isHelpOpen: false,
  }
}

function closeAddressDisclosures(state: ExplorerToolbarDisclosureState): ExplorerToolbarDisclosureState {
  return {
    ...state,
    openSegmentPath: null,
    isHistoryOpen: false,
    isFavoritesOpen: false,
  }
}
