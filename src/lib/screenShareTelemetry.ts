export type ScreenShareSenderStatsSnapshot = {
  timestampMs: number
  bytesSent: number
  framesEncoded: number
  sourceKey: string
}

export type ScreenShareSenderStatsSample = {
  status: 'initial' | 'sending' | 'static' | 'unavailable'
  snapshot: ScreenShareSenderStatsSnapshot | null
  fps: number | null
  bitrateBps: number | null
}

export type ScreenShareSendTelemetry = {
  status: 'waiting' | 'sampling' | 'sending' | 'static' | 'unavailable'
  fps: number | null
  bitrateMbps: number | null
  peerCount: number
  sampledPeerCount: number
  complete: boolean
}

type StatsReportLike = Pick<RTCStatsReport, 'forEach'>

type OutboundVideoTotals = ScreenShareSenderStatsSnapshot & {
  reportCount: number
}

function finiteCounter(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function outboundVideoTotals(stats: StatsReportLike): OutboundVideoTotals | null {
  let timestampMs = 0
  let bytesSent = 0
  let framesEncoded = 0
  let reportCount = 0
  const sourceIds: string[] = []

  stats.forEach((value) => {
    if (!value || typeof value !== 'object') return
    const report = value as Record<string, unknown>
    if (report.type !== 'outbound-rtp' || report.isRemote === true) return

    const kind = report.kind ?? report.mediaType
    const hasVideoFrameCounter = typeof report.framesEncoded === 'number'
      || typeof report.framesSent === 'number'
    if (kind !== 'video' && !(kind == null && hasVideoFrameCounter)) return

    reportCount += 1
    timestampMs = Math.max(timestampMs, finiteCounter(report.timestamp))
    bytesSent += finiteCounter(report.bytesSent)
    framesEncoded += finiteCounter(report.framesEncoded ?? report.framesSent)
    sourceIds.push(String(report.id ?? report.ssrc ?? `video-${reportCount}`))
  })

  if (!reportCount || !timestampMs) return null
  return {
    timestampMs,
    bytesSent,
    framesEncoded,
    sourceKey: sourceIds.sort().join('|'),
    reportCount,
  }
}

/**
 * Derives the real encoded frame rate and sent bitrate from two cumulative
 * outbound-rtp snapshots. A zero frame delta is kept separate from a missing
 * sample so a static screen is not reported as a failed transmission.
 */
export function sampleScreenShareSenderStats(
  stats: StatsReportLike,
  previous: ScreenShareSenderStatsSnapshot | undefined,
): ScreenShareSenderStatsSample {
  const totals = outboundVideoTotals(stats)
  if (!totals) {
    return { status: 'unavailable', snapshot: null, fps: null, bitrateBps: null }
  }

  const snapshot: ScreenShareSenderStatsSnapshot = {
    timestampMs: totals.timestampMs,
    bytesSent: totals.bytesSent,
    framesEncoded: totals.framesEncoded,
    sourceKey: totals.sourceKey,
  }
  if (!previous || previous.sourceKey !== snapshot.sourceKey) {
    return { status: 'initial', snapshot, fps: null, bitrateBps: null }
  }

  const elapsedMs = snapshot.timestampMs - previous.timestampMs
  const byteDelta = snapshot.bytesSent - previous.bytesSent
  const frameDelta = snapshot.framesEncoded - previous.framesEncoded
  if (elapsedMs <= 0 || byteDelta < 0 || frameDelta < 0) {
    return { status: 'initial', snapshot, fps: null, bitrateBps: null }
  }

  return {
    status: frameDelta === 0 ? 'static' : 'sending',
    snapshot,
    fps: (frameDelta * 1_000) / elapsedMs,
    bitrateBps: (byteDelta * 8_000) / elapsedMs,
  }
}

export function aggregateScreenShareSendTelemetry(
  samples: ScreenShareSenderStatsSample[],
  peerCount: number,
): ScreenShareSendTelemetry {
  const safePeerCount = Math.max(0, peerCount)
  if (!safePeerCount) {
    return {
      status: 'waiting',
      fps: null,
      bitrateMbps: null,
      peerCount: 0,
      sampledPeerCount: 0,
      complete: true,
    }
  }

  const measured = samples.filter(
    (sample) => sample.fps !== null && sample.bitrateBps !== null,
  )
  const complete = measured.length === safePeerCount
  if (!measured.length) {
    const isSampling = samples.some((sample) => sample.status === 'initial')
    return {
      status: isSampling ? 'sampling' : 'unavailable',
      fps: null,
      bitrateMbps: null,
      peerCount: safePeerCount,
      sampledPeerCount: 0,
      complete: false,
    }
  }

  const fps = Math.min(...measured.map((sample) => sample.fps as number))
  const bitrateBps = measured.reduce(
    (total, sample) => total + (sample.bitrateBps as number),
    0,
  )
  const allStatic = complete && measured.every((sample) => sample.status === 'static')

  return {
    status: allStatic ? 'static' : 'sending',
    fps,
    bitrateMbps: bitrateBps / 1_000_000,
    peerCount: safePeerCount,
    sampledPeerCount: measured.length,
    complete,
  }
}

