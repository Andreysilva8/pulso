import { describe, expect, it, vi } from 'vitest'
import {
  SCREEN_SHARE_DISPLAY_OPTIONS,
  SCREEN_SHARE_FRAME_RATE,
  SCREEN_SHARE_HEIGHT,
  SCREEN_SHARE_MAX_BITRATE,
  SCREEN_SHARE_VIDEO_CONSTRAINTS,
  SCREEN_SHARE_WIDTH,
  configureScreenSender,
  createScreenShareDisplayOptions,
  prepareSafeScreenAudio,
  screenShareProfile,
  screenShareSenderBitrate,
  screenShareVideoConstraints,
} from './screenShare'

describe('screen-share quality profile', () => {
  it('defaults to the stable 720p at 30 frames per second profile', () => {
    expect(SCREEN_SHARE_WIDTH).toBe(1280)
    expect(SCREEN_SHARE_HEIGHT).toBe(720)
    expect(SCREEN_SHARE_FRAME_RATE).toBe(30)
    expect(SCREEN_SHARE_VIDEO_CONSTRAINTS).toMatchObject({
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 30, max: 30 },
    })
    expect(SCREEN_SHARE_MAX_BITRATE).toBe(3_000_000)
  })

  it.each([
    [480, 15, 854, 480, 700_000],
    [480, 60, 854, 480, 2_000_000],
    [720, 30, 1280, 720, 3_000_000],
    [720, 60, 1280, 720, 5_000_000],
    [1080, 30, 1920, 1080, 4_500_000],
    [1080, 60, 1920, 1080, 8_000_000],
  ] as const)('maps %ip at %i fps to its constraints and bitrate', (resolution, frameRate, width, height, maxBitrate) => {
    const settings = { resolution, frameRate }
    expect(screenShareProfile(settings)).toMatchObject({ width, height, frameRate, maxBitrate })
    expect(screenShareVideoConstraints(settings)).toEqual({
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: frameRate, max: frameRate },
    })
  })

  it('offers protected system audio and excludes the Pulso tab', () => {
    expect(SCREEN_SHARE_DISPLAY_OPTIONS).toMatchObject({
      selfBrowserSurface: 'exclude',
      windowAudio: 'window',
      systemAudio: 'include',
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'exclude',
      preferCurrentTab: false,
      audio: {
        restrictOwnAudio: { ideal: true },
        suppressLocalAudioPlayback: { ideal: true },
      },
    })
  })

  it('only requests experimental audio constraints when the browser supports them', () => {
    const options = createScreenShareDisplayOptions({}, { resolution: 1080, frameRate: 60 })
    expect(options.audio).toMatchObject({ echoCancellation: { ideal: true } })
    expect(options.audio).not.toHaveProperty('restrictOwnAudio')
    expect(options.audio).not.toHaveProperty('suppressLocalAudioPlayback')
    expect(options.video).toMatchObject({
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
  })

  it('keeps system-wide audio when the browser confirms own-audio filtering', async () => {
    const audioTrack = {
      readyState: 'live',
      stop: vi.fn(),
      contentHint: '',
      getSettings: () => ({ restrictOwnAudio: true }),
      applyConstraints: vi.fn(),
    } as unknown as MediaStreamTrack
    const removeTrack = vi.fn()
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getAudioTracks: () => [audioTrack],
      removeTrack,
    } as unknown as MediaStream

    await expect(prepareSafeScreenAudio(stream)).resolves.toMatchObject({
      track: audioTrack,
      ownAudioRestricted: true,
      blockedSystemAudio: false,
      systemWide: true,
      displaySurface: 'monitor',
    })
    expect(audioTrack.applyConstraints).not.toHaveBeenCalled()
    expect(audioTrack.stop).not.toHaveBeenCalled()
    expect(removeTrack).not.toHaveBeenCalled()
  })

  it('applies strict filtering after capture before accepting monitor audio', async () => {
    let restricted = false
    const audioTrack = {
      readyState: 'live',
      stop: vi.fn(),
      contentHint: '',
      getSettings: () => ({ restrictOwnAudio: restricted }),
      applyConstraints: vi.fn().mockImplementation(async () => { restricted = true }),
    } as unknown as MediaStreamTrack
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream

    await expect(prepareSafeScreenAudio(stream)).resolves.toMatchObject({
      track: audioTrack,
      ownAudioRestricted: true,
      blockedSystemAudio: false,
    })
    expect(audioTrack.applyConstraints).toHaveBeenCalledWith({ restrictOwnAudio: { exact: true } })
  })

  it('blocks unfiltered monitor audio before it reaches WebRTC or the relay', async () => {
    const audioTrack = {
      readyState: 'live',
      stop: vi.fn(),
      contentHint: '',
      getSettings: () => ({ restrictOwnAudio: false }),
      applyConstraints: vi.fn().mockRejectedValue(new DOMException('unsupported', 'OverconstrainedError')),
    } as unknown as MediaStreamTrack
    const removeTrack = vi.fn()
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getAudioTracks: () => [audioTrack],
      removeTrack,
    } as unknown as MediaStream

    await expect(prepareSafeScreenAudio(stream)).resolves.toMatchObject({
      track: null,
      ownAudioRestricted: false,
      blockedSystemAudio: true,
      systemWide: true,
    })
    expect(audioTrack.stop).toHaveBeenCalledOnce()
    expect(removeTrack).toHaveBeenCalledWith(audioTrack)
  })

  it('keeps isolated window audio available to the call', async () => {
    const audioTrack = {
      readyState: 'live',
      stop: vi.fn(),
      contentHint: '',
      getSettings: () => ({}),
      applyConstraints: vi.fn(),
    } as unknown as MediaStreamTrack
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'window' }) }],
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream

    await expect(prepareSafeScreenAudio(stream)).resolves.toMatchObject({
      track: audioTrack,
      blockedSystemAudio: false,
      systemWide: false,
      displaySurface: 'window',
    })
    expect(audioTrack.applyConstraints).not.toHaveBeenCalled()
    expect(audioTrack.stop).not.toHaveBeenCalled()
    expect(audioTrack.contentHint).toBe('music')
  })

  it('uses a balanced sender for the stable default profile', async () => {
    const parameters: RTCRtpSendParameters = {
      codecs: [],
      encodings: [{}],
      headerExtensions: [],
      rtcp: { cname: '', reducedSize: true },
      transactionId: 'screen-test',
    }
    const setParameters = vi.fn().mockResolvedValue(undefined)
    const sender = { getParameters: () => parameters, setParameters } as unknown as RTCRtpSender

    await expect(configureScreenSender(sender)).resolves.toBe(true)
    expect(parameters.degradationPreference).toBe('balanced')
    expect(parameters.encodings[0]).toMatchObject({
      maxBitrate: 3_000_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1,
      priority: 'high',
      networkPriority: 'high',
    })
    expect(setParameters).toHaveBeenCalledWith(parameters)
  })

  it('caps 1080p60 and divides the available upload as viewers join', async () => {
    const parameters: RTCRtpSendParameters = {
      codecs: [],
      encodings: [{}],
      headerExtensions: [],
      rtcp: { cname: '', reducedSize: true },
      transactionId: 'screen-motion-test',
    }
    const setParameters = vi.fn().mockResolvedValue(undefined)
    const sender = { getParameters: () => parameters, setParameters } as unknown as RTCRtpSender
    const settings = { resolution: 1080, frameRate: 60 } as const

    expect(screenShareSenderBitrate(settings, 3)).toBeLessThan(8_000_000)
    await expect(configureScreenSender(sender, settings, 3)).resolves.toBe(true)
    expect(parameters.degradationPreference).toBe('maintain-framerate')
    expect(parameters.encodings[0]).toMatchObject({
      maxBitrate: screenShareSenderBitrate(settings, 3),
      maxFramerate: 60,
    })
  })
})
