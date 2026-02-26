import { useMemo, useRef, useEffect, useState } from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import { FileItemCard } from './FileItemCard'
import type { FileItem } from '@/types'

interface VirtualGridProps {
  files: FileItem[]
  rootHandle: FileSystemDirectoryHandle | null
  onFileClick: (file: FileItem) => void
  onFileDoubleClick?: (file: FileItem) => void
  onDirectoryClick: (dirName: string) => void
}

const CARD_WIDTH = 160
const CARD_HEIGHT = 180
const GAP = 16

export function VirtualGrid({ files, rootHandle, onFileClick, onFileDoubleClick, onDirectoryClick }: VirtualGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const columnCount = useMemo(() => {
    return Math.max(1, Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)))
  }, [dimensions.width])

  const rowCount = useMemo(() => {
    return Math.ceil(files.length / columnCount)
  }, [files.length, columnCount])

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>没有文件</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden">
      <Grid
        columnCount={columnCount}
        columnWidth={CARD_WIDTH + GAP}
        height={dimensions.height}
        rowCount={rowCount}
        rowHeight={CARD_HEIGHT + GAP}
        width={dimensions.width}
        className="scrollbar-thin"
      >
        {({ columnIndex, rowIndex, style }) => {
          const index = rowIndex * columnCount + columnIndex
          if (index >= files.length) return null

          const file = files[index]

          return (
            <div
              style={{
                ...style,
                left: Number(style.left) + GAP / 2,
                top: Number(style.top) + GAP / 2,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
              }}
            >
              <FileItemCard
                file={file}
                rootHandle={rootHandle}
                onClick={() => {
                  if (file.kind === 'directory') {
                    onDirectoryClick(file.name)
                  } else {
                    onFileClick(file)
                  }
                }}
                onDoubleClick={() => {
                  if (file.kind === 'file' && onFileDoubleClick) {
                    onFileDoubleClick(file)
                  }
                }}
              />
            </div>
          )
        }}
      </Grid>
    </div>
  )
}
