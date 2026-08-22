import assert from 'node:assert/strict'
import test from 'node:test'
import { Workspace, createClientState } from './workspace.mjs'

class MockStorage {
  constructor() {
    this.values = new Map()
  }

  async get(key) {
    const value = this.values.get(key)
    return value == null ? value : structuredClone(value)
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value))
  }
}

class MockState {
  constructor() {
    this.storage = new MockStorage()
    this.sockets = []
  }

  blockConcurrencyWhile(callback) {
    return Promise.resolve().then(callback)
  }

  acceptWebSocket(socket) {
    this.sockets.push(socket)
  }

  getWebSockets() {
    return this.sockets
  }
}

class MockSocket {
  constructor() {
    this.readyState = 1
    this.bufferedAmount = 0
    this.sent = []
    this.attachment = null
    this.closed = null
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value)
  }

  deserializeAttachment() {
    return structuredClone(this.attachment)
  }

  send(value) {
    this.sent.push(JSON.parse(value))
  }

  close(code, reason) {
    this.closed = { code, reason }
    this.readyState = 3
  }
}

function register(state, id) {
  const socket = new MockSocket()
  socket.serializeAttachment(createClientState(id))
  state.sockets.push(socket)
  return socket
}

async function send(workspace, socket, payload) {
  await workspace.webSocketMessage(socket, JSON.stringify(payload))
}

async function joinWorkspace(workspace, socket, name, color = '#ff816f') {
  await send(workspace, socket, {
    type: 'workspace:join',
    profile: { name, initials: name.slice(0, 2), color },
    activeChannelId: 'geral',
  })
}

function findMessage(socket, type, predicate = () => true) {
  return socket.sent.find((message) => message.type === type && predicate(message))
}

function resetRelayCadence(socket, kind) {
  const client = socket.deserializeAttachment()
  if (kind === 'frame') client.lastScreenFrameAt = 0
  else client.lastScreenAudioAt = 0
  socket.serializeAttachment(client)
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function turnResponse(username) {
  return new Response(JSON.stringify({
    iceServers: [{
      urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
      username,
      credential: `credential-${username}`,
    }],
  }), { status: 201, headers: { 'content-type': 'application/json' } })
}

test('preserva handshake, presença, chat e sinalização WebRTC', async () => {
  const state = new MockState()
  const workspace = new Workspace(state, {})
  const first = register(state, 'primeiro')
  const second = register(state, 'segundo')

  await joinWorkspace(workspace, first, 'Teste Um')
  await joinWorkspace(workspace, second, 'Teste Dois', '#3bd6c6')
  assert.equal(findMessage(second, 'workspace:state').members.length, 2)

  await send(workspace, first, { type: 'chat:send', channelId: 'geral', text: 'mensagem cloudflare' })
  assert.equal(findMessage(second, 'chat:message', (message) => message.message.text === 'mensagem cloudflare').message.senderId, 'primeiro')

  await send(workspace, first, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: true, screen: false, screenAudio: false },
  })
  await send(workspace, second, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })
  assert.deepEqual(findMessage(second, 'call:peers').peers.map((peer) => peer.id), ['primeiro'])

  await send(workspace, second, {
    type: 'call:signal',
    target: 'primeiro',
    payload: { candidate: { candidate: 'candidate:test' } },
  })
  assert.equal(findMessage(first, 'call:signal', (message) => message.from === 'segundo').payload.candidate.candidate, 'candidate:test')

  const signalCount = first.sent.filter((message) => message.type === 'call:signal').length
  await send(workspace, second, {
    type: 'call:signal',
    target: 'primeiro',
    payload: { description: { type: 'offer', sdp: 'x'.repeat(64_001) } },
  })
  assert.equal(first.sent.filter((message) => message.type === 'call:signal').length, signalCount)
})

test('mantém 1080p60 fora do relay e aceita somente fallback de até 30 fps', async () => {
  const state = new MockState()
  const workspace = new Workspace(state, {})
  const sender = register(state, 'sender')
  const viewer = register(state, 'viewer')
  await joinWorkspace(workspace, sender, 'Sender')
  await joinWorkspace(workspace, viewer, 'Viewer')
  await send(workspace, sender, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: true, screenAudio: true },
  })
  await send(workspace, viewer, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })

  const frameCount = () => viewer.sent.filter((message) => message.type === 'call:screen-frame').length
  await send(workspace, sender, {
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 60,
    targets: ['viewer'],
  })
  assert.equal(frameCount(), 0)

  await send(workspace, sender, {
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 30,
    targets: ['viewer'],
  })
  assert.equal(frameCount(), 1)
  assert.equal(findMessage(viewer, 'call:screen-frame').frameRate, 30)

  const pcm = Buffer.alloc(2_560).toString('base64')
  await send(workspace, sender, {
    type: 'call:screen-audio',
    pcm,
    sampleRate: 16_000,
    sequence: 0,
    targets: ['viewer'],
  })
  assert.ok(findMessage(viewer, 'call:screen-audio'))
})

test('limita frames em voo por espectador e libera a janela somente com ACK válido', async () => {
  const state = new MockState()
  const workspace = new Workspace(state, {})
  const sender = register(state, 'sender-flow')
  const firstViewer = register(state, 'viewer-flow-1')
  const secondViewer = register(state, 'viewer-flow-2')
  for (const [socket, name, screen] of [
    [sender, 'Sender', true],
    [firstViewer, 'Viewer 1', false],
    [secondViewer, 'Viewer 2', false],
  ]) {
    await joinWorkspace(workspace, socket, name)
    await send(workspace, socket, {
      type: 'call:join',
      channelId: 'cafe',
      media: { microphone: true, camera: false, screen, screenAudio: screen },
    })
  }

  const frameCount = (socket) => socket.sent.filter((message) => message.type === 'call:screen-frame').length
  for (let index = 0; index < 5; index += 1) {
    resetRelayCadence(sender, 'frame')
    await send(workspace, sender, {
      type: 'call:screen-frame',
      dataUrl: 'data:image/webp;base64,UklGRg==',
      frameRate: 30,
      targets: ['viewer-flow-1', 'viewer-flow-2'],
    })
  }
  assert.equal(frameCount(firstViewer), 4)
  assert.equal(frameCount(secondViewer), 4)

  const firstRelayId = firstViewer.sent.find((message) => message.type === 'call:screen-frame').relayId
  await send(workspace, firstViewer, {
    type: 'call:screen-frame-ack',
    target: 'sender-flow',
    relayId: firstRelayId,
  })
  resetRelayCadence(sender, 'frame')
  await send(workspace, sender, {
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 30,
    targets: ['viewer-flow-1', 'viewer-flow-2'],
  })
  assert.equal(frameCount(firstViewer), 5)
  assert.equal(frameCount(secondViewer), 4)

  // A spectator cannot forge an ACK for a relay ID it was never sent.
  const newestRelayId = firstViewer.sent.filter((message) => message.type === 'call:screen-frame').at(-1).relayId
  await send(workspace, secondViewer, {
    type: 'call:screen-frame-ack',
    target: 'sender-flow',
    relayId: newestRelayId,
  })
  resetRelayCadence(sender, 'frame')
  await send(workspace, sender, {
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 30,
    targets: ['viewer-flow-2'],
  })
  assert.equal(frameCount(secondViewer), 4)

  // An old client without ACKs receives a bounded recovery probe after timeout.
  const stalled = secondViewer.deserializeAttachment()
  stalled.relayFlowBySender['sender-flow'].frames.forEach((item) => { item.expiresAt = 0 })
  secondViewer.serializeAttachment(stalled)
  resetRelayCadence(sender, 'frame')
  await send(workspace, sender, {
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 30,
    targets: ['viewer-flow-2'],
  })
  resetRelayCadence(sender, 'frame')
  await send(workspace, sender, {
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 30,
    targets: ['viewer-flow-2'],
  })
  assert.equal(frameCount(secondViewer), 5)
})

test('descarta áudio novo quando a janela por espectador está cheia', async () => {
  const state = new MockState()
  const workspace = new Workspace(state, {})
  const sender = register(state, 'audio-sender')
  const viewer = register(state, 'audio-viewer')
  await joinWorkspace(workspace, sender, 'Sender')
  await joinWorkspace(workspace, viewer, 'Viewer')
  await send(workspace, sender, {
    type: 'call:join', channelId: 'cafe',
    media: { microphone: true, camera: false, screen: true, screenAudio: true },
  })
  await send(workspace, viewer, {
    type: 'call:join', channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })
  const pcm = Buffer.alloc(2_560).toString('base64')
  for (let sequence = 0; sequence < 4; sequence += 1) {
    resetRelayCadence(sender, 'audio')
    await send(workspace, sender, {
      type: 'call:screen-audio', pcm, sampleRate: 16_000, sequence, targets: ['audio-viewer'],
    })
  }
  const deliveries = viewer.sent.filter((message) => message.type === 'call:screen-audio')
  assert.equal(deliveries.length, 3)

  await send(workspace, viewer, {
    type: 'call:screen-audio-ack', target: 'audio-sender', relayId: deliveries[0].relayId,
  })
  resetRelayCadence(sender, 'audio')
  await send(workspace, sender, {
    type: 'call:screen-audio', pcm, sampleRate: 16_000, sequence: 4, targets: ['audio-viewer'],
  })
  assert.equal(viewer.sent.filter((message) => message.type === 'call:screen-audio').length, 4)
})

test('gera TURN temporário no servidor e nunca envia a chave secreta', async () => {
  const state = new MockState()
  const apiToken = 'test-api-token'
  const workspace = new Workspace(state, {
    CLOUDFLARE_TURN_KEY_ID: 'turn-key',
    CLOUDFLARE_TURN_API_TOKEN: apiToken,
    CLOUDFLARE_TURN_TTL: '3600',
    __TEST_FETCH: async (_url, options) => {
      assert.equal(options.headers.authorization, `Bearer ${apiToken}`)
      return new Response(JSON.stringify({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'],
            username: 'temporario',
            credential: 'credencial-temporaria',
          },
        ],
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    },
  })
  const socket = register(state, 'turn-client')
  await joinWorkspace(workspace, socket, 'TURN')
  await send(workspace, socket, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })

  const message = findMessage(socket, 'session:ice-servers')
  assert.ok(message)
  assert.ok(message.iceServers.some((server) => server.urls.some((url) => url.startsWith('turn:'))))
  assert.ok(message.iceServers.every((server) => server.urls.every((url) => !url.includes(':53'))))
  assert.equal(JSON.stringify(socket.sent).includes(apiToken), false)
  assert.ok(socket.deserializeAttachment().turnRefreshAt > Date.now())
})

test('TURN fica completamente ausente quando os secrets não estão configurados', async () => {
  const state = new MockState()
  const workspace = new Workspace(state, {})
  const socket = register(state, 'sem-turn')
  await joinWorkspace(workspace, socket, 'Sem TURN')
  await send(workspace, socket, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })
  assert.equal(socket.sent.some((message) => message.type === 'session:ice-servers'), false)
})

test('não restaura uma chamada encerrada enquanto a credencial TURN estava sendo gerada', async () => {
  const state = new MockState()
  const pendingFetch = deferred()
  const fetchStarted = deferred()
  const workspace = new Workspace(state, {
    CLOUDFLARE_TURN_KEY_ID: 'turn-key',
    CLOUDFLARE_TURN_API_TOKEN: 'turn-token',
    __TEST_FETCH: async () => {
      fetchStarted.resolve()
      return pendingFetch.promise
    },
  })
  const socket = register(state, 'turn-leave-race')
  await joinWorkspace(workspace, socket, 'TURN Leave')

  const joining = send(workspace, socket, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })
  await fetchStarted.promise
  await send(workspace, socket, { type: 'call:leave' })
  pendingFetch.resolve(turnResponse('stale-cafe'))
  await joining

  const client = socket.deserializeAttachment()
  assert.equal(client.callChannelId, null)
  assert.equal(client.callJoinedAt, null)
  assert.equal(client.turnRefreshAt, 0)
  assert.equal(socket.sent.some((message) => message.type === 'session:ice-servers'), false)
})

test('descarta a credencial TURN da sala anterior após trocar de chamada', async () => {
  const state = new MockState()
  const firstFetch = deferred()
  const firstFetchStarted = deferred()
  let fetchCount = 0
  const workspace = new Workspace(state, {
    CLOUDFLARE_TURN_KEY_ID: 'turn-key',
    CLOUDFLARE_TURN_API_TOKEN: 'turn-token',
    __TEST_FETCH: async () => {
      fetchCount += 1
      if (fetchCount === 1) {
        firstFetchStarted.resolve()
        return firstFetch.promise
      }
      return turnResponse('current-ideias')
    },
  })
  const socket = register(state, 'turn-room-race')
  await joinWorkspace(workspace, socket, 'TURN Room')

  const joiningCafe = send(workspace, socket, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })
  await firstFetchStarted.promise
  await send(workspace, socket, {
    type: 'call:join',
    channelId: 'ideias',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  })
  firstFetch.resolve(turnResponse('stale-cafe'))
  await joiningCafe

  const client = socket.deserializeAttachment()
  const turnMessages = socket.sent.filter((message) => message.type === 'session:ice-servers')
  assert.equal(client.callChannelId, 'ideias')
  assert.ok(client.turnRefreshAt > Date.now())
  assert.equal(turnMessages.length, 1)
  assert.equal(turnMessages[0].iceServers[0].username, 'current-ideias')
})

test('attachments e storage restauram chamada e histórico depois de hibernação', async () => {
  const state = new MockState()
  const firstInstance = new Workspace(state, {})
  const first = register(state, 'persistente')
  await joinWorkspace(firstInstance, first, 'Persistente')
  await send(firstInstance, first, { type: 'chat:send', channelId: 'geral', text: 'sobreviveu' })
  await send(firstInstance, first, {
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: true, screenAudio: false },
  })

  const restoredInstance = new Workspace(state, {})
  const second = register(state, 'novo')
  await joinWorkspace(restoredInstance, second, 'Novo')
  const snapshot = findMessage(second, 'workspace:state')
  assert.ok(snapshot.members.some((member) => member.id === 'persistente'))
  assert.ok(snapshot.calls.cafe.some((participant) => participant.id === 'persistente' && participant.media.screen))
  assert.ok(snapshot.messages.geral.some((message) => message.text === 'sobreviveu'))
  assert.ok(state.storage.values.has('messages:channel:v1:geral'))
  assert.equal(state.storage.values.has('messages:v1'), false)
})

test('limita payload e cadência genérica sem reduzir o teto válido do fallback', async () => {
  const state = new MockState()
  const workspace = new Workspace(state, {})
  const socket = register(state, 'rate-limit')

  await workspace.webSocketMessage(socket, 'x'.repeat(160 * 1024 + 1))
  assert.deepEqual(socket.closed, { code: 1009, reason: 'Mensagem muito grande' })

  const second = register(state, 'message-limit')
  const attachment = second.deserializeAttachment()
  attachment.messagesInWindow = 600
  second.serializeAttachment(attachment)
  await send(workspace, second, { type: 'ping' })
  assert.deepEqual(second.closed, { code: 1008, reason: 'Limite de mensagens excedido' })
})
