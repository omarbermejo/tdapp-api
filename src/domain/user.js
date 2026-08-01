import { ValidationError } from './errors.js'

/**
 * Catalogos del perfil. La app los consume en GET /catalogs para pintar las opciones.
 *
 * No hay catalogo de diagnostico ni de tratamiento: son dato clinico que la app no usa para
 * nada y eran las dos preguntas que mas gente dejaba a medias en el onboarding.
 */
export const FOCUS_AREAS = ['study', 'work', 'home', 'health', 'money', 'relationships', 'creativity']
export const PEAK_ENERGY = ['morning', 'afternoon', 'night', 'varies']
export const REMINDER_STYLE = ['gentle', 'firm', 'persistent']
export const ACCENT_COLOR = ['forest', 'olive', 'leaf', 'clay', 'copper']

/**
 * Como entra la cuenta. 'oauth' solo existe para filas viejas cuyo proveedor no se pudo
 * deducir al migrar; nada nuevo se guarda asi.
 */
export const AUTH_PROVIDERS = ['password', 'google', 'apple', 'oauth']

/**
 * El avatar no es un catalogo: es un PATRON.
 *
 * Los memojis son archivos del bundle de la app (`assets/avatars/memoji-NN.webp`) y aqui no hay
 * ninguno, asi que una lista enumerada no validaria nada real — solo repetiria una lista que este
 * lado no puede comprobar, y que crece cada vez que se vuelve a cortar la lamina de Figma. Con
 * nombres cerrados, el dia que la app publique memoji-46 quien lo elija recibe un 400 hasta que se
 * deployee el API: un release de la app acoplado a un deploy del backend por un dato cosmetico.
 *
 * El patron da lo unico que un catalogo cerrado daria de verdad: forma acotada, alfabeto cerrado y
 * un 400 con nombre de campo para la basura. Un nombre valido que la app todavia no tenga cae en el
 * mismo fallback que el null (la inicial del nombre), que la app necesita implementar igual para
 * las versiones viejas.
 *
 * Por eso tampoco sale en `catalogs`: la app ya genera la lista sola desde sus propios require, y
 * dos fuentes de verdad aqui es drift garantizado — con la de este lado siempre en el equivocado.
 *
 * ponytail: \d{2} topa en memoji-99. Pasar de ahi cambia tambien el esquema de nombres de la app,
 * asi que los dos lados se enteran a la vez.
 */
const AVATAR = /^memoji-\d{2}$/

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 8
const MAX_FOCUS = 3

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_BIRTH_DATE = '1920-01-01'
const MIN_AGE = 5

// La hora del recordatorio es la hora del reloj local del telefono, sin minutos: un aviso
// diario no necesita puntualidad al minuto y un solo entero se agenda igual en iOS y Android.
const MIN_HOUR = 0
const MAX_HOUR = 23

const str = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * Fecha real, no solo con forma de fecha: '2026-02-31' pasa el regex y '2026-13-01' tambien.
 * Ir y volver delata al dia que no existe; toJSON (y no toISOString) porque en las fechas
 * imposibles devuelve null en vez de lanzar RangeError.
 */
const isRealDate = (value) =>
  ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toJSON()?.startsWith(value) === true

/** La fecha de quien cumple MIN_AGE anos hoy. En ISO, comparar fechas es comparar texto. */
const oldestChildhood = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear() - MIN_AGE, now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}

/**
 * El perfil con el que nace toda cuenta. Unica fuente de los defaults: los escribe el
 * repositorio en cada insert y la app los recibe ya resueltos en el registro. La tabla no
 * declara ninguno (el DEFAULT 9 de reminder_hour existe solo para el backfill de su migracion).
 */
export const DEFAULT_PROFILE = Object.freeze({
  birthDate: null,
  focusAreas: [],
  peakEnergy: 'varies',
  reminderStyle: 'firm',
  // Con hora, no solo con intensidad, ya se puede programar el aviso diario. La manana es
  // cuando mas sirve: el dia todavia se puede acomodar.
  reminderHour: 9,
  accentColor: 'olive',
  // null no es un hueco: es "no eligio cara", y la app pinta la inicial del nombre.
  avatar: null,
})

/**
 * La unica regla de la contraseña y su unico mensaje. Devuelve el problema o null.
 *
 * Vive aparte porque la comparten el registro y el reset, y el reset no puede llamar a
 * createIdentity: esa pide correo y nombre, que ahi no existen.
 */
export const passwordProblem = (password) =>
  (typeof password === 'string' ? password : '').length < MIN_PASSWORD
    ? `Minimo ${MIN_PASSWORD} caracteres`
    : null

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
  const weak = passwordProblem(password)
  if (weak) fields.password = weak

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

  let birthDate = current.birthDate
  if (has('birthDate')) {
    birthDate = input.birthDate == null ? null : str(input.birthDate)
    if (birthDate !== null && !isRealDate(birthDate)) {
      fields.birthDate = 'Usa una fecha real con formato AAAA-MM-DD'
    } else if (birthDate !== null && (birthDate < MIN_BIRTH_DATE || birthDate > oldestChildhood())) {
      fields.birthDate = 'Fecha de nacimiento fuera de rango'
    }
  }

  let focusAreas = current.focusAreas
  if (has('focusAreas')) {
    focusAreas = Array.isArray(input.focusAreas) ? input.focusAreas.map(str) : []
    const invalid = focusAreas.filter((f) => !FOCUS_AREAS.includes(f))
    if (invalid.length) fields.focusAreas = `Opciones no validas: ${invalid.join(', ')}`
    if (focusAreas.length > MAX_FOCUS) fields.focusAreas = `Elige maximo ${MAX_FOCUS} focos, mas es ruido`
  }

  /**
   * Entero 0..23 y nada mas: '9' no se convierte (un string colado seria la app mandando el
   * valor del control sin parsear, y hay que verlo), 9.5 y 9.0000001 no son una hora agendable,
   * y null no borra nada porque sin hora no hay recordatorio — para eso esta el default.
   * Number.isInteger deja fuera de un golpe strings, decimales, NaN, Infinity y null.
   */
  let reminderHour = current.reminderHour
  if (has('reminderHour')) {
    reminderHour = input.reminderHour
    if (!Number.isInteger(reminderHour) || reminderHour < MIN_HOUR || reminderHour > MAX_HOUR) {
      fields.reminderHour = `Elige una hora entera de ${MIN_HOUR} a ${MAX_HOUR}`
    }
  }

  /**
   * null lo borra (vuelve a la inicial) y no mandarlo no lo toca, igual que birthDate y al reves
   * que reminderHour, donde null no borra porque sin hora no hay recordatorio. No pasa por `pick`
   * a proposito: `pick` trata '' como "no tocar" y aqui quitarse la cara es una eleccion tan valida
   * como ponersela. `str` devuelve '' para lo que no es texto, asi que numeros, arrays y objetos
   * caen solos contra el patron.
   */
  let avatar = current.avatar
  if (has('avatar')) {
    avatar = input.avatar == null ? null : str(input.avatar)
    if (avatar !== null && !AVATAR.test(avatar)) fields.avatar = 'Elige un avatar de la lista'
  }

  const profile = {
    birthDate,
    focusAreas,
    peakEnergy: pick('peakEnergy', PEAK_ENERGY),
    reminderStyle: pick('reminderStyle', REMINDER_STYLE),
    reminderHour,
    accentColor: pick('accentColor', ACCENT_COLOR),
    avatar,
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
  birthDate: row.birthDate ?? DEFAULT_PROFILE.birthDate,
  focusAreas: row.focusAreas ?? DEFAULT_PROFILE.focusAreas,
  peakEnergy: row.peakEnergy ?? DEFAULT_PROFILE.peakEnergy,
  reminderStyle: row.reminderStyle ?? DEFAULT_PROFILE.reminderStyle,
  reminderHour: row.reminderHour ?? DEFAULT_PROFILE.reminderHour,
  // Si un rename futuro deja un valor fuera del catalogo, sale el default en vez de un
  // nombre que la app no sabe pintar. Los ya guardados los arregla su migracion.
  accentColor: ACCENT_COLOR.includes(row.accentColor) ? row.accentColor : DEFAULT_PROFILE.accentColor,
  // Sin filtrar contra una lista, al reves que accentColor: aqui el catalogo vive en el bundle de
  // la app y este lado no puede saber cual es. Un nombre que esa version no tenga lo resuelve ella
  // con el mismo fallback que usa para null. Ver el docblock de AVATAR.
  avatar: row.avatar ?? DEFAULT_PROFILE.avatar,
  emailVerified: !!row.emailVerifiedAt,
  onboardedAt: row.onboardedAt ?? null,
  authProvider: row.authProvider ?? 'password',
  // El paso lo decide el servidor: la app lo pinta, no lo calcula.
  stage: stageOf(row),
  createdAt: row.createdAt,
})

export const catalogs = {
  focusAreas: FOCUS_AREAS,
  peakEnergy: PEAK_ENERGY,
  reminderStyle: REMINDER_STYLE,
  accentColor: ACCENT_COLOR,
}
