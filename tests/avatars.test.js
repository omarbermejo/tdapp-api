import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import {
  ALL_AVATARS,
  FREE_AVATARS,
  LOCKED_AVATARS,
  MILESTONES,
  avatarState,
  isFreeAvatar,
  milestoneOf,
  ownedAvatars,
} from '../src/domain/avatar.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-avatars.db'
await freshDb(DB)

const { buildApp } = await import('../src/composition.js')
const mail = codeMailer()
const { app, close } = buildApp({ dbPath: DB, jwtSecret: 'test-secret', mailer: mail.mailer })
const server = app.listen(0)
const url = `http://localhost:${server.address().port}`

after(() => {
  server.close()
  close()
  dropDb(DB)
})

const call = (method, path, { body, token } = {}) =>
  fetch(url + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  })

const signUp = async (email, name) => {
  const res = await call('POST', '/auth/register', { body: { email, password: 'supersecreta1', name } })
  const { token } = await res.json()
  const verified = await call('POST', '/auth/verify', { body: { code: mail.lastCode() }, token })
  return (await verified.json()).token
}

/** Crea una tarea en un dia concreto y la cierra. Es lo que mueve `done` y la racha. */
/** Cierra COMO SI fuera ese dia: `completedOn` es lo que cuenta la racha. Ver `streak.test.js`. */
const closeOn = async (date, title, token) => {
  const res = await call('POST', '/tasks', { body: { title, dueAt: `${date}T12:00:00-06:00` }, token })
  const { task } = await res.json()
  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done', completedOn: date }, token })
}

/** Un dia fijo, para que los tests no dependan del reloj. */
const TODAY = '2026-08-01'
const back = (days) => {
  const at = new Date(Date.UTC(2026, 7, 1) - days * 86400000)
  return at.toISOString().slice(0, 10)
}

let auth

before(async () => {
  auth = await signUp('vestidor@nexgen.mx', 'Vestidor')
})

// --- dominio puro ------------------------------------------------------------------------------

test('el catalogo son 8 libres y 15 por ganar, sin solaparse', () => {
  assert.equal(FREE_AVATARS.length, 8)
  assert.equal(MILESTONES.length, 5)
  assert.equal(LOCKED_AVATARS.length, 15, 'cinco logros de tres caras cada uno')
  assert.equal(ALL_AVATARS.length, 23)

  // Sin repetidas en ningun sitio: una cara pertenece a un solo logro, o a ninguno.
  assert.equal(new Set(ALL_AVATARS).size, ALL_AVATARS.length)

  for (const milestone of MILESTONES) {
    assert.equal(milestone.choices.length, 3, `${milestone.id} ofrece tres`)
    assert.ok(milestone.label && milestone.hint, `${milestone.id} se puede pintar`)
    assert.ok(['done', 'best'].includes(milestone.goal.metric))
    for (const face of milestone.choices) {
      assert.equal(isFreeAvatar(face), false, `${face} no puede ser libre y de logro a la vez`)
      assert.equal(milestoneOf(face).id, milestone.id)
    }
  }

  // Las libres no pertenecen a ningun logro.
  for (const face of FREE_AVATARS) assert.equal(milestoneOf(face), undefined)
})

test('avatarState abre los logros por avance y marca los que esperan eleccion', () => {
  const sinNada = avatarState({ progress: { done: 0, best: 0 } })
  assert.deepEqual(sinNada.free, FREE_AVATARS)
  assert.equal(sinNada.milestones.every((m) => !m.unlocked && !m.claimable), true)

  // Una tarea cerrada abre el primero y nada mas.
  const una = avatarState({ progress: { done: 1, best: 1 } })
  assert.equal(una.milestones[0].unlocked, true)
  assert.equal(una.milestones[0].claimable, true, 'abierto y sin elegir = hay premio esperando')
  assert.equal(una.milestones[1].unlocked, false)

  // Elegida, deja de estar `claimable` pero sigue abierta.
  const elegida = avatarState({
    progress: { done: 1, best: 1 },
    claimed: new Map([['first', 'memoji-09']]),
  })
  assert.equal(elegida.milestones[0].claimable, false)
  assert.equal(elegida.milestones[0].chosen, 'memoji-09')

  // El avance se topa en la meta: "50 de 50" dice mas que "173 de 50".
  const mucho = avatarState({ progress: { done: 500, best: 400 } })
  for (const milestone of mucho.milestones) {
    assert.equal(milestone.unlocked, true)
    assert.equal(milestone.progress, milestone.target)
  }
})

test('ownedAvatars son las libres mas las ganadas, nunca las demas', () => {
  assert.deepEqual(ownedAvatars(), FREE_AVATARS)
  const con = ownedAvatars(new Map([['first', 'memoji-09']]))
  assert.equal(con.includes('memoji-09'), true)
  assert.equal(con.includes('memoji-10'), false, 'las otras dos del trio no se ganan')
})

// --- endpoints ---------------------------------------------------------------------------------

test('GET /me/avatars nace con todo cerrado y ninguna cara ganada', async () => {
  const res = await call('GET', `/me/avatars?date=${TODAY}`, { token: auth })
  assert.equal(res.status, 200)

  const state = await res.json()
  assert.deepEqual(state.free, FREE_AVATARS)
  assert.equal(state.milestones.length, 5)
  assert.equal(
    state.milestones.every((m) => !m.unlocked && m.chosen === null && m.progress === 0),
    true
  )
})

test('no se puede reclamar un logro que no se ha cumplido', async () => {
  const res = await call('POST', `/me/avatars?date=${TODAY}`, {
    token: auth,
    body: { milestone: 'first', avatar: 'memoji-09' },
  })
  assert.equal(res.status, 403, 'existe, pero no se lo ha ganado')
})

test('cerrar una tarea abre el primer logro y deja elegir UNA de las tres', async () => {
  await closeOn(TODAY, 'La primera', auth)

  const abierto = await (await call('GET', `/me/avatars?date=${TODAY}`, { token: auth })).json()
  assert.equal(abierto.milestones[0].unlocked, true)
  assert.equal(abierto.milestones[0].claimable, true)
  assert.equal(abierto.milestones[1].unlocked, false, 'el de diez sigue cerrado')

  // Una cara que no es de ese trio se rechaza aunque el logro este abierto.
  const cruzada = await call('POST', `/me/avatars?date=${TODAY}`, {
    token: auth,
    body: { milestone: 'first', avatar: 'memoji-12' },
  })
  assert.equal(cruzada.status, 400)
  assert.ok((await cruzada.json()).fields.avatar)

  // Un logro que no existe.
  const fantasma = await call('POST', `/me/avatars?date=${TODAY}`, {
    token: auth,
    body: { milestone: 'inventado', avatar: 'memoji-09' },
  })
  assert.equal(fantasma.status, 404)

  const ok = await call('POST', `/me/avatars?date=${TODAY}`, {
    token: auth,
    body: { milestone: 'first', avatar: 'memoji-10' },
  })
  assert.equal(ok.status, 200)
  const state = await ok.json()
  assert.equal(state.milestones[0].chosen, 'memoji-10')
  assert.equal(state.milestones[0].claimable, false)

  // Las otras dos del trio NO se ganan: se elige una, no se cobran las tres.
  const segunda = await call('POST', `/me/avatars?date=${TODAY}`, {
    token: auth,
    body: { milestone: 'first', avatar: 'memoji-09' },
  })
  assert.equal(segunda.status, 409)
})

test('la cara ganada si se puede llevar puesta; las otras dos del trio no', async () => {
  const puesta = await call('PATCH', '/me/profile', { token: auth, body: { avatar: 'memoji-10' } })
  assert.equal(puesta.status, 200)
  assert.equal((await puesta.json()).user.avatar, 'memoji-10')

  const ajena = await call('PATCH', '/me/profile', { token: auth, body: { avatar: 'memoji-09' } })
  assert.equal(ajena.status, 403, 'estaba en el mismo trio, pero eligio la otra')

  // Las libres siguen siendo de todos.
  const libre = await call('PATCH', '/me/profile', { token: auth, body: { avatar: 'memoji-03' } })
  assert.equal(libre.status, 200)
})

test('la racha abre su propio logro sin tocar los de volumen', async () => {
  const token = await signUp('racha-cara@nexgen.mx', 'Racha')

  // Siete dias seguidos: `best` llega a 7 con `done` en 7, asi que se abren el primero y el de diez
  // NO — justo lo que separa los dos ejes.
  for (let i = 0; i < 7; i++) await closeOn(back(i), `Dia ${i}`, token)

  const state = await (await call('GET', `/me/avatars?date=${TODAY}`, { token })).json()
  const by = Object.fromEntries(state.milestones.map((m) => [m.id, m]))

  assert.equal(by.first.unlocked, true)
  assert.equal(by.week.unlocked, true, 'siete dias seguidos')
  assert.equal(by.ten.unlocked, false, 'siete cerradas no son diez')
  assert.equal(by.ten.progress, 7, 'y el avance lo dice')
  assert.equal(by.month.unlocked, false)
})

test('el vestidor de cada quien es suyo', async () => {
  const otro = await signUp('vestidor-otro@nexgen.mx', 'Otro')
  const state = await (await call('GET', `/me/avatars?date=${TODAY}`, { token: otro })).json()
  assert.equal(state.milestones.every((m) => m.chosen === null), true)
})

test('/me/avatars exige token', async () => {
  assert.equal((await call('GET', '/me/avatars')).status, 401)
  assert.equal((await call('POST', '/me/avatars', { body: {} })).status, 401)
})
