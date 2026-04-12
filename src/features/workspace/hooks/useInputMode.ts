import { useEffect, useState } from 'react'
import type { InputMode } from '@/features/workspace/types/presentation'

const INPUT_MODE_QUERIES = {
  anyCoarse: '(any-pointer: coarse)',
  anyFine: '(any-pointer: fine)',
  anyHover: '(any-hover: hover)',
} as const

function readQueryMatch(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(query).matches
}

function readInputMode(): InputMode {
  const hasCoarsePointer = readQueryMatch(INPUT_MODE_QUERIES.anyCoarse)
  const hasFinePointer = readQueryMatch(INPUT_MODE_QUERIES.anyFine)
  const hasHover = readQueryMatch(INPUT_MODE_QUERIES.anyHover)

  if (!hasCoarsePointer) {
    return 'keyboard'
  }

  if (hasFinePointer || hasHover) {
    return 'hybrid'
  }

  return 'touch'
}

export function useInputMode(): InputMode {
  const [inputMode, setInputMode] = useState<InputMode>(() => readInputMode())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQueries = [
      window.matchMedia(INPUT_MODE_QUERIES.anyCoarse),
      window.matchMedia(INPUT_MODE_QUERIES.anyFine),
      window.matchMedia(INPUT_MODE_QUERIES.anyHover),
    ]
    const applyInputMode = () => {
      setInputMode(readInputMode())
    }

    applyInputMode()
    mediaQueries.forEach((mediaQuery) => mediaQuery.addEventListener('change', applyInputMode))
    return () => mediaQueries.forEach((mediaQuery) => mediaQuery.removeEventListener('change', applyInputMode))
  }, [])

  return inputMode
}
