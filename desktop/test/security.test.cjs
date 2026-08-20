const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PULSO_APP_URL,
  canCheckPermission,
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
  assert.equal(canGrantPermission('clipboard-sanitized-write', PULSO_APP_URL), true)
  assert.equal(canGrantPermission('geolocation', PULSO_APP_URL), false)
  assert.equal(canGrantPermission('media', 'https://evil.test/'), false)
})

test('câmera e microfone só passam na checagem depois do consentimento da sessão', () => {
  const granted = new Set()
  const audioDetails = { isMainFrame: true, mediaType: 'audio' }
  const videoDetails = { isMainFrame: true, mediaType: 'video' }

  assert.equal(canCheckPermission('media', PULSO_APP_URL, audioDetails, granted), false)
  assert.equal(canCheckPermission('media', PULSO_APP_URL, videoDetails, granted), false)

  granted.add('audio')
  assert.equal(canCheckPermission('media', PULSO_APP_URL, audioDetails, granted), true)
  assert.equal(canCheckPermission('media', PULSO_APP_URL, videoDetails, granted), false)
  assert.equal(canCheckPermission('media', PULSO_APP_URL, { isMainFrame: true, mediaType: 'unknown' }, granted), false)

  granted.add('video')
  assert.equal(canCheckPermission('media', PULSO_APP_URL, videoDetails, granted), true)
  assert.equal(canCheckPermission('media', PULSO_APP_URL, { isMainFrame: true, mediaType: 'unknown' }, granted), true)
})

test('nega permissões a subframes e libera a cópia de convite somente no Pulso', () => {
  assert.equal(canCheckPermission(
    'clipboard-sanitized-write',
    PULSO_APP_URL,
    { isMainFrame: true },
  ), true)
  assert.equal(canCheckPermission(
    'clipboard-sanitized-write',
    PULSO_APP_URL,
    { isMainFrame: false },
  ), false)
  assert.equal(canCheckPermission(
    'clipboard-sanitized-write',
    'https://evil.test/',
    { isMainFrame: true },
  ), false)
  assert.equal(canCheckPermission(
    'fullscreen',
    PULSO_APP_URL,
    { isMainFrame: true, embeddingOrigin: 'https://evil.test/' },
  ), false)
})

test('captura exige vídeo, origem oficial e gesto do usuário', () => {
  const mainFrame = {}
  assert.equal(isTrustedDisplayRequest({
    frame: mainFrame,
    userGesture: true,
    videoRequested: true,
    securityOrigin: PULSO_APP_URL,
  }, mainFrame), true)
  assert.equal(isTrustedDisplayRequest({
    frame: mainFrame,
    userGesture: false,
    videoRequested: true,
    securityOrigin: PULSO_APP_URL,
  }, mainFrame), false)
  assert.equal(isTrustedDisplayRequest({
    frame: mainFrame,
    userGesture: true,
    videoRequested: true,
    securityOrigin: 'https://evil.test/',
  }, mainFrame), false)
  assert.equal(isTrustedDisplayRequest({
    frame: {},
    userGesture: true,
    videoRequested: true,
    securityOrigin: PULSO_APP_URL,
  }, mainFrame), false)
})

test('abre externamente apenas HTTPS fora do Pulso', () => {
  assert.equal(safeExternalUrl('https://electronjs.org/docs/latest/'), 'https://electronjs.org/docs/latest/')
  assert.equal(safeExternalUrl(PULSO_APP_URL), null)
  assert.equal(safeExternalUrl('javascript:alert(1)'), null)
  assert.equal(safeExternalUrl('http://example.com/'), null)
})
