import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const port = 8799
const serverProcess = spawn(process.execPath, ['server/index.mjs', `--port=${port}`], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ALLOWED_ORIGINS: 'https://pulso.test' },
})

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check, description, timeout = 5_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await check()
    if (value) return value
    await delay(20)
  }
  throw new Error(`Tempo esgotado: ${description}`)
}

async function openClient() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://pulso.test' })
  const messages = []
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())))
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const ready = await waitFor(() => messages.find((message) => message.type === 'session:ready'), 'sessão pronta')
  return { socket, messages, id: ready.clientId }
}

let first
let second

try {
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      return response.ok
    } catch {
      return false
    }
  }, 'servidor iniciar')

  await assert.rejects(
    new Promise((resolve, reject) => {
      const rejectedSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://origem-invalida.test' })
      rejectedSocket.once('open', () => {
        rejectedSocket.close()
        resolve()
      })
      rejectedSocket.once('error', reject)
    }),
    /Unexpected server response: 403/,
  )

  first = await openClient()
  second = await openClient()
  first.socket.send(JSON.stringify({
    type: 'workspace:join',
    profile: { name: 'Teste Um', initials: 'TU', color: '#ff816f' },
    activeChannelId: 'geral',
  }))
  second.socket.send(JSON.stringify({
    type: 'workspace:join',
    profile: { name: 'Teste Dois', initials: 'TD', color: '#3bd6c6' },
    activeChannelId: 'geral',
  }))

  await waitFor(() => first.messages.find((message) => message.type === 'workspace:state'), 'estado inicial do primeiro cliente')
  await waitFor(() => second.messages.find((message) => message.type === 'workspace:state'), 'estado inicial do segundo cliente')

  first.socket.send(JSON.stringify({ type: 'chat:send', channelId: 'geral', text: 'mensagem de smoke test' }))
  const delivered = await waitFor(
    () => second.messages.find((message) => message.type === 'chat:message' && message.message.text === 'mensagem de smoke test'),
    'mensagem de chat chegar ao segundo cliente',
  )
  assert.equal(delivered.message.senderName, 'Teste Um')

  first.socket.send(JSON.stringify({
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: true, screen: false, screenAudio: false },
  }))
  await waitFor(() => first.messages.find((message) => message.type === 'call:peers'), 'primeiro cliente entrar na chamada')

  second.socket.send(JSON.stringify({
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  }))
  const peerList = await waitFor(
    () => second.messages.find((message) => message.type === 'call:peers' && message.peers.length === 1),
    'segundo cliente descobrir o primeiro peer',
  )
  assert.equal(peerList.peers[0].id, first.id)

  second.socket.send(JSON.stringify({
    type: 'call:signal',
    target: first.id,
    payload: { candidate: { candidate: 'smoke-probe' } },
  }))
  const signal = await waitFor(
    () => first.messages.find((message) => message.type === 'call:signal' && message.payload?.candidate?.candidate === 'smoke-probe'),
    'sinal WebRTC ser encaminhado',
  )
  assert.equal(signal.from, second.id)

  const signalCount = first.messages.filter((message) => message.type === 'call:signal').length
  second.socket.send(JSON.stringify({
    type: 'call:signal',
    target: first.id,
    payload: { description: { type: 'offer', sdp: 'x'.repeat(70_000) } },
  }))
  await delay(80)
  assert.equal(first.messages.filter((message) => message.type === 'call:signal').length, signalCount)

  first.socket.send(JSON.stringify({
    type: 'call:update',
    media: { microphone: true, camera: true, screen: true, screenAudio: true },
  }))
  await waitFor(
    () => second.messages.find((message) => message.type === 'call:presence'
      && message.participants.some((participant) => participant.id === first.id && participant.media.screenAudio)),
    'presença anunciar áudio da tela',
  )

  first.socket.send(JSON.stringify({ type: 'call:leave' }))
  await waitFor(
    () => second.messages.find((message) => message.type === 'call:peer-left' && message.peerId === first.id),
    'espectador observar a queda temporária do transmissor',
  )
  first.socket.send(JSON.stringify({
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: true, screen: true, screenAudio: true },
  }))
  await waitFor(
    () => [...second.messages].reverse().find((message) => message.type === 'call:presence'
      && message.participants.some((participant) => participant.id === first.id
        && participant.media.screen && participant.media.screenAudio)),
    'reentrada preservar tela e áudio ativos',
  )

  second.socket.send(JSON.stringify({ type: 'call:screen-relay-request', target: first.id }))
  await waitFor(
    () => first.messages.find((message) => message.type === 'call:screen-relay-request' && message.from === second.id),
    'pedido de modo compatível chegar ao transmissor',
  )

  first.socket.send(JSON.stringify({
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    targets: [second.id],
  }))
  const screenFrame = await waitFor(
    () => second.messages.find((message) => message.type === 'call:screen-frame'),
    'quadro de compatibilidade chegar ao espectador',
  )
  assert.equal(screenFrame.from, first.id)

  first.socket.send(JSON.stringify({
    type: 'call:screen-audio',
    pcm: Buffer.alloc(2_560).toString('base64'),
    sampleRate: 16_000,
    sequence: 0,
    targets: [second.id],
  }))
  const screenAudio = await waitFor(
    () => second.messages.find((message) => message.type === 'call:screen-audio'),
    'áudio de compatibilidade chegar ao espectador',
  )
  assert.equal(screenAudio.from, first.id)

  const audioCount = second.messages.filter((message) => message.type === 'call:screen-audio').length
  first.socket.send(JSON.stringify({
    type: 'call:screen-audio',
    pcm: 'AA==',
    sampleRate: 16_000,
    sequence: 1,
    targets: [second.id],
  }))
  await delay(80)
  assert.equal(second.messages.filter((message) => message.type === 'call:screen-audio').length, audioCount)

  second.socket.send(JSON.stringify({ type: 'call:screen-relay-release', target: first.id }))
  await waitFor(
    () => first.messages.find((message) => message.type === 'call:screen-relay-release' && message.from === second.id),
    'liberação do modo compatível chegar ao transmissor',
  )

  console.log('✓ origem, presença, reconexão, signaling e compatibilidade de tela/áudio validados')
} finally {
  first?.socket.close()
  second?.socket.close()
  serverProcess.kill()
}
