import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  Check,
  Copy,
  Gauge,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShareOff,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { CallParticipant, MediaState, Profile, ScreenRelayFrame, VoiceRoom } from '../types'
import type { AudioInputOption } from '../hooks/useCall'
import {
  DEFAULT_SCREEN_SHARE_SETTINGS,
  SCREEN_SHARE_FRAME_RATE_OPTIONS,
  SCREEN_SHARE_RESOLUTION_OPTIONS,
  screenShareProfile,
  screenShareSenderBitrate,
  type ScreenShareQuality,
  type ScreenShareSettings,
} from '../lib/screenShare'
import type { ScreenShareSendTelemetry } from '../lib/screenShareTelemetry'
import { EmptyCallTile, IconButton, MediaPreview, ParticipantTile } from './ui'

const telemetryNumber = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

function screenShareSendLabel(telemetry: ScreenShareSendTelemetry | null) {
  if (!telemetry || telemetry.status === 'sampling') return 'medindo o envio real…'
  if (telemetry.status === 'waiting') return 'envio aguardando espectador'
  if (telemetry.status === 'unavailable') return 'medição do envio indisponível'

  const bitrate = telemetry.bitrateMbps === null
    ? null
    : `${telemetryNumber.format(telemetry.bitrateMbps)} Mb/s`
  if (telemetry.status === 'static') {
    return bitrate ? `tela estática · envio ${bitrate}` : 'tela estática · envio ativo'
  }

  const fps = telemetry.fps === null
    ? '—'
    : telemetry.fps > 0 && telemetry.fps < 1
      ? '<1'
      : telemetryNumber.format(telemetry.fps)
  const partialSample = telemetry.complete
    ? ''
    : ` · amostra ${telemetry.sampledPeerCount}/${telemetry.peerCount}`
  return `envio ${fps} fps · ${bitrate || 'bitrate indisponível'}${partialSample}`
}

function MicrophoneSelect({
  devices,
  selectedId,
  switching,
  compact = false,
  onSelect,
}: {
  devices: AudioInputOption[]
  selectedId: string
  switching: boolean
  compact?: boolean
  onSelect: (deviceId: string) => void
}) {
  return (
    <label
      className={`microphone-select ${compact ? 'microphone-select--compact' : ''}`}
      title={devices.find((device) => device.deviceId === selectedId)?.label || 'Escolher microfone'}
    >
      {compact ? <SlidersHorizontal size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
      <span className="sr-only">Microfone</span>
      <select
        aria-label="Selecionar microfone"
        value={selectedId}
        disabled={switching || !devices.length}
        onChange={(event) => onSelect(event.target.value)}
      >
        {!devices.length && <option value="">Microfone padrão</option>}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
        ))}
      </select>
      {switching && <span className="microphone-select__status" aria-live="polite">trocando…</span>}
    </label>
  )
}

export function PrejoinDialog({
  open,
  room,
  profile,
  stream,
  microphoneOn,
  cameraOn,
  audioInputDevices,
  selectedMicrophoneId,
  microphoneSwitching,
  cameraSwitching,
  mediaPreparing,
  error,
  joining,
  onToggleMicrophone,
  onSelectMicrophone,
  onToggleCamera,
  onJoin,
  onClose,
}: {
  open: boolean
  room: VoiceRoom
  profile: Profile
  stream: MediaStream | null
  microphoneOn: boolean
  cameraOn: boolean
  audioInputDevices: AudioInputOption[]
  selectedMicrophoneId: string
  microphoneSwitching: boolean
  cameraSwitching: boolean
  mediaPreparing: boolean
  error: string | null
  joining: boolean
  onToggleMicrophone: () => void
  onSelectMicrophone: (deviceId: string) => void
  onToggleCamera: () => void
  onJoin: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="prejoin-dialog" role="dialog" aria-modal="true" aria-labelledby="prejoin-title">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        <div className="prejoin-dialog__copy">
          <span className="eyebrow"><span className="live-dot" /> Pré-sala</span>
          <h2 id="prejoin-title">Entre no ritmo de <em>{room.name}</em></h2>
          <p>Confira como você vai aparecer. Você pode mudar câmera e microfone a qualquer momento.</p>
          <div className="prejoin-safety"><ShieldCheck size={17} /> A câmera começa desligada e só é acessada quando você clicar em ligar.</div>
        </div>
        <MediaPreview stream={stream} cameraOn={cameraOn} profile={profile} />
        {error && <div className="permission-note" role="alert">{error}</div>}
        <div className="prejoin-dialog__controls">
          <div className="prejoin-media-buttons">
            <IconButton
              icon={microphoneOn ? Mic : MicOff}
              label={microphoneOn ? 'Desligar microfone' : 'Ligar microfone'}
              active={microphoneOn}
              disabled={mediaPreparing || microphoneSwitching}
              onClick={onToggleMicrophone}
            />
            <IconButton
              icon={cameraOn ? Video : VideoOff}
              label={cameraSwitching ? 'Aguarde a câmera' : cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
              active={cameraOn}
              disabled={mediaPreparing || cameraSwitching}
              onClick={onToggleCamera}
            />
            <MicrophoneSelect
              devices={audioInputDevices}
              selectedId={selectedMicrophoneId}
              switching={microphoneSwitching}
              onSelect={onSelectMicrophone}
            />
          </div>
          <button className="primary-button primary-button--wide" type="button" onClick={onJoin} disabled={joining || mediaPreparing || microphoneSwitching || cameraSwitching}>
            <span>{mediaPreparing ? 'Preparando mídia…' : cameraSwitching ? 'Abrindo câmera…' : joining ? 'Conectando…' : 'Entrar na conversa'}</span>
            <span className="primary-button__icon"><Users size={18} /></span>
          </button>
        </div>
      </section>
    </div>
  )
}

export function CallDock({
  microphoneOn,
  cameraOn,
  sharingScreen,
  audioInputDevices,
  selectedMicrophoneId,
  microphoneSwitching,
  cameraSwitching,
  screenShareStarting,
  screenShareViewerCount,
  activeScreenShareSettings,
  onToggleMicrophone,
  onSelectMicrophone,
  onToggleCamera,
  onStartScreenShare,
  onStopScreenShare,
  onLeave,
}: {
  microphoneOn: boolean
  cameraOn: boolean
  sharingScreen: boolean
  audioInputDevices: AudioInputOption[]
  selectedMicrophoneId: string
  microphoneSwitching: boolean
  cameraSwitching: boolean
  screenShareStarting: boolean
  screenShareViewerCount: number
  activeScreenShareSettings: ScreenShareSettings
  onToggleMicrophone: () => void
  onSelectMicrophone: (deviceId: string) => void
  onToggleCamera: () => void
  onStartScreenShare: (settings: ScreenShareSettings) => void
  onStopScreenShare: () => void
  onLeave: () => void
}) {
  const [screenSettingsOpen, setScreenSettingsOpen] = useState(false)
  const [screenSettings, setScreenSettings] = useState<ScreenShareSettings>(
    activeScreenShareSettings || DEFAULT_SCREEN_SHARE_SETTINGS,
  )
  const screenControlRef = useRef<HTMLDivElement>(null)
  const screenSettingsPanelRef = useRef<HTMLDivElement>(null)
  const profile = screenShareProfile(screenSettings)
  const effectiveViewers = Math.max(1, screenShareViewerCount)
  const senderMbps = screenShareSenderBitrate(screenSettings, effectiveViewers) / 1_000_000
  const totalMbps = senderMbps * screenShareViewerCount
  const demandingProfile = screenSettings.resolution === 1080 && screenSettings.frameRate === 60

  useEffect(() => {
    if (!screenSettingsOpen) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!screenControlRef.current?.contains(event.target as Node)) setScreenSettingsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setScreenSettingsOpen(false)
      screenControlRef.current?.querySelector<HTMLButtonElement>('.icon-button')?.focus()
    }
    window.addEventListener('pointerdown', closeOnPointerDown, true)
    window.addEventListener('keydown', closeOnEscape)
    const focusTimer = window.setTimeout(
      () => screenSettingsPanelRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus(),
      0,
    )
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('pointerdown', closeOnPointerDown, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [screenSettingsOpen])

  useEffect(() => {
    if (sharingScreen) setScreenSettings(activeScreenShareSettings)
  }, [activeScreenShareSettings, sharingScreen])

  const handleScreenButton = () => {
    if (sharingScreen) {
      setScreenSettingsOpen(false)
      onStopScreenShare()
      return
    }
    setScreenSettingsOpen((open) => !open)
  }

  const beginScreenShare = () => {
    setScreenSettingsOpen(false)
    onStartScreenShare(screenSettings)
  }

  return (
    <div className="call-dock" aria-label="Controles da chamada">
      <div className="call-dock__microphone">
        <IconButton
          icon={microphoneOn ? Mic : MicOff}
          label={microphoneOn ? 'Desligar microfone — Alt+M' : 'Ligar microfone — Alt+M'}
          active={microphoneOn}
          disabled={microphoneSwitching}
          onClick={onToggleMicrophone}
        />
        <MicrophoneSelect
          compact
          devices={audioInputDevices}
          selectedId={selectedMicrophoneId}
          switching={microphoneSwitching}
          onSelect={onSelectMicrophone}
        />
      </div>
      <IconButton
        icon={cameraOn ? Video : VideoOff}
        label={cameraOn ? 'Desligar câmera — Alt+V' : 'Ligar câmera — Alt+V'}
        active={cameraOn}
        disabled={cameraSwitching}
        onClick={onToggleCamera}
      />
      <span className="call-dock__divider" />
      <div className="call-dock__screen" ref={screenControlRef}>
        <IconButton
          icon={sharingScreen ? ScreenShareOff : MonitorUp}
          label={sharingScreen ? 'Parar transmissão' : 'Escolher qualidade e compartilhar tela'}
          active={sharingScreen || screenSettingsOpen}
          tone={sharingScreen ? 'coral' : 'default'}
          disabled={screenShareStarting}
          aria-haspopup={sharingScreen ? undefined : 'dialog'}
          aria-expanded={sharingScreen ? undefined : screenSettingsOpen}
          aria-controls={sharingScreen ? undefined : 'screen-share-settings'}
          onClick={handleScreenButton}
        />
        {screenSettingsOpen && !sharingScreen && (
          <div
            id="screen-share-settings"
            ref={screenSettingsPanelRef}
            className="screen-share-settings"
            role="dialog"
            aria-modal="false"
            aria-labelledby="screen-share-settings-title"
          >
            <header className="screen-share-settings__header">
              <span className="screen-share-settings__icon"><MonitorUp size={18} /></span>
              <span>
                <strong id="screen-share-settings-title">Qualidade da transmissão</strong>
                <small>Escolha conforme sua internet e o conteúdo.</small>
              </span>
              <button type="button" onClick={() => setScreenSettingsOpen(false)} aria-label="Fechar opções de transmissão"><X size={17} /></button>
            </header>

            <fieldset className="screen-share-settings__group">
              <legend>Resolução</legend>
              <div className="screen-share-settings__choices screen-share-settings__choices--resolution">
                {SCREEN_SHARE_RESOLUTION_OPTIONS.map((option) => (
                  <label key={option.resolution} className={screenSettings.resolution === option.resolution ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="screen-resolution"
                      value={option.resolution}
                      checked={screenSettings.resolution === option.resolution}
                      onChange={() => setScreenSettings((current) => ({ ...current, resolution: option.resolution }))}
                    />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="screen-share-settings__group">
              <legend>Taxa de quadros</legend>
              <div className="screen-share-settings__choices screen-share-settings__choices--fps">
                {SCREEN_SHARE_FRAME_RATE_OPTIONS.map((frameRate) => (
                  <label key={frameRate} className={screenSettings.frameRate === frameRate ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="screen-frame-rate"
                      value={frameRate}
                      checked={screenSettings.frameRate === frameRate}
                      onChange={() => setScreenSettings((current) => ({ ...current, frameRate }))}
                    />
                    <span><strong>{frameRate} fps</strong><small>{frameRate === 15 ? 'Leve' : frameRate === 30 ? 'Equilibrado' : 'Movimento'}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={`screen-share-settings__estimate ${demandingProfile ? 'is-warning' : ''}`}>
              <Gauge size={17} />
              <span>
                <strong>{profile.width}×{profile.height} · até {profile.frameRate} fps</strong>
                <small>
                  Cerca de {senderMbps.toFixed(1).replace('.', ',')} Mb/s por pessoa
                  {screenShareViewerCount > 1 ? ` · ${totalMbps.toFixed(1).replace('.', ',')} Mb/s de upload agora` : ''}
                </small>
              </span>
            </div>

            {demandingProfile && (
              <p className="screen-share-settings__warning">1080p a 60 fps exige conexão e computador fortes. Se travar, use 720p a 30 fps.</p>
            )}

            <button type="button" className="screen-share-settings__start" onClick={beginScreenShare}>
              <MonitorUp size={17} /> Abrir seletor de tela
            </button>
            <p className="screen-share-settings__note">O navegador ainda pedirá qual aba, janela ou tela você permite compartilhar.</p>
          </div>
        )}
      </div>
      <IconButton icon={PhoneOff} label="Sair da chamada" tone="danger" onClick={onLeave} />
    </div>
  )
}

export function CallStage({
  room,
  participants,
  clientId,
  localStream,
  screenStream,
  remoteStreams,
  remoteMicrophoneStreams,
  remoteScreenAudioStreams,
  connectionStates,
  fallbackFrames,
  relayAudioBlocked,
  localProfile,
  localMedia,
  screenShareQuality,
  screenShareSendTelemetry,
  activeScreenShareSettings,
  screenAudioOn,
  screenAudioSystemWide,
  screenAudioProtected,
  onResumeRelayAudio,
  onScreenVolumeChange,
  onRequestScreenRelay,
  onReleaseScreenRelay,
  onCopyInvite,
  copied,
  onFullscreen,
}: {
  room: VoiceRoom
  participants: CallParticipant[]
  clientId: string
  localStream: MediaStream | null
  screenStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  remoteMicrophoneStreams: Map<string, MediaStream>
  remoteScreenAudioStreams: Map<string, MediaStream>
  connectionStates: Map<string, RTCPeerConnectionState>
  fallbackFrames: Map<string, ScreenRelayFrame>
  relayAudioBlocked: Map<string, boolean>
  localProfile: Profile
  localMedia: MediaState
  screenShareQuality: ScreenShareQuality | null
  screenShareSendTelemetry: ScreenShareSendTelemetry | null
  activeScreenShareSettings: ScreenShareSettings
  screenAudioOn: boolean
  screenAudioSystemWide: boolean
  screenAudioProtected: boolean
  onResumeRelayAudio: (peerId: string) => void
  onScreenVolumeChange: (peerId: string, volume: number) => void
  onRequestScreenRelay: (peerId: string) => void
  onReleaseScreenRelay: (peerId: string) => void
  onCopyInvite: () => void
  copied: boolean
  onFullscreen: () => void
}) {
  const [manualSpotlight, setManualSpotlight] = useState<string | null>(null)
  const participantList = useMemo(() => {
    const hasLocal = participants.some((participant) => participant.id === clientId)
    if (hasLocal) return participants
    return [
      {
        id: clientId || 'local',
        channelId: room.id,
        ...localProfile,
        media: localMedia,
        joinedAt: Date.now(),
      },
      ...participants,
    ]
  }, [clientId, localMedia, localProfile, participants, room.id])

  const sharingParticipant = participantList.find((participant) => participant.media.screen)
  const spotlightId = manualSpotlight || sharingParticipant?.id || null
  const sortedParticipants = spotlightId
    ? [...participantList].sort((a, b) => Number(b.id === spotlightId) - Number(a.id === spotlightId))
    : participantList
  const selectedScreenProfile = screenShareProfile(activeScreenShareSettings)

  return (
    <section className="call-stage">
      <header className="call-stage__header">
        <div>
          <span className="eyebrow"><span className="live-dot" /> Ao vivo agora</span>
          <h2>{room.name}</h2>
          <p>{participants.length || 1} {participants.length === 1 ? 'pessoa' : 'pessoas'} · {room.mood}</p>
        </div>
        <div className="call-stage__actions">
          <button type="button" className="soft-button" onClick={onCopyInvite}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiado' : 'Copiar convite'}
          </button>
          <IconButton icon={Maximize2} label="Tela cheia" onClick={onFullscreen} />
        </div>
      </header>

      {sharingParticipant?.id === clientId && (
        <div className="sharing-banner">
          <MonitorUp size={18} />
          <span><strong>Sua tela está no palco.</strong> Tudo que aparece na janela escolhida está sendo transmitido.</span>
          <span className="sharing-banner__quality">
            {screenShareQuality?.width && screenShareQuality?.height
              ? `${screenShareQuality.width}×${screenShareQuality.height}`
              : `${selectedScreenProfile.width}×${selectedScreenProfile.height}`}
            {' · '}
            alvo de até {selectedScreenProfile.frameRate} fps
            {screenShareQuality?.frameRate
              ? ` · captura ${Math.round(screenShareQuality.frameRate)} fps`
              : ''}
            {' · '}
            {screenShareSendLabel(screenShareSendTelemetry)}
          </span>
          <span className={`sharing-banner__audio ${screenAudioOn ? 'is-on' : 'is-off'}`}>
            {screenAudioOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            {screenAudioOn
              ? screenAudioSystemWide
                ? 'Áudio da tela inteira incluído · proteção antieco ativa'
                : 'Áudio isolado da aba ou janela incluído'
              : screenAudioProtected
                ? 'Áudio do sistema bloqueado por segurança · atualize o Chrome ou compartilhe uma aba/janela'
                : 'Sem áudio — marque “Compartilhar áudio” no seletor do navegador'}
          </span>
          <span className="sharing-banner__compatibility">Se a conexão direta falhar, uma cópia reduzida passa pelo servidor.</span>
        </div>
      )}

      <div className={`call-grid ${spotlightId ? 'call-grid--spotlight' : ''} count-${Math.min(sortedParticipants.length, 4)}`}>
        {sortedParticipants.map((participant) => {
          const local = participant.id === clientId || participant.id === 'local'
          const stream = local
            ? (participant.media.screen ? screenStream : localStream)
            : (remoteStreams.get(participant.id) || null)
          return (
            <ParticipantTile
              key={participant.id}
              participant={participant}
              stream={stream}
              voiceStream={local ? null : remoteMicrophoneStreams.get(participant.id) || null}
              screenAudioStream={local ? null : remoteScreenAudioStreams.get(participant.id) || null}
              local={local}
              connectionState={connectionStates.get(participant.id)}
              fallbackFrame={local ? null : fallbackFrames.get(participant.id) || null}
              relayAudioBlocked={!local && Boolean(relayAudioBlocked.get(participant.id))}
              onResumeRelayAudio={() => onResumeRelayAudio(participant.id)}
              onScreenVolumeChange={onScreenVolumeChange}
              onRequestRelay={onRequestScreenRelay}
              onReleaseRelay={onReleaseScreenRelay}
              spotlight={participant.id === spotlightId}
              onSpotlight={() => setManualSpotlight((current) => current === participant.id ? null : participant.id)}
            />
          )
        })}
        {sortedParticipants.length === 1 && <EmptyCallTile />}
      </div>
      <p className="stage-hint"><Camera size={14} /> Dois cliques fixam no palco · clique direito abre mudo e volume</p>
    </section>
  )
}
