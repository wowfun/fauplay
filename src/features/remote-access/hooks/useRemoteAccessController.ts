import { useCallback, useEffect, useState } from 'react'
import { useRemoteFileSystem } from '@/hooks/useRemoteFileSystem'
import { useRememberedDevicesAdmin } from './useRememberedDevicesAdmin'
import {
  readRemoteConnectErrorMessage,
  resolveAppWorkspaceVisibility,
  resolveRemoteAccessConnectionCommitPlan,
  resolveRemoteAccessResetPlan,
  resolveRemoteRememberedDeviceDraftChangePlan,
  resolveRemoteRootSelectionCommitPlan,
  resolveRemoteWorkspaceRestorePlan,
  type RemoteAccessConnectionCommitPlan,
  type RemoteAccessResetPlan,
} from '@/lib/appAccessModel'
import {
  clearRemoteSession,
  getActiveRemoteWorkspace,
  getRemoteSessionInvalidatedEventName,
  setActiveRemoteWorkspace,
  type AccessProvider,
} from '@/lib/accessState'
import {
  clearRemoteAccessSession,
  createRemoteAccessSession,
  loadRemoteAccessCapabilities,
  loadRemoteAccessRoots,
  type RemoteRootEntry,
} from '@/lib/remoteAccess'

interface UseRemoteAccessControllerParams {
  accessProvider: AccessProvider
  updateAccessProvider: (nextProvider: AccessProvider) => void
  localRootId: string | null
  isLoopbackUi: boolean
}

export function useRemoteAccessController({
  accessProvider,
  updateAccessProvider,
  localRootId,
  isLoopbackUi,
}: UseRemoteAccessControllerParams) {
  const [remoteStep, setRemoteStep] = useState<'idle' | 'token' | 'roots'>('idle')
  const [remoteToken, setRemoteToken] = useState('')
  const [rememberRemoteDevice, setRememberRemoteDevice] = useState(false)
  const [rememberRemoteDeviceLabel, setRememberRemoteDeviceLabel] = useState('')
  const [remoteRoots, setRemoteRoots] = useState<RemoteRootEntry[]>([])
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [activeRemoteWorkspace, setActiveRemoteWorkspaceState] = useState(() => getActiveRemoteWorkspace())
  const remoteFileSystem = useRemoteFileSystem({
    roots: remoteRoots,
    initialConfigRootId: activeRemoteWorkspace?.configRootId ?? '',
  })
  const {
    shouldShowRemoteWorkspace,
    shouldShowStartupScreen,
  } = resolveAppWorkspaceVisibility({
    accessProvider,
    activeRemoteWorkspace,
    localRootId,
  })
  const rememberedDevicesAdmin = useRememberedDevicesAdmin({
    isLoopbackUi,
    shouldShowStartupScreen,
  })

  const applyRemoteAccessResetPlan = useCallback((plan: RemoteAccessResetPlan) => {
    if (plan.clearActiveRemoteWorkspace) {
      setActiveRemoteWorkspaceState(null)
    }
    setRemoteRoots(plan.remoteRoots)
    setRemoteToken(plan.remoteToken)
    setRememberRemoteDevice(plan.rememberRemoteDevice)
    setRememberRemoteDeviceLabel(plan.rememberRemoteDeviceLabel)
    setRemoteStep(plan.remoteStep)
    if ('remoteError' in plan) {
      setRemoteError(plan.remoteError ?? null)
    }
    if (plan.nextAccessProvider) {
      updateAccessProvider(plan.nextAccessProvider)
    }
  }, [updateAccessProvider])

  const applyRemoteAccessConnectionCommitPlan = useCallback((
    plan: Extract<RemoteAccessConnectionCommitPlan, { kind: 'commit' }>
  ) => {
    if (plan.clearConnectionDraft) {
      setRemoteToken('')
      setRememberRemoteDevice(false)
      setRememberRemoteDeviceLabel('')
    }
    setRemoteRoots(plan.remoteRoots)
    if (plan.activeRemoteRoot) {
      setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(
        plan.activeRemoteRoot.id,
        plan.activeRemoteRoot.label,
      ))
    }
    setRemoteStep(plan.remoteStep)
    if (plan.nextAccessProvider) {
      updateAccessProvider(plan.nextAccessProvider)
    }
  }, [updateAccessProvider])

  const handleRememberRemoteDeviceChange = useCallback((value: boolean) => {
    const plan = resolveRemoteRememberedDeviceDraftChangePlan({
      nextRememberDevice: value,
      currentDeviceLabel: rememberRemoteDeviceLabel,
    })
    setRememberRemoteDevice(plan.rememberRemoteDevice)
    setRememberRemoteDeviceLabel(plan.rememberRemoteDeviceLabel)
  }, [rememberRemoteDeviceLabel])

  useEffect(() => {
    const storedWorkspace = getActiveRemoteWorkspace()
    if (accessProvider !== 'remote-readonly' || !storedWorkspace) {
      return
    }

    let cancelled = false
    const restoreRemoteWorkspace = async () => {
      setIsRemoteLoading(true)
      setRemoteError(null)
      setRemoteStep('token')
      try {
        const capabilities = await loadRemoteAccessCapabilities()
        if (!capabilities.enabled) {
          throw new Error('当前站点未启用远程只读访问')
        }
        const roots = await loadRemoteAccessRoots()
        if (cancelled) return
        setRemoteRoots(roots)
        const restorePlan = resolveRemoteWorkspaceRestorePlan({
          activeRemoteWorkspace: storedWorkspace,
          roots,
        })
        if (restorePlan.kind === 'error') {
          throw new Error(restorePlan.message)
        }
        setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(
          restorePlan.root.id,
          restorePlan.root.label,
        ))
      } catch (error) {
        if (cancelled) return
        clearRemoteSession()
        applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({
          reason: 'restore-failed',
          remoteError: readRemoteConnectErrorMessage(error, '远程会话恢复失败'),
        }))
      } finally {
        if (!cancelled) {
          setIsRemoteLoading(false)
        }
      }
    }

    void restoreRemoteWorkspace()
    return () => {
      cancelled = true
    }
  }, [accessProvider, applyRemoteAccessResetPlan])

  useEffect(() => {
    const eventName = getRemoteSessionInvalidatedEventName()
    const handleRemoteSessionInvalidated = () => {
      applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'session-invalidated' }))
    }

    window.addEventListener(eventName, handleRemoteSessionInvalidated)
    return () => window.removeEventListener(eventName, handleRemoteSessionInvalidated)
  }, [applyRemoteAccessResetPlan])

  const handleOpenRemoteConnect = useCallback(() => {
    const openRemoteConnect = async () => {
      setIsRemoteLoading(true)
      applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'open-connect' }))

      try {
        const capabilities = await loadRemoteAccessCapabilities()
        if (!capabilities.enabled) {
          throw new Error('当前站点未启用远程只读访问')
        }

        const roots = await loadRemoteAccessRoots(2000, {
          clearSessionOnUnauthorized: false,
        })
        const plan = resolveRemoteAccessConnectionCommitPlan({
          roots,
          clearConnectionDraft: false,
        })
        if (plan.kind === 'error') {
          throw new Error(plan.message)
        }
        applyRemoteAccessConnectionCommitPlan(plan)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'REMOTE_UNAUTHORIZED') {
          setRemoteStep('token')
          return
        }
        setRemoteError(readRemoteConnectErrorMessage(error, '远程连接失败'))
      } finally {
        setIsRemoteLoading(false)
      }
    }

    void openRemoteConnect()
  }, [applyRemoteAccessConnectionCommitPlan, applyRemoteAccessResetPlan])

  const handleCancelRemoteConnect = useCallback(() => {
    applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'cancel-connect' }))
  }, [applyRemoteAccessResetPlan])

  const handleSubmitRemoteToken = useCallback(async () => {
    const normalizedToken = remoteToken.trim()
    if (!normalizedToken) return

    setIsRemoteLoading(true)
    setRemoteError(null)
    try {
      const capabilities = await loadRemoteAccessCapabilities()
      if (!capabilities.enabled) {
        throw new Error('当前站点未启用远程只读访问')
      }

      await createRemoteAccessSession(normalizedToken, {
        rememberDevice: rememberRemoteDevice,
        rememberDeviceLabel: rememberRemoteDeviceLabel,
      })
      const roots = await loadRemoteAccessRoots()
      const plan = resolveRemoteAccessConnectionCommitPlan({
        roots,
        clearConnectionDraft: true,
      })
      if (plan.kind === 'error') {
        throw new Error(plan.message)
      }

      applyRemoteAccessConnectionCommitPlan(plan)
    } catch (error) {
      setRemoteError(readRemoteConnectErrorMessage(
        error,
        '远程连接失败',
        '远程 token 无效，或当前站点未启用远程只读访问'
      ))
    } finally {
      setIsRemoteLoading(false)
    }
  }, [
    applyRemoteAccessConnectionCommitPlan,
    rememberRemoteDevice,
    rememberRemoteDeviceLabel,
    remoteToken,
  ])

  const handleSelectRemoteRoot = useCallback((root: RemoteRootEntry) => {
    const plan = resolveRemoteRootSelectionCommitPlan(root)
    setRemoteError(plan.remoteError)
    setActiveRemoteWorkspaceState(setActiveRemoteWorkspace(
      plan.activeRemoteRoot.id,
      plan.activeRemoteRoot.label,
    ))
    updateAccessProvider(plan.nextAccessProvider)
  }, [updateAccessProvider])

  const handleDisconnectRemoteWorkspace = useCallback(() => {
    void clearRemoteAccessSession().catch(() => undefined)
    clearRemoteSession()
    applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'disconnect-workspace' }))
  }, [applyRemoteAccessResetPlan])

  const handleForgetRemoteDevice = useCallback(() => {
    const forgetRemoteDevice = async () => {
      try {
        await clearRemoteAccessSession({
          forgetDevice: true,
        })
      } catch (error) {
        setRemoteError(readRemoteConnectErrorMessage(error, '忘记此设备失败'))
      } finally {
        clearRemoteSession()
        applyRemoteAccessResetPlan(resolveRemoteAccessResetPlan({ reason: 'forget-device' }))
      }
    }

    void forgetRemoteDevice()
  }, [applyRemoteAccessResetPlan])

  return {
    activeRemoteWorkspace,
    remoteFileSystem,
    remoteStep,
    remoteToken,
    remoteError,
    remoteRoots,
    rememberRemoteDevice,
    rememberRemoteDeviceLabel,
    isRemoteLoading,
    isRememberedDevicesAdminOpen: rememberedDevicesAdmin.isOpen,
    rememberedDevices: rememberedDevicesAdmin.items,
    rememberedDevicesError: rememberedDevicesAdmin.error,
    isRememberedDevicesLoading: rememberedDevicesAdmin.isLoading,
    isRememberedDevicesMutating: rememberedDevicesAdmin.isMutating,
    shouldShowRemoteWorkspace,
    shouldShowStartupScreen,
    showRememberedDevicesAdminEntry: rememberedDevicesAdmin.showEntry,
    setRemoteToken,
    setRememberRemoteDeviceLabel,
    handleRememberRemoteDeviceChange,
    handleOpenRemoteConnect,
    handleCancelRemoteConnect,
    handleSubmitRemoteToken,
    handleSelectRemoteRoot,
    handleDisconnectRemoteWorkspace,
    handleForgetRemoteDevice,
    handleOpenRememberedDevicesAdmin: rememberedDevicesAdmin.open,
    handleCloseRememberedDevicesAdmin: rememberedDevicesAdmin.close,
    handleRenameRememberedDevice: rememberedDevicesAdmin.rename,
    handleRevokeRememberedDevice: rememberedDevicesAdmin.revoke,
    handleRevokeAllRememberedDevices: rememberedDevicesAdmin.revokeAll,
    refreshRememberedDevices: rememberedDevicesAdmin.refresh,
  }
}
