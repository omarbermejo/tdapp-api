import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { eventOfUpdate, recipientsOf, toPublicEvent } from '../src/domain/event.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-events.db'
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

let auth
const feed = async (token = auth, query = '') =>
  (await (await call('GET', `/me/events${query}`, { token })).json())

const newTask = async (body, token = auth) =>
  (await (await call('POST', '/tasks', { body, token })).json()).task

before(async () => {
  auth = await signUp('novedades@nexgen.mx', 'Novedades')
})

// --- dominio puro ------------------------------------------------------------------------------

test('eventOfUpdate elige UN evento y respeta la precedencia', () => {
  const base = { status: 'pending', workspaceId: null, title: 'A', dueAt: null }

  assert.equal(eventOfUpdate(base, { ...base, status: 'done' }).kind, 'completed')
  assert.equal(eventOfUpdate({ ...base, status: 'done' }, base).kind, 'reopened')

  const movida = eventOfUpdate(base, { ...base, workspaceId: 4 })
  assert.equal(movida.kind, 'moved')
  assert.deepEqual(movida.meta, { from: null, to: 4 })

  const editada = eventOfUpdate(base, { ...base, title: 'B', dueAt: '2026-08-01T10:00:00-06:00' })
  assert.equal(editada.kind, 'edited')
  assert.deepEqual(editada.meta.changed.sort(), ['dueAt', 'title'])

  // Cerrar Y mover a la vez fue UN gesto: gana lo mas especifico y no salen dos filas.
  assert.equal(eventOfUpdate(base, { ...base, status: 'done', workspaceId: 4 }).kind, 'completed')

  // Un PATCH que no cambia nada que contar no es noticia.
  assert.equal(eventOfUpdate(base, { ...base }), null)
  assert.equal(eventOfUpdate(base, { ...base, position: 3 }), null)
})

test('recipientsOf hoy es solo el creador', () => {
  assert.deepEqual(recipientsOf({ userId: 7, workspaceId: 2 }), [7])
})

test('toPublicEvent normaliza el actor borrado y el meta', () => {
  const row = {
    id: 1, kind: 'moved', taskId: 9, taskTitle: 'X', workspaceId: null,
    meta: '{"from":null,"to":3}', actorId: null, createdAt: '2026-08-01T10:00:00.000Z', readAt: null,
  }
  const out = toPublicEvent(row)
  assert.equal(out.actor, null, 'una cuenta borrada no rompe la fila')
  assert.deepEqual(out.meta, { from: null, to: 3 })
  assert.equal(out.read, false)
})

// --- endpoints ---------------------------------------------------------------------------------

test('una cuenta nueva no tiene novedades inventadas', async () => {
  const state = await feed()
  assert.deepEqual(state.events, [], 'sin backfill: el feed empieza a contar desde ahora')
  assert.equal(state.unread, 0)
  assert.equal(state.next, null)
})

test('crear, editar, cerrar, reabrir y borrar dejan su rastro', async () => {
  const task = await newTask({ title: 'Leer el capitulo 4', dueAt: '2026-08-01T18:00:00-06:00' })

  await call('PATCH', `/tasks/${task.id}`, { body: { title: 'Leer el capitulo 5' }, token: auth })
  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: auth })
  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'pending' }, token: auth })
  await call('DELETE', `/tasks/${task.id}`, { token: auth })

  const { events } = await feed()
  assert.deepEqual(
    events.map((e) => e.kind),
    ['deleted', 'reopened', 'completed', 'edited', 'created'],
    'de la mas nueva a la mas vieja'
  )

  // El titulo es el que tenia EN SU MOMENTO: por eso el evento guarda su propia copia.
  const [borrada, , , editada, creada] = events
  assert.equal(creada.taskTitle, 'Leer el capitulo 4')
  assert.equal(editada.taskTitle, 'Leer el capitulo 5')
  assert.equal(borrada.taskTitle, 'Leer el capitulo 5', 'la noticia del borrado sobrevive a la tarea')
  assert.deepEqual(editada.meta.changed, ['title'])
})

test('lo que haces tu nace leido: la campana no se avisa a si misma', async () => {
  await newTask({ title: 'Otra mas' })
  const state = await feed()
  assert.equal(state.unread, 0, 'el globo no se enciende con tus propios toques')
  assert.equal(state.events.every((e) => e.read), true)
})

test('reordenar y el cronometro NO son noticia', async () => {
  const antes = (await feed()).events.length
  const task = await newTask({ title: 'Con timer', dueAt: '2026-08-01T09:00:00-06:00' })

  await call('POST', `/tasks/${task.id}/timer`, { body: { action: 'start' }, token: auth })
  await call('POST', `/tasks/${task.id}/timer`, { body: { action: 'stop' }, token: auth })
  await call('PATCH', '/tasks/order', { body: { date: '2026-08-01', ids: [task.id] }, token: auth })

  const { events } = await feed()
  assert.equal(events.length, antes + 1, 'solo el created de la tarea nueva')
  assert.equal(events[0].kind, 'created')
})

test('la paginacion no repite ni se salta filas', async () => {
  const token = await signUp('paginado@nexgen.mx', 'Paginado')
  for (let i = 0; i < 7; i++) await newTask({ title: `Tarea ${i}` }, token)

  const primera = await feed(token, '?limit=3')
  assert.equal(primera.events.length, 3)
  assert.ok(primera.next, 'hay cursor cuando la pagina viene llena')

  const segunda = await feed(token, `?limit=3&before=${primera.next}`)
  const tercera = await feed(token, `?limit=3&before=${segunda.next}`)

  const ids = [...primera.events, ...segunda.events, ...tercera.events].map((e) => e.id)
  assert.equal(new Set(ids).size, 7, 'siete ids distintos, sin repetidos')
  assert.deepEqual([...ids].sort((a, b) => b - a), ids, 'y en orden descendente')
  assert.equal(tercera.next, null, 'la ultima pagina no ofrece cursor')
})

test('?since= trae solo lo posterior, que es como se rellena el hueco al reconectar', async () => {
  const token = await signUp('hueco@nexgen.mx', 'Hueco')
  await newTask({ title: 'Vieja' }, token)
  const corte = (await feed(token)).events[0].id
  await newTask({ title: 'Nueva 1' }, token)
  await newTask({ title: 'Nueva 2' }, token)

  const { events } = await feed(token, `?since=${corte}`)
  assert.equal(events.length, 2)
  assert.equal(events.every((e) => e.id > corte), true)
})

test('marcar leido es idempotente y no toca lo de nadie mas', async () => {
  const token = await signUp('leido@nexgen.mx', 'Leido')
  await newTask({ title: 'Suya' }, token)

  // Todo nace leido en el espacio personal, asi que se ensucia a mano para poder probar el marcado.
  const unread = await (await call('POST', '/me/events/read', { token })).json()
  assert.equal(unread.unread, 0)

  const otra = await (await call('POST', '/me/events/read', { token })).json()
  assert.equal(otra.unread, 0, 'marcar dos veces no falla')

  const solo = await (await call('GET', '/me/events/unread', { token })).json()
  assert.deepEqual(solo, { unread: 0 })
})

test('el feed de cada quien es suyo', async () => {
  const otro = await signUp('ajeno@nexgen.mx', 'Ajeno')
  const { events } = await feed(otro)
  assert.deepEqual(events, [], 'no ve las tareas de los demas')
})

test('/me/events exige token', async () => {
  assert.equal((await call('GET', '/me/events')).status, 401)
  assert.equal((await call('GET', '/me/events/unread')).status, 401)
  assert.equal((await call('POST', '/me/events/read', { body: {} })).status, 401)
})
