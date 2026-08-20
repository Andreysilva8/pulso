export const SCREEN_RELAY_FRAME_RATE = 10
export const SCREEN_RELAY_FRAME_INTERVAL = 1_000 / SCREEN_RELAY_FRAME_RATE
export const SCREEN_RELAY_MAX_WIDTH = 1280
export const SCREEN_RELAY_MAX_HEIGHT = 720
export const SCREEN_RELAY_MAX_DATA_URL_LENGTH = 50_000
export const SCREEN_RELAY_AUDIO_SAMPLE_RATE = 16_000

export type ScreenRelayController = {
  hasAudio: boolean
  stop: () => void
}

export type ScreenRelayHandlers = {
  sendFrame: (dataUrl: string) => void
  sendAudio: (pcmBase64: string, sampleRate: number, sequence: number) => void
}

export function downsampleToPcm16(
  channels: Float32Array[],
  inputSampleRate: number,
  outputSampleRate = SCREEN_RELAY_AUDIO_SAMPLE_RATE,
) {
  if (!channels.length || !channels[0].length) return new Int16Array()
  const sourceLength = Math.min(...channels.map((channel) => channel.length))
  const ratio = Math.max(1, inputSampleRate / outputSampleRate)
  const outputLength = Math.max(1, Math.floor(sourceLength / ratio))
  const output = new Int16Array(outputLength)

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio)
    const end = Math.min(sourceLength, Math.max(start + 1, Math.floor((outputIndex + 1) * ratio)))
    let sum = 0
    let samples = 0
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      for (const channel of channels) {
        sum += channel[sourceIndex]
        samples += 1
      }
    }
    const sample = Math.max(-1, Math.min(1, samples ? sum / samples : 0))
    output[outputIndex] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
  }
  return output
}

export function pcm16ToBase64(samples: Int16Array) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToPcm16(serialized: string) {
  const binary = atob(serialized)
  if (!binary.length || binary.length % 2 !== 0) throw new Error('PCM inválido.')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Int16Array(bytes.buffer)
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<string | null>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    }, 'image/webp', quality)
  })
}

async function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null
  const scale = Math.min(
    1,
    SCREEN_RELAY_MAX_WIDTH / video.videoWidth,
    SCREEN_RELAY_MAX_HEIGHT / video.videoHeight,
  )
  const targetWidth = Math.max(2, Math.round(video.videoWidth * scale))
  const targetHeight = Math.max(2, Math.round(video.videoHeight * scale))
  if (canvas.width !== targetWidth) canvas.width = targetWidth
  if (canvas.height !== targetHeight) canvas.height = targetHeight
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  let workingCanvas = canvas
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const quality = Math.max(0.28, 0.62 - attempt * 0.065)
    const dataUrl = await canvasToDataUrl(workingCanvas, quality)
    if (!dataUrl) return null
    if (dataUrl.length <= SCREEN_RELAY_MAX_DATA_URL_LENGTH) return dataUrl

    const reduced = document.createElement('canvas')
    reduced.width = Math.max(2, Math.round(workingCanvas.width * 0.84))
    reduced.height = Math.max(2, Math.round(workingCanvas.height * 0.84))
    reduced.getContext('2d', { alpha: false })?.drawImage(
      workingCanvas,
      0,
      0,
      reduced.width,
      reduced.height,
    )
    workingCanvas = reduced
  }
  return null
}

export async function startScreenRelay(
  stream: MediaStream,
  handlers: ScreenRelayHandlers,
): Promise<ScreenRelayController> {
  const videoTrack = stream.getVideoTracks().find((track) => track.readyState === 'live')
  if (!videoTrack) throw new Error('A transmissão não contém vídeo.')

  const video = document.createElement('video')
  const canvas = document.createElement('canvas')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream([videoTrack])
  await video.play()

  let stopped = false
  let frameTimer = 0
  let audioContext: AudioContext | null = null
  let audioSource: MediaStreamAudioSourceNode | null = null
  let audioProcessor: ScriptProcessorNode | null = null
  let silentOutput: GainNode | null = null
  let audioSequence = 0
  let lastFrame = ''
  let lastFrameSentAt = 0

  const emitFrame = async () => {
    if (stopped) return
    const startedAt = performance.now()
    try {
      const dataUrl = await captureFrame(video, canvas)
      const now = Date.now()
      if (dataUrl && (dataUrl !== lastFrame || now - lastFrameSentAt >= 1_000)) {
        lastFrame = dataUrl
        lastFrameSentAt = now
        handlers.sendFrame(dataUrl)
      }
    } finally {
      const remaining = Math.max(0, SCREEN_RELAY_FRAME_INTERVAL - (performance.now() - startedAt))
      frameTimer = window.setTimeout(() => { void emitFrame() }, remaining)
    }
  }
  void emitFrame()

  const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live')
  if (audioTracks.length && window.AudioContext) {
    try {
      audioContext = new AudioContext({ latencyHint: 'interactive' })
      audioSource = audioContext.createMediaStreamSource(new MediaStream(audioTracks))
      audioProcessor = audioContext.createScriptProcessor(4096, Math.min(2, audioTracks.length + 1), 1)
      silentOutput = audioContext.createGain()
      silentOutput.gain.value = 0
      audioProcessor.onaudioprocess = (event) => {
        if (stopped) return
        const channels = Array.from(
          { length: event.inputBuffer.numberOfChannels },
          (_, index) => new Float32Array(event.inputBuffer.getChannelData(index)),
        )
        const pcm = downsampleToPcm16(channels, event.inputBuffer.sampleRate)
        if (pcm.length) handlers.sendAudio(pcm16ToBase64(pcm), SCREEN_RELAY_AUDIO_SAMPLE_RATE, audioSequence++)
      }
      audioSource.connect(audioProcessor)
      audioProcessor.connect(silentOutput)
      silentOutput.connect(audioContext.destination)
      void audioContext.resume().catch(() => undefined)
    } catch {
      audioProcessor = null
      audioSource = null
      silentOutput = null
      if (audioContext) void audioContext.close().catch(() => undefined)
      audioContext = null
    }
  }

  return {
    hasAudio: Boolean(audioProcessor),
    stop: () => {
      if (stopped) return
      stopped = true
      window.clearTimeout(frameTimer)
      video.pause()
      video.srcObject = null
      if (audioProcessor) audioProcessor.onaudioprocess = null
      audioSource?.disconnect()
      audioProcessor?.disconnect()
      silentOutput?.disconnect()
      if (audioContext) void audioContext.close().catch(() => undefined)
    },
  }
}
