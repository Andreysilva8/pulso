import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LoaderCircle, MicOff, MonitorUp, Radio, Volume2, VolumeX, WifiOff } from 'lucide-react'
import type { CallParticipant, Profile, ScreenRelayFrame } from '../types'

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
      play()
      updateReadyState()
    }

    const tracked = new Set<MediaStreamTrack>()
    const watchTracks = () => {
      for (const track of tracked) {
        track.removeEventListener('unmute', handleTrackReady)
        track.removeEventListener('ended', attachTracks)
      }
      tracked.clear()
      for (const track of tracks()) {
        tracked.add(track)
        track.addEventListener('unmute', handleTrackReady)
        track.addEventListener('ended', attachTracks)
      }
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
        track.removeEventListener('ended', attachTracks)
      }
      element.pause()
      element.srcObject = null
    }
  }, [kind, muted, stream])

  return { ref, ready, playbackBlocked, retry }
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
  const visibleVideo = expectsVideo && video.ready
  const visibleFallback = Boolean(participant.media.screen && !visibleVideo && fallbackFrame)
  const visibleMedia = visibleVideo || visibleFallback
  const speaking = useSpeaking(resolvedVoiceStream, participant.media.microphone)
  const connectionFailed = connectionState === 'failed'
  const connectionInterrupted = connectionState === 'disconnected'
  const playbackBlocked = video.playbackBlocked || voiceAudio.playbackBlocked
    || screenAudio.playbackBlocked || relayAudioBlocked
  const pendingTitle = connectionFailed
    ? 'Transmissão sem conexão'
    : connectionInterrupted
      ? 'Reconectando à transmissão…'
      : participant.media.screen
        ? 'Conectando à transmissão…'
        : 'Conectando à câmera…'
  const pendingDetail = connectionFailed
    ? 'A rede não conseguiu receber a mídia. Tentaremos conectar novamente.'
    : 'A imagem aparecerá assim que o primeiro quadro chegar.'
  const relayRequestedRef = useRef(false)

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
    const initialTimer = window.setTimeout(requestRelay, 1_800)
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
    if (!volumeOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVolumeOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [volumeOpen])

  const retryPlayback = () => {
    void video.retry()
    void voiceAudio.retry()
    void screenAudio.retry()
    onResumeRelayAudio?.()
  }

  const hasVoiceVolume = !local && participant.media.microphone
  const hasScreenVolume = !local && participant.media.screenAudio
  const audibleVolume = Math.max(hasVoiceVolume ? voiceVolume : 0, hasScreenVolume ? screenVolume : 0)

  return (
    <article
      className={`participant-tile ${speaking ? 'is-speaking' : ''} ${spotlight ? 'is-spotlight' : ''} ${participant.media.screen ? 'is-screen' : ''}`}
      onDoubleClick={onSpotlight}
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
          <span className="media-chip media-chip--relay"><Radio size={13} /> Modo compatível</span>
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
      </div>
      {playbackBlocked && (
        <button type="button" className="participant-tile__playback-retry" onClick={retryPlayback}>
          <Volume2 size={15} />
          {video.playbackBlocked ? 'Exibir transmissão' : 'Ativar som'}
        </button>
      )}
      {(hasVoiceVolume || hasScreenVolume) && (
        <div
          className={`participant-volume ${volumeOpen ? 'is-open' : ''}`}
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
                    onChange={(event) => setVoiceVolume(Number(event.target.value) / 100)}
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
                    onChange={(event) => setScreenVolume(Number(event.target.value) / 100)}
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
