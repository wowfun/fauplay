import {
  callLocalRuntimeHttp,
  type ToolCallResult,
} from '@/lib/runtimeApi/http'
import {
  callRuntimePluginTool,
  listRuntimePluginTools,
  loadRuntimeCapabilities,
  type RuntimeCapabilitiesSnapshot,
} from '@/lib/runtimeApi/pluginCapabilities'
import {
  type RuntimeToolActionAnnotation,
  type RuntimeToolDescriptor,
  type RuntimeToolOptionAnnotation,
  type RuntimeToolOptionEnumValue,
  type RuntimeToolOptionType,
} from '@/lib/runtimeApi/toolDescriptors'
export {
  callRemoteAccessHttp as callRemoteGatewayHttp,
  clearRemoteAccessSession as clearRemoteGatewaySession,
  createRemoteAccessSession as createRemoteGatewaySession,
  loadRemoteAccessCapabilities as loadRemoteGatewayCapabilities,
  loadRemoteAccessFavorites as loadRemoteGatewayFavorites,
  loadRemoteAccessRoots as loadRemoteGatewayRoots,
  removeRemoteAccessFavorite as removeRemoteGatewayFavorite,
  syncRemotePublishedRootsFromLocalBrowser,
  upsertRemoteAccessFavorite as upsertRemoteGatewayFavorite,
  loadRememberedDevicesAdmin,
  renameRememberedDeviceAdmin,
  revokeAllRememberedDevicesAdmin,
  revokeRememberedDeviceAdmin,
} from '@/lib/remoteAccess'
export type {
  LocalPublishedRootSyncEntry,
  RememberedDeviceAdminEntry,
  RemoteAccessCapabilitiesSnapshot as RemoteCapabilitiesSnapshot,
  RemoteFavoriteEntry,
  RemoteRootEntry,
} from '@/lib/remoteAccess'
export {
  buildFaceCropUrl as buildGatewayFaceCropUrl,
  buildFileContentUrl as buildGatewayFileContentUrl,
  buildFileContentUrlForItem as buildGatewayFileContentUrlForItem,
  buildFileThumbnailUrl as buildGatewayFileThumbnailUrl,
  buildFileThumbnailUrlForItem as buildGatewayFileThumbnailUrlForItem,
  buildRemoteFileContentUrl as buildRemoteGatewayFileContentUrl,
  buildRemoteFileThumbnailUrl as buildRemoteGatewayFileThumbnailUrl,
  loadRemoteTextPreview as loadRemoteGatewayTextPreview,
  loadTextPreview as loadGatewayTextPreview,
  loadTextPreviewForItem as loadGatewayTextPreviewForItem,
} from '@/lib/fileAccess'
export type { ToolCallResult } from '@/lib/runtimeApi/http'

export const callGatewayHttp = callLocalRuntimeHttp

export type GatewayToolDescriptor = RuntimeToolDescriptor
export type ToolOptionEnumValue = RuntimeToolOptionEnumValue
export type ToolOptionType = RuntimeToolOptionType
export type ToolOptionAnnotation = RuntimeToolOptionAnnotation
export type ToolActionAnnotation = RuntimeToolActionAnnotation

export type GatewayCapabilitiesSnapshot = RuntimeCapabilitiesSnapshot

export async function listGatewayTools(timeoutMs: number = 2000): Promise<GatewayToolDescriptor[]> {
  return listRuntimePluginTools(timeoutMs)
}

export async function callGatewayTool<T = ToolCallResult>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  return callRuntimePluginTool<T>(toolName, args, timeoutMs)
}

export async function loadGatewayCapabilities(timeoutMs: number = 2000): Promise<GatewayCapabilitiesSnapshot> {
  return loadRuntimeCapabilities(timeoutMs)
}
