const PULSO_APP_URL = 'https://pulso-9ojl.onrender.com/'
const PULSO_APP_ORIGIN = new URL(PULSO_APP_URL).origin

const ALLOWED_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'display-capture',
  'fullscreen',
  'media',
  'speaker-selection',
])

const MEDIA_TYPES = new Set(['audio', 'video'])

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

function canCheckPermission(permission, requestingUrl, details, grantedMediaTypes = new Set()) {
  if (!canGrantPermission(permission, requestingUrl) || details?.isMainFrame === false) return false
  if (details?.embeddingOrigin && !isPulsoUrl(details.embeddingOrigin)) return false
  if (details?.securityOrigin && !isPulsoUrl(details.securityOrigin)) return false
  if (permission !== 'media') return true

  if (MEDIA_TYPES.has(details?.mediaType)) {
    return grantedMediaTypes.has(details.mediaType)
  }

  return details?.mediaType === 'unknown'
    && MEDIA_TYPES.size === [...MEDIA_TYPES].filter((type) => grantedMediaTypes.has(type)).length
}

function isTrustedDisplayRequest(request, expectedFrame) {
  return Boolean(
    request
      && expectedFrame
      && request.frame === expectedFrame
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
  canCheckPermission,
  canGrantPermission,
  isAllowedPermission,
  isPulsoUrl,
  isTrustedDisplayRequest,
  safeExternalUrl,
}
