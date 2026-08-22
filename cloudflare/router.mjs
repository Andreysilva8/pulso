const DEFAULT_WORKSPACE_ID = 'pulso'
const INTERNAL_TURN_CLIENT_HEADER = 'x-pulso-turn-client'
const MIN_RATE_LIMIT_SECRET_LENGTH = 32

export function isSiteOffline(env) {
  return String(env.SITE_OFFLINE || '').trim().toLowerCase() === 'true'
}

function offlineResponse() {
  return new Response('Pulso temporariamente fora do ar.', {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

function bytesToBase64Url(value) {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function turnClientKey(request, env, workspaceId) {
  const clientIp = request.headers.get('CF-Connecting-IP')?.trim() || ''
  const secret = typeof env.TURN_RATE_LIMIT_SECRET === 'string'
    ? env.TURN_RATE_LIMIT_SECRET.trim()
    : ''
  if (!clientIp || clientIp.length > 64 || secret.length < MIN_RATE_LIMIT_SECRET_LENGTH) return ''

  const encoder = new TextEncoder()
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    encoder.encode(`${workspaceId}\0${clientIp}`),
  )
  return bytesToBase64Url(signature)
}

export function safeWorkspaceId(value, fallback = DEFAULT_WORKSPACE_ID) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9-]{1,64}$/.test(candidate) ? candidate : fallback
}

export function requestedWorkspaceId(url, env) {
  const fallback = safeWorkspaceId(env.DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID)
  const requested = url.searchParams.get('workspace')
  if (requested == null || requested === '') return { workspaceId: fallback, valid: true }
  const normalized = safeWorkspaceId(requested, '')
  // The public MVP has no authentication yet. Restricting routing to the
  // configured workspace prevents untrusted query strings from creating an
  // unbounded number of Durable Objects and seed records.
  return normalized === fallback
    ? { workspaceId: fallback, valid: true }
    : { workspaceId: '', valid: false }
}

export function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin')
  if (!origin) return false

  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configured.length) return configured.includes(origin)

  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

function workspaceStub(env, workspaceId) {
  const objectId = env.WORKSPACES.idFromName(workspaceId)
  // `sam` is best effort. Today Durable Objects may still be placed outside
  // South America; keeping the hint makes future regional placement automatic.
  return env.WORKSPACES.get(objectId, { locationHint: 'sam' })
}

export async function handleRequest(request, env) {
  if (isSiteOffline(env)) return offlineResponse()

  const url = new URL(request.url)
  const { workspaceId, valid } = requestedWorkspaceId(url, env)

  if (!valid) return Response.json({ ok: false, error: 'Workspace inválido.' }, { status: 400 })

  if (url.pathname === '/api/health') {
    const response = await workspaceStub(env, workspaceId).fetch('https://workspace.internal/__health')
    const payload = await response.json()
    return Response.json({ ...payload, workspaceId })
  }

  if (url.pathname === '/ws') {
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade necessário.', { status: 426 })
    }
    if (!isAllowedOrigin(request, env)) return new Response('Origin não permitida.', { status: 403 })
    const headers = new Headers(request.headers)
    headers.delete(INTERNAL_TURN_CLIENT_HEADER)
    const clientKey = await turnClientKey(request, env, workspaceId)
    if (clientKey) headers.set(INTERNAL_TURN_CLIENT_HEADER, clientKey)
    return workspaceStub(env, workspaceId).fetch(new Request(request, { headers }))
  }

  if (env.ASSETS?.fetch) return env.ASSETS.fetch(request)
  return new Response('Not found', { status: 404 })
}
