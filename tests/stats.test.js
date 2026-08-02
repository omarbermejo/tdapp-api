import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { STATS_WINDOW, foldStats } from '../src/domain/stats.js'
import { SIZE_MINUTES } from '../src/domain/task.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-stats.db'
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

/** Crea una tarea y opcionalmente la cierra. `dueAt` nulo la deja sin agendar. */
const make = async ({ date, title, size, minutes, focusArea, done }, token = auth) => {
  const res = await call('POST', '/tasks', {
    body: {
      title,
      size,
      minutes,
      focusArea,
      ...(date && { dueAt: `${date}T12:00:00-06:00` }),
    },
    token,
  })
  const { task } = await res.json()
  if (done) await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token })
  return task
}

before(async () => {
  auth = await signUp('stats@nexgen.mx', 'Omar')
})

// --- dominio puro ------------------------------------------------------------------------------

test('los minutos son los PLANEADOS: null cae en lo que sugiere el tamaño', () => {
  const { totals } = foldStats([
    { date: '2026-07-30', focusArea: 'work', size: 'deep', minutes: null, done: 2 },
    { date: '2026-07-30', focusArea: 'work', size: 'quick', minutes: 90, done: 1 },
  ])
  assert.equal(totals.done, 3)
  // 2 x 50 (deep) + 1 x 90 (el que la persona eligio, que le gana al tamaño)
  assert.equal(totals.minutes, 2 * SIZE_MINUTES.deep + 90)
})

test('por dia sale en orden cronologico y por area de mas a menos', () => {
  const { byDay, byArea } = foldStats([
    { date: '2026-07-30', focusArea: 'home', size: 'quick', minutes: null, done: 1 },
    { date: '2026-07-28', focusArea: 'work', size: 'deep', minutes: null, done: 1 },
    { date: '2026-07-29', focusArea: 'work', size: 'medium', minutes: null, done: 1 },
  ])
  assert.deepEqual(byDay.map((d) => d.date), ['2026-07-28', '2026-07-29', '2026-07-30'])
  assert.deepEqual(byArea.map((a) => a.focusArea), ['work', 'home'])
  assert.equal(byArea[0].minutes, SIZE_MINUTES.deep + SIZE_MINUTES.medium)
})

test('las tareas sin area no se pierden: suman al total y salen como null', () => {
  const { byArea, totals } = foldStats([
    { date: '2026-07-30', focusArea: null, size: 'medium', minutes: null, done: 2 },
    { date: '2026-07-30', focusArea: 'work', size: 'medium', minutes: null, done: 1 },
  ])
  assert.equal(byArea.length, 2)
  assert.equal(byArea.reduce((n, a) => n + a.minutes, 0), totals.minutes)
  assert.ok(byArea.some((a) => a.focusArea === null))
})

test('sin nada cerrado devuelve vacio, no nulos', () => {
  const empty = foldStats([])
  assert.deepEqual(empty, { byDay: [], byArea: [], totals: { done: 0, minutes: 0 } })
})

test('las agendadas cuentan aunque no se hayan cerrado, y crean su dia', () => {
  const { byDay } = foldStats(
    [{ date: '2026-07-30', focusArea: 'work', size: 'medium', minutes: null, done: 1 }],
    [
      { date: '2026-07-30', planned: 3 },
      // Un dia que NO esta en las cerradas: es el caso que el mapa de calor necesita ver.
      { date: '2026-07-31', planned: 2 },
    ]
  )
  assert.deepEqual(byDay.map((d) => d.date), ['2026-07-30', '2026-07-31'])
  assert.equal(byDay[0].planned, 3, 'las 3 del dia, no solo la cerrada')
  assert.equal(byDay[0].done, 1)
  assert.equal(byDay[1].planned, 2, 'un dia con puras pendientes existe')
  assert.equal(byDay[1].done, 0)
})

test('sin filas de agendadas, planned cae en done y nunca queda por debajo', () => {
  const { byDay } = foldStats([
    { date: '2026-07-30', focusArea: 'work', size: 'medium', minutes: null, done: 2 },
  ])
  assert.equal(byDay[0].planned, 2, 'el piso honesto es lo cerrado, no 0')
})

// --- endpoint ------------------------------------------------------------------------------------

test('GET /me/stats resume la ventana pedida', async () => {
  await make({ date: '2026-07-28', title: 'Cerrada de trabajo', size: 'deep', focusArea: 'work', done: true })
  await make({ date: '2026-07-30', title: 'Cerrada de casa', size: 'quick', focusArea: 'home', done: true })
  await make({ date: '2026-07-30', title: 'Abierta', size: 'deep', focusArea: 'work' })

  const res = await call('GET', '/me/stats?date=2026-07-30', { token: auth })
  assert.equal(res.status, 200)
  const stats = await res.json()

  assert.equal(stats.to, '2026-07-30')
  assert.equal(stats.totals.done, 2, 'la abierta no cuenta')
  assert.equal(stats.totals.minutes, SIZE_MINUTES.deep + SIZE_MINUTES.quick)
  assert.deepEqual(stats.byDay.map((d) => d.date), ['2026-07-28', '2026-07-30'])

  // Lo que alimenta el mapa de calor: el 30 tiene dos agendadas (una cerrada y la abierta).
  const treinta = stats.byDay.find((d) => d.date === '2026-07-30')
  assert.equal(treinta.planned, 2, 'la abierta SI cuenta como agendada')
  assert.equal(treinta.done, 1, 'pero no como cerrada')
})

test('la ventana por defecto son cuatro semanas y respeta el dia del cliente', async () => {
  const res = await call('GET', '/me/stats?date=2026-07-30', { token: auth })
  const { from, to } = await res.json()
  assert.equal(to, '2026-07-30')
  assert.equal(from, '2026-07-03', `${STATS_WINDOW} dias atras, o sea 28 contando hoy`)
})

test('una ventana absurda se rechaza en vez de escanear un año de filas', async () => {
  const res = await call('GET', '/me/stats?date=2026-07-30&from=2020-01-01', { token: auth })
  assert.equal(res.status, 400)
})

test('/me/stats no filtra datos de otra cuenta', async () => {
  const otra = await signUp('stats-otro@nexgen.mx', 'Ana')
  const res = await call('GET', '/me/stats?date=2026-07-30', { token: otra })
  const { totals } = await res.json()
  assert.equal(totals.done, 0)
})

// --- el agujero del backlog ----------------------------------------------------------------------

test('backlog trae lo vencido Y lo que nunca tuvo fecha', async () => {
  // Las dos cosas que hasta ahora no salian en NINGUNA pantalla de la app.
  await make({ date: '2026-07-20', title: 'Se me paso' })
  await make({ title: 'Sin fecha' })

  const res = await call('GET', '/tasks?status=pending&backlog=2026-07-30', { token: auth })
  const { tasks } = await res.json()
  const titles = tasks.map((t) => t.title)

  assert.ok(titles.includes('Se me paso'), 'vencida')
  assert.ok(titles.includes('Sin fecha'), 'sin agendar')
  assert.ok(!titles.includes('Abierta'), 'la de hoy no es backlog')
})

test('backlog no arrastra lo ya cerrado', async () => {
  const res = await call('GET', '/tasks?status=pending&backlog=2026-07-30', { token: auth })
  const { tasks } = await res.json()
  assert.ok(tasks.every((t) => t.status === 'pending'))
})

test('sin backlog la lista se comporta igual que antes', async () => {
  const res = await call('GET', '/tasks?date=2026-07-30', { token: auth })
  const { tasks } = await res.json()
  assert.ok(tasks.length > 0)
  assert.ok(tasks.every((t) => t.dueDate === '2026-07-30'))
})
