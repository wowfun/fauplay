import { FolderOpen, Loader2, Star, X } from 'lucide-react'
import type { CachedRootEntry, FavoriteFolderEntry } from '@/types'
import { Button } from '@/ui/Button'

function buildDisplayPath(rootName: string, relativePath: string): string {
  return relativePath ? `${rootName}/${relativePath}` : rootName
}

interface DirectorySelectionLayoutProps {
  isLoading: boolean
  error: string | null
  onSelectDirectory: () => void
  cachedRoots: CachedRootEntry[]
  favoriteFolders: FavoriteFolderEntry[]
  onOpenCachedRoot: (rootId: string) => void
  onOpenFavoriteFolder: (entry: FavoriteFolderEntry) => void
  onRemoveFavoriteFolder: (entry: FavoriteFolderEntry) => void
}

export function DirectorySelectionLayout({
  isLoading,
  error,
  onSelectDirectory,
  cachedRoots,
  favoriteFolders,
  onOpenCachedRoot,
  onOpenFavoriteFolder,
  onRemoveFavoriteFolder,
}: DirectorySelectionLayoutProps) {
  return (
    <div className="h-screen bg-background flex flex-col items-center justify-center p-8 overflow-hidden">
      <div className="text-center max-w-md w-full">
        <h1 className="text-4xl font-bold mb-4">Fauplay</h1>
        <p className="text-muted-foreground mb-8">
          选择一个本地文件夹开始浏览图片和视频
        </p>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            {error}
          </div>
        )}

        <Button
          onClick={onSelectDirectory}
          disabled={isLoading}
          variant="default"
          size="md"
          className="inline-flex items-center gap-2 px-6 py-3 h-auto"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <FolderOpen className="w-5 h-5" />
          )}
          选择文件夹
        </Button>

        {cachedRoots.length > 0 && (
          <div className="mt-6 text-left">
            <p className="mb-2 text-xs text-muted-foreground">缓存目录</p>
            <div className="space-y-2">
              {cachedRoots.map((root) => (
                <Button
                  key={root.rootId}
                  onClick={() => onOpenCachedRoot(root.rootId)}
                  disabled={isLoading}
                  variant="ghost"
                  size="md"
                  className="w-full justify-start truncate"
                  title={root.rootName}
                >
                  {root.rootName}
                </Button>
              ))}
            </div>
          </div>
        )}

        {favoriteFolders.length > 0 && (
          <div className="mt-6 text-left">
            <p className="mb-2 text-xs text-muted-foreground">收藏夹</p>
            <div className="space-y-2">
              {favoriteFolders.map((entry) => {
                const rootName = entry.rootName || '根目录'
                const displayPath = buildDisplayPath(rootName, entry.path)
                return (
                  <div key={`${entry.rootId}:${entry.path}`} className="flex items-center gap-1">
                    <Button
                      onClick={() => onOpenFavoriteFolder(entry)}
                      disabled={isLoading}
                      variant="ghost"
                      size="md"
                      className="min-w-0 flex-1 justify-start gap-2 truncate"
                      title={displayPath}
                    >
                      <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" />
                      <span className="truncate">{displayPath}</span>
                    </Button>
                    <Button
                      onClick={() => onRemoveFavoriteFolder(entry)}
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="移除收藏"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-8">
          支持 Chrome 94+、Edge 94+、Firefox 111+
        </p>
      </div>
    </div>
  )
}
