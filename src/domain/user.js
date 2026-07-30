import { ValidationError } from './errors.js'

/** Catalogos del perfil TDAH. La app los consume en GET /catalogs para pintar las opciones. */
export const DIAGNOSIS = ['inattentive', 'hyperactive', 'combined', 'evaluating', 'undiagnosed', 'undisclosed']
export const TREATMENT = ['medication', 'therapy', 'both', 'none', 'undisclosed']
export const FOCUS_AREAS = ['study', 'work', 'home', 'health', 'money', 'relationships', 'creativity']
export const PEAK_ENERGY = ['morning', 'afternoon', 'night', 'varies']
export const REMINDER_STYLE = ['gentle', 'firm', 'persistent']
export const ACCENT_COLOR = ['forest', 'olive', 'leaf', 'clay', 'copper']

/**
 * Como entra la cuenta. 'oauth' solo existe para filas viejas cuyo proveedor no se pudo
 * deducir al migrar; nada nuevo se guarda asi.
 */
export const AUTH_PROVIDERS = ['password', 'google', 'apple', 'oauth']

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 8
const MAX_FOCUS = 3

const str = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * El perfil con el que nace toda cuenta. Unica fuente de los defaults: la tabla
 * user_profiles no los declara y la app los recibe ya resueltos en el registro.
 */
export const DEFAULT_PROFILE = Object.freeze({
  birthYear: null,
  diagnosis: 'undisclosed',
  treatment: 'undisclosed',
  focusAreas: [],
  peakEnergy: 'varies',
  reminderStyle: 'firm',
  accentColor: 'olive',
})

/**
 * Lo minimo para tener cuenta. Un formulario largo es la forma mas rapida de perder
 * a un usuario con TDAH: el perfil se afina despues, en onboarding.
 */
export function createIdentity(input = {}) {
  const fields = {}
  const email = str(input.email).toLowerCase()
  const name = str(input.name)
  const password = typeof input.password === 'string' ? input.password : ''

  if (!EMAIL.test(email)) fields.email = 'Escribe un correo valido'
  if (name.length < 2) fields.name = 'Tu nombre necesita al menos 2 letras'
  if (name.length > 40) fields.name = 'Maximo 40 caracteres'
  if (password.length < MIN_PASSWORD) fields.password = `Minimo ${MIN_PASSWORD} caracteres`

  if (Object.keys(fields).length) throw ValidationError(fields)

  return { email, name, password }
}

/**
 * Valida el resultado de mezclar `input` sobre `current`, no el parche suelto:
 * asi sirve igual para el onboarding completo y para editar un solo campo despues.
 */
export function createProfile(input = {}, current = DEFAULT_PROFILE) {
  const fields = {}
  const has = (key) => input[key] !== undefined

  const pick = (key, catalog) => {
    const value = has(key) ? str(input[key]) || current[key] : current[key]
    if (!catalog.includes(value)) fields[key] = `Opcion no valida: ${value}`
    return value
  }

  let birthYear = current.birthYear
  if (has('birthYear')) {
    birthYear = input.birthYear == null ? null : Number(input.birthYear)
    const currentYear = new Date().getFullYear()
    if (birthYear !== null && !(Number.isInteger(birthYear) && birthYear >= 1920 && birthYear <= currentYear - 5)) {
      fields.birthYear = 'Año de nacimiento fuera de rango'
    }
  }

  let focusAreas = current.focusAreas
  if (has('focusAreas')) {
    focusAreas = Array.isArray(input.focusAreas) ? input.focusAreas.map(str) : []
    const invalid = focusAreas.filter((f) => !FOCUS_AREAS.includes(f))
    if (invalid.length) fields.focusAreas = `Opciones no validas: ${invalid.join(', ')}`
    if (focusAreas.length > MAX_FOCUS) fields.focusAreas = `Elige maximo ${MAX_FOCUS} focos, mas es ruido`
  }

  const profile = {
    birthYear,
    focusAreas,
    diagnosis: pick('diagnosis', DIAGNOSIS),
    treatment: pick('treatment', TREATMENT),
    peakEnergy: pick('peakEnergy', PEAK_ENERGY),
    reminderStyle: pick('reminderStyle', REMINDER_STYLE),
    accentColor: pick('accentColor', ACCENT_COLOR),
  }

  if (Object.keys(fields).length) throw ValidationError(fields)

  return profile
}

/** Los pasos por los que pasa una cuenta. 'guest' es cosa de la app: aqui siempre hay usuario. */
export const STAGES = ['verify', 'onboarding', 'ready']

/**
 * En que paso va la cuenta.
 *
 * ponytail: se deriva, no se guarda. Una columna `stage` (o una tabla de pasos) seria un
 * tercer estado capaz de contradecir a email_verified_at y onboarded_at, y ningun codigo
 * podria decidir cual manda: alguien marca 'ready' sin verificar y el gate y la pantalla
 * dicen cosas distintas. Estas dos marcas de tiempo tienen que existir igual — son hechos
 * con fecha, no banderas — y de ellas sale el paso sin posibilidad de desincronizarse.
 * Techo: si algun dia hay pasos que NO se puedan deducir de un hecho ya guardado
 * (p.ej. "vio el tutorial"), eso si pide su propia columna.
 */
export const stageOf = (row) =>
  !row.emailVerifiedAt ? 'verify' : !row.onboardedAt ? 'onboarding' : 'ready'

/**
 * Un solo objeto plano para la app, aunque adentro sean dos tablas.
 * Los campos de perfil en null vienen de un LEFT JOIN sin fila: caen a los defaults
 * aqui, en un solo lugar. Nunca sale un hash de esta funcion.
 */
export const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  birthYear: row.birthYear ?? DEFAULT_PROFILE.birthYear,
  diagnosis: row.diagnosis ?? DEFAULT_PROFILE.diagnosis,
  treatment: row.treatment ?? DEFAULT_PROFILE.treatment,
  focusAreas: row.focusAreas ?? DEFAULT_PROFILE.focusAreas,
  peakEnergy: row.peakEnergy ?? DEFAULT_PROFILE.peakEnergy,
  reminderStyle: row.reminderStyle ?? DEFAULT_PROFILE.reminderStyle,
  // Si un rename futuro deja un valor fuera del catalogo, sale el default en vez de un
  // nombre que la app no sabe pintar. Los ya guardados los arregla su migracion.
  accentColor: ACCENT_COLOR.includes(row.accentColor) ? row.accentColor : DEFAULT_PROFILE.accentColor,
  emailVerified: !!row.emailVerifiedAt,
  onboardedAt: row.onboardedAt ?? null,
  authProvider: row.authProvider ?? 'password',
  // El paso lo decide el servidor: la app lo pinta, no lo calcula.
  stage: stageOf(row),
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
