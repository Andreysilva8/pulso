import { describe, expect, it, vi } from 'vitest'
import { microphoneConstraint, previewMediaConstraints, releaseCameraTracks } from './useCall'

describe('microphone constraints', () => {
  it('uses the selected input exactly', () => {
    expect(microphoneConstraint('mic-usb')).toEqual({ deviceId: { exact: 'mic-usb' } })
  })

  it('lets the browser choose a default input when none is selected', () => {
    expect(microphoneConstraint('')).toBe(true)
  })

  it('never requests the camera during automatic prejoin preparation', () => {
    expect(previewMediaConstraints('mic-usb')).toEqual({
      audio: { deviceId: { exact: 'mic-usb' } },
      video: false,
    })
  })

  it('stops and removes every camera track when the user turns it off', () => {
    const first = { stop: vi.fn(), onended: vi.fn() } as unknown as MediaStreamTrack
    const second = { stop: vi.fn(), onended: vi.fn() } as unknown as MediaStreamTrack
    const removeTrack = vi.fn()
    const stream = {
      getVideoTracks: () => [first, second],
      removeTrack,
    } as unknown as MediaStream

    releaseCameraTracks(stream)

    expect(first.stop).toHaveBeenCalledOnce()
    expect(second.stop).toHaveBeenCalledOnce()
    expect(removeTrack).toHaveBeenNthCalledWith(1, first)
    expect(removeTrack).toHaveBeenNthCalledWith(2, second)
    expect(first.onended).toBeNull()
    expect(second.onended).toBeNull()
  })
})
