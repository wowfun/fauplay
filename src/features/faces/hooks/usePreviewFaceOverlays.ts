import { useCallback, useEffect, useRef, useState } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import type { FileItem, FilePreviewKind } from '@/types'
import type { PreviewFaceOverlayItem } from '@/features/faces/types'

const FACE_DETECT_TIMEOUT_MS = 120000
const FACE_CLUSTER_TIMEOUT_MS = 30000

interface UsePreviewFaceOverlaysOptions {
  file: FileItem | null
  rootHandle: FileSystemDirectoryHandle | null
  rootId?: string | null
  previewKind: FilePreviewKind
  enabled: boolean
  refreshToken?: string | number | null
}

interface UsePreviewFaceOverlaysResult {
  items: PreviewFaceOverlayItem[]
  isLoading: boolean
  error: string | null
  reload: () => void
}

interface ParsedFaceRecord {
  faceId: string
  assetPath: string
  boundingBox: {
    x1: number
    y1: number
    x2: number
    y2: number
  }
  score: number
  status: string
  personId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseFaceItems(result: unknown): ParsedFaceRecord[] {
  if (!isRecord(result)) return []
  const rawItems = result.items
  if (!Array.isArray(rawItems)) return []

  return rawItems.flatMap((item) => {
    if (!isRecord(item)) return []
    const faceId = typeof item.faceId === 'string' ? item.faceId : ''
    const assetPath = typeof item.assetPath === 'string' ? item.assetPath : ''
    const rawBox = item.boundingBox
    if (!faceId || !assetPath || !isRecord(rawBox)) return []

    const x1 = typeof rawBox.x1 === 'number' ? rawBox.x1 : NaN
    const y1 = typeof rawBox.y1 === 'number' ? rawBox.y1 : NaN
    const x2 = typeof rawBox.x2 === 'number' ? rawBox.x2 : NaN
    const y2 = typeof rawBox.y2 === 'number' ? rawBox.y2 : NaN
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return []
    }

    const personId = typeof item.personId === 'string' && item.personId
      ? item.personId
      : null
    return [{
      faceId,
      assetPath,
      boundingBox: { x1, y1, x2, y2 },
      score: typeof item.score === 'number' ? item.score : 0,
      status: typeof item.status === 'string' ? item.status : 'unassigned',
      personId,
    }]
  })
}

function parsePersonNameMap(result: unknown): Map<string, string> {
  const map = new Map<string, string>()
  if (!isRecord(result)) return map
  const rawItems = result.items
  if (!Array.isArray(rawItems)) return map

  for (const item of rawItems) {
    if (!isRecord(item)) continue
    const personId = typeof item.personId === 'string' ? item.personId : ''
    if (!personId) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    map.set(personId, name)
  }
  return map
}

function toDisplayName(personId: string, map: Map<string, string>): string {
  const mapped = map.get(personId)?.trim()
  if (mapped) return mapped
  return `人物 ${personId.slice(0, 8)}`
}

export function usePreviewFaceOverlays({
  file,
  rootHandle,
  rootId,
  previewKind,
  enabled,
  refreshToken,
}: UsePreviewFaceOverlaysOptions): UsePreviewFaceOverlaysResult {
  const [items, setItems] = useState<PreviewFaceOverlayItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const autoDetectedPathSetRef = useRef<Set<string>>(new Set())

  const reload = useCallback(() => {
    setReloadVersion((previous) => previous + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !file || file.kind !== 'file' || !rootHandle || !rootId) {
      setItems([])
      setIsLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const invokeVisionFace = async (
          additionalArgs: Record<string, unknown>,
          timeoutMs?: number
        ): Promise<unknown> => {
          const result = await dispatchSystemTool({
            toolName: 'vision.face',
            rootHandle,
            rootId,
            additionalArgs,
            timeoutMs,
          })
          if (!result.ok) {
            throw new Error(result.error || 'vision.face 调用失败')
          }
          return result.result
        }

        let parsedFaces = parseFaceItems(await invokeVisionFace({
          operation: 'listAssetFaces',
          relativePath: file.path,
        }))

        if (
          parsedFaces.length === 0
          && previewKind === 'image'
          && !autoDetectedPathSetRef.current.has(file.path)
        ) {
          autoDetectedPathSetRef.current.add(file.path)
          await invokeVisionFace({
            operation: 'detectAsset',
            relativePath: file.path,
          }, FACE_DETECT_TIMEOUT_MS)
          try {
            await invokeVisionFace({
              operation: 'clusterPending',
              limit: 200,
            }, FACE_CLUSTER_TIMEOUT_MS)
          } catch {
            // Cluster failures should not block overlay rendering.
          }
          parsedFaces = parseFaceItems(await invokeVisionFace({
            operation: 'listAssetFaces',
            relativePath: file.path,
          }))
        }

        const personIds = [...new Set(parsedFaces.map((face) => face.personId).filter((id): id is string => Boolean(id)))]
        const personNameMap = personIds.length === 0
          ? new Map<string, string>()
          : parsePersonNameMap(await invokeVisionFace({
            operation: 'listPeople',
            page: 1,
            size: 500,
          }))

        if (cancelled) return

        setItems(parsedFaces.map((face) => ({
          faceId: face.faceId,
          assetPath: face.assetPath,
          boundingBox: face.boundingBox,
          score: face.score,
          status: face.status,
          personId: face.personId,
          personName: face.personId ? toDisplayName(face.personId, personNameMap) : null,
        })))
      } catch (loadError) {
        if (cancelled) return
        setItems([])
        setError(loadError instanceof Error ? loadError.message : '读取人脸数据失败')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled, file, previewKind, refreshToken, reloadVersion, rootHandle, rootId])

  return {
    items,
    isLoading,
    error,
    reload,
  }
}
