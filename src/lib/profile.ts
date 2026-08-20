import type { Profile } from '../types'

export const profileColors = ['#ff816f', '#3bd6c6', '#ffc65c', '#80a8ff', '#d699ff']

export function makeInitials(name: string) {
  const pieces = name.trim().split(/\s+/).filter(Boolean)
  if (!pieces.length) return 'VI'
  const initials = pieces.length > 1
    ? `${pieces[0][0]}${pieces.at(-1)?.[0]}`
    : pieces[0].slice(0, 2)
  return initials.toLocaleUpperCase('pt-BR')
}

export function createGuestProfile(randomValue = Math.random()): Profile {
  const suffix = Math.floor(100 + randomValue * 900)
  const name = `Visitante ${suffix}`
  return {
    name,
    initials: makeInitials(name),
    color: profileColors[suffix % profileColors.length],
  }
}

export function loadStoredProfile(storage: Pick<Storage, 'getItem'>): Profile {
  try {
    const stored = storage.getItem('pulso-profile')
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Profile>
      if (
        typeof parsed.name === 'string'
        && typeof parsed.initials === 'string'
        && typeof parsed.color === 'string'
      ) {
        return {
          name: parsed.name.slice(0, 32),
          initials: parsed.initials.slice(0, 2),
          color: parsed.color,
        }
      }
    }
  } catch {
    // Invalid or unavailable storage falls back to an ephemeral guest profile.
  }
  return createGuestProfile()
}
