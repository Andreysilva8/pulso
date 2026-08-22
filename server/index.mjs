import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import { generateCloudflareIceServers } from './turn.mjs'

const currentFile = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFile)
const projectRoot = path.resolve(currentDir, '..')
const distDir = path.join(projectRoot, 'dist')
const portArg = process.argv.find((value) => value.startsWith('--port='))
const port = Number(portArg?.split('=')[1] || process.env.PORT || 4173)
const host = process.env.HOST || '127.0.0.1'
const maxClients = Number(process.env.MAX_CLIENTS || 100)
const cloudflareTurnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID || ''
const cloudflareTurnApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN || ''
const cloudflareTurnTtl = Number(process.env.CLOUDFLARE_TURN_TTL || 3_600)
const MAX_RELAY_FRAME_LENGTH = 22_000
const MAX_RELAY_BYTES_PER_WINDOW = 6 * 1024 * 1024
// A 30 fps compatibility stream plus 4096-sample audio chunks produces about
// 42 media messages/s. The byte, frame and audio validators below remain the
// effective media limits; this ceiling protects signaling without closing a
// valid relay after a few seconds.
const MAX_MESSAGES_PER_WINDOW = 600
const MAX_MEDIA_BUFFERED_AMOUNT = 512 * 1024
const MAX_CONTROL_BUFFERED_AMOUNT = 2 * 1024 * 1024
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT deve ser um número entre 1 e 65535.')
}

if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 10_000) {
  throw new Error('MAX_CLIENTS deve ser um número entre 1 e 10000.')
}

const app = express()
app.disable('x-powered-by')

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'pulso-signal', clients: clients.size })
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }))
  app.use((request, response, next) => {
    if (request.method === 'GET' && request.accepts('html')) {
      response.sendFile(path.join(distDir, 'index.html'))
      return
    }
    next()
  })
}

const server = http.createServer(app)
const socketServer = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 160 * 1024,
  verifyClient: ({ origin, req }, done) => {
    let allowed = false
    if (allowedOrigins.size > 0) {
      allowed = Boolean(origin && allowedOrigins.has(origin))
    } else if (origin && req.headers.host) {
      try {
        allowed = new URL(origin).host === req.headers.host
      } catch {
        allowed = false
      }
    }
    done(Boolean(allowed), allowed ? 101 : 403, allowed ? undefined : 'Origin não permitida')
  },
})

const clients = new Map()
const messagesByChannel = new Map()
const MAX_HISTORY = 100

const palette = ['#ff816f', '#3bd6c6', '#ffc65c', '#80a8ff', '#d699ff']
const now = Date.now()

function seedMessage(channelId, name, initials, text, minutesAgo, colorIndex) {
  return {
    id: crypto.randomUUID(),
    channelId,
    senderId: `seed-${name.toLowerCase()}`,
    senderName: name,
    senderColor: palette[colorIndex % palette.length],
    senderInitials: initials,
    text,
    sentAt: now - minutesAgo * 60_000,
  }
}

messagesByChannel.set('geral', [
  seedMessage('geral', 'Lia', 'LI', 'Bom dia, Pulso! Deixei o roteiro da apresentação fixado. Hoje a gente fecha o lançamento ✦', 38, 1),
  seedMessage('geral', 'Davi', 'DA', 'Vou abrir a sala Café às 18h para quem quiser revisar junto.', 23, 2),
  seedMessage('geral', 'Maya', 'MA', 'A identidade nova ficou linda. O coral com menta tem muita energia.', 9, 0),
])
messagesByChannel.set('novidades', [
  seedMessage('novidades', 'Pulso', 'PU', 'Agora você pode iniciar chamadas, ligar a câmera e transmitir sua tela diretamente da sala.', 52, 1),
])
messagesByChannel.set('ideias', [
  seedMessage('ideias', 'Noah', 'NO', 'Ideia do dia: uma sessão aberta de co-criação toda sexta, com música e câmera opcional.', 17, 3),
])

function isChannelId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,48}$/.test(value)
}

function safeProfile(value) {
  const name = typeof value?.name === 'string' ? value.name.trim().slice(0, 32) : 'Visitante'
  const initials = typeof value?.initials === 'string'
    ? value.initials.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()
    : name.slice(0, 2).toUpperCase()
  const color = typeof value?.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
    ? value.color
    : palette[0]
  return { name: name || 'Visitante', initials: initials || 'VI', color }
}

function send(client, payload, { droppable = false, serialized = null } = {}) {
  if (client.socket.readyState !== WebSocket.OPEN) return false
  if (droppable && client.socket.bufferedAmount > MAX_MEDIA_BUFFERED_AMOUNT) return false
  if (!droppable && client.socket.bufferedAmount > MAX_CONTROL_BUFFERED_AMOUNT) {
    client.socket.close(1013, 'Conexão congestionada')
    return false
  }
  try {
    client.socket.send(serialized || JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function broadcast(payload, predicate = () => true, options = {}) {
  const serialized = JSON.stringify(payload)
  for (const client of clients.values()) {
    if (client.profile && predicate(client)) send(client, payload, { ...options, serialized })
  }
}

function safeSignalPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.description) {
    const { type, sdp } = payload.description
    if (!['offer', 'answer'].includes(type) || typeof sdp !== 'string' || sdp.length > 64_000) return null
    return { description: { type, sdp } }
  }
  if (payload.candidate) {
    const candidate = payload.candidate
    if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4_096) return null
    if (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 64)) return null
    if (candidate.sdpMLineIndex != null
      && (!Number.isSafeInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 32)) return null
    if (candidate.usernameFragment != null
      && (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256)) return null
    return {
      candidate: {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        usernameFragment: candidate.usernameFragment ?? null,
      },
    }
  }
  return null
}

function relayTargets(client, rawTargets) {
  if (!Array.isArray(rawTargets)) return new Set()
  return new Set(rawTargets
    .filter((target) => typeof target === 'string')
    .slice(0, 12)
    .filter((target) => {
      const recipient = clients.get(target)
      return recipient?.callChannelId === client.callChannelId && recipient.id !== client.id
    }))
}

function consumeRelayBudget(client, bytes, now) {
  if (now - client.relayWindowStartedAt >= 10_000) {
    client.relayWindowStartedAt = now
    client.relayBytesInWindow = 0
  }
  if (client.relayBytesInWindow + bytes > MAX_RELAY_BYTES_PER_WINDOW) return false
  client.relayBytesInWindow += bytes
  return true
}

function presenceMembers() {
  return [...clients.values()]
    .filter((client) => client.profile)
    .map((client) => ({
      id: client.id,
      ...client.profile,
      activeChannelId: client.activeChannelId,
      connectedAt: client.connectedAt,
    }))
}

function callParticipants(channelId) {
  return [...clients.values()]
    .filter((client) => client.profile && client.callChannelId === channelId)
    .map((client) => ({
      id: client.id,
      channelId,
      ...client.profile,
      media: client.media,
      joinedAt: client.callJoinedAt,
    }))
}

async function refreshTurnCredentials(client) {
  if (
    !cloudflareTurnKeyId
    || !cloudflareTurnApiToken
    || !client.profile
    || !client.callChannelId
    || client.socket.readyState !== WebSocket.OPEN
  ) return
  try {
    const config = await generateCloudflareIceServers({
      keyId: cloudflareTurnKeyId,
      apiToken: cloudflareTurnApiToken,
      ttl: cloudflareTurnTtl,
    })
    if (!config || client.socket.readyState !== WebSocket.OPEN) return
    send(client, {
      type: 'session:ice-servers',
      iceServers: config.iceServers,
      expiresAt: config.expiresAt,
    })
    const refreshIn = Math.max(5 * 60_000, Math.floor(config.ttlSeconds * 1_000 * 0.75))
    client.turnRefreshTimer = setTimeout(() => { void refreshTurnCredentials(client) }, refreshIn)
  } catch (error) {
    console.warn('TURN temporário indisponível; mantendo conexão direta/STUN.', error.message)
    if (client.socket.readyState === WebSocket.OPEN) {
      client.turnRefreshTimer = setTimeout(() => { void refreshTurnCredentials(client) }, 60_000)
    }
  }
}

function callsSnapshot() {
  const result = {}
  for (const client of clients.values()) {
    if (!client.callChannelId || result[client.callChannelId]) continue
    result[client.callChannelId] = callParticipants(client.callChannelId)
  }
  return result
}

function messagesSnapshot() {
  return Object.fromEntries(messagesByChannel.entries())
}

function broadcastPresence() {
  broadcast({ type: 'workspace:presence', members: presenceMembers() })
}

function broadcastCallPresence(channelId) {
  if (!channelId) return
  broadcast({
    type: 'call:presence',
    channelId,
    participants: callParticipants(channelId),
  })
}

function leaveCall(client) {
  const channelId = client.callChannelId
  if (!channelId) return

  if (client.turnRefreshTimer) {
    clearTimeout(client.turnRefreshTimer)
    client.turnRefreshTimer = null
  }

  if (client.media.screen) {
    broadcast(
      { type: 'call:screen-stop', channelId, from: client.id },
      (other) => other.callChannelId === channelId && other.id !== client.id,
    )
  }

  client.callChannelId = null
  client.callJoinedAt = null
  client.media = { microphone: false, camera: false, screen: false, screenAudio: false }

  broadcast(
    { type: 'call:peer-left', channelId, peerId: client.id },
    (other) => other.callChannelId === channelId && other.id !== client.id,
  )
  broadcastCallPresence(channelId)
}

function handleMessage(client, rawData) {
  const messageWindowNow = Date.now()
  if (messageWindowNow - client.messageWindowStartedAt >= 10_000) {
    client.messageWindowStartedAt = messageWindowNow
    client.messagesInWindow = 0
  }
  client.messagesInWindow += 1
  if (client.messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
    client.socket.close(1008, 'Limite de mensagens excedido')
    return
  }

  let message
  try {
    message = JSON.parse(rawData.toString())
  } catch {
    send(client, { type: 'error', message: 'Mensagem de sinalização inválida.' })
    return
  }

  if (!message || typeof message.type !== 'string') return

  switch (message.type) {
    case 'workspace:join': {
      client.profile = safeProfile(message.profile)
      client.activeChannelId = isChannelId(message.activeChannelId) ? message.activeChannelId : 'geral'
      send(client, {
        type: 'workspace:state',
        clientId: client.id,
        members: presenceMembers(),
        calls: callsSnapshot(),
        messages: messagesSnapshot(),
      })
      broadcastPresence()
      break
    }

    case 'workspace:update-profile': {
      if (!client.profile) return
      client.profile = safeProfile(message.profile)
      broadcastPresence()
      if (client.callChannelId) broadcastCallPresence(client.callChannelId)
      break
    }

    case 'channel:select': {
      if (!client.profile || !isChannelId(message.channelId)) return
      client.activeChannelId = message.channelId
      broadcastPresence()
      break
    }

    case 'chat:send': {
      if (!client.profile || !isChannelId(message.channelId)) return
      const text = typeof message.text === 'string' ? message.text.trim().slice(0, 2_000) : ''
      if (!text) return
      if (Date.now() - client.lastChatAt < 250) return
      client.lastChatAt = Date.now()

      const chatMessage = {
        id: crypto.randomUUID(),
        channelId: message.channelId,
        senderId: client.id,
        senderName: client.profile.name,
        senderColor: client.profile.color,
        senderInitials: client.profile.initials,
        text,
        sentAt: Date.now(),
      }
      const history = messagesByChannel.get(message.channelId) || []
      history.push(chatMessage)
      messagesByChannel.set(message.channelId, history.slice(-MAX_HISTORY))
      broadcast({ type: 'chat:message', message: chatMessage })
      break
    }

    case 'chat:typing': {
      if (!client.profile || !isChannelId(message.channelId)) return
      broadcast(
        {
          type: 'chat:typing',
          channelId: message.channelId,
          member: { id: client.id, name: client.profile.name },
          active: Boolean(message.active),
        },
        (other) => other.id !== client.id,
      )
      break
    }

    case 'call:join': {
      if (!client.profile || !isChannelId(message.channelId)) return
      if (client.callChannelId) leaveCall(client)

      const existingPeers = callParticipants(message.channelId)
      client.callChannelId = message.channelId
      client.callJoinedAt = Date.now()
      const sharingScreen = Boolean(message.media?.screen)
      client.media = {
        microphone: Boolean(message.media?.microphone),
        camera: Boolean(message.media?.camera),
        screen: sharingScreen,
        screenAudio: Boolean(sharingScreen && message.media?.screenAudio),
      }
      client.lastScreenAudioSequence = -1
      send(client, { type: 'call:peers', channelId: message.channelId, peers: existingPeers })
      // TURN credentials are only issued to clients that have completed the
      // workspace handshake and joined a real call, never to idle sockets.
      void refreshTurnCredentials(client)
      broadcastCallPresence(message.channelId)
      break
    }

    case 'call:update': {
      if (!client.profile || !client.callChannelId) return
      const wasSharingScreen = client.media.screen
      const sharingScreen = Boolean(message.media?.screen)
      client.media = {
        microphone: Boolean(message.media?.microphone),
        camera: Boolean(message.media?.camera),
        screen: sharingScreen,
        screenAudio: Boolean(sharingScreen && message.media?.screenAudio),
      }
      if (sharingScreen !== wasSharingScreen) client.lastScreenAudioSequence = -1
      broadcastCallPresence(client.callChannelId)
      break
    }

    case 'call:signal': {
      if (!client.profile || !client.callChannelId || typeof message.target !== 'string') return
      const target = clients.get(message.target)
      if (!target || target.callChannelId !== client.callChannelId) return
      const payload = safeSignalPayload(message.payload)
      if (!payload) return
      send(target, {
        type: 'call:signal',
        channelId: client.callChannelId,
        from: client.id,
        payload,
      })
      break
    }

    case 'call:screen-relay-request':
    case 'call:screen-relay-release': {
      if (!client.profile || !client.callChannelId || typeof message.target !== 'string') return
      const target = clients.get(message.target)
      if (!target || target.callChannelId !== client.callChannelId || !target.media.screen) return
      send(target, {
        type: message.type,
        channelId: client.callChannelId,
        from: client.id,
      })
      break
    }

    case 'call:screen-frame': {
      if (!client.profile || !client.callChannelId || !client.media.screen) return
      const targets = relayTargets(client, message.targets)
      if (!targets.size) return
      const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : ''
      const relayFrameRate = Number(message.frameRate)
      if (!Number.isSafeInteger(relayFrameRate) || relayFrameRate < 1 || relayFrameRate > 30) return
      if (dataUrl.length > MAX_RELAY_FRAME_LENGTH || !/^data:image\/(?:webp|jpeg);base64,[a-z0-9+/=]+$/i.test(dataUrl)) return
      if (messageWindowNow - client.lastScreenFrameAt < 30) return
      if (!consumeRelayBudget(client, dataUrl.length, messageWindowNow)) return
      client.lastScreenFrameAt = messageWindowNow
      broadcast(
        {
          type: 'call:screen-frame',
          channelId: client.callChannelId,
          from: client.id,
          dataUrl,
          frameRate: relayFrameRate,
        },
        (other) => targets.has(other.id),
        { droppable: true },
      )
      break
    }

    case 'call:screen-audio': {
      if (!client.profile || !client.callChannelId || !client.media.screen || !client.media.screenAudio) return
      const targets = relayTargets(client, message.targets)
      if (!targets.size) return
      const pcm = typeof message.pcm === 'string' ? message.pcm : ''
      const sampleRate = Number(message.sampleRate)
      const sequence = Number(message.sequence)
      if (!pcm || pcm.length > 5_200 || pcm.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(pcm)) return
      let pcmBytes
      try {
        pcmBytes = Buffer.from(pcm, 'base64')
      } catch {
        return
      }
      if (pcmBytes.toString('base64') !== pcm || pcmBytes.length < 1_280
        || pcmBytes.length > 3_840 || pcmBytes.length % 2 !== 0) return
      if (sampleRate !== 16_000 || !Number.isSafeInteger(sequence)
        || sequence <= client.lastScreenAudioSequence) return
      if (messageWindowNow - client.lastScreenAudioAt < 55) return
      if (!consumeRelayBudget(client, pcm.length, messageWindowNow)) return
      client.lastScreenAudioAt = messageWindowNow
      client.lastScreenAudioSequence = sequence
      broadcast(
        { type: 'call:screen-audio', channelId: client.callChannelId, from: client.id, pcm, sampleRate, sequence },
        (other) => targets.has(other.id),
        { droppable: true },
      )
      break
    }

    case 'call:screen-stop': {
      if (!client.profile || !client.callChannelId) return
      broadcast(
        { type: 'call:screen-stop', channelId: client.callChannelId, from: client.id },
        (other) => other.callChannelId === client.callChannelId && other.id !== client.id,
      )
      break
    }

    case 'call:leave':
      leaveCall(client)
      break

    case 'ping':
      send(client, { type: 'pong', at: Date.now() })
      break
  }
}

socketServer.on('connection', (socket) => {
  if (clients.size >= maxClients) {
    socket.close(1013, 'Servidor temporariamente cheio')
    return
  }

  const id = crypto.randomUUID()
  const client = {
    id,
    socket,
    profile: null,
    activeChannelId: 'geral',
    callChannelId: null,
    callJoinedAt: null,
    media: { microphone: false, camera: false, screen: false, screenAudio: false },
    connectedAt: Date.now(),
    lastChatAt: 0,
    messageWindowStartedAt: Date.now(),
    messagesInWindow: 0,
    relayWindowStartedAt: Date.now(),
    relayBytesInWindow: 0,
    lastScreenFrameAt: 0,
    lastScreenAudioAt: 0,
    lastScreenAudioSequence: -1,
    turnRefreshTimer: null,
    isAlive: true,
  }
  clients.set(id, client)

  send(client, { type: 'session:ready', clientId: id })
  socket.on('message', (data) => handleMessage(client, data))
  socket.on('pong', () => { client.isAlive = true })
  socket.on('close', () => {
    if (client.turnRefreshTimer) clearTimeout(client.turnRefreshTimer)
    leaveCall(client)
    clients.delete(id)
    broadcastPresence()
  })
  socket.on('error', () => {
    // The close handler performs all shared-state cleanup.
  })
})

const heartbeat = setInterval(() => {
  for (const client of clients.values()) {
    if (!client.isAlive) {
      client.socket.terminate()
      continue
    }
    client.isAlive = false
    client.socket.ping()
  }
}, 30_000)

socketServer.on('close', () => clearInterval(heartbeat))

server.listen(port, host, () => {
  console.log(`Pulso disponível em http://${host}:${port}`)
})

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} recebido; encerrando conexões.`)
  clearInterval(heartbeat)

  for (const client of clients.values()) {
    client.socket.close(1012, 'Servidor reiniciando')
  }

  socketServer.close(() => {
    server.close(() => process.exit(0))
  })

  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
