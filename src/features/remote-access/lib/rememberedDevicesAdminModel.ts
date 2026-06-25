export type RememberedDevicesAdminStartupPlan =
  | {
    kind: 'check-local-runtime'
  }
  | {
    kind: 'close-admin'
    isLocalRuntimeOnline: false
    isOpen: false
  }

export function resolveRememberedDevicesAdminStartupPlan({
  isLoopbackUi,
  shouldShowStartupScreen,
}: {
  isLoopbackUi: boolean
  shouldShowStartupScreen: boolean
}): RememberedDevicesAdminStartupPlan {
  if (isLoopbackUi && shouldShowStartupScreen) {
    return { kind: 'check-local-runtime' }
  }

  return {
    kind: 'close-admin',
    isLocalRuntimeOnline: false,
    isOpen: false,
  }
}

export function resolveRememberedDevicesAdminEntryVisibility({
  isLoopbackUi,
  isLocalRuntimeOnline,
}: {
  isLoopbackUi: boolean
  isLocalRuntimeOnline: boolean
}): boolean {
  return isLoopbackUi && isLocalRuntimeOnline
}

export function readRememberedDevicesAdminErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
