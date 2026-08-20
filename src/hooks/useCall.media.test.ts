import { describe, expect, it } from 'vitest'
import { microphoneConstraint } from './useCall'

describe('microphone constraints', () => {
  it('uses the selected input exactly', () => {
    expect(microphoneConstraint('mic-usb')).toEqual({ deviceId: { exact: 'mic-usb' } })
  })

  it('lets the browser choose a default input when none is selected', () => {
    expect(microphoneConstraint('')).toBe(true)
  })
})
