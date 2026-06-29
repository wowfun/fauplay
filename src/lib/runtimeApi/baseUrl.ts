export function resolveLocalRuntimeBaseUrl(
  getCurrentOrigin: () => string,
): string {
  return getCurrentOrigin()
}
