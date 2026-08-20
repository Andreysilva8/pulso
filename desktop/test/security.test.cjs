const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PULSO_APP_URL,
  canGrantPermission,
  isPulsoUrl,
  isTrustedDisplayRequest,
  safeExternalUrl,
} = require('../src/security.cjs')

test('aceita somente a origem oficial do Pulso', () => {
  assert.equal(isPulsoUrl(PULSO_APP_URL), true)
  assert.equal(isPulsoUrl('https://pulso-9ojl.onrender.com/cafe?room=1'), true)
  assert.equal(isPulsoUrl('https://pulso-9ojl.onrender.com.evil.test/'), false)
  assert.equal(isPulsoUrl('http://pulso-9ojl.onrender.com/'), false)
  assert.equal(isPulsoUrl('not-a-url'), false)
})

test('limita permissões à origem e capacidades de chamada', () => {
  assert.equal(canGrantPermission('media', PULSO_APP_URL), true)
  assert.equal(canGrantPermission('display-capture', PULSO_APP_URL), true)
  assert.equal(canGrantPermission('geolocation', PULSO_APP_URL), false)
  assert.equal(canGrantPermission('media', 'https://evil.test/'), false)
})

test('captura exige vídeo, origem oficial e gesto do usuário', () => {
  assert.equal(isTrustedDisplayRequest({
    userGesture: true,
    videoRequested: true,
    securityOrigin: PULSO_APP_URL,
  }), true)
  assert.equal(isTrustedDisplayRequest({
    userGesture: false,
    videoRequested: true,
    securityOrigin: PULSO_APP_URL,
  }), false)
  assert.equal(isTrustedDisplayRequest({
    userGesture: true,
    videoRequested: true,
    securityOrigin: 'https://evil.test/',
  }), false)
})

test('abre externamente apenas HTTPS fora do Pulso', () => {
  assert.equal(safeExternalUrl('https://electronjs.org/docs/latest/'), 'https://electronjs.org/docs/latest/')
  assert.equal(safeExternalUrl(PULSO_APP_URL), null)
  assert.equal(safeExternalUrl('javascript:alert(1)'), null)
  assert.equal(safeExternalUrl('http://example.com/'), null)
})
