import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRequest, isAllowedOrigin, requestedWorkspaceId, safeWorkspaceId } from './router.mjs'

function testEnvironment() {
  const calls = []
  return {
    calls,
    env: {
      DEFAULT_WORKSPACE_ID: 'pulso',
      WORKSPACES: {
        idFromName(name) {
          calls.push({ operation: 'idFromName', name })
          return `id:${name}`
        },
        get(id, options) {
          calls.push({ operation: 'get', id, options })
          return {
            async fetch(request) {
              calls.push({ operation: 'fetch', request })
              if (String(request).includes('/__health')) {
                return Response.json({ ok: true, service: 'pulso-signal-cloudflare', clients: 2 })
              }
              return new Response('workspace')
            },
          }
        },
      },
      ASSETS: {
        async fetch(request) {
          calls.push({ operation: 'asset', url: request.url })
          return new Response('asset')
        },
      },
    },
  }
}

test('normaliza e valida o identificador do workspace', () => {
  assert.equal(safeWorkspaceId(' Equipe-1 '), 'equipe-1')
  assert.equal(safeWorkspaceId('../segredo'), 'pulso')

  const valid = requestedWorkspaceId(new URL('https://pulso.test/ws?workspace=pulso'), {})
  assert.deepEqual(valid, { workspaceId: 'pulso', valid: true })
  const untrusted = requestedWorkspaceId(new URL('https://pulso.test/ws?workspace=sala-azul'), {})
  assert.deepEqual(untrusted, { workspaceId: '', valid: false })
  const invalid = requestedWorkspaceId(new URL('https://pulso.test/ws?workspace=../azul'), {})
  assert.deepEqual(invalid, { workspaceId: '', valid: false })
})

test('origem é same-host por padrão ou allowlist exata quando configurada', () => {
  const sameHost = new Request('https://pulso.test/ws', { headers: { Origin: 'https://pulso.test' } })
  const otherHost = new Request('https://pulso.test/ws', { headers: { Origin: 'https://evil.test' } })
  assert.equal(isAllowedOrigin(sameHost, {}), true)
  assert.equal(isAllowedOrigin(otherHost, {}), false)
  assert.equal(isAllowedOrigin(otherHost, { ALLOWED_ORIGINS: 'https://evil.test, https://app.test' }), true)
})

test('roteia WebSocket somente para o workspace configurado com hint sul-americano', async () => {
  const { env, calls } = testEnvironment()
  const request = new Request('https://pulso.test/ws', {
    headers: { Origin: 'https://pulso.test', Upgrade: 'websocket' },
  })
  const response = await handleRequest(request, env)
  assert.equal(await response.text(), 'workspace')
  assert.ok(calls.some((call) => call.operation === 'idFromName' && call.name === 'pulso'))
  assert.ok(calls.some((call) => call.operation === 'get'
    && call.id === 'id:pulso' && call.options.locationHint === 'sam'))
})

test('rejeita origem inválida e serve assets sem invocar o Durable Object', async () => {
  const { env, calls } = testEnvironment()
  const denied = await handleRequest(new Request('https://pulso.test/ws', {
    headers: { Origin: 'https://evil.test', Upgrade: 'websocket' },
  }), env)
  assert.equal(denied.status, 403)

  const asset = await handleRequest(new Request('https://pulso.test/assets/app.js'), env)
  assert.equal(await asset.text(), 'asset')
  assert.ok(calls.some((call) => call.operation === 'asset'))
})

test('workspace arbitrário é rejeitado antes de criar Durable Object ou storage', async () => {
  const { env, calls } = testEnvironment()
  const response = await handleRequest(new Request('https://pulso.test/ws?workspace=ataque-123', {
    headers: { Origin: 'https://pulso.test', Upgrade: 'websocket' },
  }), env)
  assert.equal(response.status, 400)
  assert.equal(calls.some((call) => call.operation === 'idFromName'), false)
})

test('health consulta o workspace selecionado sem expor o objeto diretamente', async () => {
  const { env } = testEnvironment()
  const response = await handleRequest(new Request('https://pulso.test/api/health'), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'pulso-signal-cloudflare',
    clients: 2,
    workspaceId: 'pulso',
  })
})
