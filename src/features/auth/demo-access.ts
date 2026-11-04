const webProtocols = new Set(['https:', 'http:']);

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Demo runs on a separate origin so its mock session cannot replace the API session. */
export function getDemoAccessUrl(configured: unknown, currentLocation: string): string | undefined {
  if (typeof configured !== 'string' || !configured.trim()) return undefined;
  try {
    const current = new URL(currentLocation);
    const destination = new URL(configured.trim());
    if (!webProtocols.has(current.protocol) || !webProtocols.has(destination.protocol)) return undefined;
    if (destination.username || destination.password || destination.origin === current.origin) return undefined;
    if (destination.protocol === 'http:' && !isLoopback(destination.hostname)) return undefined;
    destination.searchParams.set('demonstracao', 'perfis');
    return destination.href;
  } catch {
    return undefined;
  }
}
