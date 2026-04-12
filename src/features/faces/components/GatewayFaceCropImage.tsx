import { buildGatewayFaceCropUrl } from '@/lib/gateway'

interface GatewayFaceCropImageProps {
  faceId: string
  size?: number
  padding?: number
  alt: string
  className?: string
  draggable?: boolean
}

export function GatewayFaceCropImage({
  faceId,
  size,
  padding,
  alt,
  className,
  draggable = false,
}: GatewayFaceCropImageProps) {
  return (
    <img
      src={buildGatewayFaceCropUrl(faceId, { size, padding })}
      alt={alt}
      draggable={draggable}
      className={className}
    />
  )
}
