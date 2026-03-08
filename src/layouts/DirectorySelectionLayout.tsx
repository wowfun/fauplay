import { FolderOpen, Loader2 } from 'lucide-react'
import type { CachedRootEntry } from '@/types'
import { Button } from '@/ui/Button'

interface DirectorySelectionLayoutProps {
  isLoading: boolean
  error: string | null
  onSelectDirectory: () => void
  cachedRoots: CachedRootEntry[]
  onOpenCachedRoot: (rootId: string) => void
}

export function DirectorySelectionLayout({
  isLoading,
  error,
  onSelectDirectory,
  cachedRoots,
  onOpenCachedRoot,
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

        <p className="text-xs text-muted-foreground mt-8">
          支持 Chrome 94+、Edge 94+、Firefox 111+
        </p>
      </div>
    </div>
  )
}
