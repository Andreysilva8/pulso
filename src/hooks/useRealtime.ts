import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CallEvent,
  CallParticipant,
  ChatMessage,
  MediaState,
  PresenceMember,
  Profile,
  RealtimeStatus,
  SignalPayload,
} from '../types'
import { configuredIceServers, sanitizeIceServers } from '../lib/iceServers'

type CallListener = (event: CallEvent) => void
const MAX_MEDIA_SOCKET_BUFFER = 256 * 1024
const MAX_CONTROL_SOCKET_BUFFER = 2 * 1024 * 1024

function socketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export function useRealtime(initialProfile: Profile, activeChannelId: string) {
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const [clientId, setClientId] = useState('')
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(() => configuredIceServers(
    import.meta.env.VITE_ICE_SERVERS,
    import.meta.env.VITE_STUN_URL,
  ))
  const [members, setMembers] = useState<PresenceMember[]>([])
  const [callsByChannel, setCallsByChannel] = useState<Record<string, CallParticipant[]>>({})
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, ChatMessage[]>>({})
  const [typingByChannel, setTypingByChannel] = useState<Record<string, { id: string; name: string }[]>>({})

  const socketRef = useRef<WebSocket | null>(null)
  const profileRef = useRef(initialProfile)
  const activeChannelRef = useRef(activeChannelId)
  const listenersRef = useRef(new Set<CallListener>())
  const typingTimersRef = useRef(new Map<string, number>())

  const send = useCallback((payload: unknown, droppable = false) => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return false
    if (droppable && socket.bufferedAmount > MAX_MEDIA_SOCKET_BUFFER) return false
    if (!droppable && socket.bufferedAmount > MAX_CONTROL_SOCKET_BUFFER) {
      socket.close(1013, 'Conexão congestionada')
      return false
    }
    try {
      socket.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let reconnectTimer = 0
    let pingTimer = 0
    let attempt = 0

    const connect = () => {
      if (stopped) return
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      const socket = new WebSocket(socketUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        if (stopped) return
        attempt = 0
        setStatus('connected')
        socket.send(JSON.stringify({
          type: 'workspace:join',
          profile: profileRef.current,
          activeChannelId: activeChannelRef.current,
        }))
        window.clearInterval(pingTimer)
        pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 20_000)
      })

      socket.addEventListener('message', (event) => {
        let message: any
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }

        switch (message.type) {
          case 'session:ready':
            setClientId(message.clientId)
            break

          case 'session:ice-servers': {
            const nextIceServers = sanitizeIceServers(message.iceServers)
            if (nextIceServers.length) setIceServers(nextIceServers)
            break
          }

          case 'workspace:state':
            setClientId(message.clientId)
            setMembers(message.members || [])
            setCallsByChannel(message.calls || {})
            setMessagesByChannel(message.messages || {})
            break

          case 'workspace:presence':
            setMembers(message.members || [])
            break

          case 'call:presence':
            setCallsByChannel((current) => ({
              ...current,
              [message.channelId]: message.participants || [],
            }))
            break

          case 'chat:message': {
            const chatMessage = message.message as ChatMessage
            setMessagesByChannel((current) => ({
              ...current,
              [chatMessage.channelId]: [...(current[chatMessage.channelId] || []), chatMessage].slice(-100),
            }))
            break
          }

          case 'chat:typing': {
            const key = `${message.channelId}:${message.member.id}`
            const removeTyping = () => {
              setTypingByChannel((current) => ({
                ...current,
                [message.channelId]: (current[message.channelId] || []).filter(
                  (member) => member.id !== message.member.id,
                ),
              }))
              typingTimersRef.current.delete(key)
            }

            window.clearTimeout(typingTimersRef.current.get(key))
            if (!message.active) {
              removeTyping()
              break
            }

            setTypingByChannel((current) => {
              const existing = current[message.channelId] || []
              if (existing.some((member) => member.id === message.member.id)) return current
              return { ...current, [message.channelId]: [...existing, message.member] }
            })
            typingTimersRef.current.set(key, window.setTimeout(removeTyping, 2_000))
            break
          }

          case 'call:peers':
          case 'call:peer-left':
          case 'call:signal':
          case 'call:screen-frame':
          case 'call:screen-audio':
          case 'call:screen-stop':
          case 'call:screen-relay-request':
          case 'call:screen-relay-release':
            for (const listener of listenersRef.current) listener(message as CallEvent)
            break
        }
      })

      socket.addEventListener('close', () => {
        window.clearInterval(pingTimer)
        if (stopped) return
        setStatus('reconnecting')
        attempt += 1
        const delay = Math.min(8000, 700 * 2 ** Math.min(attempt, 4))
        reconnectTimer = window.setTimeout(connect, delay)
      })

      socket.addEventListener('error', () => {
        socket.close()
      })
    }

    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(pingTimer)
      for (const timer of typingTimersRef.current.values()) window.clearTimeout(timer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    activeChannelRef.current = activeChannelId
    send({ type: 'channel:select', channelId: activeChannelId })
  }, [activeChannelId, send])

  const updateProfile = useCallback((profile: Profile) => {
    profileRef.current = profile
    send({ type: 'workspace:update-profile', profile })
  }, [send])

  const subscribeToCallEvents = useCallback((listener: CallListener) => {
    listenersRef.current.add(listener)
    return () => listenersRef.current.delete(listener)
  }, [])

  const sendChat = useCallback((channelId: string, text: string) => (
    send({ type: 'chat:send', channelId, text })
  ), [send])

  const sendTyping = useCallback((channelId: string, active: boolean) => {
    send({ type: 'chat:typing', channelId, active })
  }, [send])

  const joinCall = useCallback((channelId: string, media: MediaState) => {
    send({ type: 'call:join', channelId, media })
  }, [send])

  const leaveCall = useCallback(() => {
    send({ type: 'call:leave' })
  }, [send])

  const updateCall = useCallback((media: MediaState) => {
    send({ type: 'call:update', media })
  }, [send])

  const sendSignal = useCallback((target: string, payload: SignalPayload) => {
    send({ type: 'call:signal', target, payload })
  }, [send])

  const sendScreenFrame = useCallback((dataUrl: string, frameRate: number, targets: string[]) => {
    send({ type: 'call:screen-frame', dataUrl, frameRate, targets }, true)
  }, [send])

  const sendScreenAudio = useCallback((pcm: string, sampleRate: number, sequence: number, targets: string[]) => {
    send({ type: 'call:screen-audio', pcm, sampleRate, sequence, targets }, true)
  }, [send])

  const stopScreenRelay = useCallback(() => {
    send({ type: 'call:screen-stop' })
  }, [send])

  const requestScreenRelay = useCallback((target: string) => {
    send({ type: 'call:screen-relay-request', target })
  }, [send])

  const releaseScreenRelay = useCallback((target: string) => {
    send({ type: 'call:screen-relay-release', target })
  }, [send])

  return {
    status,
    clientId,
    iceServers,
    members,
    callsByChannel,
    messagesByChannel,
    typingByChannel,
    updateProfile,
    subscribeToCallEvents,
    sendChat,
    sendTyping,
    joinCall,
    leaveCall,
    updateCall,
    sendSignal,
    sendScreenFrame,
    sendScreenAudio,
    stopScreenRelay,
    requestScreenRelay,
    releaseScreenRelay,
  }
}
