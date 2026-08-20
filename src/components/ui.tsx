import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { LoaderCircle, MicOff, MonitorUp, Radio, Volume2, VolumeX, WifiOff } from 'lucide-react'
import type { CallParticipant, Profile, ScreenRelayFrame } from '../types'
import { SCREEN_RELAY_FRAME_RATE } from '../lib/screenRelay'

const VOLUME_CONTROLS_IDLE_MS = 2_500

export function Avatar({
  profile,
  size = 'medium',
  online,
  className = '',
}: {
  profile: Pick<Profile, 'name' | 'initials' | 'color'>
  size?: 'small' | 'medium' | 'large' | 'hero'
  online?: boolean
  className?: string
}) {
  return (
    <span
      className={`avatar avatar--${size} ${className}`}
      style={{ '--avatar-color': profile.color } as React.CSSProperties}
      aria-label={profile.name}
    >
      <span aria-hidden="true">{profile.initials}</span>
      {online !== undefined && <i className={online ? 'is-online' : 'is-offline'} aria-label={online ? 'Online' : 'Offline'} />}
    </span>
  )
}

export function IconButton({
  icon: Icon,
  label,
  active = false,
  tone = 'default',
  badge,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  active?: boolean
  tone?: 'default' | 'danger' | 'mint' | 'coral'
  badge?: string | number
}) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${tone} ${active ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      {...props}
    >
      <Icon size={19} strokeWidth={2} />
      {badge !== undefined && <span className="icon-button__badge">{badge}</span>}
    </button>
  )
}

export function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={`connection-pill ${connected ? 'is-connected' : 'is-offline'}`}>
      <span className="connection-pill__dot" />
      {connected ? 'Sincronizado' : 'Reconectando'}
    </span>
  )
}

type MediaElementKind = 'audio' | 'video'

function useMediaElement<Element extends HTMLMediaElement>(
  stream: MediaStream | null,
  muted: boolean,
  kind: MediaElementKind,
) {
  const ref = useRef<Element>(null)
  const [ready, setReady] = useState(false)
  const [stalled, setStalled] = useState(false)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)

  const retry = useCallback(async () => {
    const element = ref.current
    if (!element?.srcObject) return
    try {
      await element.play()
      setPlaybackBlocked(false)
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') {
        setPlaybackBlocked(true)
      }
    }
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element) return

    element.muted = muted
    element.defaultMuted = muted
    setReady(false)
    setStalled(false)
    setPlaybackBlocked(false)

    const updateReadyState = () => {
      if (kind === 'audio') {
        setReady(Boolean(element.srcObject && stream?.getAudioTracks().some((track) => track.readyState === 'live')))
        return
      }
      const video = element as unknown as HTMLVideoElement
      setReady(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0)
    }

    const play = () => {
      if (!element.srcObject) return
      void element.play()
        .then(() => {
          setPlaybackBlocked(false)
          updateReadyState()
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException) || error.name !== 'AbortError') {
            setPlaybackBlocked(true)
          }
        })
    }

    const tracks = () => kind === 'video' ? stream?.getVideoTracks() || [] : stream?.getAudioTracks() || []
    const attachTracks = () => {
      const selectedTracks = tracks().filter((track) => track.readyState === 'live')
      element.srcObject = selectedTracks.length ? new MediaStream(selectedTracks) : null
      setReady(false)
      if (element.srcObject) play()
    }
    const handleTrackReady = () => {
      setStalled(false)
      play()
      updateReadyState()
    }

    const tracked = new Set<MediaStreamTrack>()
    const watchTracks = () => {
      for (const track of tracked) {
        track.removeEventListener('unmute', handleTrackReady)
        track.removeEventListener('mute', handleVideoMuted)
        track.removeEventListener('ended', attachTracks)
      }
      tracked.clear()
      for (const track of tracks()) {
        tracked.add(track)
        track.addEventListener('unmute', handleTrackReady)
        if (kind === 'video') track.addEventListener('mute', handleVideoMuted)
        track.addEventListener('ended', attachTracks)
      }
    }

    function handleVideoMuted() {
      setStalled(true)
    }
    const handleTrackChange = () => {
      watchTracks()
      attachTracks()
    }

    element.addEventListener('loadeddata', updateReadyState)
    element.addEventListener('canplay', updateReadyState)
    element.addEventListener('playing', updateReadyState)
    element.addEventListener('resize', updateReadyState)
    element.addEventListener('emptied', updateReadyState)
    stream?.addEventListener('addtrack', handleTrackChange)
    stream?.addEventListener('removetrack', handleTrackChange)
    watchTracks()
    attachTracks()

    let frameRequest = 0
    if (kind === 'video') {
      const video = element as unknown as HTMLVideoElement
      if (video.requestVideoFrameCallback) {
        const handleFrame: VideoFrameRequestCallback = () => {
          setStalled(false)
          frameRequest = video.requestVideoFrameCallback(handleFrame)
        }
        frameRequest = video.requestVideoFrameCallback(handleFrame)
      }
    }

    return () => {
      element.removeEventListener('loadeddata', updateReadyState)
      element.removeEventListener('canplay', updateReadyState)
      element.removeEventListener('playing', updateReadyState)
      element.removeEventListener('resize', updateReadyState)
      element.removeEventListener('emptied', updateReadyState)
      stream?.removeEventListener('addtrack', handleTrackChange)
      stream?.removeEventListener('removetrack', handleTrackChange)
      for (const track of tracked) {
        track.removeEventListener('unmute', handleTrackReady)
        track.removeEventListener('mute', handleVideoMuted)
        track.removeEventListener('ended', attachTracks)
      }
      if (frameRequest) (element as unknown as HTMLVideoElement).cancelVideoFrameCallback(frameRequest)
      element.pause()
      element.srcObject = null
    }
  }, [kind, muted, stream])

  return { ref, ready, stalled, playbackBlocked, retry }
}

function useSpeaking(stream: MediaStream | null, enabled: boolean) {
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    if (!stream || !enabled || !stream.getAudioTracks().length) {
      setSpeaking(false)
      return
    }

    const AudioContextClass = window.AudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.72
    const source = context.createMediaStreamSource(stream)
    source.connect(analyser)
    const samples = new Uint8Array(analyser.frequencyBinCount)

    const interval = window.setInterval(() => {
      analyser.getByteFrequencyData(samples)
      const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
      setSpeaking(average > 12)
    }, 140)

    return () => {
      window.clearInterval(interval)
      source.disconnect()
      void context.close()
    }
  }, [enabled, stream])

  return speaking
}

export function MediaPreview({
  stream,
  cameraOn,
  profile,
}: {
  stream: MediaStream | null
  cameraOn: boolean
  profile: Profile
}) {
  const video = useMediaElement<HTMLVideoElement>(stream, true, 'video')
  return (
    <div className="media-preview">
      <video ref={video.ref} autoPlay muted playsInline className={!cameraOn ? 'is-hidden' : ''} />
      {!cameraOn && (
        <div className="media-preview__avatar">
          <Avatar profile={profile} size="hero" />
          <span>Câmera desligada</span>
        </div>
      )}
      <div className="media-preview__shade" />
      <span className="media-preview__label">Prévia</span>
    </div>
  )
}

export function ParticipantTile({
  participant,
  stream,
  voiceStream,
  screenAudioStream,
  local = false,
  connectionState,
  fallbackFrame,
  relayAudioBlocked = false,
  onResumeRelayAudio,
  onScreenVolumeChange,
  onRequestRelay,
  onReleaseRelay,
  spotlight = false,
  onSpotlight,
}: {
  participant: CallParticipant
  stream: MediaStream | null
  voiceStream?: MediaStream | null
  screenAudioStream?: MediaStream | null
  local?: boolean
  connectionState?: RTCPeerConnectionState
  fallbackFrame?: ScreenRelayFrame | null
  relayAudioBlocked?: boolean
  onResumeRelayAudio?: () => void
  onScreenVolumeChange?: (peerId: string, volume: number) => void
  onRequestRelay?: (peerId: string) => void
  onReleaseRelay?: (peerId: string) => void
  spotlight?: boolean
  onSpotlight?: () => void
}) {
  const expectsVideo = participant.media.camera || participant.media.screen
  const video = useMediaElement<HTMLVideoElement>(stream, true, 'video')
  const resolvedVoiceStream = !local && participant.media.microphone
    ? voiceStream || (!screenAudioStream ? stream : null)
    : null
  const resolvedScreenAudioStream = !local && participant.media.screenAudio
    ? screenAudioStream || (!participant.media.microphone && !voiceStream ? stream : null)
    : null
  const voiceAudio = useMediaElement<HTMLAudioElement>(resolvedVoiceStream, false, 'audio')
  const screenAudio = useMediaElement<HTMLAudioElement>(resolvedScreenAudioStream, false, 'audio')
  const [voiceVolume, setVoiceVolume] = useState(1)
  const [screenVolume, setScreenVolume] = useState(1)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [volumeControlsVisible, setVolumeControlsVisible] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const participantTileRef = useRef<HTMLElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const previousVolumesRef = useRef({ voice: 1, screen: 1 })
  const volumeControlsIdleTimerRef = useRef<number | null>(null)
  const volumeControlsLastActivityRef = useRef(0)
  const connectionFailed = connectionState === 'failed'
  const connectionInterrupted = connectionState === 'disconnected'
  const directVideoUnavailable = video.stalled || connectionFailed || connectionInterrupted
  const visibleVideo = expectsVideo && video.ready && !directVideoUnavailable
  const visibleFallback = Boolean(participant.media.screen && !visibleVideo && fallbackFrame)
  const visibleMedia = visibleVideo || visibleFallback
  const speaking = useSpeaking(resolvedVoiceStream, participant.media.microphone)
  const playbackBlocked = video.playbackBlocked || voiceAudio.playbackBlocked
    || screenAudio.playbackBlocked || relayAudioBlocked
  const pendingTitle = connectionFailed
    ? 'Transmissão sem conexão'
    : connectionInterrupted
      ? 'Reconectando à transmissão…'
      : participant.media.screen
        ? video.stalled ? 'Recuperando transmissão…' : 'Conectando à transmissão…'
        : 'Conectando à câmera…'
  const pendingDetail = connectionFailed
    ? 'A rede não conseguiu receber a mídia. Tentaremos conectar novamente.'
    : 'A imagem aparecerá assim que o primeiro quadro chegar.'
  const relayRequestedRef = useRef(false)
  const hasVoiceVolume = !local && participant.media.microphone
  const hasScreenVolume = !local && participant.media.screenAudio
  const hasVolumeControls = hasVoiceVolume || hasScreenVolume
  const volumeControlsPinned = volumeOpen || contextMenu !== null
  const participantMuted = (hasVoiceVolume || hasScreenVolume)
    && (!hasVoiceVolume || voiceVolume === 0)
    && (!hasScreenVolume || screenVolume === 0)

  const clearVolumeControlsIdleTimer = useCallback(() => {
    if (volumeControlsIdleTimerRef.current === null) return
    window.clearTimeout(volumeControlsIdleTimerRef.current)
    volumeControlsIdleTimerRef.current = null
  }, [])

  const scheduleVolumeControlsIdleCheck = useCallback(() => {
    if (!hasVolumeControls || volumeControlsPinned || volumeControlsIdleTimerRef.current !== null) return

    const checkIdle = () => {
      volumeControlsIdleTimerRef.current = null
      if (volumeControlsPinned) return

      const focusedElement = document.activeElement as HTMLElement | null
      const keyboardFocusInside = Boolean(
        focusedElement
          && participantTileRef.current?.contains(focusedElement)
          && focusedElement.matches?.(':focus-visible'),
      )
      if (keyboardFocusInside) {
        volumeControlsIdleTimerRef.current = window.setTimeout(checkIdle, VOLUME_CONTROLS_IDLE_MS)
        return
      }

      const remaining = VOLUME_CONTROLS_IDLE_MS - (Date.now() - volumeControlsLastActivityRef.current)
      if (remaining > 0) {
        volumeControlsIdleTimerRef.current = window.setTimeout(checkIdle, remaining)
        return
      }
      setVolumeControlsVisible(false)
    }

    const remaining = VOLUME_CONTROLS_IDLE_MS - (Date.now() - volumeControlsLastActivityRef.current)
    volumeControlsIdleTimerRef.current = window.setTimeout(checkIdle, Math.max(0, remaining))
  }, [hasVolumeControls, volumeControlsPinned])

  const revealVolumeControls = useCallback(() => {
    if (!hasVolumeControls) return
    volumeControlsLastActivityRef.current = Date.now()
    setVolumeControlsVisible(true)
    scheduleVolumeControlsIdleCheck()
  }, [hasVolumeControls, scheduleVolumeControlsIdleCheck])

  const handleTileBlur = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    volumeControlsLastActivityRef.current = Date.now()
    scheduleVolumeControlsIdleCheck()
  }, [scheduleVolumeControlsIdleCheck])

  useEffect(() => {
    clearVolumeControlsIdleTimer()
    if (!hasVolumeControls) return

    volumeControlsLastActivityRef.current = Date.now()
    setVolumeControlsVisible(true)
    if (!volumeControlsPinned) scheduleVolumeControlsIdleCheck()
    return clearVolumeControlsIdleTimer
  }, [
    clearVolumeControlsIdleTimer,
    hasVolumeControls,
    scheduleVolumeControlsIdleCheck,
    volumeControlsPinned,
  ])

  useEffect(() => {
    if (local || !participant.media.screen || visibleVideo || !onRequestRelay) {
      if (relayRequestedRef.current) {
        onReleaseRelay?.(participant.id)
        relayRequestedRef.current = false
      }
      return
    }

    let retryTimer = 0
    const requestRelay = () => {
      onRequestRelay(participant.id)
      relayRequestedRef.current = true
      retryTimer = window.setTimeout(requestRelay, 5_000)
    }
    const initialTimer = window.setTimeout(requestRelay, 4_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearTimeout(retryTimer)
      if (relayRequestedRef.current) {
        onReleaseRelay?.(participant.id)
        relayRequestedRef.current = false
      }
    }
  }, [local, onReleaseRelay, onRequestRelay, participant.id, participant.media.screen, visibleVideo])

  useEffect(() => {
    if (voiceAudio.ref.current) voiceAudio.ref.current.volume = voiceVolume
  }, [voiceAudio.ref, voiceVolume])

  useEffect(() => {
    if (screenAudio.ref.current) screenAudio.ref.current.volume = screenVolume
    if (!local) onScreenVolumeChange?.(participant.id, screenVolume)
  }, [local, onScreenVolumeChange, participant.id, screenAudio.ref, screenVolume])

  useEffect(() => {
    if (!volumeOpen && !contextMenu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVolumeOpen(false)
        setContextMenu(null)
      }
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('pointerdown', closeOnPointerDown, true)
    window.addEventListener('resize', closeContextMenu)
    window.addEventListener('scroll', closeContextMenu, true)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('pointerdown', closeOnPointerDown, true)
      window.removeEventListener('resize', closeContextMenu)
      window.removeEventListener('scroll', closeContextMenu, true)
    }
  }, [contextMenu, volumeOpen])

  const retryPlayback = () => {
    void video.retry()
    void voiceAudio.retry()
    void screenAudio.retry()
    onResumeRelayAudio?.()
  }

  const audibleVolume = Math.max(hasVoiceVolume ? voiceVolume : 0, hasScreenVolume ? screenVolume : 0)

  const changeVoiceVolume = (value: number) => {
    const safeValue = Math.max(0, Math.min(1, value))
    if (safeValue > 0) previousVolumesRef.current.voice = safeValue
    setVoiceVolume(safeValue)
  }

  const changeScreenVolume = (value: number) => {
    const safeValue = Math.max(0, Math.min(1, value))
    if (safeValue > 0) previousVolumesRef.current.screen = safeValue
    setScreenVolume(safeValue)
  }

  const toggleParticipantMute = () => {
    if (participantMuted) {
      if (hasVoiceVolume) setVoiceVolume(previousVolumesRef.current.voice || 1)
      if (hasScreenVolume) setScreenVolume(previousVolumesRef.current.screen || 1)
      return
    }
    if (hasVoiceVolume && voiceVolume > 0) previousVolumesRef.current.voice = voiceVolume
    if (hasScreenVolume && screenVolume > 0) previousVolumesRef.current.screen = screenVolume
    if (hasVoiceVolume) setVoiceVolume(0)
    if (hasScreenVolume) setScreenVolume(0)
  }

  const openContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (local || (!hasVoiceVolume && !hasScreenVolume)) return
    event.preventDefault()
    event.stopPropagation()
    revealVolumeControls()
    setVolumeOpen(false)
    const menuWidth = 264
    const menuHeight = hasVoiceVolume && hasScreenVolume ? 278 : 222
    setContextMenu({
      x: Math.max(10, Math.min(event.clientX, window.innerWidth - menuWidth - 10)),
      y: Math.max(10, Math.min(event.clientY, window.innerHeight - menuHeight - 10)),
    })
  }

  return (
    <article
      ref={participantTileRef}
      className={`participant-tile ${speaking ? 'is-speaking' : ''} ${spotlight ? 'is-spotlight' : ''} ${participant.media.screen ? 'is-screen' : ''} ${participantMuted ? 'is-locally-muted' : ''}`}
      aria-label={`${participant.name}${local ? ', você' : ', clique com o botão direito para controlar o áudio'}`}
      title={local ? undefined : 'Clique com o botão direito para mutar ou ajustar o volume'}
      onDoubleClick={onSpotlight}
      onContextMenu={openContextMenu}
      onPointerMove={revealVolumeControls}
      onTouchStart={revealVolumeControls}
      onFocusCapture={revealVolumeControls}
      onBlurCapture={handleTileBlur}
    >
      {stream && (
        <video
          ref={video.ref}
          autoPlay
          muted
          playsInline
          className={visibleVideo ? '' : 'participant-tile__video-pending'}
        />
      )}
      {visibleFallback && fallbackFrame && (
        <img
          className="participant-tile__relay-frame"
          src={fallbackFrame.dataUrl}
          alt={`Transmissão de tela de ${participant.name}`}
        />
      )}
      {resolvedVoiceStream && <audio ref={voiceAudio.ref} autoPlay className="participant-tile__audio-sink" />}
      {resolvedScreenAudioStream && <audio ref={screenAudio.ref} autoPlay className="participant-tile__audio-sink" />}
      {!visibleMedia && (
        <div className={`participant-tile__identity ${expectsVideo ? 'is-pending-media' : ''}`}>
          <div className="voice-rings" aria-hidden="true">
            <span />
            <span />
          </div>
          <Avatar profile={participant} size="hero" />
          {expectsVideo && (
            <div className={`participant-tile__media-status ${connectionFailed ? 'is-failed' : ''}`} role="status">
              <span className="participant-tile__media-status-icon" aria-hidden="true">
                {connectionFailed ? <WifiOff size={17} /> : <LoaderCircle size={17} />}
              </span>
              <strong>{pendingTitle}</strong>
              <span>{pendingDetail}</span>
            </div>
          )}
        </div>
      )}
      <div className="participant-tile__scrim" />
      <div className="participant-tile__topline">
        {participant.media.screen && (
          <span className="media-chip media-chip--screen"><MonitorUp size={13} /> Transmitindo</span>
        )}
        {visibleFallback && (
          <span className="media-chip media-chip--relay"><Radio size={13} /> Compatível · {SCREEN_RELAY_FRAME_RATE} fps</span>
        )}
        {participant.media.screen && (
          <span className={`media-chip ${participant.media.screenAudio ? 'media-chip--audio' : 'media-chip--muted-audio'}`}>
            {participant.media.screenAudio ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {participant.media.screenAudio ? 'Com áudio' : 'Sem áudio'}
          </span>
        )}
        {(connectionFailed || connectionInterrupted) && (
          <span className="media-chip media-chip--danger"><WifiOff size={13} /> Instável</span>
        )}
        {participantMuted && (
          <span className="media-chip media-chip--local-muted"><VolumeX size={13} /> Mudo para você</span>
        )}
      </div>
      {playbackBlocked && (
        <button type="button" className="participant-tile__playback-retry" onClick={retryPlayback}>
          <Volume2 size={15} />
          {video.playbackBlocked ? 'Exibir transmissão' : 'Ativar som'}
        </button>
      )}
      {hasVolumeControls && (
        <div
          className={`participant-volume ${volumeOpen ? 'is-open' : ''} ${volumeControlsVisible ? '' : 'is-idle'}`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="participant-volume__trigger"
            aria-label={`Ajustar volume de ${participant.name}`}
            aria-expanded={volumeOpen}
            aria-controls={`volume-${participant.id}`}
            onClick={() => setVolumeOpen((current) => !current)}
          >
            {audibleVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            <span>{Math.round(audibleVolume * 100)}%</span>
          </button>
          <div
            id={`volume-${participant.id}`}
            className="participant-volume__panel"
            role="group"
            aria-label={`Volumes de ${participant.name}`}
            hidden={!volumeOpen}
          >
              {hasVoiceVolume && (
                <label className="is-voice">
                  <span><strong>Voz</strong><output>{Math.round(voiceVolume * 100)}%</output></span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(voiceVolume * 100)}
                    aria-label={`Volume da voz de ${participant.name}`}
                    onChange={(event) => changeVoiceVolume(Number(event.target.value) / 100)}
                  />
                </label>
              )}
              {hasScreenVolume && (
                <label className="is-screen">
                  <span><strong>Transmissão</strong><output>{Math.round(screenVolume * 100)}%</output></span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(screenVolume * 100)}
                    aria-label={`Volume da transmissão de ${participant.name}`}
                    onChange={(event) => changeScreenVolume(Number(event.target.value) / 100)}
                  />
                </label>
              )}
          </div>
        </div>
      )}
      <div className="participant-tile__footer">
        <span className="participant-name">{participant.name}{local ? ' (você)' : ''}</span>
        {!participant.media.microphone && <span className="muted-chip" aria-label="Microfone desligado"><MicOff size={14} /></span>}
      </div>
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <div
          ref={contextMenuRef}
          className="participant-context-menu"
          role="dialog"
          aria-label={`Controles de áudio de ${participant.name}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="participant-context-menu__header">
            <Avatar profile={participant} size="small" />
            <span><strong>{participant.name}</strong><small>Áudio somente para você</small></span>
          </div>
          <button
            type="button"
            className={`participant-context-menu__mute ${participantMuted ? 'is-muted' : ''}`}
            onClick={toggleParticipantMute}
          >
            {participantMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span><strong>{participantMuted ? 'Ouvir novamente' : 'Mutar esta pessoa'}</strong><small>Voz e transmissão</small></span>
          </button>
          <div className="participant-context-menu__levels">
            {hasVoiceVolume && (
              <label>
                <span><strong>Voz</strong><output>{Math.round(voiceVolume * 100)}%</output></span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(voiceVolume * 100)}
                  aria-label={`Volume da voz de ${participant.name}`}
                  onChange={(event) => changeVoiceVolume(Number(event.target.value) / 100)}
                />
              </label>
            )}
            {hasScreenVolume && (
              <label className="is-screen">
                <span><strong>Transmissão</strong><output>{Math.round(screenVolume * 100)}%</output></span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(screenVolume * 100)}
                  aria-label={`Volume da transmissão de ${participant.name}`}
                  onChange={(event) => changeScreenVolume(Number(event.target.value) / 100)}
                />
              </label>
            )}
          </div>
          <p>Use os controles separados para cortar apenas o retorno da tela sem perder a voz.</p>
        </div>,
        document.body,
      )}
    </article>
  )
}

export function EmptyCallTile() {
  return (
    <div className="empty-call-tile">
      <div className="empty-call-tile__orb">
        <span />
        <span />
        <span />
      </div>
      <strong>O espaço está aberto</strong>
      <p>Convide alguém ou abra outra aba para testar a chamada.</p>
    </div>
  )
}

export function Toast({ children, tone = 'default', onClose }: { children: ReactNode; tone?: 'default' | 'danger' | 'success'; onClose?: () => void }) {
  return (
    <div className={`toast toast--${tone}`} role="status">
      <span>{children}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Fechar aviso">×</button>}
    </div>
  )
}
