import { describe, expect, it } from 'vitest'
import { relayAudioQueueIsFull, screenRelayAckFor } from './screenRelayFlow'

describe('screen relay flow control', () => {
  it('acknowledges Cloudflare frame and audio deliveries', () => {
    expect(screenRelayAckFor({
      type: 'call:screen-frame',
      from: 'sender-1',
      relayId: 41,
    })).toEqual({ type: 'call:screen-frame-ack', target: 'sender-1', relayId: 41 })

    expect(screenRelayAckFor({
      type: 'call:screen-audio',
      from: 'sender-1',
      relayId: 42,
    })).toEqual({ type: 'call:screen-audio-ack', target: 'sender-1', relayId: 42 })
  })

  it('keeps compatibility with Node deliveries that do not have relay IDs', () => {
    expect(screenRelayAckFor({
      type: 'call:screen-frame',
      from: 'sender-1',
    })).toBeNull()
    expect(screenRelayAckFor({
      type: 'call:screen-frame',
      from: 'sender-1',
      relayId: Number.MAX_SAFE_INTEGER + 1,
    })).toBeNull()
    expect(screenRelayAckFor({ type: 'call:signal', from: 'sender-1', relayId: 1 })).toBeNull()
  })

  it('drops new PCM when the local playback queue is already stale', () => {
    expect(relayAudioQueueIsFull(10.23, 10)).toBe(true)
    expect(relayAudioQueueIsFull(10.21, 10)).toBe(false)
  })
})
