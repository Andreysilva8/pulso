import test from 'node:test'
import assert from 'node:assert/strict'
import { generateCloudflareIceServers, safeTurnTtl, sanitizeIceServers } from './turn.mjs'

test('usa TTL curto por padrão e respeita os limites do provedor', () => {
  assert.equal(safeTurnTtl(undefined), 900)
  assert.equal(safeTurnTtl('900'), 900)
  assert.equal(safeTurnTtl(1), 600)
  assert.equal(safeTurnTtl(999_999), 172_800)
})

test('filtra porta 53 e configura somente ICE seguro', () => {
  assert.deepEqual(sanitizeIceServers([
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'temporario',
      credential: 'temporaria',
    },
    { urls: ['https://evil.test'] },
  ]), [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'temporario',
      credential: 'temporaria',
    },
  ])
})

test('gera credencial temporária sem expor o token no retorno', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return {
      status: 201,
      json: async () => ({
        iceServers: [{
          urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
          username: 'usuario-curto',
          credential: 'senha-curta',
        }],
      }),
    }
  }
  const result = await generateCloudflareIceServers({
    keyId: 'key id',
    apiToken: 'segredo-servidor',
    ttl: 3_600,
    fetchImpl,
  })

  assert.match(request.url, /key%20id\/credentials\/generate-ice-servers$/)
  assert.equal(request.options.headers.authorization, 'Bearer segredo-servidor')
  assert.deepEqual(JSON.parse(request.options.body), { ttl: 3_600 })
  assert.equal(result.iceServers[0].username, 'usuario-curto')
  assert.equal(JSON.stringify(result).includes('segredo-servidor'), false)
})

test('não chama a Cloudflare quando o servidor não possui os secrets', async () => {
  let called = false
  const result = await generateCloudflareIceServers({
    keyId: '',
    apiToken: '',
    fetchImpl: async () => { called = true },
  })
  assert.equal(result, null)
  assert.equal(called, false)
})
