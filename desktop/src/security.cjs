const PULSO_APP_URL = 'https://pulso-9ojl.onrender.com/'
const PULSO_APP_ORIGIN = new URL(PULSO_APP_URL).origin

const ALLOWED_PERMISSIONS = new Set([
  'display-capture',
  'fullscreen',
  'media',
  'speaker-selection',
])

function isPulsoUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === PULSO_APP_ORIGIN
  } catch {
    return false
  }
}

function isAllowedPermission(permission) {
  return ALLOWED_PERMISSIONS.has(permission)
}

function canGrantPermission(permission, requestingUrl) {
  return isAllowedPermission(permission) && isPulsoUrl(requestingUrl)
}

function isTrustedDisplayRequest(request) {
  return Boolean(
    request
      && request.userGesture
      && request.videoRequested
      && isPulsoUrl(request.securityOrigin),
  )
}

function safeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === 'https:' && !isPulsoUrl(rawUrl) ? parsed.toString() : null
  } catch {
    return null
  }
}

module.exports = {
  PULSO_APP_ORIGIN,
  PULSO_APP_URL,
  canGrantPermission,
  isAllowedPermission,
  isPulsoUrl,
  isTrustedDisplayRequest,
  safeExternalUrl,
}
