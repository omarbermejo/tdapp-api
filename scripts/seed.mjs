/**
 * Llena una cuenta con un historial creible para ver las pantallas con datos.
 *
 *   node scripts/seed.mjs                      # la primera cuenta de la base
 *   node scripts/seed.mjs omar@local.mx        # una en concreto
 *   node scripts/seed.mjs omar@local.mx --wipe # borra su historial antes
 *
 * SOLO PARA DESARROLLO. Escribe directo sobre SQLite y no pasa por los casos de uso: es a proposito
 * — sembrar por HTTP obligaria a autenticarse y a respetar reglas que aqui estorban (no se puede
 * crear una tarea con fecha de hace tres meses y cerrarla en su dia). El precio es que este archivo
 * conoce el esquema, asi que si una columna cambia, se entera aqui.
 *
 * Todo es DETERMINISTA: el generador lleva semilla, asi que dos corridas dan exactamente el mismo
 * historial. Un seed con Math.random hace que "en mi maquina se ve bien" no signifique nada.
 *
 * Que se busca con la forma de los datos, y no es azar bonito:
 *
 * - **Huecos de verdad.** Un mapa de calor donde todos los dias tienen algo no ensena nada; lo que
 *   se esta comprobando es que un dia vacio se distinga de un dia flojo.
 * - **Una racha viva pero no perfecta.** Doce dias seguidos y un roto antes, para que la mejor marca
 *   y la actual no coincidan — que es el caso que el copy de la racha trata aparte.
 * - **Los tres estados de los logros a la vez**: uno ya elegido, otro esperando eleccion y otros
 *   cerrados con avance a medias. Es la unica forma de mirar las tres celdas juntas.
 * - **Futuro agendado.** El mapa del trimestre mide carga, no logro, asi que sin tareas por venir
 *   sale medio vacio y no se ve para que sirve.
 */

import { DatabaseSync } from 'node:sqlite'

import { MILESTONES } from '../src/domain/avatar.js'

const [emailArg, ...flags] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const WIPE = process.argv.includes('--wipe')
const DB_PATH = process.env.DB_PATH ?? 'data.db'

/** Generador con semilla (mulberry32). Corto, sin dependencias y reproducible. */
function rng(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = rng(20260801)
const pick = (list) => list[Math.floor(random() * list.length)]
const between = (min, max) => min + Math.floor(random() * (max - min + 1))

const pad = (n) => String(n).padStart(2, '0')
const iso = (at) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
/** Hoy en LOCAL, que es como la app manda las fechas: en UTC el dia se corre y la racha miente. */
const TODAY = new Date()
const day = (back) => {
  const at = new Date(TODAY)
  at.setDate(at.getDate() - back)
  return iso(at)
}

// El offset de la zona, para que `due_at` sea un ISO con zona como el que manda la app.
const OFFSET = (() => {
  const mins = -TODAY.getTimezoneOffset()
  const sign = mins >= 0 ? '+' : '-'
  return `${sign}${pad(Math.floor(Math.abs(mins) / 60))}:${pad(Math.abs(mins) % 60)}`
})()

const SPACES = [
  { name: 'Tesis', icon: 'academic', accent: 'forest' },
  { name: 'Trabajo', icon: 'work', accent: 'olive' },
  { name: 'Casa', icon: 'home', accent: 'clay' },
  { name: 'Salud', icon: 'health', accent: 'leaf' },
]

/** Titulos por area, para que la lista no parezca generada. */
const TITLES = {
  study: ['Leer el capitulo 4', 'Resumen del paper', 'Fichas de la bibliografia', 'Revisar el marco teorico', 'Corregir citas APA', 'Escribir la introduccion'],
  work: ['Cerrar el reporte', 'Responder correos', 'Junta de seguimiento', 'Revisar el PR', 'Preparar la demo', 'Actualizar el board'],
  home: ['Lavar ropa', 'Sacar la basura', 'Comprar despensa', 'Cambiar el foco del pasillo', 'Ordenar el escritorio', 'Regar las plantas'],
  health: ['Caminar 30 min', 'Estirar la espalda', 'Cita con el dentista', 'Preparar la comida', 'Dormir antes de las 12', 'Tomar agua'],
  money: ['Pagar la luz', 'Revisar suscripciones', 'Cuadrar gastos del mes', 'Mandar la factura'],
  relationships: ['Llamar a mi mama', 'Confirmar la cena', 'Felicitar a Ana', 'Contestar el grupo'],
  creativity: ['Bocetos de la portada', 'Editar el video', 'Escribir 500 palabras', 'Probar la paleta nueva'],
}
const AREAS = Object.keys(TITLES)
const SIZES = ['quick', 'medium', 'deep']

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')

const user = emailArg
  ? db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(emailArg)
  : db.prepare('SELECT id, email, name FROM users ORDER BY id LIMIT 1').get()

if (!user) {
  console.error(
    emailArg
      ? `No existe ninguna cuenta con ${emailArg}. Registrala desde la app y vuelve a correr esto.`
      : 'La base no tiene ninguna cuenta todavia. Registrate desde la app primero.'
  )
  process.exit(1)
}

console.log(`Sembrando ${user.email} (id ${user.id}) en ${DB_PATH}`)

if (WIPE) {
  db.prepare('DELETE FROM tasks WHERE user_id = ?').run(user.id)
  db.prepare('DELETE FROM workspaces WHERE user_id = ?').run(user.id)
  db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(user.id)
  console.log('  historial anterior borrado')
}

// ---------------------------------------------------------------------------------------------
// Espacios
// ---------------------------------------------------------------------------------------------

const insertSpace = db.prepare(
  'INSERT INTO workspaces (user_id, name, icon, accent, position) VALUES (?, ?, ?, ?, ?)'
)

const spaceIds = []
const existing = db.prepare('SELECT id FROM workspaces WHERE user_id = ?').all(user.id)
if (existing.length) {
  spaceIds.push(...existing.map((r) => r.id))
  console.log(`  ${existing.length} espacios ya existian, se reusan`)
} else {
  for (const [i, space] of SPACES.entries()) {
    const { lastInsertRowid } = insertSpace.run(user.id, space.name, space.icon, space.accent, i)
    spaceIds.push(Number(lastInsertRowid))
  }
  console.log(`  ${SPACES.length} espacios`)
}

// ---------------------------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------------------------

const insertTask = db.prepare(`INSERT INTO tasks
  (user_id, title, size, status, focus_area, due_at, due_date, minutes, completed_at, workspace_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

/**
 * Cuantas tareas tiene el dia de hace `back` dias, y cuantas se cerraron.
 *
 * La curva no es plana a proposito: hay un hueco de vacaciones, una racha viva de doce dias y un
 * roto justo antes, para que la mejor marca y la actual no sean el mismo numero.
 */
function shapeOf(back) {
  if (back === 0) return { total: 4, done: 2 } // hoy, a medias
  if (back < 0) return { total: between(1, 3), done: 0 } // futuro: agendado, nada cerrado
  if (back === 13) return { total: 2, done: 0 } // el dia que rompio la racha
  if (back >= 30 && back <= 40) return { total: 0, done: 0 } // vacaciones: el hueco del mapa

  // Los domingos flojos van DESPUES de la racha: dentro de los ultimos doce dias un domingo en
  // blanco la partiria, y la racha viva es justo lo que este seed existe para poder mirar.
  if (back > 13 && back % 7 === 6) return { total: between(0, 1), done: 0 }

  const total = back <= 12 ? between(2, 5) : between(0, 4)

  /*
    El pasado se cierra casi entero, y eso NO es optimismo: lo que queda pendiente en un dia que ya
    paso cae en "Antes de hoy", y ese cajon acumula TODO el historial. Dejando un tercio abierto
    cada dia, tres meses de seed daban setenta y seis atrasadas — una pantalla que ningun usuario
    real ve y que tapa justo lo que se queria mirar. Un rezago creible son unas pocas.
  */
  const leftover = random() < 0.12 ? 1 : 0
  return { total, done: Math.max(total - leftover, 0) }
}

let created = 0
let closed = 0

// De -21 (tres semanas de futuro agendado) a 119 dias atras: el trimestre que pinta el mapa de Hoy.
for (let back = -21; back <= 119; back++) {
  const { total, done } = shapeOf(back)
  const date = day(back)

  for (let i = 0; i < total; i++) {
    const area = pick(AREAS)
    const isDone = i < done
    const hour = between(8, 20)
    const dueAt = `${date}T${pad(hour)}:${pick(['00', '15', '30'])}:00${OFFSET}`

    insertTask.run(
      user.id,
      pick(TITLES[area]),
      pick(SIZES),
      isDone ? 'done' : 'pending',
      area,
      dueAt,
      date,
      random() < 0.3 ? between(10, 90) : null,
      isDone ? `${date}T${pad(hour + 1)}:00:00.000Z` : null,
      random() < 0.6 ? pick(spaceIds) : null,
      `${date} 08:00:00`
    )
    created++
    if (isDone) closed++
  }
}

console.log(`  ${created} tareas (${closed} cerradas)`)

// ---------------------------------------------------------------------------------------------
// Caras ganadas
// ---------------------------------------------------------------------------------------------

/*
  Se reclama SOLO el primer logro, aunque el historial cumpla varios.

  Es lo que deja las tres formas de celda visibles a la vez en la pantalla: una elegida (con sus dos
  hermanas ya cerradas), otra con el trio esperando eleccion, y las demas con candado y su barra a
  medias. Reclamarlos todos dejaria la pantalla sin nada que mirar.
*/
const claim = db.prepare(
  'INSERT OR IGNORE INTO user_avatars (user_id, milestone, avatar) VALUES (?, ?, ?)'
)
claim.run(user.id, MILESTONES[0].id, MILESTONES[0].choices[1])

db.prepare('UPDATE user_profiles SET avatar = ? WHERE user_id = ?').run(
  MILESTONES[0].choices[1],
  user.id
)

console.log(`  cara puesta: ${MILESTONES[0].choices[1]} (de "${MILESTONES[0].label}")`)

// ---------------------------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------------------------

const done = db
  .prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'done'")
  .get(user.id).n

console.log('\nListo. Ahora deberias ver:')
console.log(`  · ${done} cerradas en total  -> "Mis tareas" y los logros de volumen`)
console.log('  · racha viva de 12 dias, con la mejor marca por encima')
console.log('  · un hueco de 11 dias hace un mes -> el contraste del mapa de calor')
console.log('  · tres semanas de futuro agendado -> el mapa del trimestre en Hoy')
console.log('  · un logro elegido, otro esperando eleccion y el resto con candado')

db.close()
