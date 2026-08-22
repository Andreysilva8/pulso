import { describe, expect, it } from 'vitest'
import {
  configuredIceServers,
  hasTurnServer,
  rtcConfigurationFor,
  sanitizeIceServers,
} from './iceServers'

describe('ICE servers', () => {
  it('keeps safe TURN transports and removes browser-blocked port 53', () => {
    const servers = sanitizeIceServers([
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
    ])
    expect(servers).toHaveLength(2)
    expect(servers[1].urls).toEqual([
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ])
    expect(hasTurnServer(servers)).toBe(true)
  })

  it('rejects TURN without temporary credentials', () => {
    expect(sanitizeIceServers([{ urls: 'turn:turn.cloudflare.com:3478' }])).toEqual([])
  })

  it('falls back to two public STUN servers on malformed environment JSON', () => {
    const servers = configuredIceServers('{invalid', 'not-a-stun-url')
    expect(servers).toHaveLength(2)
    expect(hasTurnServer(servers)).toBe(false)
  })

  it('keeps immutable peer settings when temporary TURN replaces STUN', () => {
    const iceServers = [{
      urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
      username: 'temporario',
      credential: 'temporaria',
    }]
    expect(rtcConfigurationFor(iceServers)).toEqual({
      iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 8,
    })
  })
})
