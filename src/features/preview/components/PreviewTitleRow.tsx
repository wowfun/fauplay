interface PreviewTitleRowProps {
  fileName: string
}

export function PreviewTitleRow({ fileName }: PreviewTitleRowProps) {
  return (
    <div className="min-w-0" data-preview-subzone="PreviewTitleRow">
      <p className="text-sm font-medium truncate" title={fileName}>
        {fileName}
      </p>
    </div>
  )
}
