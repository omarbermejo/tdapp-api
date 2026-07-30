import { ValidationError } from './errors.js'

/** Catalogos del perfil TDAH. La app los consume en GET /catalogs para pintar las opciones. */
export const DIAGNOSIS = ['inattentive', 'hyperactive', 'combined', 'evaluating', 'undiagnosed', 'undisclosed']
export const TREATMENT = ['medication', 'therapy', 'both', 'none', 'undisclosed']
export const FOCUS_AREAS = ['study', 'work', 'home', 'health', 'money', 'relationships', 'creativity']
export const PEAK_ENERGY = ['morning', 'afternoon', 'night', 'varies']
export const REMINDER_STYLE = ['gentle', 'firm', 'persistent']
export const ACCENT_COLOR = ['forest', 'olive', 'leaf', 'clay', 'copper']

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 8

const str = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Crea un usuario valido. Solo email, password y name son obligatorios:
 * un formulario largo es la forma mas rapida de perder a un usuario con TDAH.
 * El resto del perfil cae en defaults y se afina despues en onboarding.
 */
export function createUser(input = {}) {
  const fields = {}
  const email = str(input.email).toLowerCase()
  const name = str(input.name)
  const password = typeof input.password === 'string' ? input.password : ''

  if (!EMAIL.test(email)) fields.email = 'Escribe un correo valido'
  if (name.length < 2) fields.name = 'Tu nombre necesita al menos 2 letras'
  if (name.length > 40) fields.name = 'Maximo 40 caracteres'
  if (password.length < MIN_PASSWORD) fields.password = `Minimo ${MIN_PASSWORD} caracteres`

  const pick = (key, catalog, fallback) => {
    const value = str(input[key]) || fallback
    if (!catalog.includes(value)) fields[key] = `Opcion no valida: ${value}`
    return value
  }

  const birthYear = input.birthYear == null ? null : Number(input.birthYear)
  const currentYear = new Date().getFullYear()
  if (birthYear !== null && !(Number.isInteger(birthYear) && birthYear >= 1920 && birthYear <= currentYear - 5)) {
    fields.birthYear = 'Año de nacimiento fuera de rango'
  }

  const focusAreas = Array.isArray(input.focusAreas) ? input.focusAreas.map(str) : []
  const invalidFocus = focusAreas.filter((f) => !FOCUS_AREAS.includes(f))
  if (invalidFocus.length) fields.focusAreas = `Opciones no validas: ${invalidFocus.join(', ')}`
  if (focusAreas.length > 3) fields.focusAreas = 'Elige maximo 3 focos, mas es ruido'

  const profile = {
    diagnosis: pick('diagnosis', DIAGNOSIS, 'undisclosed'),
    treatment: pick('treatment', TREATMENT, 'undisclosed'),
    peakEnergy: pick('peakEnergy', PEAK_ENERGY, 'varies'),
    reminderStyle: pick('reminderStyle', REMINDER_STYLE, 'firm'),
    accentColor: pick('accentColor', ACCENT_COLOR, 'olive'),
  }

  if (Object.keys(fields).length) throw ValidationError(fields)

  return { email, name, password, birthYear, focusAreas, ...profile }
}

/** Nunca sale un hash de aqui. */
export const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  birthYear: row.birthYear ?? null,
  diagnosis: row.diagnosis,
  treatment: row.treatment,
  focusAreas: row.focusAreas ?? [],
  peakEnergy: row.peakEnergy,
  reminderStyle: row.reminderStyle,
  accentColor: row.accentColor,
  createdAt: row.createdAt,
})

export const catalogs = {
  diagnosis: DIAGNOSIS,
  treatment: TREATMENT,
  focusAreas: FOCUS_AREAS,
  peakEnergy: PEAK_ENERGY,
  reminderStyle: REMINDER_STYLE,
  accentColor: ACCENT_COLOR,
}
