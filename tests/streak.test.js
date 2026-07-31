import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import {
  STREAK_WINDOW,
  bestStreak,
  currentStreak,
  daysBetween,
  shiftDay,
  weekOf,
} from '../src/domain/streak.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-streak.db'
// El esquema sale de las migraciones: openDatabase ya no crea tablas.
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

let auth
let otherAuth

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

/** Crea una tarea en un dia concreto y la cierra. Es lo que alimenta la racha. */
const closeOn = async (date, title, token = auth) => {
  const res = await call('POST', '/tasks', {
    body: { title, dueAt: `${date}T12:00:00-06:00` },
    token,
  })
  const { task } = await res.json()
  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token })
  return task.id
}

before(async () => {
  auth = await signUp('racha@nexgen.mx', 'Omar')
  otherAuth = await signUp('racha-otro@nexgen.mx', 'Ana')
})

// --- dominio puro ------------------------------------------------------------------------------

test('shiftDay suma y resta dias sin cruzar zonas', () => {
  assert.equal(shiftDay('2026-07-30', 1), '2026-07-31')
  assert.equal(shiftDay('2026-07-30', -1), '2026-07-29')
  assert.equal(shiftDay('2026-07-31', 1), '2026-08-01', 'cambio de mes')
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01', 'cambio de año')
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29', 'año bisiesto')
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28', 'febrero de 28')
})

test('daysBetween cuenta dias, no horas', () => {
  assert.equal(daysBetween('2026-07-30', '2026-07-31'), 1)
  assert.equal(daysBetween('2026-07-30', '2026-07-30'), 0)
  assert.equal(daysBetween('2026-07-31', '2026-07-30'), -1)
  assert.equal(daysBetween('2026-07-01', '2026-08-01'), 31)
})

test('la racha cuenta dias seguidos hacia atras', () => {
  const days = [
    { date: '2026-07-30', done: 1 },
    { date: '2026-07-29', done: 3 },
    { date: '2026-07-28', done: 1 },
  ]
  assert.equal(currentStreak(days, '2026-07-30'), 3)
})

test('hoy sin cerrar nada NO rompe la racha', () => {
  // Es la decision de producto que importa: una racha que se pone en cero a las 00:01 castiga por no
  // haber hecho nada a medianoche.
  const days = [
    { date: '2026-07-29', done: 2 },
    { date: '2026-07-28', done: 1 },
  ]
  assert.equal(currentStreak(days, '2026-07-30'), 2, 'ayer cuenta, hoy todavia esta abierto')
})

test('dos dias de hueco si la rompen', () => {
  const days = [{ date: '2026-07-28', done: 2 }]
  assert.equal(currentStreak(days, '2026-07-30'), 0)
})

test('un hueco en medio corta la racha ahi', () => {
  const days = [
    { date: '2026-07-30', done: 1 },
    { date: '2026-07-29', done: 1 },
    // falta el 28
    { date: '2026-07-27', done: 5 },
  ]
  assert.equal(currentStreak(days, '2026-07-30'), 2)
})

test('sin nada cerrado la racha es cero', () => {
  assert.equal(currentStreak([], '2026-07-30'), 0)
  assert.equal(bestStreak([]), 0)
})

test('la mejor racha mira todo el historial, no solo la actual', () => {
  const days = [
    { date: '2026-07-30', done: 1 }, // racha actual: 1
    // hueco largo
    { date: '2026-07-10', done: 1 },
    { date: '2026-07-09', done: 1 },
    { date: '2026-07-08', done: 1 },
    { date: '2026-07-07', done: 1 }, // la mejor: 4
  ]
  assert.equal(currentStreak(days, '2026-07-30'), 1)
  assert.equal(bestStreak(days), 4)
})

test('la mejor racha aguanta las fechas en cualquier orden', () => {
  const revuelto = [
    { date: '2026-07-08', done: 1 },
    { date: '2026-07-10', done: 1 },
    { date: '2026-07-09', done: 1 },
  ]
  assert.equal(bestStreak(revuelto), 3)
})

test('la semana va de lunes a domingo y trae los conteos', () => {
  // 2026-07-30 es jueves.
  const week = weekOf([{ date: '2026-07-30', done: 2 }, { date: '2026-07-27', done: 1 }], '2026-07-30')
  assert.equal(week.length, 7)
  assert.equal(week[0].date, '2026-07-27', 'el lunes va primero, como en la tira de la app')
  assert.equal(week[6].date, '2026-08-02', 'y el domingo al final')
  assert.equal(week[0].done, 1)
  assert.equal(week[3].done, 2, 'el jueves')
  assert.equal(week[1].done, 0, 'un dia sin nada es 0, no un hueco')
})

test('la semana de un domingo lo pone al final, no al principio', () => {
  // 2026-08-02 es domingo.
  const week = weekOf([], '2026-08-02')
  assert.equal(week[0].date, '2026-07-27', 'el lunes de ESA semana')
  assert.equal(week[6].date, '2026-08-02')
})

test('la semana de un lunes lo pone primero', () => {
  // 2026-07-27 es lunes.
  const week = weekOf([], '2026-07-27')
  assert.equal(week[0].date, '2026-07-27')
})

test('la ventana del historial es de un año', () => {
  assert.equal(STREAK_WINDOW, 365)
})

// --- el endpoint -------------------------------------------------------------------------------

test('/me/streak exige token', async () => {
  assert.equal((await call('GET', '/me/streak')).status, 401)
})

test('/me/streak arranca en cero para una cuenta nueva', async () => {
  const res = await call('GET', '/me/streak?date=2026-07-30', { token: auth })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.days, 0)
  assert.equal(body.best, 0)
  assert.equal(body.week.length, 7)
  assert.equal(body.date, '2026-07-30')
})

test('/me/streak cuenta las tareas cerradas de verdad', async () => {
  await closeOn('2026-07-28', 'Lunes')
  await closeOn('2026-07-29', 'Martes')
  await closeOn('2026-07-30', 'Miercoles')

  const body = await (await call('GET', '/me/streak?date=2026-07-30', { token: auth })).json()
  assert.equal(body.days, 3, 'tres dias seguidos')
  assert.equal(body.best, 3)
})

test('/me/streak solo cuenta las CERRADAS, no las pendientes', async () => {
  // Una pendiente en un dia nuevo no debe alargar la racha.
  await call('POST', '/tasks', {
    body: { title: 'Sin cerrar', dueAt: '2026-07-31T12:00:00-06:00' },
    token: auth,
  })
  const body = await (await call('GET', '/me/streak?date=2026-07-31', { token: auth })).json()
  assert.equal(body.days, 3, 'la racha sigue siendo la de hasta el 30')
})

test('la racha de un usuario no ve las tareas de otro', async () => {
  await closeOn('2026-07-30', 'De Ana', otherAuth)
  const mia = await (await call('GET', '/me/streak?date=2026-07-30', { token: auth })).json()
  const suya = await (await call('GET', '/me/streak?date=2026-07-30', { token: otherAuth })).json()
  assert.equal(mia.days, 3)
  assert.equal(suya.days, 1, 'Ana solo cerro una cosa un dia')
})

test('/me/streak sin fecha no revienta (usa hoy en UTC)', async () => {
  const res = await call('GET', '/me/streak', { token: auth })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(body.week.length, 7)
})
