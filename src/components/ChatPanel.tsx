import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AtSign, Gift, Hash, Paperclip, Send, Smile, Sparkles } from 'lucide-react'
import type { ChatMessage, Profile } from '../types'
import { Avatar, IconButton } from './ui'

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function formatMessageDay(timestamp: number) {
  const today = new Date()
  const date = new Date(timestamp)
  if (date.toDateString() === today.toDateString()) return 'Hoje'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(date)
}

export function ChatPanel({
  channelId,
  channelName,
  channelDescription,
  messages,
  typingMembers,
  profile,
  clientId,
  onSend,
  onTyping,
  compact = false,
}: {
  channelId: string
  channelName: string
  channelDescription: string
  messages: ChatMessage[]
  typingMembers: { id: string; name: string }[]
  profile: Profile
  clientId: string
  onSend: (channelId: string, text: string) => void
  onTyping: (channelId: string, active: boolean) => void
  compact?: boolean
}) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const typingTimerRef = useRef(0)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [channelId, messages.length])

  useEffect(() => () => {
    window.clearTimeout(typingTimerRef.current)
    onTyping(channelId, false)
  }, [channelId, onTyping])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(channelId, text)
    setDraft('')
    window.clearTimeout(typingTimerRef.current)
    onTyping(channelId, false)
  }

  const updateDraft = (value: string) => {
    setDraft(value)
    onTyping(channelId, Boolean(value.trim()))
    window.clearTimeout(typingTimerRef.current)
    typingTimerRef.current = window.setTimeout(() => onTyping(channelId, false), 1_400)
  }

  return (
    <section className={`chat-panel ${compact ? 'chat-panel--compact' : ''}`}>
      <header className="chat-panel__header">
        <span className="channel-symbol"><Hash size={18} /></span>
        <div>
          <strong>{channelName}</strong>
          {!compact && <span>{channelDescription}</span>}
        </div>
        <div className="chat-panel__header-actions">
          <IconButton icon={AtSign} label="Menções" />
          <IconButton icon={Sparkles} label="Destaques" />
        </div>
      </header>

      <div className="message-list" ref={listRef} role="log" aria-live="polite" aria-label={`Mensagens de ${channelName}`}>
        <div className="channel-welcome">
          <span className="channel-welcome__mark"><Hash size={25} /></span>
          <p className="eyebrow">Começo do canal</p>
          <h2>Você chegou em <em>#{channelName}</em></h2>
          <p>{channelDescription}</p>
        </div>

        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const showDay = !previous || new Date(previous.sentAt).toDateString() !== new Date(message.sentAt).toDateString()
          const grouped = Boolean(
            previous
            && previous.senderId === message.senderId
            && message.sentAt - previous.sentAt < 5 * 60_000
            && !showDay,
          )
          return (
            <div key={message.id}>
              {showDay && (
                <div className="day-divider"><span>{formatMessageDay(message.sentAt)}</span></div>
              )}
              <article className={`message ${grouped ? 'message--grouped' : ''} ${message.senderId === clientId ? 'message--mine' : ''}`}>
                {!grouped && <Avatar profile={{ name: message.senderName, initials: message.senderInitials, color: message.senderColor }} size="medium" />}
                <div className="message__body">
                  {!grouped && (
                    <div className="message__meta">
                      <strong style={{ color: message.senderColor }}>{message.senderName}</strong>
                      <time dateTime={new Date(message.sentAt).toISOString()}>{formatMessageTime(message.sentAt)}</time>
                    </div>
                  )}
                  <p>{message.text}</p>
                </div>
              </article>
            </div>
          )
        })}

        {!messages.length && (
          <div className="empty-chat">
            <Avatar profile={profile} size="large" />
            <p>Seja a primeira pessoa a deixar uma mensagem por aqui.</p>
          </div>
        )}
      </div>

      <div className="typing-line" aria-live="polite">
        {typingMembers.length > 0 && (
          <><i><span /><span /><span /></i> <strong>{typingMembers.map((member) => member.name).join(', ')}</strong> está digitando</>
        )}
      </div>

      <form className="message-composer" onSubmit={submit}>
        <IconButton icon={Paperclip} label="Anexar arquivo (em breve)" disabled />
        <textarea
          value={draft}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit(event)
            }
          }}
          placeholder={`Mensagem em #${channelName}`}
          aria-label={`Mensagem em ${channelName}`}
          maxLength={2000}
          rows={1}
        />
        <div className="composer-extras">
          <IconButton icon={Gift} label="Enviar presente (em breve)" disabled />
          <IconButton icon={Smile} label="Adicionar emoji" onClick={() => updateDraft(`${draft}${draft ? ' ' : ''}✦`)} />
          <button type="submit" className="send-button" aria-label="Enviar mensagem" disabled={!draft.trim()}>
            <Send size={17} />
          </button>
        </div>
      </form>
    </section>
  )
}
