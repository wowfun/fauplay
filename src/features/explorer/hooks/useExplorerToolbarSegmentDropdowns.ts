import { useCallback, useState } from 'react'
import {
  getSegmentDropdownState,
  resolveSegmentDropdownLoadErrorState,
  resolveSegmentDropdownLoadStartState,
  resolveSegmentDropdownLoadSuccessState,
  toAddressTaskErrorMessage,
  type SegmentDropdownStateByPath,
} from '@/features/explorer/lib/explorerToolbarAddressBarModel'

export interface UseExplorerToolbarSegmentDropdownsParams {
  onListChildDirectories: (path: string) => Promise<string[]>
}

export function useExplorerToolbarSegmentDropdowns({
  onListChildDirectories,
}: UseExplorerToolbarSegmentDropdownsParams) {
  const [segmentDropdownStateByPath, setSegmentDropdownStateByPath] = useState<SegmentDropdownStateByPath>({})

  const readSegmentDropdownState = useCallback((path: string) => {
    return getSegmentDropdownState(segmentDropdownStateByPath, path)
  }, [segmentDropdownStateByPath])

  const loadSegmentDirectories = useCallback(async (path: string): Promise<void> => {
    setSegmentDropdownStateByPath((previous) => resolveSegmentDropdownLoadStartState(previous, path))

    try {
      const directories = await onListChildDirectories(path)
      setSegmentDropdownStateByPath((previous) => (
        resolveSegmentDropdownLoadSuccessState(previous, path, directories)
      ))
    } catch (error) {
      setSegmentDropdownStateByPath((previous) => (
        resolveSegmentDropdownLoadErrorState(
          previous,
          path,
          toAddressTaskErrorMessage(error, '读取子目录失败'),
        )
      ))
    }
  }, [onListChildDirectories])

  return {
    readSegmentDropdownState,
    loadSegmentDirectories,
  }
}
