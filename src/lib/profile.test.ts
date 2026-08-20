import { describe, expect, it } from 'vitest'
import { createGuestProfile, loadStoredProfile, makeInitials } from './profile'

describe('profile helpers', () => {
  it('creates compact initials for Portuguese names', () => {
    expect(makeInitials('Ana Paula Ribeiro')).toBe('AR')
    expect(makeInitials('Érica')).toBe('ÉR')
    expect(makeInitials('   ')).toBe('VI')
  })

  it('creates deterministic guest profiles', () => {
    expect(createGuestProfile(0)).toMatchObject({ name: 'Visitante 100', initials: 'V1' })
    expect(createGuestProfile(0.999)).toMatchObject({ name: 'Visitante 999', initials: 'V9' })
  })

  it('accepts valid stored profiles and rejects malformed JSON', () => {
    const validStorage = { getItem: () => JSON.stringify({ name: 'Nina', initials: 'NI', color: '#ff816f' }) }
    expect(loadStoredProfile(validStorage)).toEqual({ name: 'Nina', initials: 'NI', color: '#ff816f' })

    const invalidStorage = { getItem: () => '{broken' }
    expect(loadStoredProfile(invalidStorage).name).toMatch(/^Visitante \d{3}$/)
  })
})
