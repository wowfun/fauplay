import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileItem, ListingPageState, ListingQueryState } from '@/types'
import { readDirectory } from '@/lib/fileSystem'
import {
  listRuntimeLocalDirectory,
  toRuntimeFileItems,
} from '@/lib/runtimeApi'
import { getBoundRootPath } from '@/lib/reveal'
import {
  DEFAULT_LISTING_QUERY,
  type RuntimeListingPageCursor,
  isSameRuntimeListingPageCursor,
} from '@/features/explorer/lib/listingQueryModel'
import {
  appendRuntimeListingPageItems,
  createRuntimeListingPageCursor,
  createRuntimeListingRequest,
  resolveListingQueryUpdate,
} from '@/features/explorer/lib/localListingLoadModel'
import { toLocalListingItems } from '@/features/explorer/lib/localFileSystemModel'

export interface LoadDirectoryItemsOptions {
  rootId?: string | null
  resolveDirectoryHandle?: () => Promise<FileSystemDirectoryHandle | null>
}

export interface UseLocalListingControllerParams {
  rootId: string | null
  currentPath: string
  isFlattenView: boolean
  virtualTrashPath: string
  pageSize: number
  permissionDeniedMessage: string
  resolveCurrentDirectoryHandle: () => Promise<FileSystemDirectoryHandle | null>
  setIsLoading: (isLoading: boolean) => void
  setError: (message: string | null) => void
}

export function useLocalListingController({
  rootId,
  currentPath,
  isFlattenView,
  virtualTrashPath,
  pageSize,
  permissionDeniedMessage,
  resolveCurrentDirectoryHandle,
  setIsLoading,
  setError,
}: UseLocalListingControllerParams) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [listingQuery, setListingQueryState] = useState<ListingQueryState>(DEFAULT_LISTING_QUERY)
  const [runtimeListingPageCursor, setRuntimeListingPageCursor] = useState<RuntimeListingPageCursor | null>(null)
  const [isLoadingNextListingPage, setIsLoadingNextListingPage] = useState(false)
  const listingQueryRef = useRef<ListingQueryState>(DEFAULT_LISTING_QUERY)
  const runtimeListingPageCursorRef = useRef<RuntimeListingPageCursor | null>(null)

  useEffect(() => {
    runtimeListingPageCursorRef.current = runtimeListingPageCursor
  }, [runtimeListingPageCursor])

  useEffect(() => {
    listingQueryRef.current = listingQuery
  }, [listingQuery])

  const loadDirectoryItems = useCallback(async (
    dirHandle: FileSystemDirectoryHandle | null,
    basePath: string,
    flattenView: boolean,
    options: LoadDirectoryItemsOptions = {}
  ) => {
    const boundRootPath = options.rootId ? getBoundRootPath(options.rootId) : null
    if (boundRootPath) {
      try {
        const activeListingQuery = listingQueryRef.current
        const runtimeListingRequest = createRuntimeListingRequest({
          rootPath: boundRootPath,
          rootRelativePath: basePath,
          flattened: flattenView,
          pageSize,
          query: activeListingQuery,
        })
        if (!runtimeListingRequest) {
          throw new Error(permissionDeniedMessage)
        }

        const runtimeListing = await listRuntimeLocalDirectory(runtimeListingRequest)
        setFiles(toRuntimeFileItems(runtimeListing.entries, boundRootPath))
        setRuntimeListingPageCursor(createRuntimeListingPageCursor({
          rootPath: boundRootPath,
          rootRelativePath: basePath,
          flattened: flattenView,
          query: activeListingQuery,
          isTruncated: runtimeListing.isTruncated,
          nextOffset: runtimeListing.nextOffset,
        }))
        return
      } catch {
        // Fall back to File System Access while the runtime-backed Listing path is being adopted.
      }
    }

    setRuntimeListingPageCursor(null)

    const fallbackHandle = dirHandle ?? await options.resolveDirectoryHandle?.() ?? null
    if (!fallbackHandle) {
      throw new Error(permissionDeniedMessage)
    }

    const result = await readDirectory(fallbackHandle, flattenView)
    setFiles(toLocalListingItems(result, {
      basePath,
      flattened: flattenView,
    }))
  }, [pageSize, permissionDeniedMessage])

  const loadNextListingPage = useCallback(async (): Promise<void> => {
    const cursor = runtimeListingPageCursorRef.current
    if (!cursor || isLoadingNextListingPage) return

    setIsLoadingNextListingPage(true)
    setError(null)

    try {
      const runtimeListingRequest = createRuntimeListingRequest({
        rootPath: cursor.rootPath,
        rootRelativePath: cursor.rootRelativePath,
        flattened: cursor.flattened,
        pageSize,
        offset: cursor.nextOffset,
        query: cursor.query,
      })
      if (!runtimeListingRequest) return

      const runtimeListing = await listRuntimeLocalDirectory(runtimeListingRequest)

      if (!isSameRuntimeListingPageCursor(runtimeListingPageCursorRef.current, cursor)) {
        return
      }

      const nextItems = toRuntimeFileItems(runtimeListing.entries, cursor.rootPath)
      setFiles((previous) => appendRuntimeListingPageItems({
        previousItems: previous,
        nextItems,
      }))
      setRuntimeListingPageCursor(createRuntimeListingPageCursor({
        rootPath: cursor.rootPath,
        rootRelativePath: cursor.rootRelativePath,
        flattened: cursor.flattened,
        query: cursor.query,
        isTruncated: runtimeListing.isTruncated,
        nextOffset: runtimeListing.nextOffset,
      }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoadingNextListingPage(false)
    }
  }, [isLoadingNextListingPage, pageSize, setError])

  const replaceListingItems = useCallback((nextFiles: FileItem[]): void => {
    setFiles(nextFiles)
    setRuntimeListingPageCursor(null)
  }, [])

  const setListingQuery = useCallback(async (nextQuery: ListingQueryState): Promise<void> => {
    const update = resolveListingQueryUpdate({
      currentQuery: listingQueryRef.current,
      nextQuery,
      rootId,
      currentPath,
      virtualTrashPath,
      hasBoundRootPath: rootId ? getBoundRootPath(rootId) !== null : false,
    })
    if (update.type === 'unchanged') return

    listingQueryRef.current = update.query
    setListingQueryState(update.query)
    setRuntimeListingPageCursor(null)
    if (update.type !== 'reload-runtime-listing') return

    setIsLoading(true)
    setError(null)
    try {
      await loadDirectoryItems(null, currentPath, isFlattenView, {
        rootId,
        resolveDirectoryHandle: resolveCurrentDirectoryHandle,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [
    currentPath,
    isFlattenView,
    loadDirectoryItems,
    resolveCurrentDirectoryHandle,
    rootId,
    setError,
    setIsLoading,
    virtualTrashPath,
  ])

  const listingPage: ListingPageState = {
    hasNextPage: runtimeListingPageCursor !== null,
    isLoadingNextPage: isLoadingNextListingPage,
  }

  return {
    files,
    listingPage,
    loadDirectoryItems,
    loadNextListingPage,
    replaceListingItems,
    setListingQuery,
  }
}
