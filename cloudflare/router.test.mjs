import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleRequest,
  isAllowedOrigin,
  isSiteOffline,
  requestedWorkspaceId,
  safeWorkspaceId,
  turnClientKey,
} from './router.mjs'

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

test('modo offline bloqueia assets, API e WebSocket sem tocar no workspace', async () => {
  const { env, calls } = testEnvironment()
  env.SITE_OFFLINE = 'true'
  assert.equal(isSiteOffline(env), true)

  for (const path of ['/', '/api/health', '/ws']) {
    const response = await handleRequest(new Request(`https://pulso.test${path}`, {
      headers: path === '/ws' ? { Origin: 'https://pulso.test', Upgrade: 'websocket' } : undefined,
    }), env)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(await response.text(), 'Pulso temporariamente fora do ar.')
  }

  assert.equal(calls.length, 0)
})

test('deriva chave HMAC estável do IP sem expor IP ou secret', async () => {
  const request = new Request('https://pulso.test/ws', {
    headers: { 'CF-Connecting-IP': '203.0.113.7' },
  })
  const env = { TURN_RATE_LIMIT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres' }
  const first = await turnClientKey(request, env, 'pulso')
  const repeated = await turnClientKey(request, env, 'pulso')
  const otherWorkspace = await turnClientKey(request, env, 'outro')

  assert.match(first, /^[a-z0-9_-]{43}$/i)
  assert.equal(first, repeated)
  assert.notEqual(first, otherWorkspace)
  assert.equal(first.includes('203.0.113.7'), false)
  assert.equal(first.includes(env.TURN_RATE_LIMIT_SECRET), false)
  assert.equal(await turnClientKey(request, {}, 'pulso'), '')
  assert.equal(await turnClientKey(request, { TURN_RATE_LIMIT_SECRET: 'curto' }, 'pulso'), '')
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

test('sobrescreve header interno com HMAC confiável e remove spoof sem secret', async () => {
  const first = testEnvironment()
  first.env.TURN_RATE_LIMIT_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres'
  await handleRequest(new Request('https://pulso.test/ws', {
    headers: {
      Origin: 'https://pulso.test',
      Upgrade: 'websocket',
      'CF-Connecting-IP': '2001:db8::7',
      'X-Pulso-Turn-Client': 'valor-controlado-pelo-visitante',
    },
  }), first.env)
  const forwarded = first.calls.find((call) => call.operation === 'fetch').request
  const trustedKey = forwarded.headers.get('x-pulso-turn-client')
  assert.match(trustedKey, /^[a-z0-9_-]{43}$/i)
  assert.notEqual(trustedKey, 'valor-controlado-pelo-visitante')
  assert.equal(trustedKey.includes('2001:db8::7'), false)

  const second = testEnvironment()
  await handleRequest(new Request('https://pulso.test/ws', {
    headers: {
      Origin: 'https://pulso.test',
      Upgrade: 'websocket',
      'CF-Connecting-IP': '203.0.113.9',
      'X-Pulso-Turn-Client': 'spoof',
    },
  }), second.env)
  const withoutSecret = second.calls.find((call) => call.operation === 'fetch').request
  assert.equal(withoutSecret.headers.has('x-pulso-turn-client'), false)
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
