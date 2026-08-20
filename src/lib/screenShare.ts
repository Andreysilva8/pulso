export const SCREEN_SHARE_WIDTH = 1920
export const SCREEN_SHARE_HEIGHT = 1080
export const SCREEN_SHARE_FRAME_RATE = 60
export const SCREEN_SHARE_MAX_BITRATE = 12_000_000

export const SCREEN_SHARE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: SCREEN_SHARE_WIDTH, max: SCREEN_SHARE_WIDTH },
  height: { ideal: SCREEN_SHARE_HEIGHT, max: SCREEN_SHARE_HEIGHT },
  frameRate: { ideal: SCREEN_SHARE_FRAME_RATE, max: SCREEN_SHARE_FRAME_RATE },
}

export type ScreenShareQuality = {
  width?: number
  height?: number
  frameRate?: number
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
  }
  parameters.degradationPreference = 'maintain-resolution'

  try {
    await sender.setParameters(parameters)
    return true
  } catch {
    // The sender may not be negotiated yet. It is configured again as soon as
    // the peer connection reaches the connected state.
    return false
  }
}
