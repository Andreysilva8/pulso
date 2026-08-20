export type ScreenShareResolution = 480 | 720 | 1080
export type ScreenShareFrameRate = 15 | 30 | 60

export type ScreenShareSettings = {
  resolution: ScreenShareResolution
  frameRate: ScreenShareFrameRate
}

export const SCREEN_SHARE_RESOLUTION_OPTIONS = [
  { resolution: 480, width: 854, label: '480p', description: 'Economiza internet' },
  { resolution: 720, width: 1280, label: '720p', description: 'Mais estável' },
  { resolution: 1080, width: 1920, label: '1080p', description: 'Mais detalhes' },
] as const

export const SCREEN_SHARE_FRAME_RATE_OPTIONS = [15, 30, 60] as const

export const DEFAULT_SCREEN_SHARE_SETTINGS: ScreenShareSettings = {
  resolution: 720,
  frameRate: 30,
}

export const DESKTOP_SCREEN_SHARE_SETTINGS: ScreenShareSettings = {
  resolution: 720,
  frameRate: 60,
}

export const SCREEN_SHARE_SETTINGS_STORAGE_KEY = 'pulso:screen-share-settings'

export function isPulsoDesktop(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
) {
  return /\bElectron\/\d+/i.test(userAgent)
}

export function preferredScreenShareSettings(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): ScreenShareSettings {
  return isPulsoDesktop(userAgent)
    ? { ...DESKTOP_SCREEN_SHARE_SETTINGS }
    : { ...DEFAULT_SCREEN_SHARE_SETTINGS }
}

export function isScreenShareSettings(value: unknown): value is ScreenShareSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<ScreenShareSettings>
  return SCREEN_SHARE_RESOLUTION_OPTIONS.some(({ resolution }) => resolution === settings.resolution)
    && SCREEN_SHARE_FRAME_RATE_OPTIONS.includes(settings.frameRate as ScreenShareFrameRate)
}

export function loadScreenShareSettings(
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): ScreenShareSettings {
  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(SCREEN_SHARE_SETTINGS_STORAGE_KEY) || 'null')
      if (isScreenShareSettings(saved)) return { ...saved }
    } catch {
      // Ignore inaccessible storage and malformed preferences.
    }
  }
  return preferredScreenShareSettings(userAgent)
}

export function saveScreenShareSettings(
  settings: ScreenShareSettings,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  if (!storage || !isScreenShareSettings(settings)) return false
  try {
    storage.setItem(SCREEN_SHARE_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

const BITRATE_BY_RESOLUTION: Record<ScreenShareResolution, Record<ScreenShareFrameRate, number>> = {
  480: { 15: 700_000, 30: 1_200_000, 60: 2_000_000 },
  720: { 15: 1_200_000, 30: 3_000_000, 60: 5_000_000 },
  1080: { 15: 2_200_000, 30: 4_500_000, 60: 8_000_000 },
}

export function screenShareProfile(settings: ScreenShareSettings = DEFAULT_SCREEN_SHARE_SETTINGS) {
  const resolution = SCREEN_SHARE_RESOLUTION_OPTIONS.find(
    (option) => option.resolution === settings.resolution,
  ) || SCREEN_SHARE_RESOLUTION_OPTIONS[1]
  return {
    width: resolution.width,
    height: resolution.resolution,
    frameRate: settings.frameRate,
    maxBitrate: BITRATE_BY_RESOLUTION[resolution.resolution][settings.frameRate],
    estimatedMbps: BITRATE_BY_RESOLUTION[resolution.resolution][settings.frameRate] / 1_000_000,
  }
}

export function screenShareSenderBitrate(
  settings: ScreenShareSettings = DEFAULT_SCREEN_SHARE_SETTINGS,
  peerCount = 1,
) {
  const profile = screenShareProfile(settings)
  const uploadShare = Math.max(1, Math.max(1, peerCount) * 0.72)
  return Math.max(650_000, Math.floor(profile.maxBitrate / uploadShare))
}

const DEFAULT_SCREEN_SHARE_PROFILE = screenShareProfile()

export const SCREEN_SHARE_WIDTH = DEFAULT_SCREEN_SHARE_PROFILE.width
export const SCREEN_SHARE_HEIGHT = DEFAULT_SCREEN_SHARE_PROFILE.height
export const SCREEN_SHARE_FRAME_RATE = DEFAULT_SCREEN_SHARE_PROFILE.frameRate
export const SCREEN_SHARE_MAX_BITRATE = DEFAULT_SCREEN_SHARE_PROFILE.maxBitrate

export function screenShareVideoConstraints(
  settings: ScreenShareSettings = DEFAULT_SCREEN_SHARE_SETTINGS,
): MediaTrackConstraints {
  const profile = screenShareProfile(settings)
  return {
    width: { ideal: profile.width, max: profile.width },
    height: { ideal: profile.height, max: profile.height },
    frameRate: { ideal: profile.frameRate, max: profile.frameRate },
  }
}

export const SCREEN_SHARE_VIDEO_CONSTRAINTS = screenShareVideoConstraints()

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
  settings: ScreenShareSettings = DEFAULT_SCREEN_SHARE_SETTINGS,
): DisplayMediaStreamOptions {
  const audio: ScreenAudioConstraints = {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  }
  if (supported.restrictOwnAudio) audio.restrictOwnAudio = { ideal: true }
  if (supported.suppressLocalAudioPlayback) audio.suppressLocalAudioPlayback = { ideal: true }

  return {
    video: screenShareVideoConstraints(settings),
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

export async function configureScreenTrack(
  track: MediaStreamTrack,
  settings: ScreenShareSettings = DEFAULT_SCREEN_SHARE_SETTINGS,
): Promise<ScreenShareQuality> {
  if ('contentHint' in track) track.contentHint = settings.frameRate >= 60 ? 'motion' : 'detail'

  try {
    await track.applyConstraints(screenShareVideoConstraints(settings))
  } catch {
    // Some browsers only apply display constraints during getDisplayMedia.
    // Keep the selected stream instead of aborting the share.
  }

  const actual = track.getSettings()
  return {
    width: actual.width,
    height: actual.height,
    frameRate: actual.frameRate,
  }
}

export async function configureScreenSender(
  sender: RTCRtpSender,
  settings: ScreenShareSettings = DEFAULT_SCREEN_SHARE_SETTINGS,
  peerCount = 1,
) {
  const parameters = sender.getParameters()
  if (!parameters.encodings.length) return false

  const profile = screenShareProfile(settings)
  const peerBitrate = screenShareSenderBitrate(settings, peerCount)

  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = peerBitrate
    encoding.maxFramerate = profile.frameRate
    encoding.scaleResolutionDownBy = 1
    encoding.priority = 'high'
    encoding.networkPriority = 'high'
  }
  parameters.degradationPreference = settings.frameRate >= 60 ? 'maintain-framerate' : 'balanced'

  try {
    await sender.setParameters(parameters)
    return true
  } catch {
    // The sender may not be negotiated yet. It is configured again as soon as
    // the peer connection reaches the connected state.
    return false
  }
}
