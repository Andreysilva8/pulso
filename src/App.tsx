import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  ChevronDown,
  Compass,
  Hash,
  Headphones,
  Menu,
  MessageCircle,
  Mic,
  MonitorUp,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  Volume2,
  Waves,
  X,
} from 'lucide-react'
import { CallDock, CallStage, PrejoinDialog } from './components/CallExperience'
import { ChatPanel } from './components/ChatPanel'
import { Avatar, IconButton, StatusDot, Toast } from './components/ui'
import { useCall } from './hooks/useCall'
import { useRealtime } from './hooks/useRealtime'
import { loadStoredProfile, makeInitials, profileColors } from './lib/profile'
import type { Profile, TextChannel, VoiceRoom } from './types'

const textChannels: TextChannel[] = [
  { id: 'geral', name: 'geral', description: 'Conversas, recados e o que estiver pulsando hoje.' },
  { id: 'novidades', name: 'novidades', description: 'Atualizações importantes da comunidade Pulso.' },
  { id: 'ideias', name: 'ideias', description: 'Rascunhos, referências e boas ideias ainda sem dono.' },
]

const voiceRooms: VoiceRoom[] = [
  { id: 'cafe', name: 'Café aberto', mood: 'conversa sem pauta', accent: 'coral' },
  { id: 'palco', name: 'Palco criativo', mood: 'mostre no que está trabalhando', accent: 'mint' },
  { id: 'foco', name: 'Sala foco', mood: 'companhia silenciosa', accent: 'amber' },
]

const spaces = [
  { id: 'pulso', label: 'Pulso', mark: 'P', color: '#ff816f' },
  { id: 'atelier', label: 'Ateliê', mark: 'A', color: '#3bd6c6' },
  { id: 'cinema', label: 'Clube de cinema', mark: 'C', color: '#ffc65c' },
  { id: 'estudos', label: 'Estudos', mark: 'E', color: '#80a8ff' },
]

const familiarMembers = [
  { name: 'Lia', initials: 'LI', color: '#3bd6c6', activity: 'Montando o roteiro', online: false },
  { name: 'Davi', initials: 'DA', color: '#ffc65c', activity: 'Volta às 18h', online: false },
  { name: 'Maya', initials: 'MA', color: '#ff816f', activity: 'Criando em silêncio', online: false },
]

function loadProfile(): Profile {
  return loadStoredProfile(window.localStorage)
}

export default function App() {
  const invitedRoomId = new URLSearchParams(window.location.search).get('room')
  const initialRoom = voiceRooms.some((room) => room.id === invitedRoomId) ? invitedRoomId! : 'cafe'
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [selectedTextChannelId, setSelectedTextChannelId] = useState('geral')
  const [selectedVoiceRoomId, setSelectedVoiceRoomId] = useState(initialRoom)
  const [prejoinOpen, setPrejoinOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileDraft, setProfileDraft] = useState(profile.name)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(invitedRoomId ? 'Convite aberto. Entre na sala quando estiver pronto.' : null)
  const workspaceRef = useRef<HTMLElement>(null)

  const realtime = useRealtime(profile, selectedTextChannelId)
  const call = useCall({
    clientId: realtime.clientId,
    realtimeStatus: realtime.status,
    subscribeToCallEvents: realtime.subscribeToCallEvents,
    joinRealtimeCall: realtime.joinCall,
    leaveRealtimeCall: realtime.leaveCall,
    updateRealtimeCall: realtime.updateCall,
    sendSignal: realtime.sendSignal,
    sendScreenFrame: realtime.sendScreenFrame,
    sendScreenAudio: realtime.sendScreenAudio,
    notifyScreenRelayStop: realtime.stopScreenRelay,
  })

  const selectedTextChannel = textChannels.find((channel) => channel.id === selectedTextChannelId) || textChannels[0]
  const selectedVoiceRoom = voiceRooms.find((room) => room.id === selectedVoiceRoomId) || voiceRooms[0]
  const activeCallRoom = voiceRooms.find((room) => room.id === call.channelId) || selectedVoiceRoom
  const activeParticipants = realtime.callsByChannel[call.channelId || selectedVoiceRoomId] || []
  const callChatId = `voz-${call.channelId || selectedVoiceRoomId}`

  const openVoiceRoom = useCallback((room: VoiceRoom) => {
    setSelectedVoiceRoomId(room.id)
    setChannelsOpen(false)
    if (call.status === 'joined' && call.channelId === room.id) return
    if (call.status === 'joined') call.leave()
    setPrejoinOpen(true)
    void call.prepareMedia()
  }, [call])

  const closePrejoin = useCallback(() => {
    setPrejoinOpen(false)
    call.cancelPreview()
  }, [call])

  const enterCall = useCallback(async () => {
    await call.join(selectedVoiceRoom.id)
    setPrejoinOpen(false)
    setNotice(`Você entrou em ${selectedVoiceRoom.name}.`)
  }, [call, selectedVoiceRoom])

  const copyInvite = useCallback(async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('room', activeCallRoom.id)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setNotice(`Convite: ${url.toString()}`)
    }
  }, [activeCallRoom.id])

  const saveProfile = () => {
    const cleanName = profileDraft.trim().slice(0, 32)
    if (!cleanName) return
    const nextProfile = { ...profile, name: cleanName, initials: makeInitials(cleanName) }
    setProfile(nextProfile)
    realtime.updateProfile(nextProfile)
    try {
      window.localStorage.setItem('pulso-profile', JSON.stringify(nextProfile))
    } catch {
      // Keep the profile in memory when storage is unavailable.
    }
    setProfileOpen(false)
    setNotice('Seu perfil foi atualizado.')
  }

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      if (!event.altKey || call.status !== 'joined') return
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        void call.toggleMicrophone()
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void call.toggleCamera()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [call])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3_600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const localMedia = useMemo(() => ({
    microphone: call.microphoneOn && Boolean(call.localStream?.getAudioTracks().length),
    camera: call.cameraOn && Boolean(call.localStream?.getVideoTracks().length),
    screen: call.sharingScreen,
    screenAudio: call.sharingScreen && call.screenAudioOn,
  }), [call.cameraOn, call.localStream, call.microphoneOn, call.screenAudioOn, call.sharingScreen])

  const onlineMemberIds = new Set(realtime.members.map((member) => member.id))

  return (
    <div className="app-shell">
      <header className="global-header">
        <button className="mobile-menu" type="button" onClick={() => setChannelsOpen(true)} aria-label="Abrir canais"><Menu size={21} /></button>
        <a className="brand" href="/" aria-label="Página inicial do Pulso">
          <span className="brand__mark"><Waves size={23} /></span>
          <span className="brand__word">pulso</span>
        </a>
        <div className="workspace-breadcrumb">
          <span>Comunidade</span>
          <strong>Pulso criativo</strong>
          <ChevronDown size={15} />
        </div>
        <label className="global-search">
          <Search size={17} />
          <input type="search" placeholder="Buscar no Pulso" aria-label="Buscar no Pulso" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="global-actions">
          <StatusDot connected={realtime.status === 'connected'} />
          <IconButton icon={Bell} label="Notificações" badge="2" />
          <IconButton icon={Users} label="Mostrar participantes" onClick={() => setMembersOpen((open) => !open)} />
        </div>
      </header>

      <div className="app-body">
        <aside className="spaces-rail" aria-label="Espaços">
          <span className="rail-caption">espaços</span>
          {spaces.map((space, index) => (
            <button
              key={space.id}
              className={`space-button ${index === 0 ? 'is-active' : ''}`}
              type="button"
              aria-label={space.label}
              title={space.label}
              style={{ '--space-color': space.color } as React.CSSProperties}
            >
              <span>{space.mark}</span>
            </button>
          ))}
          <button type="button" className="space-button space-button--add" aria-label="Adicionar espaço"><Plus size={20} /></button>
          <span className="rail-spacer" />
          <button type="button" className="rail-compass" aria-label="Explorar comunidades"><Compass size={20} /></button>
        </aside>

        <div className={`mobile-scrim ${channelsOpen || membersOpen ? 'is-visible' : ''}`} onClick={() => { setChannelsOpen(false); setMembersOpen(false) }} />

        <aside className={`channel-sidebar ${channelsOpen ? 'is-open' : ''}`} aria-label="Canais da comunidade">
          <button type="button" className="drawer-close" onClick={() => setChannelsOpen(false)} aria-label="Fechar canais"><X size={20} /></button>
          <div className="community-card">
            <div className="community-card__art" aria-hidden="true"><span /><span /><span /></div>
            <div>
              <span className="eyebrow">Seu espaço</span>
              <h2>Pulso criativo</h2>
              <p>742 pessoas · 12 online</p>
            </div>
            <button type="button" aria-label="Opções da comunidade"><MoreHorizontal size={19} /></button>
          </div>

          <nav className="channel-nav">
            <div className="channel-section">
              <div className="channel-section__title"><span>Conversas</span><Plus size={15} /></div>
              {textChannels.map((channel) => (
                <button
                  type="button"
                  key={channel.id}
                  className={`channel-row ${selectedTextChannelId === channel.id && call.status !== 'joined' ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedTextChannelId(channel.id)
                    setChannelsOpen(false)
                  }}
                >
                  <Hash size={17} />
                  <span>{channel.name}</span>
                  {channel.id === 'novidades' && <i className="unread-dot" />}
                </button>
              ))}
            </div>

            <div className="channel-section channel-section--voice">
              <div className="channel-section__title"><span>Salas ao vivo</span><Plus size={15} /></div>
              {voiceRooms.map((room) => {
                const participants = realtime.callsByChannel[room.id] || []
                const active = call.channelId === room.id
                return (
                  <button
                    type="button"
                    key={room.id}
                    className={`voice-room voice-room--${room.accent} ${active ? 'is-active' : ''}`}
                    onClick={() => openVoiceRoom(room)}
                  >
                    <span className="voice-room__icon"><Volume2 size={17} /></span>
                    <span className="voice-room__copy">
                      <strong>{room.name}</strong>
                      <small>{participants.length ? `${participants.length} ao vivo` : room.mood}</small>
                    </span>
                    {participants.length > 0 && (
                      <span className="voice-room__avatars">
                        {participants.slice(0, 3).map((participant) => (
                          <Avatar key={participant.id} profile={participant} size="small" />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </nav>

          <div className="sidebar-live-card">
            <span className="sidebar-live-card__icon"><Radio size={18} /></span>
            <div><strong>Algo acontecendo?</strong><span>Abra uma sala em segundos.</span></div>
            <button type="button" onClick={() => openVoiceRoom(selectedVoiceRoom)}>Entrar</button>
          </div>

          <button type="button" className="account-strip" onClick={() => { setProfileDraft(profile.name); setProfileOpen(true) }}>
            <Avatar profile={profile} size="medium" online />
            <span><strong>{profile.name}</strong><small>Disponível</small></span>
            <Settings size={17} />
          </button>
        </aside>

        <main className={`workspace ${call.status === 'joined' ? 'workspace--call' : ''}`} ref={workspaceRef}>
          {call.status === 'joined' ? (
            <CallStage
              room={activeCallRoom}
              participants={activeParticipants}
              clientId={realtime.clientId}
              localStream={call.localStream}
              screenStream={call.screenStream}
              remoteStreams={call.remoteStreams}
              remoteMicrophoneStreams={call.remoteMicrophoneStreams}
              remoteScreenAudioStreams={call.remoteScreenAudioStreams}
              connectionStates={call.connectionStates}
              fallbackFrames={call.fallbackFrames}
              relayAudioBlocked={call.relayAudioBlocked}
              localProfile={profile}
              localMedia={localMedia}
              screenShareQuality={call.screenShareQuality}
              activeScreenShareSettings={call.activeScreenShareSettings}
              screenAudioOn={call.screenAudioOn}
              screenAudioSystemWide={call.screenAudioSystemWide}
              screenAudioProtected={call.screenAudioProtected}
              onResumeRelayAudio={(peerId) => void call.resumeRelayAudio(peerId)}
              onScreenVolumeChange={call.setRelayScreenVolume}
              onRequestScreenRelay={realtime.requestScreenRelay}
              onReleaseScreenRelay={realtime.releaseScreenRelay}
              onCopyInvite={copyInvite}
              copied={copied}
              onFullscreen={() => void workspaceRef.current?.requestFullscreen?.()}
            />
          ) : (
            <ChatPanel
              channelId={selectedTextChannel.id}
              channelName={selectedTextChannel.name}
              channelDescription={selectedTextChannel.description}
              messages={realtime.messagesByChannel[selectedTextChannel.id] || []}
              typingMembers={realtime.typingByChannel[selectedTextChannel.id] || []}
              profile={profile}
              clientId={realtime.clientId}
              onSend={(channelId, text) => { realtime.sendChat(channelId, text) }}
              onTyping={realtime.sendTyping}
            />
          )}
        </main>

        <aside className={`context-panel ${membersOpen ? 'is-open' : ''}`} aria-label={call.status === 'joined' ? 'Chat da chamada' : 'Participantes'}>
          <button type="button" className="drawer-close" onClick={() => setMembersOpen(false)} aria-label="Fechar painel"><X size={20} /></button>
          {call.status === 'joined' ? (
            <ChatPanel
              compact
              channelId={callChatId}
              channelName={activeCallRoom.name}
              channelDescription={`Chat ao vivo de ${activeCallRoom.name}`}
              messages={realtime.messagesByChannel[callChatId] || []}
              typingMembers={realtime.typingByChannel[callChatId] || []}
              profile={profile}
              clientId={realtime.clientId}
              onSend={(channelId, text) => { realtime.sendChat(channelId, text) }}
              onTyping={realtime.sendTyping}
            />
          ) : (
            <div className="members-panel">
              <header>
                <div><span className="eyebrow">Na comunidade</span><h3>Quem está por perto</h3></div>
                <IconButton icon={UserPlus} label="Convidar pessoas" />
              </header>
              <div className="members-panel__section">
                <p className="section-label">Online agora — {realtime.members.length}</p>
                {realtime.members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <Avatar profile={member} size="medium" online={onlineMemberIds.has(member.id)} />
                    <span><strong>{member.name}{member.id === realtime.clientId ? ' · você' : ''}</strong><small>{member.activeChannelId === selectedTextChannelId ? `Lendo #${selectedTextChannel.name}` : 'Explorando o Pulso'}</small></span>
                    <MessageCircle size={16} />
                  </div>
                ))}
              </div>
              <div className="happening-card">
                <div className="happening-card__art"><Sparkles size={22} /></div>
                <span className="eyebrow">Próximo encontro</span>
                <strong>Crítica sem drama</strong>
                <p>Sexta, 18:30 · Palco criativo</p>
                <button type="button" onClick={() => openVoiceRoom(voiceRooms[1])}>Ver sala</button>
              </div>
              <div className="members-panel__section">
                <p className="section-label">Pessoas da casa</p>
                {familiarMembers.map((member) => (
                  <div className="member-row member-row--offline" key={member.name}>
                    <Avatar profile={member} size="medium" online={false} />
                    <span><strong>{member.name}</strong><small>{member.activity}</small></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {call.status === 'joined' && (
        <CallDock
          microphoneOn={call.microphoneOn}
          cameraOn={call.cameraOn}
          sharingScreen={call.sharingScreen}
          audioInputDevices={call.audioInputDevices}
          selectedMicrophoneId={call.selectedMicrophoneId}
          microphoneSwitching={call.microphoneSwitching}
          cameraSwitching={call.cameraSwitching}
          screenShareStarting={call.screenShareStarting}
          screenShareViewerCount={activeParticipants.filter((participant) => participant.id !== realtime.clientId).length}
          activeScreenShareSettings={call.activeScreenShareSettings}
          onToggleMicrophone={() => void call.toggleMicrophone()}
          onSelectMicrophone={(deviceId) => void call.selectMicrophone(deviceId)}
          onToggleCamera={() => void call.toggleCamera()}
          onStartScreenShare={(settings) => void call.startScreenShare(settings)}
          onStopScreenShare={() => void call.stopScreenShare()}
          onLeave={() => { call.leave(); setNotice('Você saiu da conversa.') }}
        />
      )}

      <nav className="mobile-nav" aria-label="Navegação móvel">
        <button type="button" onClick={() => setChannelsOpen(true)}><Hash size={20} /><span>Canais</span></button>
        <button type="button" className={call.status === 'joined' ? 'is-live' : ''} onClick={() => openVoiceRoom(selectedVoiceRoom)}><Headphones size={20} /><span>Ao vivo</span></button>
        <button type="button" onClick={() => setMembersOpen(true)}><Users size={20} /><span>Pessoas</span></button>
        <button type="button" onClick={() => setProfileOpen(true)}><Avatar profile={profile} size="small" /><span>Perfil</span></button>
      </nav>

      <PrejoinDialog
        open={prejoinOpen}
        room={selectedVoiceRoom}
        profile={profile}
        stream={call.localStream}
        microphoneOn={call.microphoneOn}
        cameraOn={call.cameraOn}
        audioInputDevices={call.audioInputDevices}
        selectedMicrophoneId={call.selectedMicrophoneId}
        microphoneSwitching={call.microphoneSwitching}
        cameraSwitching={call.cameraSwitching}
        mediaPreparing={call.mediaPreparing}
        error={call.mediaError}
        joining={call.status === 'joining'}
        onToggleMicrophone={() => void call.toggleMicrophone()}
        onSelectMicrophone={(deviceId) => void call.selectMicrophone(deviceId)}
        onToggleCamera={() => void call.toggleCamera()}
        onJoin={() => void enterCall()}
        onClose={closePrejoin}
      />

      {profileOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <button type="button" className="modal-close" onClick={() => setProfileOpen(false)} aria-label="Fechar"><X size={20} /></button>
            <span className="eyebrow">Seu cartão de visita</span>
            <h2 id="profile-title">Como você aparece no <em>Pulso</em></h2>
            <div className="profile-dialog__preview"><Avatar profile={{ ...profile, name: profileDraft || profile.name, initials: makeInitials(profileDraft || profile.name) }} size="hero" /><span><strong>{profileDraft || 'Seu nome'}</strong><small>Disponível para conversar</small></span></div>
            <label>Nome de exibição<input value={profileDraft} maxLength={32} onChange={(event) => setProfileDraft(event.target.value)} autoFocus /></label>
            <div className="color-picker" aria-label="Cor do perfil">
              {profileColors.map((color) => (
                <button key={color} type="button" className={profile.color === color ? 'is-active' : ''} style={{ background: color }} onClick={() => setProfile((current) => ({ ...current, color }))} aria-label={`Usar a cor ${color}`} />
              ))}
            </div>
            <button type="button" className="primary-button" onClick={saveProfile}>Salvar perfil</button>
          </section>
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {realtime.status !== 'connected' && <Toast tone="danger">Tentando reconectar ao Pulso…</Toast>}
        {call.mediaError && !prejoinOpen && <Toast tone="danger" onClose={call.dismissMediaError}>{call.mediaError}</Toast>}
        {notice && <Toast tone="success" onClose={() => setNotice(null)}>{notice}</Toast>}
      </div>
    </div>
  )
}
