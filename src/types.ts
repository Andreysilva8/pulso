export type Profile = {
  name: string
  color: string
  initials: string
}

export type PresenceMember = Profile & {
  id: string
  activeChannelId: string
  connectedAt: number
}

export type MediaState = {
  microphone: boolean
  camera: boolean
  screen: boolean
  screenAudio: boolean
}

export type CallParticipant = Profile & {
  id: string
  channelId: string
  media: MediaState
  joinedAt: number
}

export type ChatMessage = {
  id: string
  channelId: string
  senderId: string
  senderName: string
  senderColor: string
  senderInitials: string
  text: string
  sentAt: number
  system?: boolean
}

export type SignalPayload = {
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

export type ScreenRelayFrame = {
  dataUrl: string
  receivedAt: number
  frameRate: number
}

export type CallEvent =
  | { type: 'call:peers'; channelId: string; peers: CallParticipant[] }
  | { type: 'call:peer-left'; channelId: string; peerId: string }
  | { type: 'call:signal'; channelId: string; from: string; payload: SignalPayload }
  | { type: 'call:screen-frame'; channelId: string; from: string; dataUrl: string; frameRate: number; relayId?: number }
  | { type: 'call:screen-audio'; channelId: string; from: string; pcm: string; sampleRate: number; sequence: number; relayId?: number }
  | { type: 'call:screen-stop'; channelId: string; from: string }
  | { type: 'call:screen-relay-request'; channelId: string; from: string }
  | { type: 'call:screen-relay-release'; channelId: string; from: string }

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export type VoiceRoom = {
  id: string
  name: string
  mood: string
  accent: 'mint' | 'coral' | 'amber'
}

export type TextChannel = {
  id: string
  name: string
  description: string
}
