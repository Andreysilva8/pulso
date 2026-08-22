import { generateCloudflareIceServers } from '../server/turn.mjs'

const SOCKET_OPEN = 1
const MAX_PAYLOAD_BYTES = 160 * 1024
const MAX_HISTORY = 100
const MAX_RELAY_FRAME_LENGTH = 22_000
const MAX_RELAY_BYTES_PER_WINDOW = 6 * 1024 * 1024
const MAX_MESSAGES_PER_WINDOW = 600
const MAX_MEDIA_BUFFERED_AMOUNT = 512 * 1024
const MAX_CONTROL_BUFFERED_AMOUNT = 2 * 1024 * 1024
const MAX_RELAY_FRAMES_IN_FLIGHT = 4
const MAX_RELAY_AUDIO_IN_FLIGHT = 3
const RELAY_FRAME_ACK_TIMEOUT_MS = 1_200
const RELAY_AUDIO_ACK_TIMEOUT_MS = 900
const ATTACHMENT_VERSION = 1
const MESSAGES_INDEX_KEY = 'messages:index:v1'
const MESSAGES_CHANNEL_PREFIX = 'messages:channel:v1:'
const MAX_STORED_CHANNELS = 32

const palette = ['#ff816f', '#3bd6c6', '#ffc65c', '#80a8ff', '#d699ff']

function defaultMedia() {
  return { microphone: false, camera: false, screen: false, screenAudio: false }
}

function seedMessage(channelId, name, initials, text, minutesAgo, colorIndex, now) {
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

function seedMessages() {
  const now = Date.now()
  return {
    geral: [
      seedMessage('geral', 'Lia', 'LI', 'Bom dia, Pulso! Deixei o roteiro da apresentação fixado. Hoje a gente fecha o lançamento ✦', 38, 1, now),
      seedMessage('geral', 'Davi', 'DA', 'Vou abrir a sala Café às 18h para quem quiser revisar junto.', 23, 2, now),
      seedMessage('geral', 'Maya', 'MA', 'A identidade nova ficou linda. O coral com menta tem muita energia.', 9, 0, now),
    ],
    novidades: [
      seedMessage('novidades', 'Pulso', 'PU', 'Agora você pode iniciar chamadas, ligar a câmera e transmitir sua tela diretamente da sala.', 52, 1, now),
    ],
    ideias: [
      seedMessage('ideias', 'Noah', 'NO', 'Ideia do dia: uma sessão aberta de co-criação toda sexta, com música e câmera opcional.', 17, 3, now),
    ],
  }
}

export function createClientState(id = crypto.randomUUID(), now = Date.now()) {
  return {
    attachmentVersion: ATTACHMENT_VERSION,
    id,
    profile: null,
    activeChannelId: 'geral',
    callChannelId: null,
    callJoinedAt: null,
    media: defaultMedia(),
    connectedAt: now,
    lastChatAt: 0,
    messageWindowStartedAt: now,
    messagesInWindow: 0,
    relayWindowStartedAt: now,
    relayBytesInWindow: 0,
    lastScreenFrameAt: 0,
    lastScreenAudioAt: 0,
    lastScreenAudioSequence: -1,
    nextRelayId: 0,
    relayFlowBySender: {},
    turnRefreshAt: 0,
  }
}

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

function parseMaxClients(value) {
  const parsed = Number(value || 100)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) return 100
  return parsed
}

function rawMessageText(value) {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value)
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  return null
}

function canonicalBase64ByteLength(value) {
  try {
    const decoded = atob(value)
    return btoa(decoded) === value ? decoded.length : -1
  } catch {
    return -1
  }
}

function socketIsOpen(socket) {
  return socket?.readyState == null || socket.readyState === SOCKET_OPEN
}

function socketBufferedAmount(socket) {
  return typeof socket?.bufferedAmount === 'number' ? socket.bufferedAmount : 0
}

function pendingRelayItems(value, now) {
  if (!Array.isArray(value)) return { items: [], expired: false }
  const valid = value.filter((item) => Number.isSafeInteger(item?.relayId)
    && item.relayId > 0
    && Number.isFinite(item.expiresAt)
    && item.expiresAt > now)
  return { items: valid, expired: valid.length < value.length }
}

function relayFlowFor(client, senderId, now) {
  const flows = client.relayFlowBySender && typeof client.relayFlowBySender === 'object'
    ? client.relayFlowBySender
    : {}
  const stored = flows[senderId] && typeof flows[senderId] === 'object' ? flows[senderId] : {}
  const pendingFrames = pendingRelayItems(stored.frames, now)
  const pendingAudio = pendingRelayItems(stored.audio, now)
  const flow = {
    frames: pendingFrames.items,
    audio: pendingAudio.items,
    frameRecovering: Boolean(stored.frameRecovering || pendingFrames.expired),
    audioRecovering: Boolean(stored.audioRecovering || pendingAudio.expired),
    lastFrameSent: Number.isSafeInteger(stored.lastFrameSent) ? stored.lastFrameSent : 0,
    lastFrameAcked: Number.isSafeInteger(stored.lastFrameAcked) ? stored.lastFrameAcked : 0,
    lastAudioSent: Number.isSafeInteger(stored.lastAudioSent) ? stored.lastAudioSent : 0,
    lastAudioAcked: Number.isSafeInteger(stored.lastAudioAcked) ? stored.lastAudioAcked : 0,
  }
  flows[senderId] = flow
  client.relayFlowBySender = flows
  return { flow, expired: pendingFrames.expired || pendingAudio.expired }
}

function relayWindowAvailable(flow, kind) {
  if (kind === 'frame') {
    return flow.frames.length < (flow.frameRecovering ? 1 : MAX_RELAY_FRAMES_IN_FLIGHT)
  }
  return flow.audio.length < (flow.audioRecovering ? 1 : MAX_RELAY_AUDIO_IN_FLIGHT)
}

function recordRelayDelivery(flow, kind, relayId, now) {
  if (kind === 'frame') {
    flow.frames.push({ relayId, expiresAt: now + RELAY_FRAME_ACK_TIMEOUT_MS })
    flow.lastFrameSent = relayId
    return
  }
  flow.audio.push({ relayId, expiresAt: now + RELAY_AUDIO_ACK_TIMEOUT_MS })
  flow.lastAudioSent = relayId
}

function acknowledgeRelayDelivery(client, senderId, kind, relayId, now) {
  const stored = client.relayFlowBySender?.[senderId]
  if (!stored || typeof stored !== 'object') return false
  const { flow } = relayFlowFor(client, senderId, now)
  const lastSent = kind === 'frame' ? flow.lastFrameSent : flow.lastAudioSent
  const lastAcked = kind === 'frame' ? flow.lastFrameAcked : flow.lastAudioAcked
  if (relayId <= lastAcked || relayId > lastSent) return false

  if (kind === 'frame') {
    flow.frames = flow.frames.filter((item) => item.relayId > relayId)
    flow.lastFrameAcked = relayId
    flow.frameRecovering = false
  } else {
    flow.audio = flow.audio.filter((item) => item.relayId > relayId)
    flow.lastAudioAcked = relayId
    flow.audioRecovering = false
  }
  return true
}

function nextRelayId(client) {
  const current = Number.isSafeInteger(client.nextRelayId) && client.nextRelayId >= 0
    ? client.nextRelayId
    : 0
  client.nextRelayId = current >= Number.MAX_SAFE_INTEGER - 1 ? 1 : current + 1
  return client.nextRelayId
}

function removeRelayFlow(client, senderId) {
  if (!client.relayFlowBySender?.[senderId]) return false
  delete client.relayFlowBySender[senderId]
  return true
}

export class Workspace {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    this.messagesByChannel = new Map()
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const storedIndex = await this.ctx.storage.get(MESSAGES_INDEX_KEY)
      const channelIds = Array.isArray(storedIndex)
        ? storedIndex.filter(isChannelId).slice(0, MAX_STORED_CHANNELS)
        : []

      if (channelIds.length) {
        for (const channelId of channelIds) {
          const history = await this.ctx.storage.get(`${MESSAGES_CHANNEL_PREFIX}${channelId}`)
          this.messagesByChannel.set(channelId, Array.isArray(history) ? history.slice(-MAX_HISTORY) : [])
        }
        return
      }

      const seeded = seedMessages()
      this.messagesByChannel = new Map(Object.entries(seeded))
      await Promise.all([
        this.ctx.storage.put(MESSAGES_INDEX_KEY, [...this.messagesByChannel.keys()]),
        ...[...this.messagesByChannel.entries()].map(([channelId, history]) => (
          this.ctx.storage.put(`${MESSAGES_CHANNEL_PREFIX}${channelId}`, history)
        )),
      ])
    })
  }

  async fetch(request) {
    await this.ready
    const url = new URL(request.url)

    if (url.pathname === '/__health') {
      return Response.json({
        ok: true,
        service: 'pulso-signal-cloudflare',
        clients: this.entries().length,
      })
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade necessário.', { status: 426 })
    }

    if (this.entries().length >= parseMaxClients(this.env.MAX_CLIENTS_PER_WORKSPACE)) {
      return new Response('Workspace temporariamente cheio.', { status: 503 })
    }

    const pair = new WebSocketPair()
    const [clientSocket, serverSocket] = Object.values(pair)
    this.ctx.acceptWebSocket(serverSocket)

    const client = createClientState()
    this.saveClient(serverSocket, client)
    this.send(serverSocket, { type: 'session:ready', clientId: client.id })

    return new Response(null, { status: 101, webSocket: clientSocket })
  }

  readClient(socket) {
    try {
      const client = socket.deserializeAttachment()
      if (!client || client.attachmentVersion !== ATTACHMENT_VERSION || typeof client.id !== 'string') return null
      return client
    } catch {
      return null
    }
  }

  saveClient(socket, client) {
    socket.serializeAttachment(client)
  }

  entries(excludedSocket = null) {
    const result = []
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excludedSocket || !socketIsOpen(socket)) continue
      const client = this.readClient(socket)
      if (client) result.push({ socket, client })
    }
    return result
  }

  send(socket, payload, { droppable = false, serialized = null } = {}) {
    if (!socketIsOpen(socket)) return false
    const bufferedAmount = socketBufferedAmount(socket)
    if (droppable && bufferedAmount > MAX_MEDIA_BUFFERED_AMOUNT) return false
    if (!droppable && bufferedAmount > MAX_CONTROL_BUFFERED_AMOUNT) {
      try {
        socket.close(1013, 'Conexão congestionada')
      } catch {
        // The runtime will finish closing the WebSocket.
      }
      return false
    }
    try {
      socket.send(serialized || JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  broadcast(payload, predicate = () => true, options = {}, excludedSocket = null) {
    const serialized = JSON.stringify(payload)
    for (const entry of this.entries(excludedSocket)) {
      if (entry.client.profile && predicate(entry.client)) {
        this.send(entry.socket, payload, { ...options, serialized })
      }
    }
  }

  presenceMembers(excludedSocket = null) {
    return this.entries(excludedSocket)
      .map(({ client }) => client)
      .filter((client) => client.profile)
      .map((client) => ({
        id: client.id,
        ...client.profile,
        activeChannelId: client.activeChannelId,
        connectedAt: client.connectedAt,
      }))
  }

  callParticipants(channelId, excludedSocket = null) {
    return this.entries(excludedSocket)
      .map(({ client }) => client)
      .filter((client) => client.profile && client.callChannelId === channelId)
      .map((client) => ({
        id: client.id,
        channelId,
        ...client.profile,
        media: client.media,
        joinedAt: client.callJoinedAt,
      }))
  }

  callsSnapshot() {
    const result = {}
    for (const { client } of this.entries()) {
      if (!client.callChannelId || result[client.callChannelId]) continue
      result[client.callChannelId] = this.callParticipants(client.callChannelId)
    }
    return result
  }

  messagesSnapshot() {
    return Object.fromEntries(this.messagesByChannel.entries())
  }

  async persistChannel(channelId, isNewChannel) {
    const writes = [
      this.ctx.storage.put(`${MESSAGES_CHANNEL_PREFIX}${channelId}`, this.messagesByChannel.get(channelId) || []),
    ]
    if (isNewChannel) writes.push(this.ctx.storage.put(MESSAGES_INDEX_KEY, [...this.messagesByChannel.keys()]))
    await Promise.all(writes)
  }

  broadcastPresence(excludedSocket = null) {
    this.broadcast(
      { type: 'workspace:presence', members: this.presenceMembers(excludedSocket) },
      () => true,
      {},
      excludedSocket,
    )
  }

  broadcastCallPresence(channelId, excludedSocket = null) {
    if (!channelId) return
    this.broadcast(
      { type: 'call:presence', channelId, participants: this.callParticipants(channelId, excludedSocket) },
      () => true,
      {},
      excludedSocket,
    )
  }

  findClient(id) {
    return this.entries().find(({ client }) => client.id === id) || null
  }

  relayTargets(client, rawTargets) {
    if (!Array.isArray(rawTargets)) return new Set()
    const requested = new Set(rawTargets.filter((target) => typeof target === 'string').slice(0, 12))
    return new Set(this.entries()
      .map(({ client: candidate }) => candidate)
      .filter((candidate) => requested.has(candidate.id)
        && candidate.callChannelId === client.callChannelId
        && candidate.id !== client.id)
      .map((candidate) => candidate.id))
  }

  clearRelayFlowsFrom(senderId, channelId, excludedSocket = null) {
    for (const entry of this.entries(excludedSocket)) {
      if (entry.client.callChannelId !== channelId) continue
      if (!removeRelayFlow(entry.client, senderId)) continue
      this.saveClient(entry.socket, entry.client)
    }
  }

  consumeRelayBudget(client, bytes, now) {
    if (now - client.relayWindowStartedAt >= 10_000) {
      client.relayWindowStartedAt = now
      client.relayBytesInWindow = 0
    }
    if (client.relayBytesInWindow + bytes > MAX_RELAY_BYTES_PER_WINDOW) return false
    client.relayBytesInWindow += bytes
    return true
  }

  async maybeRefreshTurn(socket, client, force = false) {
    if (!this.env.CLOUDFLARE_TURN_KEY_ID || !this.env.CLOUDFLARE_TURN_API_TOKEN
      || !client.profile || !client.callChannelId) return
    const now = Date.now()
    if (!force && client.turnRefreshAt > now) return
    const refreshSession = {
      clientId: client.id,
      callChannelId: client.callChannelId,
      callJoinedAt: client.callJoinedAt,
    }
    const currentRefreshClient = () => {
      if (!socketIsOpen(socket) || !this.ctx.getWebSockets().includes(socket)) return null
      const currentClient = this.readClient(socket)
      if (!currentClient
        || currentClient.id !== refreshSession.clientId
        || currentClient.callChannelId !== refreshSession.callChannelId
        || currentClient.callJoinedAt !== refreshSession.callJoinedAt) return null
      return currentClient
    }

    try {
      const config = await generateCloudflareIceServers({
        keyId: this.env.CLOUDFLARE_TURN_KEY_ID,
        apiToken: this.env.CLOUDFLARE_TURN_API_TOKEN,
        ttl: Number(this.env.CLOUDFLARE_TURN_TTL || 3_600),
        fetchImpl: this.env.__TEST_FETCH || fetch,
      })
      const currentClient = currentRefreshClient()
      if (!config || !currentClient) return
      currentClient.turnRefreshAt = now + Math.max(5 * 60_000, Math.floor(config.ttlSeconds * 1_000 * 0.75))
      this.saveClient(socket, currentClient)
      this.send(socket, {
        type: 'session:ice-servers',
        iceServers: config.iceServers,
        expiresAt: config.expiresAt,
      })
    } catch (error) {
      const currentClient = currentRefreshClient()
      if (!currentClient) return
      currentClient.turnRefreshAt = now + 60_000
      this.saveClient(socket, currentClient)
      console.warn('TURN temporário indisponível; mantendo conexão direta/STUN.', error?.message || 'erro desconhecido')
    }
  }

  leaveCall(socket, client, excludedSocket = null) {
    const channelId = client.callChannelId
    if (!channelId) return

    if (client.media.screen) {
      this.broadcast(
        { type: 'call:screen-stop', channelId, from: client.id },
        (other) => other.callChannelId === channelId && other.id !== client.id,
        {},
        excludedSocket,
      )
      this.clearRelayFlowsFrom(client.id, channelId, excludedSocket)
    }

    client.callChannelId = null
    client.callJoinedAt = null
    client.media = defaultMedia()
    client.relayFlowBySender = {}
    client.turnRefreshAt = 0
    this.saveClient(socket, client)

    this.broadcast(
      { type: 'call:peer-left', channelId, peerId: client.id },
      (other) => other.callChannelId === channelId && other.id !== client.id,
      {},
      excludedSocket,
    )
    this.broadcastCallPresence(channelId, excludedSocket)
  }

  async webSocketMessage(socket, rawData) {
    await this.ready
    const client = this.readClient(socket)
    if (!client) {
      try {
        socket.close(1008, 'Sessão inválida')
      } catch {
        // Ignore a socket that is already closing.
      }
      return
    }

    const rawText = rawMessageText(rawData)
    if (rawText == null || new TextEncoder().encode(rawText).byteLength > MAX_PAYLOAD_BYTES) {
      socket.close(1009, 'Mensagem muito grande')
      return
    }

    const messageWindowNow = Date.now()
    if (messageWindowNow - client.messageWindowStartedAt >= 10_000) {
      client.messageWindowStartedAt = messageWindowNow
      client.messagesInWindow = 0
    }
    client.messagesInWindow += 1
    this.saveClient(socket, client)
    if (client.messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
      socket.close(1008, 'Limite de mensagens excedido')
      return
    }

    let message
    try {
      message = JSON.parse(rawText)
    } catch {
      this.send(socket, { type: 'error', message: 'Mensagem de sinalização inválida.' })
      return
    }

    if (!message || typeof message.type !== 'string') return

    switch (message.type) {
      case 'workspace:join': {
        client.profile = safeProfile(message.profile)
        client.activeChannelId = isChannelId(message.activeChannelId) ? message.activeChannelId : 'geral'
        this.saveClient(socket, client)
        this.send(socket, {
          type: 'workspace:state',
          clientId: client.id,
          members: this.presenceMembers(),
          calls: this.callsSnapshot(),
          messages: this.messagesSnapshot(),
        })
        this.broadcastPresence()
        break
      }

      case 'workspace:update-profile': {
        if (!client.profile) return
        client.profile = safeProfile(message.profile)
        this.saveClient(socket, client)
        this.broadcastPresence()
        if (client.callChannelId) this.broadcastCallPresence(client.callChannelId)
        break
      }

      case 'channel:select': {
        if (!client.profile || !isChannelId(message.channelId)) return
        client.activeChannelId = message.channelId
        this.saveClient(socket, client)
        this.broadcastPresence()
        break
      }

      case 'chat:send': {
        if (!client.profile || !isChannelId(message.channelId)) return
        const text = typeof message.text === 'string' ? message.text.trim().slice(0, 2_000) : ''
        if (!text || Date.now() - client.lastChatAt < 250) return
        client.lastChatAt = Date.now()
        this.saveClient(socket, client)

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
        const isNewChannel = !this.messagesByChannel.has(message.channelId)
        if (isNewChannel && this.messagesByChannel.size >= MAX_STORED_CHANNELS) return
        const history = this.messagesByChannel.get(message.channelId) || []
        this.messagesByChannel.set(message.channelId, [...history, chatMessage].slice(-MAX_HISTORY))
        await this.persistChannel(message.channelId, isNewChannel)
        this.broadcast({ type: 'chat:message', message: chatMessage })
        break
      }

      case 'chat:typing': {
        if (!client.profile || !isChannelId(message.channelId)) return
        this.broadcast(
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
        if (client.callChannelId) this.leaveCall(socket, client)

        const existingPeers = this.callParticipants(message.channelId)
        const sharingScreen = Boolean(message.media?.screen)
        client.callChannelId = message.channelId
        client.callJoinedAt = Date.now()
        client.media = {
          microphone: Boolean(message.media?.microphone),
          camera: Boolean(message.media?.camera),
          screen: sharingScreen,
          screenAudio: Boolean(sharingScreen && message.media?.screenAudio),
        }
        client.lastScreenAudioSequence = -1
        client.relayFlowBySender = {}
        client.turnRefreshAt = 0
        this.saveClient(socket, client)
        this.send(socket, { type: 'call:peers', channelId: message.channelId, peers: existingPeers })
        this.broadcastCallPresence(message.channelId)
        await this.maybeRefreshTurn(socket, client, true)
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
        this.saveClient(socket, client)
        if (sharingScreen !== wasSharingScreen) {
          this.clearRelayFlowsFrom(client.id, client.callChannelId, socket)
        }
        this.broadcastCallPresence(client.callChannelId)
        break
      }

      case 'call:signal': {
        if (!client.profile || !client.callChannelId || typeof message.target !== 'string') return
        const target = this.findClient(message.target)
        if (!target || target.client.callChannelId !== client.callChannelId) return
        const payload = safeSignalPayload(message.payload)
        if (!payload) return
        this.send(target.socket, {
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
        const target = this.findClient(message.target)
        if (!target || target.client.callChannelId !== client.callChannelId || !target.client.media.screen) return
        if (message.type === 'call:screen-relay-release' && removeRelayFlow(client, target.client.id)) {
          this.saveClient(socket, client)
        }
        this.send(target.socket, {
          type: message.type,
          channelId: client.callChannelId,
          from: client.id,
        })
        break
      }

      case 'call:screen-frame-ack':
      case 'call:screen-audio-ack': {
        if (!client.profile || !client.callChannelId || typeof message.target !== 'string') return
        const relayId = Number(message.relayId)
        if (!Number.isSafeInteger(relayId) || relayId < 1) return
        const target = this.findClient(message.target)
        if (!target || target.client.callChannelId !== client.callChannelId || !target.client.media.screen) return
        const kind = message.type === 'call:screen-frame-ack' ? 'frame' : 'audio'
        if (acknowledgeRelayDelivery(client, target.client.id, kind, relayId, messageWindowNow)) {
          this.saveClient(socket, client)
        }
        break
      }

      case 'call:screen-frame': {
        if (!client.profile || !client.callChannelId || !client.media.screen) return
        const targets = this.relayTargets(client, message.targets)
        if (!targets.size) return
        const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : ''
        const relayFrameRate = Number(message.frameRate)
        if (!Number.isSafeInteger(relayFrameRate) || relayFrameRate < 1 || relayFrameRate > 30) return
        if (dataUrl.length > MAX_RELAY_FRAME_LENGTH
          || !/^data:image\/(?:webp|jpeg);base64,[a-z0-9+/=]+$/i.test(dataUrl)) return
        if (messageWindowNow - client.lastScreenFrameAt < 30) return
        if (!this.consumeRelayBudget(client, dataUrl.length, messageWindowNow)) return
        client.lastScreenFrameAt = messageWindowNow
        const relayId = nextRelayId(client)
        this.saveClient(socket, client)
        const payload = {
          type: 'call:screen-frame',
          channelId: client.callChannelId,
          from: client.id,
          dataUrl,
          frameRate: relayFrameRate,
          relayId,
        }
        const serialized = JSON.stringify(payload)
        for (const target of this.entries(socket)) {
          if (!targets.has(target.client.id)) continue
          const { flow, expired } = relayFlowFor(target.client, client.id, messageWindowNow)
          if (!relayWindowAvailable(flow, 'frame')) {
            if (expired) this.saveClient(target.socket, target.client)
            continue
          }
          if (this.send(target.socket, payload, { droppable: true, serialized })) {
            recordRelayDelivery(flow, 'frame', relayId, messageWindowNow)
            this.saveClient(target.socket, target.client)
          } else if (expired) {
            this.saveClient(target.socket, target.client)
          }
        }
        break
      }

      case 'call:screen-audio': {
        if (!client.profile || !client.callChannelId || !client.media.screen || !client.media.screenAudio) return
        const targets = this.relayTargets(client, message.targets)
        if (!targets.size) return
        const pcm = typeof message.pcm === 'string' ? message.pcm : ''
        const sampleRate = Number(message.sampleRate)
        const sequence = Number(message.sequence)
        if (!pcm || pcm.length > 5_200 || pcm.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(pcm)) return
        const pcmBytes = canonicalBase64ByteLength(pcm)
        if (pcmBytes < 1_280 || pcmBytes > 3_840 || pcmBytes % 2 !== 0) return
        if (sampleRate !== 16_000 || !Number.isSafeInteger(sequence)
          || sequence <= client.lastScreenAudioSequence) return
        if (messageWindowNow - client.lastScreenAudioAt < 55) return
        if (!this.consumeRelayBudget(client, pcm.length, messageWindowNow)) return
        client.lastScreenAudioAt = messageWindowNow
        client.lastScreenAudioSequence = sequence
        const relayId = nextRelayId(client)
        this.saveClient(socket, client)
        const payload = {
          type: 'call:screen-audio',
          channelId: client.callChannelId,
          from: client.id,
          pcm,
          sampleRate,
          sequence,
          relayId,
        }
        const serialized = JSON.stringify(payload)
        for (const target of this.entries(socket)) {
          if (!targets.has(target.client.id)) continue
          const { flow, expired } = relayFlowFor(target.client, client.id, messageWindowNow)
          if (!relayWindowAvailable(flow, 'audio')) {
            if (expired) this.saveClient(target.socket, target.client)
            continue
          }
          if (this.send(target.socket, payload, { droppable: true, serialized })) {
            recordRelayDelivery(flow, 'audio', relayId, messageWindowNow)
            this.saveClient(target.socket, target.client)
          } else if (expired) {
            this.saveClient(target.socket, target.client)
          }
        }
        break
      }

      case 'call:screen-stop': {
        if (!client.profile || !client.callChannelId) return
        this.clearRelayFlowsFrom(client.id, client.callChannelId, socket)
        this.broadcast(
          { type: 'call:screen-stop', channelId: client.callChannelId, from: client.id },
          (other) => other.callChannelId === client.callChannelId && other.id !== client.id,
        )
        break
      }

      case 'call:leave':
        this.leaveCall(socket, client)
        break

      case 'ping':
        this.send(socket, { type: 'pong', at: Date.now() })
        await this.maybeRefreshTurn(socket, client)
        break
    }
  }

  async cleanupSocket(socket) {
    await this.ready
    const client = this.readClient(socket)
    if (!client) return
    this.leaveCall(socket, client, socket)
    this.broadcastPresence(socket)
  }

  async webSocketClose(socket) {
    await this.cleanupSocket(socket)
  }

  async webSocketError(socket) {
    await this.cleanupSocket(socket)
    try {
      socket.close(1011, 'Erro de conexão')
    } catch {
      // The close callback may have run first.
    }
  }
}
