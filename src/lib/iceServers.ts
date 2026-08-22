export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
]

function safeIceUrl(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 512
    && /^(?:stun|stuns|turn|turns):/i.test(value)
    && !/:53(?:\?|$)/i.test(value)
}

export function sanitizeIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return []
  const result: RTCIceServer[] = []
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Partial<RTCIceServer>
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls])
      .filter(safeIceUrl)
      .slice(0, 8)
    if (!urls.length) continue
    const needsCredentials = urls.some((url) => /^turns?:/i.test(url))
    if (needsCredentials && (typeof entry.username !== 'string' || typeof entry.credential !== 'string')) continue
    result.push({
      urls,
      ...(needsCredentials ? {
        username: entry.username!.slice(0, 512),
        credential: entry.credential!.slice(0, 512),
      } : {}),
    })
  }
  return result
}

export function configuredIceServers(serialized?: string, stunUrl?: string): RTCIceServer[] {
  if (serialized) {
    try {
      const parsed = sanitizeIceServers(JSON.parse(serialized))
      if (parsed.length) return parsed
    } catch {
      // Continue with the safe public STUN configuration.
    }
  }
  const configuredStun = safeIceUrl(stunUrl) ? stunUrl : DEFAULT_ICE_SERVERS[0].urls
  return [
    { urls: configuredStun },
    ...DEFAULT_ICE_SERVERS.filter((server) => server.urls !== configuredStun),
  ]
}

export function hasTurnServer(iceServers: RTCIceServer[]) {
  return iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
    return urls.some((url) => /^turns?:/i.test(url))
  })
}

export function rtcConfigurationFor(iceServers: RTCIceServer[]): RTCConfiguration {
  return {
    iceServers,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: 8,
  }
}
