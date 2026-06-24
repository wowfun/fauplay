import { buildFaceCropUrl } from '@/lib/fileAccess'

interface FaceCropImageProps {
  faceId: string
  size?: number
  padding?: number
  alt: string
  className?: string
  draggable?: boolean
}

export function FaceCropImage({
  faceId,
  size,
  padding,
  alt,
  className,
  draggable = false,
}: FaceCropImageProps) {
  return (
    <img
      src={buildFaceCropUrl(faceId, { size, padding })}
      alt={alt}
      draggable={draggable}
      className={className}
    />
  )
}
