import { ArrowLeft, Loader2, RefreshCw, Shield, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RememberedDeviceAdminEntry } from '@/lib/gateway'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'

interface RememberedDevicesAdminPanelProps {
  items: RememberedDeviceAdminEntry[]
  error: string | null
  isLoading: boolean
  isMutating: boolean
  onClose: () => void
  onRefresh: () => void
  onRename: (deviceId: string, label: string) => void
  onRevoke: (deviceId: string) => void
  onRevokeAll: () => void
}

function formatTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return '未知'
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestampMs))
}

export function RememberedDevicesAdminPanel({
  items,
  error,
  isLoading,
  isMutating,
  onClose,
  onRefresh,
  onRename,
  onRevoke,
  onRevokeAll,
}: RememberedDevicesAdminPanelProps) {
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')

  useEffect(() => {
    if (!editingDeviceId) {
      setDraftLabel('')
      return
    }
    const matched = items.find((item) => item.id === editingDeviceId) ?? null
    if (!matched) {
      setEditingDeviceId(null)
      setDraftLabel('')
    }
  }, [editingDeviceId, items])

  const handleStartRename = (item: RememberedDeviceAdminEntry) => {
    setEditingDeviceId(item.id)
    setDraftLabel(item.label)
  }

  const handleCancelRename = () => {
    setEditingDeviceId(null)
    setDraftLabel('')
  }

  const handleConfirmRename = () => {
    if (!editingDeviceId) return
    const targetId = editingDeviceId
    setEditingDeviceId(null)
    setDraftLabel('')
    onRename(targetId, draftLabel)
  }

  const handleRevokeDevice = (item: RememberedDeviceAdminEntry) => {
    const displayName = item.label || item.autoLabel
    if (!window.confirm(`撤销“${displayName}”后，该设备的持久登录态和关联活动会话都会立即失效。继续吗？`)) {
      return
    }
    onRevoke(item.id)
  }

  const handleRevokeAll = () => {
    if (!window.confirm('全部撤销后，所有已记住设备的持久登录态都会失效。继续吗？')) {
      return
    }
    onRevokeAll()
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <div className="border-b border-border px-5 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">已记住设备</p>
            <p className="mt-1 text-sm text-muted-foreground">
              本机 loopback 管理面板。可查看、重命名或撤销 remembered devices。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              onClick={onRefresh}
              disabled={isLoading || isMutating}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              刷新
            </Button>
            <Button
              onClick={onClose}
              disabled={isMutating}
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">设备总数：{items.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                撤销 remembered device 会立即一并失效该设备关联的活动 session。
              </p>
            </div>
            <Button
              onClick={handleRevokeAll}
              disabled={isLoading || isMutating || items.length === 0}
              variant="outline"
              size="sm"
              className="gap-2 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              全部撤销
            </Button>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
              正在读取已记住设备...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card px-4 py-12 text-center">
              <Shield className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-foreground">当前没有已记住设备</p>
              <p className="mt-1 text-xs text-muted-foreground">
                当远程登录时勾选“记住此设备”，这里会出现可管理的设备记录。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const title = item.label || item.autoLabel
                const isEditing = editingDeviceId === item.id
                const shouldShowAutoLabel = Boolean(item.label) && item.autoLabel && item.autoLabel !== title
                const shouldShowUserAgentSummary = Boolean(item.userAgentSummary) && item.userAgentSummary !== title

                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{title}</p>
                        {shouldShowAutoLabel && (
                          <p className="mt-1 text-xs text-muted-foreground">自动命名：{item.autoLabel}</p>
                        )}
                        {shouldShowUserAgentSummary && (
                          <p className="mt-1 text-xs text-muted-foreground">设备摘要：{item.userAgentSummary}</p>
                        )}
                        <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                          <p>创建时间：{formatTimestamp(item.createdAtMs)}</p>
                          <p>最近使用：{formatTimestamp(item.lastUsedAtMs)}</p>
                          <p>到期时间：{formatTimestamp(item.expiresAtMs)}</p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 lg:w-[320px]">
                        {isEditing ? (
                          <>
                            <Input
                              value={draftLabel}
                              onChange={(event) => setDraftLabel(event.target.value)}
                              placeholder="留空则回退自动命名"
                              disabled={isMutating}
                              maxLength={80}
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                onClick={handleConfirmRename}
                                disabled={isMutating}
                                variant="default"
                                size="sm"
                                className="flex-1"
                              >
                                保存名称
                              </Button>
                              <Button
                                onClick={handleCancelRename}
                                disabled={isMutating}
                                variant="ghost"
                                size="sm"
                                className="flex-1"
                              >
                                取消
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              onClick={() => handleStartRename(item)}
                              disabled={isMutating}
                              variant="outline"
                              size="sm"
                              className="flex-1"
                            >
                              重命名
                            </Button>
                            <Button
                              onClick={() => handleRevokeDevice(item)}
                              disabled={isMutating}
                              variant="outline"
                              size="sm"
                              className="flex-1 text-destructive hover:bg-destructive/10"
                            >
                              撤销
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
