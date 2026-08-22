const CLOUDFLARE_TURN_ENDPOINT = 'https://rtc.live.cloudflare.com/v1/turn/keys'
const MIN_TTL_SECONDS = 600
const MAX_TTL_SECONDS = 172_800

function safeTurnTtl(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 3_600
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.floor(parsed)))
}

function safeIceUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return false
  if (!/^(?:stun|stuns|turn|turns):/i.test(value)) return false
  // Port 53 is commonly blocked by browsers and only delays ICE gathering.
  return !/:53(?:\?|$)/i.test(value)
}

export function sanitizeIceServers(value) {
  if (!Array.isArray(value)) return []
  const result = []
  for (const entry of value.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue
    const rawUrls = Array.isArray(entry.urls) ? entry.urls : [entry.urls]
    const urls = rawUrls.filter(safeIceUrl).slice(0, 8)
    if (!urls.length) continue
    const needsCredentials = urls.some((url) => /^turns?:/i.test(url))
    if (needsCredentials && (typeof entry.username !== 'string' || typeof entry.credential !== 'string')) continue
    result.push({
      urls,
      ...(needsCredentials ? {
        username: entry.username.slice(0, 512),
        credential: entry.credential.slice(0, 512),
      } : {}),
    })
  }
  return result
}

export async function generateCloudflareIceServers({
  keyId,
  apiToken,
  ttl = 3_600,
  fetchImpl = fetch,
}) {
  if (!keyId || !apiToken) return null
  const ttlSeconds = safeTurnTtl(ttl)
  const response = await fetchImpl(
    `${CLOUDFLARE_TURN_ENDPOINT}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ttl: ttlSeconds }),
      signal: AbortSignal.timeout(8_000),
    },
  )
  if (response.status !== 201) throw new Error(`Cloudflare TURN respondeu ${response.status}.`)
  const payload = await response.json()
  const iceServers = sanitizeIceServers(payload?.iceServers)
  if (!iceServers.some((server) => server.urls.some((url) => /^turns?:/i.test(url)))) {
    throw new Error('A Cloudflare não retornou um servidor TURN válido.')
  }
  return {
    iceServers,
    expiresAt: Date.now() + ttlSeconds * 1_000,
    ttlSeconds,
  }
}
