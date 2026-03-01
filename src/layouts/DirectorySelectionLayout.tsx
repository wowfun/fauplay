import { FolderOpen, Loader2 } from 'lucide-react'
import { Button } from '@/ui/Button'

interface DirectorySelectionLayoutProps {
  isLoading: boolean
  error: string | null
  onSelectDirectory: () => void
}

export function DirectorySelectionLayout({
  isLoading,
  error,
  onSelectDirectory,
}: DirectorySelectionLayoutProps) {
  return (
    <div className="h-screen bg-background flex flex-col items-center justify-center p-8 overflow-hidden">
      <div className="text-center max-w-md">
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

        <p className="text-xs text-muted-foreground mt-8">
          支持 Chrome 94+、Edge 94+、Firefox 111+
        </p>
      </div>
    </div>
  )
}
