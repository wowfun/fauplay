import type { AddressPathHistoryEntry, FavoriteFolderEntry } from '../../../types/index.ts'
import {
  buildAddressSuggestions,
  parseDraftPathSuggestionContext,
  segmentKey,
  type AddressSuggestionItem,
  type AddressSuggestionStatus,
} from './addressPathModel.ts'

export type SegmentDropdownStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SegmentDropdownState {
  status: SegmentDropdownStatus
  items: string[]
  errorMessage: string | null
}

export type SegmentDropdownStateByPath = Record<string, SegmentDropdownState>

export interface AddressSuggestionSessionState {
  status: AddressSuggestionStatus
  items: AddressSuggestionItem[]
  errorMessage: string | null
  activeIndex: number
}

export interface ResolveAddressSuggestionLoadSuccessStateParams {
  draftPath: string
  childDirectories: string[]
  favoriteFolders: FavoriteFolderEntry[]
  recentPathHistory: AddressPathHistoryEntry[]
  currentRootId: string | null | undefined
  currentRootLabel: string
  maxItems: number
}

const IDLE_SEGMENT_DROPDOWN_STATE: SegmentDropdownState = {
  status: 'idle',
  items: [],
  errorMessage: null,
}

export function getSegmentDropdownState(
  stateByPath: SegmentDropdownStateByPath,
  path: string,
): SegmentDropdownState {
  return stateByPath[segmentKey(path)] ?? IDLE_SEGMENT_DROPDOWN_STATE
}

export function resolveSegmentDropdownLoadStartState(
  stateByPath: SegmentDropdownStateByPath,
  path: string,
): SegmentDropdownStateByPath {
  return {
    ...stateByPath,
    [segmentKey(path)]: {
      status: 'loading',
      items: [],
      errorMessage: null,
    },
  }
}

export function resolveSegmentDropdownLoadSuccessState(
  stateByPath: SegmentDropdownStateByPath,
  path: string,
  items: string[],
): SegmentDropdownStateByPath {
  return {
    ...stateByPath,
    [segmentKey(path)]: {
      status: 'ready',
      items,
      errorMessage: null,
    },
  }
}

export function resolveSegmentDropdownLoadErrorState(
  stateByPath: SegmentDropdownStateByPath,
  path: string,
  errorMessage: string,
): SegmentDropdownStateByPath {
  return {
    ...stateByPath,
    [segmentKey(path)]: {
      status: 'error',
      items: [],
      errorMessage,
    },
  }
}

export function createIdleAddressSuggestionSessionState(): AddressSuggestionSessionState {
  return {
    status: 'idle',
    items: [],
    errorMessage: null,
    activeIndex: -1,
  }
}

export function resolveAddressSuggestionLookupPath(draftPath: string): string {
  return parseDraftPathSuggestionContext(draftPath).basePath
}

export function resolveAddressSuggestionLoadStartState(): AddressSuggestionSessionState {
  return {
    status: 'loading',
    items: [],
    errorMessage: null,
    activeIndex: -1,
  }
}

export function resolveAddressSuggestionLoadSuccessState({
  draftPath,
  childDirectories,
  favoriteFolders,
  recentPathHistory,
  currentRootId,
  currentRootLabel,
  maxItems,
}: ResolveAddressSuggestionLoadSuccessStateParams): AddressSuggestionSessionState {
  return {
    status: 'ready',
    items: buildAddressSuggestions({
      context: parseDraftPathSuggestionContext(draftPath),
      childDirectories,
      favoriteFolders,
      recentPathHistory,
      currentRootId,
      currentRootLabel,
      maxItems,
    }),
    errorMessage: null,
    activeIndex: -1,
  }
}

export function resolveAddressSuggestionLoadErrorState(errorMessage: string): AddressSuggestionSessionState {
  return {
    status: 'error',
    items: [],
    errorMessage,
    activeIndex: -1,
  }
}

export function toAddressTaskErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage
}
