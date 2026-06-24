export function toArgsWithoutOperation(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args }
  delete next.operation
  return next
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

export function normalizeRootRelativePath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function normalizeAbsolutePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)) {
    return normalized
  }
  return normalized.replace(/\/+$/, '')
}

function toRelativePathWithinRoot(rootPath: string, absolutePath: string): string | null {
  const normalizedRootPath = normalizeAbsolutePath(rootPath)
  const normalizedAbsolutePath = normalizeAbsolutePath(absolutePath)
  if (!normalizedRootPath || !normalizedAbsolutePath) {
    return null
  }
  if (normalizedAbsolutePath === normalizedRootPath) {
    return ''
  }
  const prefix = `${normalizedRootPath}/`
  if (!normalizedAbsolutePath.startsWith(prefix)) {
    return null
  }
  return normalizeRootRelativePath(normalizedAbsolutePath.slice(prefix.length))
}

function compactRootRelativePaths(paths: string[]): string[] {
  let compacted: string[] = []

  for (const pathItem of paths) {
    if (compacted.includes(pathItem)) continue
    if (compacted.some((existing) => pathItem === existing || pathItem.startsWith(`${existing}/`))) continue

    compacted = compacted.filter((existing) => !(existing === pathItem || existing.startsWith(`${pathItem}/`)))
    compacted.push(pathItem)
  }

  return compacted
}

export function readRootRelativePaths(args: Record<string, unknown>): string[] | null {
  const hasRelativePath = Object.prototype.hasOwnProperty.call(args, 'relativePath')
  const hasRelativePaths = Object.prototype.hasOwnProperty.call(args, 'relativePaths')
  if (hasRelativePath && hasRelativePaths) {
    return null
  }

  if (hasRelativePath && typeof args.relativePath === 'string') {
    const normalized = normalizeRootRelativePath(args.relativePath)
    return normalized ? [normalized] : null
  }

  if (hasRelativePaths && isStringArray(args.relativePaths)) {
    const normalizedPaths = args.relativePaths
      .map((item) => normalizeRootRelativePath(item))
      .filter((item) => item)
    return normalizedPaths.length > 0 ? compactRootRelativePaths(normalizedPaths) : null
  }

  return null
}

export function readMoveRootRelativePaths(args: Record<string, unknown>, rootPath: string): string[] | null {
  const relativePaths = readRootRelativePaths(args)
  if (relativePaths) {
    return relativePaths
  }

  if (!isStringArray(args.absolutePaths)) {
    return null
  }

  const paths = args.absolutePaths
    .map((absolutePath) => toRelativePathWithinRoot(rootPath, absolutePath))
    .filter((item): item is string => Boolean(item))
  if (paths.length !== args.absolutePaths.length) {
    return null
  }

  return compactRootRelativePaths(paths)
}

export function readRestoreRootRelativePaths(args: Record<string, unknown>, rootPath: string): string[] | null {
  const relativePaths = readRootRelativePaths(args)
  if (relativePaths) {
    return relativePaths
  }

  if (!isObjectArray(args.items)) {
    return null
  }

  const paths: string[] = []
  for (const item of args.items) {
    if (item.sourceType !== 'root_trash') {
      return null
    }
    const absolutePath = typeof item.absolutePath === 'string' ? item.absolutePath.trim() : ''
    if (!absolutePath) {
      return null
    }
    const relativePath = toRelativePathWithinRoot(rootPath, absolutePath)
    if (!relativePath || !relativePath.startsWith('.trash/')) {
      return null
    }
    paths.push(relativePath)
  }

  return paths.length > 0 ? compactRootRelativePaths(paths) : null
}

export function readMoveGlobalTrashAbsolutePaths(args: Record<string, unknown>): string[] | null {
  if (!isStringArray(args.absolutePaths)) {
    return null
  }

  const absolutePaths = args.absolutePaths
    .map((item) => item.trim())
    .filter((item) => item)

  return absolutePaths.length > 0 ? absolutePaths : null
}

export function readRestoreGlobalTrashRecycleIds(args: Record<string, unknown>): string[] | null {
  if (typeof args.recycleId === 'string' && args.recycleId.trim()) {
    return [args.recycleId.trim()]
  }

  if (isStringArray(args.recycleIds)) {
    const recycleIds = args.recycleIds
      .map((item) => item.trim())
      .filter((item) => item)
    return recycleIds.length > 0 ? recycleIds : null
  }

  if (!isObjectArray(args.items)) {
    return null
  }

  const recycleIds: string[] = []
  for (const item of args.items) {
    if (item.sourceType !== 'global_recycle') {
      return null
    }
    const recycleId = typeof item.recycleId === 'string' ? item.recycleId.trim() : ''
    if (!recycleId) {
      return null
    }
    recycleIds.push(recycleId)
  }

  return recycleIds.length > 0 ? recycleIds : null
}
