export type ScreenRelayAck = {
  type: 'call:screen-frame-ack' | 'call:screen-audio-ack'
  target: string
  relayId: number
}

type RelayDelivery = {
  type?: unknown
  from?: unknown
  relayId?: unknown
}

/**
 * Cloudflare Durable Objects do not expose WebSocket.bufferedAmount. Each
 * viewer therefore returns an application-level ACK for relayed media. The
 * Node/Render signaling server can safely ignore these additive messages.
 */
export function screenRelayAckFor(message: unknown): ScreenRelayAck | null {
  if (!message || typeof message !== 'object') return null
  const delivery = message as RelayDelivery
  if (delivery.type !== 'call:screen-frame' && delivery.type !== 'call:screen-audio') return null
  if (typeof delivery.from !== 'string' || !delivery.from || delivery.from.length > 128) return null
  if (!Number.isSafeInteger(delivery.relayId) || Number(delivery.relayId) < 1) return null
  return {
    type: delivery.type === 'call:screen-frame'
      ? 'call:screen-frame-ack'
      : 'call:screen-audio-ack',
    target: delivery.from,
    relayId: Number(delivery.relayId),
  }
}

export const MAX_RELAY_AUDIO_QUEUE_SECONDS = 0.22

export function relayAudioQueueIsFull(
  nextPlaybackTime: number,
  currentTime: number,
  maxQueueSeconds = MAX_RELAY_AUDIO_QUEUE_SECONDS,
) {
  return Number.isFinite(nextPlaybackTime)
    && Number.isFinite(currentTime)
    && nextPlaybackTime > currentTime + maxQueueSeconds
}
