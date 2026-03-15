import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/ui/Input'

export interface PreviewRenameResult {
  ok: boolean
  error?: string
}

interface PreviewTitleRowProps {
  fileName: string
  canRename: boolean
  renameInFlight: boolean
  renameUnavailableReason?: string | null
  onSubmitRename: (nextBaseName: string) => Promise<PreviewRenameResult>
}

function splitFileName(fileName: string): { baseName: string; extension: string } {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return {
      baseName: fileName,
      extension: '',
    }
  }

  return {
    baseName: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex),
  }
}

export function PreviewTitleRow({
  fileName,
  canRename,
  renameInFlight,
  renameUnavailableReason,
  onSubmitRename,
}: PreviewTitleRowProps) {
  const { baseName, extension } = useMemo(() => splitFileName(fileName), [fileName])
  const [isEditing, setIsEditing] = useState(false)
  const [draftBaseName, setDraftBaseName] = useState(baseName)
  const [renameError, setRenameError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurSubmitRef = useRef(false)

  useEffect(() => {
    setIsEditing(false)
    setDraftBaseName(baseName)
    setRenameError(null)
  }, [baseName, fileName])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const cancelEditing = () => {
    setIsEditing(false)
    setDraftBaseName(baseName)
    setRenameError(null)
  }

  const submitRename = async () => {
    if (!isEditing || renameInFlight) return

    if (!canRename) {
      setRenameError(renameUnavailableReason || '重命名能力不可用')
      return
    }

    if (draftBaseName.trim().length === 0) {
      setRenameError('文件名不能为空')
      return
    }

    if (draftBaseName.includes('/') || draftBaseName.includes('\\')) {
      setRenameError('文件名不能包含路径分隔符')
      return
    }

    if (draftBaseName === baseName) {
      setIsEditing(false)
      setRenameError(null)
      return
    }

    const result = await onSubmitRename(draftBaseName)
    if (result.ok) {
      setIsEditing(false)
      setRenameError(null)
      return
    }

    setRenameError(result.error || '重命名失败')
  }

  return (
    <div className="min-w-0 w-full" data-preview-subzone="PreviewTitleRow">
      {isEditing ? (
        <>
          <Input
            ref={inputRef}
            value={draftBaseName}
            disabled={renameInFlight}
            className="h-8 w-full max-w-full px-2 text-sm"
            onChange={(event) => {
              setDraftBaseName(event.target.value)
              if (renameError) {
                setRenameError(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitRename()
                return
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                skipBlurSubmitRef.current = true
                cancelEditing()
              }
            }}
            onBlur={() => {
              if (skipBlurSubmitRef.current) {
                skipBlurSubmitRef.current = false
                return
              }
              void submitRename()
            }}
            aria-label="重命名文件名主体"
            title={fileName}
          />
          {extension && (
            <p className="mt-1 text-xs text-muted-foreground" title={extension}>
              扩展名保持不变：{extension}
            </p>
          )}
        </>
      ) : (
        <button
          type="button"
          disabled={!canRename || renameInFlight}
          className="max-w-full text-left text-sm font-medium truncate disabled:cursor-not-allowed disabled:text-muted-foreground"
          title={canRename ? `${fileName}\n点击重命名（仅主体名）` : `${fileName}\n${renameUnavailableReason || '重命名能力不可用'}`}
          onClick={() => {
            if (!canRename || renameInFlight) return
            setDraftBaseName(baseName)
            setRenameError(null)
            setIsEditing(true)
          }}
        >
          {fileName}
        </button>
      )}

      {!canRename && renameUnavailableReason && !isEditing && (
        <p className="mt-1 text-xs text-muted-foreground" title={renameUnavailableReason}>
          {renameUnavailableReason}
        </p>
      )}

      {renameError && (
        <p className="mt-1 text-xs text-destructive" title={renameError}>
          {renameError}
        </p>
      )}
    </div>
  )
}
