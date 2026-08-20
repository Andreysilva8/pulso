import { describe, expect, it } from 'vitest'
import {
  aggregateScreenShareSendTelemetry,
  sampleScreenShareSenderStats,
  type ScreenShareSenderStatsSnapshot,
} from './screenShareTelemetry'

function stats(...reports: Array<Record<string, unknown>>) {
  return {
    forEach(callback: (value: unknown) => void) {
      reports.forEach(callback)
    },
  } as Pick<RTCStatsReport, 'forEach'>
}

describe('screen share outbound telemetry', () => {
  it('calculates encoded fps and bitrate from cumulative outbound video counters', () => {
    const previous: ScreenShareSenderStatsSnapshot = {
      timestampMs: 1_000,
      bytesSent: 100_000,
      framesEncoded: 100,
      sourceKey: 'screen-video',
    }
    const sample = sampleScreenShareSenderStats(stats({
      id: 'screen-video',
      type: 'outbound-rtp',
      kind: 'video',
      timestamp: 3_000,
      bytesSent: 850_000,
      framesEncoded: 160,
    }), previous)

    expect(sample).toMatchObject({
      status: 'sending',
      fps: 30,
      bitrateBps: 3_000_000,
    })
  })

  it('marks a valid zero-frame delta as static instead of missing telemetry', () => {
    const previous: ScreenShareSenderStatsSnapshot = {
      timestampMs: 2_000,
      bytesSent: 500_000,
      framesEncoded: 40,
      sourceKey: 'screen-video',
    }
    const sample = sampleScreenShareSenderStats(stats({
      id: 'screen-video',
      type: 'outbound-rtp',
      mediaType: 'video',
      timestamp: 4_000,
      bytesSent: 510_000,
      framesSent: 40,
    }), previous)

    expect(sample).toMatchObject({
      status: 'static',
      fps: 0,
      bitrateBps: 40_000,
    })
  })

  it('waits for a second sample and resets safely when the outbound source changes', () => {
    const first = sampleScreenShareSenderStats(stats({
      id: 'new-source',
      type: 'outbound-rtp',
      kind: 'video',
      timestamp: 5_000,
      bytesSent: 10_000,
      framesEncoded: 1,
    }), undefined)
    expect(first.status).toBe('initial')
    expect(first.fps).toBeNull()

    const changed = sampleScreenShareSenderStats(stats({
      id: 'replacement-source',
      type: 'outbound-rtp',
      kind: 'video',
      timestamp: 7_000,
      bytesSent: 2_000,
      framesEncoded: 1,
    }), first.snapshot || undefined)
    expect(changed.status).toBe('initial')
    expect(changed.bitrateBps).toBeNull()
  })

  it('uses the worst sender fps and total bitrate across viewers', () => {
    const telemetry = aggregateScreenShareSendTelemetry([
      { status: 'sending', snapshot: null, fps: 58, bitrateBps: 3_200_000 },
      { status: 'sending', snapshot: null, fps: 42, bitrateBps: 2_800_000 },
    ], 2)

    expect(telemetry).toEqual({
      status: 'sending',
      fps: 42,
      bitrateMbps: 6,
      peerCount: 2,
      sampledPeerCount: 2,
      complete: true,
    })
  })

  it('distinguishes waiting, sampling, unavailable, and fully static states', () => {
    expect(aggregateScreenShareSendTelemetry([], 0).status).toBe('waiting')
    expect(aggregateScreenShareSendTelemetry([
      { status: 'initial', snapshot: null, fps: null, bitrateBps: null },
    ], 1).status).toBe('sampling')
    expect(aggregateScreenShareSendTelemetry([
      { status: 'unavailable', snapshot: null, fps: null, bitrateBps: null },
    ], 1).status).toBe('unavailable')
    expect(aggregateScreenShareSendTelemetry([
      { status: 'static', snapshot: null, fps: 0, bitrateBps: 30_000 },
      { status: 'static', snapshot: null, fps: 0, bitrateBps: 20_000 },
    ], 2)).toMatchObject({
      status: 'static',
      fps: 0,
      bitrateMbps: 0.05,
      complete: true,
    })
  })
})
