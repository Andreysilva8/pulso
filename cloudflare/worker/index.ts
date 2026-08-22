import { handleRequest } from '../router.mjs'

export { Workspace } from '../workspace.mjs'

export interface Env {
  ASSETS: Fetcher
  WORKSPACES: DurableObjectNamespace
  ALLOWED_ORIGINS?: string
  DEFAULT_WORKSPACE_ID?: string
  MAX_CLIENTS_PER_WORKSPACE?: string
  CLOUDFLARE_TURN_KEY_ID?: string
  CLOUDFLARE_TURN_API_TOKEN?: string
  CLOUDFLARE_TURN_TTL?: string
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<Env>
