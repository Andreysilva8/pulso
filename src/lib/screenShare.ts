export const SCREEN_SHARE_WIDTH = 1920
export const SCREEN_SHARE_HEIGHT = 1080
export const SCREEN_SHARE_FRAME_RATE = 60
export const SCREEN_SHARE_MAX_BITRATE = 12_000_000

export const SCREEN_SHARE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: SCREEN_SHARE_WIDTH, max: SCREEN_SHARE_WIDTH },
  height: { ideal: SCREEN_SHARE_HEIGHT, max: SCREEN_SHARE_HEIGHT },
  frameRate: { ideal: SCREEN_SHARE_FRAME_RATE, max: SCREEN_SHARE_FRAME_RATE },
}

type ScreenAudioConstraints = MediaTrackConstraints & {
  restrictOwnAudio?: ConstrainBoolean
  suppressLocalAudioPlayback?: ConstrainBoolean
}

type ScreenSupportedConstraints = MediaTrackSupportedConstraints & {
  restrictOwnAudio?: boolean
  suppressLocalAudioPlayback?: boolean
}

export function createScreenShareDisplayOptions(
  supported: ScreenSupportedConstraints = {},
): DisplayMediaStreamOptions {
  const audio: ScreenAudioConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  }
  if (supported.restrictOwnAudio) audio.restrictOwnAudio = { ideal: true }
  if (supported.suppressLocalAudioPlayback) audio.suppressLocalAudioPlayback = { ideal: true }

  return {
    video: SCREEN_SHARE_VIDEO_CONSTRAINTS,
    audio,
    systemAudio: 'include',
    windowAudio: 'window',
    monitorTypeSurfaces: 'include',
    selfBrowserSurface: 'exclude',
    // Prevent changing to an unverified source after the audio safety check.
    surfaceSwitching: 'exclude',
    preferCurrentTab: false,
  } as DisplayMediaStreamOptions
}

export const SCREEN_SHARE_DISPLAY_OPTIONS = createScreenShareDisplayOptions({
  restrictOwnAudio: true,
  suppressLocalAudioPlayback: true,
} as ScreenSupportedConstraints)

export type ScreenShareQuality = {
  width?: number
  height?: number
  frameRate?: number
}

export type ScreenAudioSafety = {
  track: MediaStreamTrack | null
  systemWide: boolean
  ownAudioRestricted: boolean
  blockedSystemAudio: boolean
  displaySurface?: string
}

type ExtendedAudioSettings = MediaTrackSettings & {
  restrictOwnAudio?: boolean
}

export async function prepareSafeScreenAudio(stream: MediaStream): Promise<ScreenAudioSafety> {
  const screenTrack = stream.getVideoTracks()[0]
  const displaySurface = screenTrack?.getSettings().displaySurface
  let audioTrack = stream.getAudioTracks().find((track) => track.readyState === 'live') || null
  const systemWide = displaySurface === 'monitor' && Boolean(audioTrack)
  let ownAudioRestricted = Boolean(
    audioTrack && (audioTrack.getSettings() as ExtendedAudioSettings).restrictOwnAudio,
  )

  if (systemWide && audioTrack && !ownAudioRestricted) {
    try {
      await audioTrack.applyConstraints({ restrictOwnAudio: { exact: true } } as ScreenAudioConstraints)
      ownAudioRestricted = Boolean((audioTrack.getSettings() as ExtendedAudioSettings).restrictOwnAudio)
    } catch {
      // Older browsers do not support this constraint. The unfiltered track
      // is rejected below before it can reach WebRTC or the relay.
    }
  }

  const blockedSystemAudio = systemWide && !ownAudioRestricted
  if (blockedSystemAudio && audioTrack) {
    audioTrack.stop()
    stream.removeTrack(audioTrack)
    audioTrack = null
  }

  if (audioTrack && 'contentHint' in audioTrack) audioTrack.contentHint = 'music'

  return {
    track: audioTrack,
    systemWide,
    ownAudioRestricted,
    blockedSystemAudio,
    displaySurface,
  }
}

export async function configureScreenTrack(track: MediaStreamTrack): Promise<ScreenShareQuality> {
  if ('contentHint' in track) track.contentHint = 'motion'

  try {
    await track.applyConstraints(SCREEN_SHARE_VIDEO_CONSTRAINTS)
  } catch {
    // Some browsers only apply display constraints during getDisplayMedia.
    // Keep the selected stream instead of aborting the share.
  }

  const settings = track.getSettings()
  return {
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
  }
}

export async function configureScreenSender(sender: RTCRtpSender) {
  const parameters = sender.getParameters()
  if (!parameters.encodings.length) return false

  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = SCREEN_SHARE_MAX_BITRATE
    encoding.maxFramerate = SCREEN_SHARE_FRAME_RATE
    encoding.scaleResolutionDownBy = 1
    encoding.priority = 'high'
    encoding.networkPriority = 'high'
  }
  // Preserve motion first. Under congestion the browser may soften the image,
  // but it should avoid turning a 60 fps share into a frozen slideshow.
  parameters.degradationPreference = 'maintain-framerate'

  try {
    await sender.setParameters(parameters)
    return true
  } catch {
    // The sender may not be negotiated yet. It is configured again as soon as
    // the peer connection reaches the connected state.
    return false
  }
}
