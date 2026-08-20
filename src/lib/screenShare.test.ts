import { describe, expect, it } from 'vitest'
import {
  SCREEN_SHARE_FRAME_RATE,
  SCREEN_SHARE_HEIGHT,
  SCREEN_SHARE_MAX_BITRATE,
  SCREEN_SHARE_VIDEO_CONSTRAINTS,
  SCREEN_SHARE_WIDTH,
} from './screenShare'

describe('screen-share quality profile', () => {
  it('requests Full HD at 60 frames per second', () => {
    expect(SCREEN_SHARE_WIDTH).toBe(1920)
    expect(SCREEN_SHARE_HEIGHT).toBe(1080)
    expect(SCREEN_SHARE_FRAME_RATE).toBe(60)
    expect(SCREEN_SHARE_VIDEO_CONSTRAINTS).toMatchObject({
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
  })

  it('reserves enough sender bitrate for high-motion Full HD sharing', () => {
    expect(SCREEN_SHARE_MAX_BITRATE).toBeGreaterThanOrEqual(10_000_000)
  })
})
