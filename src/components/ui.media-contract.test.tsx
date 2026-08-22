import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CallParticipant } from '../types'
import { ParticipantTile } from './ui'

const participant: CallParticipant = {
  id: 'peer-1',
  channelId: 'cafe',
  name: 'Visitante 164',
  initials: 'V1',
  color: '#3bd6c6',
  joinedAt: 1,
  media: { microphone: true, camera: false, screen: true, screenAudio: true },
}

const remoteStream = {} as MediaStream

describe('ParticipantTile media playback contract', () => {
  it('keeps remote video muted and sends sound to a separate audio element', () => {
    const markup = renderToStaticMarkup(
      <ParticipantTile participant={participant} stream={remoteStream} />,
    )
    const video = markup.match(/<video[^>]*>/)?.[0] || ''
    const audio = markup.match(/<audio[^>]*>/)?.[0] || ''

    expect(video).toContain('muted=""')
    expect(video).toContain('autoPlay=""')
    expect(video).toContain('playsInline=""')
    expect(audio).toContain('autoPlay=""')
    expect(audio).not.toContain('muted=""')
  })

  it('does not create an audible sink for the local participant', () => {
    const markup = renderToStaticMarkup(
      <ParticipantTile participant={participant} stream={remoteStream} local />,
    )

    expect(markup).toContain('<video')
    expect(markup).not.toContain('<audio')
  })

  it('keeps screen audio audible even when the presenter microphone is muted', () => {
    const screenAudioOnly = {
      ...participant,
      media: { ...participant.media, microphone: false, screenAudio: true },
    }
    const markup = renderToStaticMarkup(
      <ParticipantTile participant={screenAudioOnly} stream={remoteStream} />,
    )

    expect(markup).toContain('<audio')
    expect(markup).toContain('Com áudio')
  })

  it('offers independent controls for voice and screen-share audio', () => {
    const markup = renderToStaticMarkup(
      <ParticipantTile
        participant={participant}
        stream={remoteStream}
        voiceStream={{} as MediaStream}
        screenAudioStream={{} as MediaStream}
      />,
    )

    expect(markup).toContain(`Ajustar volume de ${participant.name}`)
    expect(markup).toContain(`Volume da voz de ${participant.name}`)
    expect(markup).toContain(`Volume da transmissão de ${participant.name}`)
    expect(markup).toContain('Clique com o botão direito para mutar ou ajustar o volume')
  })

  it('renders the relayed frame instead of the connecting placeholder', () => {
    const markup = renderToStaticMarkup(
      <ParticipantTile
        participant={participant}
        stream={null}
        fallbackFrame={{ dataUrl: 'data:image/webp;base64,UklGRg==', receivedAt: 1, frameRate: 30 }}
      />,
    )

    expect(markup).toContain('participant-tile__relay-frame')
    expect(markup).toContain('Compatível · limite 30 fps')
    expect(markup).not.toContain('Conectando à transmissão…')
  })

  it('shows a connecting state instead of an empty tile before the first screen frame', () => {
    const markup = renderToStaticMarkup(
      <ParticipantTile participant={participant} stream={null} connectionState="connecting" />,
    )

    expect(markup).toContain('Conectando à transmissão…')
    expect(markup).toContain('A imagem aparecerá assim que o primeiro quadro chegar.')
  })

  it('explains when the media connection failed', () => {
    const markup = renderToStaticMarkup(
      <ParticipantTile participant={participant} stream={null} connectionState="failed" />,
    )

    expect(markup).toContain('Transmissão sem conexão')
    expect(markup).toContain('Tentaremos conectar novamente.')
  })
})
