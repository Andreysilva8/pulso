import { handleRequest } from '../router.mjs'

export { Workspace } from '../workspace.mjs'

export interface Env {
  ASSETS: Fetcher
  WORKSPACES: DurableObjectNamespace
  ALLOWED_ORIGINS?: string
  SITE_OFFLINE?: string
  DEFAULT_WORKSPACE_ID?: string
  MAX_CLIENTS_PER_WORKSPACE?: string
  CLOUDFLARE_TURN_KEY_ID?: string
  CLOUDFLARE_TURN_API_TOKEN?: string
  CLOUDFLARE_TURN_TTL?: string
  TURN_RATE_LIMIT_SECRET?: string
  TURN_MIN_GRANT_INTERVAL_SECONDS?: string
  TURN_MAX_GRANTS_PER_SESSION_DAY?: string
  TURN_MAX_GRANTS_PER_IP_DAY?: string
  TURN_MAX_GRANTS_PER_ROOM_DAY?: string
  TURN_MAX_GRANTS_PER_WORKSPACE_DAY?: string
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<Env>
