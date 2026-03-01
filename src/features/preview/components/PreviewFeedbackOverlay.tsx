interface PreviewFeedbackOverlayProps {
  showPlaybackError: boolean
}

export function PreviewFeedbackOverlay({ showPlaybackError }: PreviewFeedbackOverlayProps) {
  if (!showPlaybackError) {
    return null
  }

  return (
    <div
      className="absolute bottom-2 left-2 right-2 rounded-md bg-black/55 px-3 py-2"
      data-preview-subzone="PreviewFeedbackOverlay"
    >
      <p className="text-xs text-white text-center">
        当前浏览器可能不支持该视频的编码格式（尤其常见于 AVI）。建议转码为 MP4(H.264/AAC) 后再播放。
      </p>
    </div>
  )
}
