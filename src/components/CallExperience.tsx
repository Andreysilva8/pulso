import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  Check,
  Copy,
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
import type { ScreenShareQuality } from '../lib/screenShare'
import { EmptyCallTile, IconButton, MediaPreview, ParticipantTile } from './ui'

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
          <div className="prejoin-safety"><ShieldCheck size={17} /> A prévia é local; nada é enviado antes de você entrar.</div>
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
              label={cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
              active={cameraOn}
              disabled={mediaPreparing}
              onClick={onToggleCamera}
            />
            <MicrophoneSelect
              devices={audioInputDevices}
              selectedId={selectedMicrophoneId}
              switching={microphoneSwitching}
              onSelect={onSelectMicrophone}
            />
          </div>
          <button className="primary-button primary-button--wide" type="button" onClick={onJoin} disabled={joining || mediaPreparing || microphoneSwitching}>
            <span>{mediaPreparing ? 'Preparando mídia…' : joining ? 'Conectando…' : 'Entrar na conversa'}</span>
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
  screenShareStarting,
  onToggleMicrophone,
  onSelectMicrophone,
  onToggleCamera,
  onToggleScreen,
  onLeave,
}: {
  microphoneOn: boolean
  cameraOn: boolean
  sharingScreen: boolean
  audioInputDevices: AudioInputOption[]
  selectedMicrophoneId: string
  microphoneSwitching: boolean
  screenShareStarting: boolean
  onToggleMicrophone: () => void
  onSelectMicrophone: (deviceId: string) => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onLeave: () => void
}) {
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
        onClick={onToggleCamera}
      />
      <span className="call-dock__divider" />
      <IconButton
        icon={sharingScreen ? ScreenShareOff : MonitorUp}
        label={sharingScreen ? 'Parar transmissão' : 'Compartilhar tela'}
        active={sharingScreen}
        tone={sharingScreen ? 'coral' : 'default'}
        disabled={screenShareStarting}
        onClick={onToggleScreen}
      />
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
  screenAudioOn,
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
  screenAudioOn: boolean
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
              : 'Full HD'}
            {' · '}
            {screenShareQuality?.frameRate ? `${Math.round(screenShareQuality.frameRate)} fps` : '60 fps'}
          </span>
          <span className={`sharing-banner__audio ${screenAudioOn ? 'is-on' : 'is-off'}`}>
            {screenAudioOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
            {screenAudioOn
              ? 'Áudio isolado da aba ou janela incluído'
              : screenAudioProtected
                ? 'Proteção antieco ativa · compartilhe uma aba ou janela para transmitir o áudio'
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
