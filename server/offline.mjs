export function isSiteOffline(env = process.env) {
  return env.SITE_OFFLINE === 'true' || env.RENDER === 'true'
}
