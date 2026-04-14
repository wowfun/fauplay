import { useCallback, useEffect, useRef, useState } from 'react'
import { dispatchSystemTool } from '@/lib/actionDispatcher'
import { listFileFaces } from '@/features/faces/api'
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
  onFaceMutationCommitted?: () => void | Promise<void>
}

interface UsePreviewFaceOverlaysResult {
  items: PreviewFaceOverlayItem[]
  isLoading: boolean
  error: string | null
  reload: () => void
}

function readDetectedAssetId(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null
  }
  const assetId = (result as { assetId?: unknown }).assetId
  return typeof assetId === 'string' && assetId.trim() ? assetId.trim() : null
}

export function usePreviewFaceOverlays({
  file,
  rootHandle,
  rootId,
  previewKind,
  enabled,
  refreshToken,
  onFaceMutationCommitted,
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

        let parsedFaces = await listFileFaces(
          {
            rootHandle,
            rootId,
          },
          {
            relativePath: file.path,
          }
        )

        if (
          parsedFaces.length === 0
          && previewKind === 'image'
          && !autoDetectedPathSetRef.current.has(file.path)
        ) {
          let hasFaceMutation = false
          autoDetectedPathSetRef.current.add(file.path)
          const detectResult = await invokeVisionFace({
            operation: 'detectAsset',
            relativePath: file.path,
          }, FACE_DETECT_TIMEOUT_MS)
          hasFaceMutation = true
          const detectedAssetId = readDetectedAssetId(detectResult)
          try {
            if (detectedAssetId) {
              await invokeVisionFace({
                operation: 'clusterPending',
                assetId: detectedAssetId,
                limit: 200,
              }, FACE_CLUSTER_TIMEOUT_MS)
              hasFaceMutation = true
            }
          } catch {
            // Cluster failures should not block overlay rendering.
          }
          parsedFaces = await listFileFaces(
            {
              rootHandle,
              rootId,
            },
            {
              relativePath: file.path,
            }
          )

          if (hasFaceMutation && !cancelled) {
            try {
              await onFaceMutationCommitted?.()
            } catch {
              // Tag snapshot refresh failures should not block overlay rendering.
            }
          }
          if (cancelled) return
        }

        if (cancelled) return

        setItems(parsedFaces.map((face) => ({
          faceId: face.faceId,
          assetPath: face.assetPath || file.path,
          boundingBox: face.boundingBox,
          score: face.score,
          status: face.status,
          mediaType: face.mediaType,
          frameTsMs: face.frameTsMs,
          personId: face.personId,
          personName: face.personName,
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
  }, [enabled, file, onFaceMutationCommitted, previewKind, refreshToken, reloadVersion, rootHandle, rootId])

  return {
    items,
    isLoading,
    error,
    reload,
  }
}
