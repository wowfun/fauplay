import { ArrowLeft, FolderOpen, Loader2, Server, Shield, Star, X } from 'lucide-react'
import type { CachedRootEntry, FavoriteFolderEntry } from '@/types'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import type { RemoteRootEntry } from '@/lib/gateway'

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
  onRebindCachedRootPath: (rootId: string) => void
  onOpenFavoriteFolder: (entry: FavoriteFolderEntry) => void
  onRemoveFavoriteFolder: (entry: FavoriteFolderEntry) => void
  remoteStep: 'idle' | 'token' | 'roots'
  remoteToken: string
  rememberRemoteDevice: boolean
  rememberRemoteDeviceLabel: string
  remoteError: string | null
  remoteRoots: RemoteRootEntry[]
  showRememberedDevicesAdminEntry: boolean
  onRemoteTokenChange: (value: string) => void
  onRememberRemoteDeviceChange: (value: boolean) => void
  onRememberRemoteDeviceLabelChange: (value: string) => void
  onOpenRemoteConnect: () => void
  onCancelRemoteConnect: () => void
  onSubmitRemoteToken: () => void
  onSelectRemoteRoot: (root: RemoteRootEntry) => void
  onOpenRememberedDevicesAdmin: () => void
}

export function DirectorySelectionLayout({
  isLoading,
  error,
  onSelectDirectory,
  cachedRoots,
  favoriteFolders,
  onOpenCachedRoot,
  onRebindCachedRootPath,
  onOpenFavoriteFolder,
  onRemoveFavoriteFolder,
  remoteStep,
  remoteToken,
  rememberRemoteDevice,
  rememberRemoteDeviceLabel,
  remoteError,
  remoteRoots,
  showRememberedDevicesAdminEntry,
  onRemoteTokenChange,
  onRememberRemoteDeviceChange,
  onRememberRemoteDeviceLabelChange,
  onOpenRemoteConnect,
  onCancelRemoteConnect,
  onSubmitRemoteToken,
  onSelectRemoteRoot,
  onOpenRememberedDevicesAdmin,
}: DirectorySelectionLayoutProps) {
  const hasRemotePanel = remoteStep !== 'idle'

  return (
    <div className="h-screen bg-background flex flex-col items-center justify-center p-8 overflow-hidden">
      <div className="text-center max-w-md w-full">
        <h1 className="text-4xl font-bold mb-4">Fauplay</h1>
        <p className="text-muted-foreground mb-8">
          选择一个本地文件夹，或连接同源远程 Fauplay
        </p>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            {error}
          </div>
        )}

        {remoteError && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            {remoteError}
          </div>
        )}

        {!hasRemotePanel ? (
          <div className="space-y-3">
            <Button
              onClick={onSelectDirectory}
              disabled={isLoading}
              variant="default"
              size="md"
              className="inline-flex items-center gap-2 px-6 py-3 h-auto w-full justify-center"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <FolderOpen className="w-5 h-5" />
              )}
              选择本地文件夹
            </Button>
            <Button
              onClick={onOpenRemoteConnect}
              disabled={isLoading}
              variant="outline"
              size="md"
              className="inline-flex items-center gap-2 px-6 py-3 h-auto w-full justify-center"
            >
              <Server className="w-5 h-5" />
              连接远程 Fauplay
            </Button>
            {showRememberedDevicesAdminEntry && (
              <Button
                onClick={onOpenRememberedDevicesAdmin}
                disabled={isLoading}
                variant="ghost"
                size="md"
                className="inline-flex items-center gap-2 px-6 py-3 h-auto w-full justify-center"
              >
                <Shield className="w-5 h-5" />
                管理已记住设备
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 text-left space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">远程只读访问</p>
                <p className="text-xs text-muted-foreground">
                  通过当前站点同源入口连接远程 Fauplay
                </p>
              </div>
              <Button
                onClick={onCancelRemoteConnect}
                disabled={isLoading}
                variant="ghost"
                size="sm"
                className="gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                返回
              </Button>
            </div>

            {remoteStep === 'token' && (
              <div className="space-y-3">
                <Input
                  value={remoteToken}
                  onChange={(event) => onRemoteTokenChange(event.target.value)}
                  placeholder="输入 Bearer Token"
                  autoComplete="off"
                  spellCheck={false}
                />
                <label className="flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={rememberRemoteDevice}
                    onChange={(event) => onRememberRemoteDeviceChange(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">记住此设备 30 天</span>
                    <span className="block text-xs text-muted-foreground">
                      后续可自动恢复远程登录；如需撤销，可在工作区中点击“忘记此设备”。
                    </span>
                  </span>
                </label>
                {rememberRemoteDevice && (
                  <div className="space-y-1">
                    <Input
                      value={rememberRemoteDeviceLabel}
                      onChange={(event) => onRememberRemoteDeviceLabelChange(event.target.value)}
                      placeholder="可选：设备名，例如 我的小米手机"
                      autoComplete="off"
                      maxLength={80}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      留空时由服务端自动命名，例如 Safari · iPhone。
                    </p>
                  </div>
                )}
                <Button
                  onClick={onSubmitRemoteToken}
                  disabled={isLoading || !remoteToken.trim()}
                  variant="default"
                  size="md"
                  className="w-full justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                  验证并读取远程 Roots
                </Button>
              </div>
            )}

            {remoteStep === 'roots' && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">选择远程 Root</p>
                {remoteRoots.map((root) => (
                  <Button
                    key={root.id}
                    onClick={() => onSelectRemoteRoot(root)}
                    disabled={isLoading}
                    variant="ghost"
                    size="md"
                    className="w-full justify-start"
                    title={root.id}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate">{root.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{root.id}</span>
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {!hasRemotePanel && cachedRoots.length > 0 && (
          <div className="mt-6 text-left">
            <p className="mb-2 text-xs text-muted-foreground">缓存目录</p>
            <div className="space-y-2">
              {cachedRoots.map((root) => (
                <div key={root.rootId} className="flex items-center gap-1">
                  <Button
                    onClick={() => onOpenCachedRoot(root.rootId)}
                    disabled={isLoading}
                    variant="ghost"
                    size="md"
                    className="min-w-0 flex-1 justify-start"
                    title={`${root.rootName}\n${root.boundRootPath || '未绑定'}`}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate">{root.rootName}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {root.boundRootPath || '未绑定'}
                      </span>
                    </span>
                  </Button>
                  <Button
                    onClick={() => onRebindCachedRootPath(root.rootId)}
                    disabled={isLoading}
                    variant="ghost"
                    size="md"
                    className="shrink-0 px-2"
                    title="重绑路径"
                  >
                    重绑
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasRemotePanel && favoriteFolders.length > 0 && (
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
