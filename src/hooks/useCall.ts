import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CallEvent,
  MediaState,
  RealtimeStatus,
  SignalPayload,
} from '../types'
import {
  SCREEN_SHARE_DISPLAY_OPTIONS,
  configureScreenSender,
  configureScreenTrack,
  selectSafeScreenAudio,
  type ScreenShareQuality,
} from '../lib/screenShare'
import {
  base64ToPcm16,
  startScreenRelay,
  type ScreenRelayController,
} from '../lib/screenRelay'

type CallStatus = 'idle' | 'preview' | 'joining' | 'joined'

type PeerRecord = {
  pc: RTCPeerConnection
  microphoneTransceiver: RTCRtpTransceiver
  screenAudioTransceiver: RTCRtpTransceiver
  videoTransceiver: RTCRtpTransceiver
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  pendingCandidates: RTCIceCandidateInit[]
  restartAttempts: number
  restartTimer: number | null
  restartRequested: boolean
}

export type AudioInputOption = {
  deviceId: string
  groupId: string
  label: string
}

type RelayAudioPlayer = {
  context: AudioContext
  gain: GainNode
  nextPlaybackTime: number
  resumeRequested: boolean
}

type UseCallOptions = {
  clientId: string
  realtimeStatus: RealtimeStatus
  subscribeToCallEvents: (listener: (event: CallEvent) => void) => () => void
  joinRealtimeCall: (channelId: string, media: MediaState) => void
  leaveRealtimeCall: () => void
  updateRealtimeCall: (media: MediaState) => void
  sendSignal: (target: string, payload: SignalPayload) => void
  sendScreenFrame: (dataUrl: string, targets: string[]) => void
  sendScreenAudio: (pcm: string, sampleRate: number, sequence: number, targets: string[]) => void
  notifyScreenRelayStop: () => void
}

function configuredIceServers(): RTCIceServer[] {
  const serialized = import.meta.env.VITE_ICE_SERVERS
  if (serialized) {
    try {
      const parsed = JSON.parse(serialized)
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      console.warn('VITE_ICE_SERVERS inválido; usando o servidor STUN padrão.')
    }
  }
  return [
    { urls: import.meta.env.VITE_STUN_URL || 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ]
}

const rtcConfiguration: RTCConfiguration = {
  iceServers: configuredIceServers(),
  bundlePolicy: 'max-bundle',
  iceCandidatePoolSize: 8,
}

function describeMediaError(error: unknown) {
  if (!(error instanceof DOMException)) {
    return 'Não foi possível acessar seus dispositivos de mídia.'
  }
  switch (error.name) {
    case 'NotAllowedError':
      return 'A permissão foi bloqueada. Libere câmera e microfone no navegador para participar com mídia.'
    case 'NotFoundError':
      return 'Não encontramos uma câmera ou um microfone disponível neste dispositivo.'
    case 'NotReadableError':
      return 'Outro aplicativo parece estar usando sua câmera ou seu microfone.'
    case 'AbortError':
      return 'A captura de mídia foi interrompida antes de começar.'
    default:
      return 'Não foi possível iniciar sua câmera ou seu microfone.'
  }
}

export function microphoneConstraint(deviceId: string): true | MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : true
}

export function useCall({
  clientId,
  realtimeStatus,
  subscribeToCallEvents,
  joinRealtimeCall,
  leaveRealtimeCall,
  updateRealtimeCall,
  sendSignal,
  sendScreenFrame,
  sendScreenAudio,
  notifyScreenRelayStop,
}: UseCallOptions) {
  const [status, setStatus] = useState<CallStatus>('idle')
  const [channelId, setChannelId] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [remoteMicrophoneStreams, setRemoteMicrophoneStreams] = useState<Map<string, MediaStream>>(new Map())
  const [remoteScreenAudioStreams, setRemoteScreenAudioStreams] = useState<Map<string, MediaStream>>(new Map())
  const [connectionStates, setConnectionStates] = useState<Map<string, RTCPeerConnectionState>>(new Map())
  const [microphoneOn, setMicrophoneOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [sharingScreen, setSharingScreen] = useState(false)
  const [screenAudioOn, setScreenAudioOn] = useState(false)
  const [screenAudioProtected, setScreenAudioProtected] = useState(false)
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputOption[]>([])
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState('')
  const [microphoneSwitching, setMicrophoneSwitching] = useState(false)
  const [mediaPreparing, setMediaPreparing] = useState(false)
  const [screenShareStarting, setScreenShareStarting] = useState(false)
  const [fallbackFrames, setFallbackFrames] = useState<Map<string, { dataUrl: string; receivedAt: number }>>(new Map())
  const [relayAudioBlocked, setRelayAudioBlocked] = useState<Map<string, boolean>>(new Map())

  const peerRecordsRef = useRef(new Map<string, PeerRecord>())
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const channelIdRef = useRef<string | null>(null)
  const statusRef = useRef<CallStatus>('idle')
  const microphoneOnRef = useRef(true)
  const cameraOnRef = useRef(true)
  const sharingScreenRef = useRef(false)
  const screenAudioOnRef = useRef(false)
  const selectedMicrophoneIdRef = useRef('')
  const microphoneSwitchingRef = useRef(false)
  const mediaEpochRef = useRef(0)
  const preparePromiseRef = useRef<Promise<MediaStream | null> | null>(null)
  const pendingMicrophoneTrackRef = useRef<MediaStreamTrack | null>(null)
  const microphoneSwitchRequestRef = useRef(0)
  const screenShareStartingRef = useRef(false)
  const screenShareRequestRef = useRef(0)
  const screenRelayRef = useRef<ScreenRelayController | null>(null)
  const screenRelayStartingRef = useRef<Promise<void> | null>(null)
  const screenRelaySubscribersRef = useRef(new Set<string>())
  const recoverMicrophoneRef = useRef<() => Promise<void>>(async () => undefined)
  const fallbackFrameTimersRef = useRef(new Map<string, number>())
  const relayAudioPlayersRef = useRef(new Map<string, RelayAudioPlayer>())
  const relayScreenVolumesRef = useRef(new Map<string, number>())
  const previousRealtimeStatusRef = useRef(realtimeStatus)
  const makeOfferRef = useRef<(
    peerId: string,
    record: PeerRecord,
    restartIce?: boolean,
  ) => Promise<void>>(async () => undefined)

  const currentMediaState = useCallback((): MediaState => ({
    microphone: microphoneOnRef.current && Boolean(
      localStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled),
    ),
    camera: cameraOnRef.current && Boolean(
      localStreamRef.current?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled),
    ),
    screen: sharingScreenRef.current,
    screenAudio: sharingScreenRef.current && screenAudioOnRef.current,
  }), [])

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'audioinput')
        .map((device, index): AudioInputOption => ({
          deviceId: device.deviceId,
          groupId: device.groupId,
          label: device.label || `Microfone ${index + 1}`,
        }))
      setAudioInputDevices(devices)

      const activeDeviceId = localStreamRef.current?.getAudioTracks()[0]?.getSettings().deviceId
      const preferred = activeDeviceId || selectedMicrophoneIdRef.current
      const nextId = devices.some((device) => device.deviceId === preferred)
        ? preferred
        : devices[0]?.deviceId || ''
      selectedMicrophoneIdRef.current = nextId
      setSelectedMicrophoneId(nextId)
      return { devices, nextId }
    } catch {
      // Device enumeration can fail before the first permission grant.
      return null
    }
  }, [])

  const closeRelayAudioPlayer = useCallback((peerId: string) => {
    const player = relayAudioPlayersRef.current.get(peerId)
    if (player) void player.context.close().catch(() => undefined)
    relayAudioPlayersRef.current.delete(peerId)
    setRelayAudioBlocked((current) => {
      if (!current.has(peerId)) return current
      const next = new Map(current)
      next.delete(peerId)
      return next
    })
  }, [])

  const clearFallbackFrame = useCallback((peerId: string) => {
    const timer = fallbackFrameTimersRef.current.get(peerId)
    if (timer !== undefined) window.clearTimeout(timer)
    fallbackFrameTimersRef.current.delete(peerId)
    setFallbackFrames((current) => {
      if (!current.has(peerId)) return current
      const next = new Map(current)
      next.delete(peerId)
      return next
    })
  }, [])

  const playRelayAudio = useCallback(async (peerId: string, serialized: string, sampleRate: number) => {
    const directScreenAudio = peerRecordsRef.current.get(peerId)?.screenAudioTransceiver.receiver.track
    if (directScreenAudio?.readyState === 'live' && !directScreenAudio.muted) {
      closeRelayAudioPlayer(peerId)
      return
    }
    if (!window.AudioContext) return

    let player = relayAudioPlayersRef.current.get(peerId)
    if (!player) {
      const context = new AudioContext({ latencyHint: 'interactive' })
      const gain = context.createGain()
      gain.gain.value = relayScreenVolumesRef.current.get(peerId) ?? 1
      gain.connect(context.destination)
      player = { context, gain, nextPlaybackTime: 0, resumeRequested: false }
      relayAudioPlayersRef.current.set(peerId, player)
    }
    const { context } = player
    if (context.state === 'suspended') {
      setRelayAudioBlocked((current) => new Map(current).set(peerId, true))
      if (!player.resumeRequested) {
        player.resumeRequested = true
        void context.resume().then(() => {
          player!.resumeRequested = false
          setRelayAudioBlocked((current) => new Map(current).set(peerId, context.state !== 'running'))
        }).catch(() => {
          player!.resumeRequested = false
        })
      }
      return
    }
    if (context.state !== 'running') return

    setRelayAudioBlocked((current) => {
      if (!current.get(peerId)) return current
      const next = new Map(current)
      next.set(peerId, false)
      return next
    })
    let samples: Int16Array
    try {
      samples = base64ToPcm16(serialized)
    } catch {
      return
    }
    if (!samples.length) return
    const buffer = context.createBuffer(1, samples.length, sampleRate)
    const channel = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 0x8000
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(player.gain)
    if (player.nextPlaybackTime > context.currentTime + 0.5) player.nextPlaybackTime = context.currentTime + 0.04
    const startAt = Math.max(context.currentTime + 0.04, player.nextPlaybackTime)
    source.start(startAt)
    player.nextPlaybackTime = startAt + buffer.duration
  }, [closeRelayAudioPlayer])

  const resumeRelayAudio = useCallback(async (peerId: string) => {
    const player = relayAudioPlayersRef.current.get(peerId)
    if (!player) return
    try {
      await player.context.resume()
      player.resumeRequested = false
      player.nextPlaybackTime = player.context.currentTime
      setRelayAudioBlocked((current) => new Map(current).set(peerId, player.context.state !== 'running'))
    } catch {
      setRelayAudioBlocked((current) => new Map(current).set(peerId, true))
    }
  }, [])

  const setRelayScreenVolume = useCallback((peerId: string, volume: number) => {
    const safeVolume = Math.max(0, Math.min(1, volume))
    relayScreenVolumesRef.current.set(peerId, safeVolume)
    const player = relayAudioPlayersRef.current.get(peerId)
    if (player) player.gain.gain.setValueAtTime(safeVolume, player.context.currentTime)
  }, [])

  const syncPeerSenders = useCallback(async (record: PeerRecord) => {
    const microphoneTrack = pendingMicrophoneTrackRef.current
      || localStreamRef.current?.getAudioTracks().find((track) => track.readyState === 'live')
      || null
    const screenAudioTrack = sharingScreenRef.current
      ? screenStreamRef.current?.getAudioTracks().find((track) => track.readyState === 'live') || null
      : null
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0] || null
    const videoTrack = sharingScreenRef.current ? screenTrack : cameraTrack

    await Promise.all([
      record.microphoneTransceiver.sender.replaceTrack(microphoneTrack),
      record.screenAudioTransceiver.sender.replaceTrack(screenAudioTrack),
      record.videoTransceiver.sender.replaceTrack(videoTrack),
    ])
    if (sharingScreenRef.current) {
      await configureScreenSender(record.videoTransceiver.sender)
    }
  }, [])

  const stopCompatibilityRelayIfIdle = useCallback((force = false) => {
    if (!force && screenRelaySubscribersRef.current.size > 0) return
    screenRelayRef.current?.stop()
    screenRelayRef.current = null
  }, [])

  const ensureCompatibilityRelay = useCallback(() => {
    const stream = screenStreamRef.current
    if (!stream || !sharingScreenRef.current || !screenRelaySubscribersRef.current.size
      || screenRelayRef.current || screenRelayStartingRef.current) return

    const operation = (async () => {
      try {
        const controller = await startScreenRelay(stream, {
          sendFrame: (dataUrl) => {
            const targets = [...screenRelaySubscribersRef.current]
            if (targets.length) sendScreenFrame(dataUrl, targets)
          },
          sendAudio: (pcm, sampleRate, sequence) => {
            const targets = [...screenRelaySubscribersRef.current]
            if (targets.length) sendScreenAudio(pcm, sampleRate, sequence, targets)
          },
        })
        if (stream !== screenStreamRef.current || !sharingScreenRef.current
          || !screenRelaySubscribersRef.current.size) {
          controller.stop()
          return
        }
        screenRelayRef.current = controller
      } catch (error) {
        console.warn('O modo de compatibilidade da transmissão não iniciou.', error)
      }
    })()
    screenRelayStartingRef.current = operation
    void operation.finally(() => {
      if (screenRelayStartingRef.current === operation) screenRelayStartingRef.current = null
    })
  }, [sendScreenAudio, sendScreenFrame])

  const closePeer = useCallback((peerId: string) => {
    const record = peerRecordsRef.current.get(peerId)
    if (!record) return
    record.pc.ontrack = null
    record.pc.onicecandidate = null
    record.pc.onconnectionstatechange = null
    record.pc.onsignalingstatechange = null
    if (record.restartTimer !== null) window.clearTimeout(record.restartTimer)
    record.pc.close()
    peerRecordsRef.current.delete(peerId)
    screenRelaySubscribersRef.current.delete(peerId)
    stopCompatibilityRelayIfIdle()
    clearFallbackFrame(peerId)
    closeRelayAudioPlayer(peerId)
    relayScreenVolumesRef.current.delete(peerId)
    setRemoteStreams((current) => {
      const next = new Map(current)
      next.delete(peerId)
      return next
    })
    setRemoteMicrophoneStreams((current) => {
      if (!current.has(peerId)) return current
      const next = new Map(current)
      next.delete(peerId)
      return next
    })
    setRemoteScreenAudioStreams((current) => {
      if (!current.has(peerId)) return current
      const next = new Map(current)
      next.delete(peerId)
      return next
    })
    setConnectionStates((current) => {
      const next = new Map(current)
      next.delete(peerId)
      return next
    })
  }, [clearFallbackFrame, closeRelayAudioPlayer, stopCompatibilityRelayIfIdle])

  const closeAllPeers = useCallback(() => {
    for (const peerId of [...peerRecordsRef.current.keys()]) closePeer(peerId)
  }, [closePeer])

  const ensurePeer = useCallback((peerId: string) => {
    const existing = peerRecordsRef.current.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection(rtcConfiguration)
    const microphoneTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' })
    const screenAudioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' })
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' })

    const record: PeerRecord = {
      pc,
      microphoneTransceiver,
      screenAudioTransceiver,
      videoTransceiver,
      polite: clientId.localeCompare(peerId) > 0,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      restartAttempts: 0,
      restartTimer: null,
      restartRequested: false,
    }
    peerRecordsRef.current.set(peerId, record)

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(peerId, { candidate: candidate.toJSON() })
    }

    pc.ontrack = ({ track, transceiver }) => {
      if (transceiver === screenAudioTransceiver) {
        track.onunmute = () => closeRelayAudioPlayer(peerId)
      }
      const updateAudioStream = (
        setter: typeof setRemoteMicrophoneStreams,
      ) => setter((current) => {
        const next = new Map(current)
        const stream = next.get(peerId) || new MediaStream()
        if (!stream.getTracks().some((existingTrack) => existingTrack.id === track.id)) stream.addTrack(track)
        next.set(peerId, stream)
        return next
      })
      if (transceiver === microphoneTransceiver) updateAudioStream(setRemoteMicrophoneStreams)
      if (transceiver === screenAudioTransceiver) updateAudioStream(setRemoteScreenAudioStreams)
      setRemoteStreams((current) => {
        const next = new Map(current)
        const stream = next.get(peerId) || new MediaStream()
        if (!stream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
          stream.addTrack(track)
        }
        next.set(peerId, stream)
        return next
      })
    }

    pc.onconnectionstatechange = () => {
      setConnectionStates((current) => {
        const next = new Map(current)
        next.set(peerId, pc.connectionState)
        return next
      })
      if (pc.connectionState === 'connected') {
        if (record.restartTimer !== null) window.clearTimeout(record.restartTimer)
        record.restartTimer = null
        record.restartAttempts = 0
        record.restartRequested = false
        if (sharingScreenRef.current) void syncPeerSenders(record)
        return
      }

      if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected')
        && record.restartTimer === null
        && record.restartAttempts < 3) {
        const delay = pc.connectionState === 'failed' ? 0 : 2_500
        record.restartTimer = window.setTimeout(() => {
          record.restartTimer = null
          if (pc.connectionState === 'connected' || pc.connectionState === 'closed') return
          record.restartAttempts += 1
          record.restartRequested = true
          void makeOfferRef.current(peerId, record, true)
        }, delay)
      }
    }

    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable' && record.restartRequested && !record.makingOffer) {
        void makeOfferRef.current(peerId, record, true)
      }
    }

    void syncPeerSenders(record)
    return record
  }, [clientId, closeRelayAudioPlayer, sendSignal, syncPeerSenders])

  const makeOffer = useCallback(async (
    peerId: string,
    record = ensurePeer(peerId),
    restartIce = false,
  ) => {
    const shouldRestartIce = restartIce || record.restartRequested
    if (record.makingOffer || record.pc.signalingState !== 'stable') {
      if (shouldRestartIce) record.restartRequested = true
      return
    }
    try {
      record.makingOffer = true
      record.restartRequested = false
      if (shouldRestartIce) record.pc.restartIce()
      await syncPeerSenders(record)
      await record.pc.setLocalDescription()
      if (record.pc.localDescription) {
        sendSignal(peerId, { description: record.pc.localDescription.toJSON() })
      }
    } catch (error) {
      if (shouldRestartIce) record.restartRequested = true
      console.warn(shouldRestartIce ? 'Falha ao reiniciar a conexão WebRTC' : 'Falha ao criar oferta WebRTC', error)
    } finally {
      record.makingOffer = false
    }
  }, [ensurePeer, sendSignal, syncPeerSenders])

  useEffect(() => {
    makeOfferRef.current = makeOffer
  }, [makeOffer])

  const handleSignal = useCallback(async (peerId: string, payload: SignalPayload) => {
    const record = ensurePeer(peerId)
    const { pc } = record

    try {
      if (payload.description) {
        const description = payload.description
        const offerCollision = description.type === 'offer'
          && (record.makingOffer || pc.signalingState !== 'stable')
        record.ignoreOffer = !record.polite && offerCollision
        if (record.ignoreOffer) return

        if (offerCollision && pc.signalingState !== 'stable') {
          await pc.setLocalDescription({ type: 'rollback' })
        }
        await pc.setRemoteDescription(description)

        for (const candidate of record.pendingCandidates.splice(0)) {
          await pc.addIceCandidate(candidate)
        }

        if (description.type === 'offer') {
          await syncPeerSenders(record)
          await pc.setLocalDescription()
          if (pc.localDescription) {
            sendSignal(peerId, { description: pc.localDescription.toJSON() })
          }
        }
      } else if (payload.candidate) {
        if (record.ignoreOffer) return
        if (!pc.remoteDescription) {
          record.pendingCandidates.push(payload.candidate)
        } else {
          await pc.addIceCandidate(payload.candidate)
        }
      }
    } catch (error) {
      if (!record.ignoreOffer) console.warn('Falha na negociação WebRTC', error)
    }
  }, [ensurePeer, sendSignal, syncPeerSenders])

  useEffect(() => subscribeToCallEvents((event) => {
    if (event.channelId !== channelIdRef.current) return

    if (event.type === 'call:peers') {
      for (const peer of event.peers) {
        const record = ensurePeer(peer.id)
        void makeOffer(peer.id, record)
      }
    } else if (event.type === 'call:peer-left') {
      closePeer(event.peerId)
    } else if (event.type === 'call:signal') {
      void handleSignal(event.from, event.payload)
    } else if (event.type === 'call:screen-frame') {
      const receivedAt = Date.now()
      setFallbackFrames((current) => new Map(current).set(event.from, { dataUrl: event.dataUrl, receivedAt }))
      const previousTimer = fallbackFrameTimersRef.current.get(event.from)
      if (previousTimer !== undefined) window.clearTimeout(previousTimer)
      fallbackFrameTimersRef.current.set(event.from, window.setTimeout(() => {
        clearFallbackFrame(event.from)
      }, 2_500))
    } else if (event.type === 'call:screen-audio') {
      void playRelayAudio(event.from, event.pcm, event.sampleRate)
    } else if (event.type === 'call:screen-stop') {
      clearFallbackFrame(event.from)
      closeRelayAudioPlayer(event.from)
    } else if (event.type === 'call:screen-relay-request') {
      if (!sharingScreenRef.current) return
      screenRelaySubscribersRef.current.add(event.from)
      ensureCompatibilityRelay()
    } else if (event.type === 'call:screen-relay-release') {
      screenRelaySubscribersRef.current.delete(event.from)
      stopCompatibilityRelayIfIdle()
    }
  }), [
    clearFallbackFrame,
    closePeer,
    closeRelayAudioPlayer,
    ensurePeer,
    ensureCompatibilityRelay,
    handleSignal,
    makeOffer,
    playRelayAudio,
    subscribeToCallEvents,
    stopCompatibilityRelayIfIdle,
  ])

  const prepareMedia = useCallback((): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError('Este navegador não oferece captura de câmera e microfone.')
      if (statusRef.current !== 'joining' && statusRef.current !== 'joined') {
        setStatus('preview')
        statusRef.current = 'preview'
      }
      return Promise.resolve(null)
    }

    const existing = localStreamRef.current
    if (existing?.getTracks().some((track) => track.readyState === 'live')) {
      void refreshAudioInputs()
      if (statusRef.current !== 'joining' && statusRef.current !== 'joined') {
        setStatus('preview')
        statusRef.current = 'preview'
      }
      return Promise.resolve(existing)
    }
    if (preparePromiseRef.current) return preparePromiseRef.current

    const requestEpoch = mediaEpochRef.current
    setMediaError(null)
    setMediaPreparing(true)
    const operation = (async () => {
      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraint(selectedMicrophoneIdRef.current),
          video: cameraOnRef.current,
        })
      } catch (firstError) {
        if (requestEpoch !== mediaEpochRef.current) return null
        if (cameraOnRef.current && firstError instanceof DOMException && firstError.name !== 'NotAllowedError') {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: microphoneConstraint(selectedMicrophoneIdRef.current),
              video: false,
            })
            if (requestEpoch !== mediaEpochRef.current) {
              for (const track of stream.getTracks()) track.stop()
              return null
            }
            cameraOnRef.current = false
            setCameraOn(false)
            setMediaError('A câmera não está disponível; você ainda pode entrar somente com áudio.')
          } catch (audioError) {
            if (requestEpoch === mediaEpochRef.current) setMediaError(describeMediaError(audioError))
          }
        } else {
          setMediaError(describeMediaError(firstError))
        }
      }

      if (requestEpoch !== mediaEpochRef.current) {
        for (const track of stream?.getTracks() || []) track.stop()
        return null
      }

      if (stream) {
        for (const track of stream.getAudioTracks()) {
          track.enabled = microphoneOnRef.current
          track.onended = () => { void recoverMicrophoneRef.current() }
        }
        for (const track of stream.getVideoTracks()) track.enabled = cameraOnRef.current
        localStreamRef.current = stream
        setLocalStream(stream)
        if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
          microphoneOnRef.current = false
          setMicrophoneOn(false)
        }
        if (!stream.getVideoTracks().some((track) => track.readyState === 'live')) {
          cameraOnRef.current = false
          setCameraOn(false)
        }
        const activeMicrophoneId = stream.getAudioTracks()[0]?.getSettings().deviceId || selectedMicrophoneIdRef.current
        selectedMicrophoneIdRef.current = activeMicrophoneId
        setSelectedMicrophoneId(activeMicrophoneId)
        void refreshAudioInputs()
      } else {
        microphoneOnRef.current = false
        cameraOnRef.current = false
        setMicrophoneOn(false)
        setCameraOn(false)
      }

      if (statusRef.current !== 'joining' && statusRef.current !== 'joined') {
        setStatus('preview')
        statusRef.current = 'preview'
      }
      return stream
    })()
    preparePromiseRef.current = operation
    void operation.finally(() => {
      if (preparePromiseRef.current === operation) preparePromiseRef.current = null
      if (requestEpoch === mediaEpochRef.current) setMediaPreparing(false)
    })
    return operation
  }, [refreshAudioInputs])

  const selectMicrophone = useCallback(async (deviceId: string) => {
    if (!deviceId || microphoneSwitchingRef.current || !navigator.mediaDevices?.getUserMedia) return
    const currentTrack = localStreamRef.current?.getAudioTracks()[0] || null
    const currentDeviceId = currentTrack?.getSettings().deviceId
    if (deviceId === currentDeviceId && currentTrack?.readyState === 'live') {
      selectedMicrophoneIdRef.current = deviceId
      setSelectedMicrophoneId(deviceId)
      return
    }

    const requestEpoch = mediaEpochRef.current
    const operationIsStale = () => requestEpoch !== mediaEpochRef.current || statusRef.current === 'idle'
    const switchRequest = ++microphoneSwitchRequestRef.current
    microphoneSwitchingRef.current = true
    setMicrophoneSwitching(true)
    setMediaError(null)
    const previousStream = localStreamRef.current
    const previousTrack = previousStream?.getAudioTracks()[0] || null
    const previousSendTrack = previousTrack?.readyState === 'live' ? previousTrack : null
    let replacementTrack: MediaStreamTrack | null = null

    try {
      const replacementStream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraint(deviceId),
        video: false,
      })
      replacementTrack = replacementStream.getAudioTracks()[0] || null
      if (!replacementTrack) throw new DOMException('Microfone indisponível', 'NotFoundError')
      if (operationIsStale()) {
        replacementTrack.stop()
        return
      }
      replacementTrack.enabled = microphoneOnRef.current
      pendingMicrophoneTrackRef.current = replacementTrack
      await Promise.allSettled([...peerRecordsRef.current.values()].map(
        (record) => record.microphoneTransceiver.sender.replaceTrack(replacementTrack),
      ))
      if (operationIsStale()) {
        pendingMicrophoneTrackRef.current = null
        await Promise.allSettled([...peerRecordsRef.current.values()].map(
          (record) => record.microphoneTransceiver.sender.replaceTrack(previousSendTrack),
        ))
        replacementTrack.stop()
        return
      }

      replacementTrack.enabled = microphoneOnRef.current
      replacementTrack.onended = () => { void recoverMicrophoneRef.current() }
      const videoTracks = previousStream?.getVideoTracks().filter((track) => track.readyState === 'live') || []
      const nextStream = new MediaStream([...videoTracks, replacementTrack])
      localStreamRef.current = nextStream
      setLocalStream(nextStream)
      pendingMicrophoneTrackRef.current = null
      await Promise.allSettled([...peerRecordsRef.current.values()].map(syncPeerSenders))
      replacementTrack.enabled = microphoneOnRef.current
      if (previousTrack) previousTrack.onended = null
      previousTrack?.stop()

      const activeId = replacementTrack.getSettings().deviceId || deviceId
      selectedMicrophoneIdRef.current = activeId
      setSelectedMicrophoneId(activeId)
      if (statusRef.current === 'joined') updateRealtimeCall(currentMediaState())
      void refreshAudioInputs()
    } catch (error) {
      pendingMicrophoneTrackRef.current = null
      replacementTrack?.stop()
      if (requestEpoch === mediaEpochRef.current) setMediaError(describeMediaError(error))
    } finally {
      if (microphoneSwitchRequestRef.current === switchRequest) {
        microphoneSwitchingRef.current = false
        setMicrophoneSwitching(false)
      }
    }
  }, [currentMediaState, refreshAudioInputs, syncPeerSenders, updateRealtimeCall])

  const recoverMicrophone = useCallback(async () => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track || track.readyState === 'live' || !microphoneOnRef.current) {
      await refreshAudioInputs()
      return
    }
    const result = await refreshAudioInputs()
    if (result?.nextId) {
      await selectMicrophone(result.nextId)
      return
    }
    microphoneOnRef.current = false
    setMicrophoneOn(false)
    setMediaError('O microfone foi desconectado. Conecte outro dispositivo para continuar falando.')
    if (statusRef.current === 'joined') updateRealtimeCall(currentMediaState())
  }, [currentMediaState, refreshAudioInputs, selectMicrophone, updateRealtimeCall])

  useEffect(() => {
    recoverMicrophoneRef.current = recoverMicrophone
  }, [recoverMicrophone])

  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.addEventListener) return
    const handleDeviceChange = () => { void recoverMicrophone() }
    devices.addEventListener('devicechange', handleDeviceChange)
    return () => devices.removeEventListener('devicechange', handleDeviceChange)
  }, [recoverMicrophone])

  const cancelPreview = useCallback(() => {
    if (statusRef.current === 'joined') return
    mediaEpochRef.current += 1
    preparePromiseRef.current = null
    microphoneSwitchRequestRef.current += 1
    for (const track of localStreamRef.current?.getTracks() || []) {
      track.onended = null
      track.stop()
    }
    localStreamRef.current = null
    pendingMicrophoneTrackRef.current?.stop()
    pendingMicrophoneTrackRef.current = null
    setLocalStream(null)
    setMediaPreparing(false)
    setMicrophoneSwitching(false)
    microphoneSwitchingRef.current = false
    setStatus('idle')
    statusRef.current = 'idle'
    setMediaError(null)
  }, [])

  const join = useCallback(async (targetChannelId: string) => {
    setStatus('joining')
    statusRef.current = 'joining'
    channelIdRef.current = targetChannelId
    setChannelId(targetChannelId)

    if (!localStreamRef.current) await prepareMedia()
    joinRealtimeCall(targetChannelId, currentMediaState())
    setStatus('joined')
    statusRef.current = 'joined'
  }, [currentMediaState, joinRealtimeCall, prepareMedia])

  const stopScreenShare = useCallback(async () => {
    const stream = screenStreamRef.current
    stopCompatibilityRelayIfIdle(true)
    screenRelaySubscribersRef.current.clear()
    screenStreamRef.current = null
    sharingScreenRef.current = false
    screenAudioOnRef.current = false
    setScreenStream(null)
    setSharingScreen(false)
    setScreenAudioOn(false)
    setScreenAudioProtected(false)
    setScreenShareQuality(null)
    for (const track of stream?.getTracks() || []) {
      track.onended = null
      track.stop()
    }
    await Promise.allSettled([...peerRecordsRef.current.values()].map(syncPeerSenders))
    if (statusRef.current === 'joined') {
      updateRealtimeCall(currentMediaState())
      notifyScreenRelayStop()
    }
  }, [currentMediaState, notifyScreenRelayStop, stopCompatibilityRelayIfIdle, syncPeerSenders, updateRealtimeCall])

  const leave = useCallback(() => {
    mediaEpochRef.current += 1
    preparePromiseRef.current = null
    microphoneSwitchRequestRef.current += 1
    screenShareRequestRef.current += 1
    leaveRealtimeCall()
    closeAllPeers()
    stopCompatibilityRelayIfIdle(true)
    screenRelaySubscribersRef.current.clear()
    const sharedStream = screenStreamRef.current
    screenStreamRef.current = null
    for (const track of sharedStream?.getTracks() || []) {
      track.onended = null
      track.stop()
    }
    for (const track of localStreamRef.current?.getTracks() || []) {
      track.onended = null
      track.stop()
    }
    pendingMicrophoneTrackRef.current?.stop()
    pendingMicrophoneTrackRef.current = null
    localStreamRef.current = null
    channelIdRef.current = null
    statusRef.current = 'idle'
    sharingScreenRef.current = false
    screenAudioOnRef.current = false
    setLocalStream(null)
    setScreenStream(null)
    setScreenShareQuality(null)
    setRemoteStreams(new Map())
    setRemoteMicrophoneStreams(new Map())
    setRemoteScreenAudioStreams(new Map())
    setConnectionStates(new Map())
    setFallbackFrames(new Map())
    setRelayAudioBlocked(new Map())
    setSharingScreen(false)
    setScreenAudioOn(false)
    setScreenAudioProtected(false)
    setMediaPreparing(false)
    setMicrophoneSwitching(false)
    setScreenShareStarting(false)
    microphoneSwitchingRef.current = false
    screenShareStartingRef.current = false
    setChannelId(null)
    setStatus('idle')
    setMediaError(null)
    for (const timer of fallbackFrameTimersRef.current.values()) window.clearTimeout(timer)
    fallbackFrameTimersRef.current.clear()
    for (const player of relayAudioPlayersRef.current.values()) void player.context.close().catch(() => undefined)
    relayAudioPlayersRef.current.clear()
    relayScreenVolumesRef.current.clear()
  }, [closeAllPeers, leaveRealtimeCall, stopCompatibilityRelayIfIdle])

  const toggleMicrophone = useCallback(async () => {
    if (microphoneSwitchingRef.current) return
    let track = localStreamRef.current?.getAudioTracks().find((item) => item.readyState === 'live')
    const nextState = !microphoneOnRef.current

    if (nextState && !track && navigator.mediaDevices?.getUserMedia) {
      const requestEpoch = mediaEpochRef.current
      try {
        const addition = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraint(selectedMicrophoneIdRef.current),
        })
        track = addition.getAudioTracks()[0]
        if (requestEpoch !== mediaEpochRef.current || statusRef.current === 'idle') {
          track?.stop()
          return
        }
        if (track) {
          track.enabled = true
          track.onended = () => { void recoverMicrophoneRef.current() }
          const videoTracks = localStreamRef.current?.getVideoTracks().filter((item) => item.readyState === 'live') || []
          const nextStream = new MediaStream([...videoTracks, track])
          localStreamRef.current = nextStream
          setLocalStream(nextStream)
          const activeId = track.getSettings().deviceId || selectedMicrophoneIdRef.current
          selectedMicrophoneIdRef.current = activeId
          setSelectedMicrophoneId(activeId)
          await Promise.allSettled([...peerRecordsRef.current.values()].map(syncPeerSenders))
          void refreshAudioInputs()
        }
      } catch (error) {
        setMediaError(describeMediaError(error))
        return
      }
    }

    if (track) track.enabled = nextState
    microphoneOnRef.current = Boolean(track) && nextState
    setMicrophoneOn(microphoneOnRef.current)
    if (statusRef.current === 'joined') updateRealtimeCall(currentMediaState())
  }, [currentMediaState, refreshAudioInputs, syncPeerSenders, updateRealtimeCall])

  const toggleCamera = useCallback(async () => {
    let track = localStreamRef.current?.getVideoTracks().find((item) => item.readyState === 'live')
    const nextState = !cameraOnRef.current

    if (nextState && !track && navigator.mediaDevices?.getUserMedia) {
      try {
        const addition = await navigator.mediaDevices.getUserMedia({ video: true })
        track = addition.getVideoTracks()[0]
        if (track) {
          const targetStream = localStreamRef.current || new MediaStream()
          targetStream.addTrack(track)
          localStreamRef.current = targetStream
          setLocalStream(targetStream)
          if (!sharingScreenRef.current) {
            await Promise.allSettled([...peerRecordsRef.current.values()].map(syncPeerSenders))
          }
        }
      } catch (error) {
        setMediaError(describeMediaError(error))
        return
      }
    }

    if (track) track.enabled = nextState
    cameraOnRef.current = Boolean(track) && nextState
    setCameraOn(cameraOnRef.current)
    if (statusRef.current === 'joined') updateRealtimeCall(currentMediaState())
  }, [currentMediaState, syncPeerSenders, updateRealtimeCall])

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || statusRef.current !== 'joined') {
      setMediaError('O compartilhamento de tela não está disponível neste navegador.')
      return
    }
    if (sharingScreenRef.current || screenShareStartingRef.current) return

    const requestEpoch = mediaEpochRef.current
    const shareRequest = ++screenShareRequestRef.current
    let capturedStream: MediaStream | null = null
    screenShareStartingRef.current = true
    setScreenShareStarting(true)
    try {
      setMediaError(null)
      capturedStream = await navigator.mediaDevices.getDisplayMedia(SCREEN_SHARE_DISPLAY_OPTIONS)
      if (requestEpoch !== mediaEpochRef.current || statusRef.current !== 'joined') {
        for (const track of capturedStream.getTracks()) track.stop()
        return
      }
      const screenTrack = capturedStream.getVideoTracks()[0]
      if (!screenTrack) {
        for (const track of capturedStream.getTracks()) track.stop()
        throw new Error('A captura não forneceu vídeo.')
      }
      const screenAudioSafety = selectSafeScreenAudio(capturedStream)
      const screenAudioTrack = screenAudioSafety.track

      const quality = await configureScreenTrack(screenTrack)
      if (requestEpoch !== mediaEpochRef.current || statusRef.current !== 'joined') {
        for (const track of capturedStream.getTracks()) track.stop()
        return
      }

      stopCompatibilityRelayIfIdle(true)
      screenRelaySubscribersRef.current.clear()
      screenStreamRef.current = capturedStream
      sharingScreenRef.current = true
      screenAudioOnRef.current = Boolean(screenAudioTrack)
      setScreenStream(capturedStream)
      setSharingScreen(true)
      setScreenAudioOn(Boolean(screenAudioTrack))
      setScreenAudioProtected(screenAudioSafety.blockedSystemAudio)
      setScreenShareQuality(quality)
      screenTrack.onended = () => { void stopScreenShare() }
      if (screenAudioTrack) {
        screenAudioTrack.onended = () => {
          screenAudioOnRef.current = false
          setScreenAudioOn(false)
          void Promise.allSettled([...peerRecordsRef.current.values()].map(syncPeerSenders))
          if (statusRef.current === 'joined') updateRealtimeCall(currentMediaState())
        }
      }
      await Promise.allSettled([...peerRecordsRef.current.values()].map(syncPeerSenders))
      if (requestEpoch === mediaEpochRef.current && statusRef.current === 'joined') {
        updateRealtimeCall(currentMediaState())
      }
    } catch (error) {
      if (capturedStream && capturedStream !== screenStreamRef.current) {
        for (const track of capturedStream.getTracks()) track.stop()
      }
      if (requestEpoch !== mediaEpochRef.current) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setMediaError('O compartilhamento foi cancelado. Nada foi transmitido.')
      } else {
        setMediaError('Não foi possível começar a transmissão da tela.')
      }
    } finally {
      if (screenShareRequestRef.current === shareRequest) {
        screenShareStartingRef.current = false
        setScreenShareStarting(false)
      }
    }
  }, [
    currentMediaState,
    stopCompatibilityRelayIfIdle,
    syncPeerSenders,
    updateRealtimeCall,
  ])

  useEffect(() => {
    const previous = previousRealtimeStatusRef.current
    previousRealtimeStatusRef.current = realtimeStatus
    if (previous === 'connected' && realtimeStatus !== 'connected') return
    if (previous !== 'connected' && realtimeStatus === 'connected' && statusRef.current === 'joined') {
      closeAllPeers()
      const activeChannel = channelIdRef.current
      if (activeChannel) joinRealtimeCall(activeChannel, currentMediaState())
    }
  }, [closeAllPeers, currentMediaState, joinRealtimeCall, realtimeStatus])

  useEffect(() => {
    const handlePageHide = () => {
      mediaEpochRef.current += 1
      if (statusRef.current === 'joined') leaveRealtimeCall()
      stopCompatibilityRelayIfIdle(true)
      screenRelaySubscribersRef.current.clear()
      for (const record of peerRecordsRef.current.values()) record.pc.close()
      for (const track of screenStreamRef.current?.getTracks() || []) track.stop()
      for (const track of localStreamRef.current?.getTracks() || []) track.stop()
      for (const player of relayAudioPlayersRef.current.values()) void player.context.close().catch(() => undefined)
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [leaveRealtimeCall, stopCompatibilityRelayIfIdle])

  return {
    status,
    channelId,
    localStream,
    screenStream,
    remoteStreams,
    remoteMicrophoneStreams,
    remoteScreenAudioStreams,
    connectionStates,
    microphoneOn,
    cameraOn,
    sharingScreen,
    screenAudioOn,
    screenAudioProtected,
    screenShareQuality,
    mediaError,
    audioInputDevices,
    selectedMicrophoneId,
    microphoneSwitching,
    mediaPreparing,
    screenShareStarting,
    fallbackFrames,
    relayAudioBlocked,
    prepareMedia,
    refreshAudioInputs,
    selectMicrophone,
    cancelPreview,
    join,
    leave,
    toggleMicrophone,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    resumeRelayAudio,
    setRelayScreenVolume,
    dismissMediaError: () => setMediaError(null),
  }
}
