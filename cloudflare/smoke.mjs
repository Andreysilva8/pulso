import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { WebSocket } from 'ws'

const require = createRequire(import.meta.url)
const wranglerCli = require.resolve('wrangler')
const port = Number(process.env.CLOUDFLARE_SMOKE_PORT || 8802)
const origin = `http://127.0.0.1:${port}`
const processOutput = []

const wrangler = spawn(process.execPath, [wranglerCli, 'dev', '--ip', '127.0.0.1', '--port', String(port)], {
  cwd: new URL('..', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe'],
})
wrangler.stdout.on('data', (chunk) => processOutput.push(chunk.toString()))
wrangler.stderr.on('data', (chunk) => processOutput.push(chunk.toString()))

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check, description, timeout = 15_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const value = await check()
    if (value) return value
    await delay(25)
  }
  throw new Error(`Tempo esgotado: ${description}\n${processOutput.join('').slice(-4_000)}`)
}

async function openClient() {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws`, { origin })
  const messages = []
  socket.on('message', (value) => messages.push(JSON.parse(value.toString())))
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const ready = await waitFor(
    () => messages.find((message) => message.type === 'session:ready'),
    'session:ready do Worker local',
  )
  return { socket, messages, id: ready.clientId }
}

let first
let second
try {
  await waitFor(async () => {
    try {
      const response = await fetch(`${origin}/api/health`)
      return response.ok
    } catch {
      return false
    }
  }, 'Wrangler iniciar')

  const assetResponse = await fetch(origin)
  assert.equal(assetResponse.ok, true)

  await assert.rejects(new Promise((resolve, reject) => {
    const denied = new WebSocket(`${origin.replace('http', 'ws')}/ws`, { origin: 'https://origem-invalida.test' })
    denied.once('open', () => {
      denied.close()
      resolve()
    })
    denied.once('error', reject)
  }), /Unexpected server response: 403/)

  first = await openClient()
  second = await openClient()
  first.socket.send(JSON.stringify({
    type: 'workspace:join',
    profile: { name: 'Cloud Um', initials: 'CU', color: '#ff816f' },
    activeChannelId: 'geral',
  }))
  second.socket.send(JSON.stringify({
    type: 'workspace:join',
    profile: { name: 'Cloud Dois', initials: 'CD', color: '#3bd6c6' },
    activeChannelId: 'geral',
  }))
  await waitFor(() => second.messages.find((message) => message.type === 'workspace:state'), 'workspace:state')

  first.socket.send(JSON.stringify({ type: 'chat:send', channelId: 'geral', text: 'smoke Cloudflare' }))
  await waitFor(
    () => second.messages.find((message) => message.type === 'chat:message' && message.message.text === 'smoke Cloudflare'),
    'chat entre clientes',
  )

  first.socket.send(JSON.stringify({
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: true, screenAudio: false },
  }))
  second.socket.send(JSON.stringify({
    type: 'call:join',
    channelId: 'cafe',
    media: { microphone: true, camera: false, screen: false, screenAudio: false },
  }))
  await waitFor(
    () => second.messages.find((message) => message.type === 'call:peers' && message.peers.some((peer) => peer.id === first.id)),
    'descoberta de peer',
  )

  second.socket.send(JSON.stringify({
    type: 'call:signal',
    target: first.id,
    payload: { candidate: { candidate: 'cloudflare-smoke' } },
  }))
  await waitFor(
    () => first.messages.find((message) => message.type === 'call:signal'
      && message.payload?.candidate?.candidate === 'cloudflare-smoke'),
    'relay de sinalização',
  )

  const beforeFrames = second.messages.filter((message) => message.type === 'call:screen-frame').length
  first.socket.send(JSON.stringify({
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 60,
    targets: [second.id],
  }))
  await delay(80)
  assert.equal(second.messages.filter((message) => message.type === 'call:screen-frame').length, beforeFrames)

  first.socket.send(JSON.stringify({
    type: 'call:screen-frame',
    dataUrl: 'data:image/webp;base64,UklGRg==',
    frameRate: 30,
    targets: [second.id],
  }))
  await waitFor(
    () => second.messages.filter((message) => message.type === 'call:screen-frame').length === beforeFrames + 1,
    'fallback reduzido a 30 fps',
  )

  console.log('✓ Worker real: assets, origem, chat, signaling e limite de fallback validados')
} finally {
  first?.socket.close()
  second?.socket.close()
  wrangler.kill()
}
