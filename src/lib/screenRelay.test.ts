import { describe, expect, it } from 'vitest'
import { base64ToPcm16, downsampleToPcm16, pcm16ToBase64 } from './screenRelay'

describe('screen relay audio', () => {
  it('downsamples and mixes stereo audio into 16 kHz mono PCM', () => {
    const left = new Float32Array(480).fill(0.5)
    const right = new Float32Array(480).fill(-0.25)
    const pcm = downsampleToPcm16([left, right], 48_000, 16_000)

    expect(pcm).toHaveLength(160)
    expect(pcm[0]).toBeGreaterThan(4_000)
    expect(pcm[0]).toBeLessThan(4_200)
  })

  it('round-trips signed PCM samples through base64', () => {
    const original = new Int16Array([-32768, -123, 0, 456, 32767])
    expect([...base64ToPcm16(pcm16ToBase64(original))]).toEqual([...original])
  })

  it('clamps samples before conversion', () => {
    const pcm = downsampleToPcm16([new Float32Array([-2, 2])], 16_000, 16_000)
    expect([...pcm]).toEqual([-32768, 32767])
  })

  it('rejects malformed PCM with an odd byte count', () => {
    expect(() => base64ToPcm16('AA==')).toThrow('PCM inválido')
  })
})
