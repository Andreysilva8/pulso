import { describe, expect, it, vi } from 'vitest'
import {
  SCREEN_SHARE_DISPLAY_OPTIONS,
  SCREEN_SHARE_FRAME_RATE,
  SCREEN_SHARE_HEIGHT,
  SCREEN_SHARE_MAX_BITRATE,
  SCREEN_SHARE_VIDEO_CONSTRAINTS,
  SCREEN_SHARE_WIDTH,
  configureScreenSender,
  selectSafeScreenAudio,
} from './screenShare'

describe('screen-share quality profile', () => {
  it('requests Full HD at 60 frames per second', () => {
    expect(SCREEN_SHARE_WIDTH).toBe(1920)
    expect(SCREEN_SHARE_HEIGHT).toBe(1080)
    expect(SCREEN_SHARE_FRAME_RATE).toBe(60)
    expect(SCREEN_SHARE_VIDEO_CONSTRAINTS).toMatchObject({
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
  })

  it('reserves enough sender bitrate for high-motion Full HD sharing', () => {
    expect(SCREEN_SHARE_MAX_BITRATE).toBeGreaterThanOrEqual(10_000_000)
  })

  it('excludes the Pulso tab and asks the browser for isolated window audio', () => {
    expect(SCREEN_SHARE_DISPLAY_OPTIONS).toMatchObject({
      selfBrowserSurface: 'exclude',
      windowAudio: 'window',
      systemAudio: 'exclude',
      preferCurrentTab: false,
      audio: {
        restrictOwnAudio: { ideal: true },
      },
    })
  })

  it('removes system-wide audio before it can create a feedback loop', () => {
    const audioTrack = {
      readyState: 'live',
      stop: vi.fn(),
      contentHint: '',
    } as unknown as MediaStreamTrack
    const removeTrack = vi.fn()
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getAudioTracks: () => [audioTrack],
      removeTrack,
    } as unknown as MediaStream

    expect(selectSafeScreenAudio(stream)).toMatchObject({
      track: null,
      blockedSystemAudio: true,
      displaySurface: 'monitor',
    })
    expect(audioTrack.stop).toHaveBeenCalledOnce()
    expect(removeTrack).toHaveBeenCalledWith(audioTrack)
  })

  it('keeps isolated window audio available to the call', () => {
    const audioTrack = {
      readyState: 'live',
      stop: vi.fn(),
      contentHint: '',
    } as unknown as MediaStreamTrack
    const stream = {
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'window' }) }],
      getAudioTracks: () => [audioTrack],
      removeTrack: vi.fn(),
    } as unknown as MediaStream

    expect(selectSafeScreenAudio(stream)).toMatchObject({
      track: audioTrack,
      blockedSystemAudio: false,
      displaySurface: 'window',
    })
    expect(audioTrack.stop).not.toHaveBeenCalled()
    expect(audioTrack.contentHint).toBe('music')
  })

  it('prioritizes smooth motion when configuring the WebRTC sender', async () => {
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
    expect(parameters.degradationPreference).toBe('maintain-framerate')
    expect(parameters.encodings[0]).toMatchObject({
      maxBitrate: 12_000_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1,
      priority: 'high',
      networkPriority: 'high',
    })
    expect(setParameters).toHaveBeenCalledWith(parameters)
  })
})
