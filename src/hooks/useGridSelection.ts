import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

export const GRID_SELECTABLE_ITEM_ATTR = 'data-grid-selectable-id'

export interface GridMarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

interface UseGridSelectionOptions<T> {
  items: readonly T[]
  getId: (item: T) => string
  selectedIds?: Iterable<string> | null
  onSelectionChange?: (selectedIds: string[]) => void
  containerRef?: RefObject<HTMLElement | null>
}

function areStringSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
}

function normalizeRect(startX: number, startY: number, endX: number, endY: number): GridMarqueeRect {
  const left = Math.min(startX, endX)
  const top = Math.min(startY, endY)
  return {
    left,
    top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  }
}

function rectsIntersect(left: GridMarqueeRect, right: DOMRect): boolean {
  return (
    left.left <= right.right &&
    left.left + left.width >= right.left &&
    left.top <= right.bottom &&
    left.top + left.height >= right.top
  )
}

function shouldIgnoreMarqueeStart(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  if (target.closest([
    'input',
    'select',
    'textarea',
    'a',
    '[contenteditable="true"]',
    '[data-grid-marquee-ignore="true"]',
  ].join(','))) {
    return true
  }
  if (target.closest(`[${GRID_SELECTABLE_ITEM_ATTR}]`)) {
    return false
  }
  return Boolean(target.closest([
    'button',
    '[role="button"]',
  ].join(',')))
}

export function useGridSelection<T>({
  items,
  getId,
  selectedIds,
  onSelectionChange,
  containerRef,
}: UseGridSelectionOptions<T>) {
  const [internalSelectedIdSet, setInternalSelectedIdSet] = useState<Set<string>>(() => new Set())
  const [marqueeRect, setMarqueeRect] = useState<GridMarqueeRect | null>(null)
  const anchorIdRef = useRef<string | null>(null)
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const suppressNextClickRef = useRef(false)
  const suppressNextClickTimeoutRef = useRef<number | null>(null)

  const itemIds = useMemo(() => items.map((item) => getId(item)), [getId, items])
  const itemIdSet = useMemo(() => new Set(itemIds), [itemIds])
  const controlledSelectedIdSet = useMemo(
    () => (selectedIds ? new Set(selectedIds) : null),
    [selectedIds]
  )
  const isControlled = controlledSelectedIdSet !== null
  const selectedIdSet = controlledSelectedIdSet ?? internalSelectedIdSet

  useEffect(() => {
    selectedIdsRef.current = selectedIdSet
  }, [selectedIdSet])

  const toOrderedSelection = useCallback((selection: Set<string>) => {
    return itemIds.filter((id) => selection.has(id))
  }, [itemIds])

  const commitSelection = useCallback((nextSelection: Set<string>) => {
    const visibleNextSelection = new Set(
      toOrderedSelection(nextSelection)
    )
    const previous = selectedIdsRef.current
    if (areStringSetsEqual(previous, visibleNextSelection)) {
      return
    }

    selectedIdsRef.current = visibleNextSelection
    if (!isControlled) {
      setInternalSelectedIdSet(visibleNextSelection)
    }
    onSelectionChange?.(toOrderedSelection(visibleNextSelection))
  }, [isControlled, onSelectionChange, toOrderedSelection])

  const clearSelection = useCallback(() => {
    commitSelection(new Set())
  }, [commitSelection])

  const selectAll = useCallback(() => {
    commitSelection(new Set(itemIds))
  }, [commitSelection, itemIds])

  const replaceSelection = useCallback((ids: Iterable<string>) => {
    commitSelection(new Set(ids))
  }, [commitSelection])

  const toggleSelection = useCallback((id: string) => {
    const next = new Set(selectedIdsRef.current)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    commitSelection(next)
  }, [commitSelection])

  const setAnchorId = useCallback((id: string | null) => {
    anchorIdRef.current = id && itemIdSet.has(id) ? id : null
  }, [itemIdSet])

  const resetAnchor = useCallback(() => {
    anchorIdRef.current = null
  }, [])

  const selectRangeToId = useCallback((targetId: string) => {
    if (itemIds.length === 0) return

    const targetIndex = itemIds.indexOf(targetId)
    if (targetIndex < 0) return

    const fallbackAnchorId = anchorIdRef.current && itemIdSet.has(anchorIdRef.current)
      ? anchorIdRef.current
      : targetId
    const anchorIndex = Math.max(0, itemIds.indexOf(fallbackAnchorId))
    const rangeStart = Math.min(anchorIndex, targetIndex)
    const rangeEnd = Math.max(anchorIndex, targetIndex)
    commitSelection(new Set(itemIds.slice(rangeStart, rangeEnd + 1)))
  }, [commitSelection, itemIdSet, itemIds])

  const getMarqueeHitIds = useCallback((rect: GridMarqueeRect): string[] => {
    const container = containerRef?.current
    if (!container) return []

    const hitIds: string[] = []
    const elements = container.querySelectorAll<HTMLElement>(`[${GRID_SELECTABLE_ITEM_ATTR}]`)
    elements.forEach((element) => {
      const id = element.getAttribute(GRID_SELECTABLE_ITEM_ATTR)
      if (!id || !itemIdSet.has(id)) return
      if (rectsIntersect(rect, element.getBoundingClientRect())) {
        hitIds.push(id)
      }
    })
    return hitIds
  }, [containerRef, itemIdSet])

  const shouldSuppressClick = useCallback(() => {
    if (!suppressNextClickRef.current) {
      return false
    }
    suppressNextClickRef.current = false
    if (suppressNextClickTimeoutRef.current !== null) {
      window.clearTimeout(suppressNextClickTimeoutRef.current)
      suppressNextClickTimeoutRef.current = null
    }
    return true
  }, [])

  const handleMarqueePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!containerRef?.current || event.button !== 0 || shouldIgnoreMarqueeStart(event.target)) {
      return
    }

    const startX = event.clientX
    const startY = event.clientY
    const additive = event.ctrlKey || event.metaKey
    const baseSelection = new Set(selectedIdsRef.current)
    let hasMoved = false

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const nextRect = normalizeRect(startX, startY, pointerEvent.clientX, pointerEvent.clientY)
      if (!hasMoved && nextRect.width < 4 && nextRect.height < 4) {
        return
      }

      pointerEvent.preventDefault()
      hasMoved = true
      setMarqueeRect(nextRect)

      const hitIds = getMarqueeHitIds(nextRect)
      const nextSelection = additive ? new Set(baseSelection) : new Set<string>()
      hitIds.forEach((id) => nextSelection.add(id))
      commitSelection(nextSelection)
    }

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)

      if (hasMoved) {
        const finalRect = normalizeRect(startX, startY, pointerEvent.clientX, pointerEvent.clientY)
        const hitIds = getMarqueeHitIds(finalRect)
        anchorIdRef.current = hitIds[hitIds.length - 1] ?? anchorIdRef.current
        suppressNextClickRef.current = true
        if (suppressNextClickTimeoutRef.current !== null) {
          window.clearTimeout(suppressNextClickTimeoutRef.current)
        }
        suppressNextClickTimeoutRef.current = window.setTimeout(() => {
          suppressNextClickRef.current = false
          suppressNextClickTimeoutRef.current = null
        }, 250)
      }

      setMarqueeRect(null)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [commitSelection, containerRef, getMarqueeHitIds])

  useEffect(() => {
    return () => {
      if (suppressNextClickTimeoutRef.current !== null) {
        window.clearTimeout(suppressNextClickTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const nextSelection = new Set(
      [...selectedIdSet].filter((id) => itemIdSet.has(id))
    )
    if (!areStringSetsEqual(selectedIdSet, nextSelection)) {
      commitSelection(nextSelection)
    }
    if (anchorIdRef.current && !itemIdSet.has(anchorIdRef.current)) {
      anchorIdRef.current = null
    }
  }, [commitSelection, itemIdSet, selectedIdSet])

  return {
    selectedIdSet,
    selectedIds: toOrderedSelection(selectedIdSet),
    marqueeRect,
    clearSelection,
    selectAll,
    replaceSelection,
    toggleSelection,
    setAnchorId,
    resetAnchor,
    selectRangeToId,
    handleMarqueePointerDown,
    shouldSuppressClick,
  }
}
