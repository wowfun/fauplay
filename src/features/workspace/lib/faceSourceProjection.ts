import type { FaceRecord } from '@/features/faces/types'
import { getFilePreviewKind } from '@/lib/filePreview'
import type { FileItem, ResultProjection } from '@/types'

export const FACE_SOURCE_PROJECTION_ID = 'people:selected-face-sources'

interface BuildFaceSourceProjectionParams {
  selectedFaces: FaceRecord[]
  activeSurfaceFiles: FileItem[]
  filteredFiles: FileItem[]
  boundRootPath: string | null
  remoteRootId: string | null
}

function normalizeRootRelativePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:[\\/]/.test(path)
}

export function normalizeCurrentRootFaceSourcePath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (isAbsolutePathLike(slashPath)) {
    return null
  }

  const pathParts = slashPath.split('/').filter(Boolean)
  if (pathParts.length === 0 || pathParts.some((part) => part === '..')) {
    return null
  }
  return pathParts.join('/')
}

function normalizeAbsoluteFaceSourcePath(assetPath: string | null | undefined): string | null {
  const rawPath = assetPath?.trim()
  if (!rawPath) return null

  const slashPath = rawPath.replace(/\\/g, '/')
  if (!isAbsolutePathLike(slashPath)) return null
  return slashPath
}

function joinAbsolutePath(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedRoot ? `${normalizedRoot}/${relativePath}` : relativePath
}

export function getFaceSourceParentPath(relativePath: string): string {
  return relativePath.split('/').slice(0, -1).join('/')
}

function getRelativeFileName(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath
}

export function buildFaceSourceProjection({
  selectedFaces,
  activeSurfaceFiles,
  filteredFiles,
  boundRootPath,
  remoteRootId,
}: BuildFaceSourceProjectionParams): ResultProjection | null {
  const existingFileByPath = new Map(
    [...activeSurfaceFiles, ...filteredFiles]
      .filter((file) => file.kind === 'file')
      .map((file) => [normalizeRootRelativePath(file.path), file])
  )
  const fileByKey = new Map<string, FileItem>()

  for (const face of selectedFaces) {
    const relativePath = normalizeCurrentRootFaceSourcePath(face.assetPath)
    if (relativePath) {
      const existingFile = existingFileByPath.get(relativePath)
      const absolutePath = boundRootPath ? joinAbsolutePath(boundRootPath, relativePath) : undefined
      const nextFile: FileItem = existingFile
        ? {
          ...existingFile,
          remoteRootId: existingFile.remoteRootId ?? remoteRootId ?? undefined,
          sourceRootPath: existingFile.sourceRootPath ?? boundRootPath ?? undefined,
          sourceRelativePath: existingFile.sourceRelativePath ?? relativePath,
          absolutePath: existingFile.absolutePath ?? absolutePath,
        }
        : {
          name: getRelativeFileName(relativePath),
          path: relativePath,
          kind: 'file',
          absolutePath,
          displayPath: relativePath,
          previewKind: getFilePreviewKind(relativePath),
          remoteRootId: remoteRootId ?? undefined,
          sourceType: 'face_source',
          sourceRootPath: boundRootPath ?? undefined,
          sourceRelativePath: relativePath,
        }

      if (!fileByKey.has(`relative:${relativePath}`)) {
        fileByKey.set(`relative:${relativePath}`, nextFile)
      }
      continue
    }

    const absolutePath = normalizeAbsoluteFaceSourcePath(face.assetPath)
    if (!absolutePath) continue

    if (!fileByKey.has(`absolute:${absolutePath}`)) {
      fileByKey.set(`absolute:${absolutePath}`, {
        name: getRelativeFileName(absolutePath),
        path: absolutePath,
        kind: 'file',
        absolutePath,
        displayPath: absolutePath,
        previewKind: getFilePreviewKind(absolutePath),
        sourceType: 'face_source',
      })
    }
  }

  const projectionFiles = [...fileByKey.values()]
  if (projectionFiles.length === 0) {
    return null
  }

  return {
    id: FACE_SOURCE_PROJECTION_ID,
    title: `人脸来源 ${projectionFiles.length} 个文件`,
    entry: 'manual',
    ordering: {
      mode: 'listed',
    },
    files: projectionFiles,
  }
}
