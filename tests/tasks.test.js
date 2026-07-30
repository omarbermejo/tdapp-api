import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-tasks.db'
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

const newTask = (body, token = auth) => call('POST', '/tasks', { body, token })

/** Las tareas exigen correo verificado, asi que el alta de prueba pasa por el codigo. */
const signUp = async (email, name) => {
  const res = await call('POST', '/auth/register', { body: { email, password: 'supersecreta1', name } })
  const { token } = await res.json()
  const verified = await call('POST', '/auth/verify', { body: { code: mail.lastCode() }, token })
  return (await verified.json()).token
}

before(async () => {
  auth = await signUp('tareas@nexgen.mx', 'Omar')
  otherAuth = await signUp('otro@nexgen.mx', 'Ana')
})

test('todas las rutas de tareas exigen token', async () => {
  assert.equal((await call('GET', '/tasks')).status, 401)
  assert.equal((await call('POST', '/tasks', { body: { title: 'x' } })).status, 401)
  assert.equal((await call('GET', '/me/today')).status, 401)
})

test('crea una tarea con defaults y deriva la fecha local', async () => {
  const res = await newTask({ title: 'Terminar el reporte', dueAt: '2026-08-01T18:00:00-06:00' })
  assert.equal(res.status, 201)

  const { task } = await res.json()
  assert.equal(task.size, 'medium')
  assert.equal(task.status, 'pending')
  assert.equal(task.suggestedMinutes, 25)
  assert.equal(task.dueDate, '2026-08-01', 'la fecha local sale del ISO que mando el cliente')
  assert.equal(task.elapsedSeconds, 0)
  assert.equal(task.running, false)
})

test('los minutos exactos mandan sobre el tamaño', async () => {
  // Sin minutos: el tamaño sugiere. Es el caso normal, y anotar no obliga a elegir numero.
  const porTamano = await (await newTask({ title: 'Profunda', size: 'deep' })).json()
  assert.equal(porTamano.task.minutes, null, 'null significa "no lo decidi"')
  assert.equal(porTamano.task.suggestedMinutes, 50)

  // Con minutos: 15 no cabe en ningun cajon, y es justo el caso que motivo la columna.
  const exacta = await (await newTask({ title: 'Quince', size: 'medium', minutes: 15 })).json()
  assert.equal(exacta.task.minutes, 15)
  assert.equal(exacta.task.suggestedMinutes, 15, 'lo elegido gana al sugerido')

  // Y se puede volver a "que decida el tamaño" mandando null.
  const devuelta = await (
    await call('PATCH', `/tasks/${exacta.task.id}`, { body: { minutes: null }, token: auth })
  ).json()
  assert.equal(devuelta.task.minutes, null)
  assert.equal(devuelta.task.suggestedMinutes, 25)
})

test('rechaza minutos fuera de rango', async () => {
  for (const minutes of [0, -5, 481, 12.5]) {
    const res = await newTask({ title: 'Fuera', minutes })
    assert.equal(res.status, 400, `${minutes} no deberia pasar`)
    assert.ok((await res.json()).fields.minutes)
  }
})

test('rechaza datos invalidos', async () => {
  const sinTitulo = await newTask({ title: '   ' })
  assert.equal(sinTitulo.status, 400)
  assert.ok((await sinTitulo.json()).fields.title)

  assert.equal((await newTask({ title: 'x', size: 'gigante' })).status, 400)
  assert.equal((await newTask({ title: 'x', focusArea: 'inventado' })).status, 400)
  assert.equal((await newTask({ title: 'x', dueAt: 'mañana' })).status, 400)
  assert.equal((await newTask({ title: 'a'.repeat(121) })).status, 400)
})

test('lista filtrando por fecha, estado y foco', async () => {
  await newTask({ title: 'Hoy A', dueAt: '2026-08-02T09:00:00-06:00', focusArea: 'work' })
  await newTask({ title: 'Hoy B', dueAt: '2026-08-02T20:00:00-06:00', focusArea: 'health' })
  await newTask({ title: 'Sin fecha' })

  const delDia = await (await call('GET', '/tasks?date=2026-08-02', { token: auth })).json()
  assert.equal(delDia.tasks.length, 2)
  assert.deepEqual(delDia.tasks.map((t) => t.title), ['Hoy A', 'Hoy B'], 'ordenadas por hora')

  const porFoco = await (await call('GET', '/tasks?focusArea=health', { token: auth })).json()
  assert.deepEqual(porFoco.tasks.map((t) => t.title), ['Hoy B'])

  const pendientes = await (await call('GET', '/tasks?status=pending', { token: auth })).json()
  assert.ok(pendientes.tasks.length >= 3)
})

test('completar sella la hora y reabrir la borra', async () => {
  const { task } = await (await newTask({ title: 'Lavar trastes' })).json()

  const hecha = await (
    await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: auth })
  ).json()
  assert.equal(hecha.task.status, 'done')
  assert.ok(hecha.task.completedAt)
  assert.equal(hecha.task.title, 'Lavar trastes', 'el patch parcial no borra lo que no viene')

  const reabierta = await (
    await call('PATCH', `/tasks/${task.id}`, { body: { status: 'pending' }, token: auth })
  ).json()
  assert.equal(reabierta.task.completedAt, null)
})

test('el timer acumula y solo permite uno corriendo', async () => {
  const { task } = await (await newTask({ title: 'Sesion de foco' })).json()
  const otra = (await (await newTask({ title: 'Otra cosa' })).json()).task

  const arrancada = await (
    await call('POST', `/tasks/${task.id}/timer`, { body: { action: 'start' }, token: auth })
  ).json()
  assert.equal(arrancada.task.running, true)

  const choque = await call('POST', `/tasks/${otra.id}/timer`, { body: { action: 'start' }, token: auth })
  assert.equal(choque.status, 409, 'dos timers a la vez no')

  const parada = await (
    await call('POST', `/tasks/${task.id}/timer`, { body: { action: 'stop' }, token: auth })
  ).json()
  assert.equal(parada.task.running, false)
  assert.ok(parada.task.elapsedSeconds >= 0)

  const malaAccion = await call('POST', `/tasks/${task.id}/timer`, { body: { action: 'pausa' }, token: auth })
  assert.equal(malaAccion.status, 400)
})

test('completar una tarea para su cronometro', async () => {
  const { task } = await (await newTask({ title: 'Sesion que se completa' })).json()

  await call('POST', `/tasks/${task.id}/timer`, { body: { action: 'start' }, token: auth })

  const hecha = await (
    await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: auth })
  ).json()
  assert.equal(hecha.task.running, false, 'una tarea hecha no puede seguir contando')
  assert.equal(hecha.task.startedAt, null)

  // Y lo que importaba: el cronometro liberado deja arrancar otro. Con el bug, este
  // start respondia 409 para siempre porque findRunning seguia devolviendo la hecha.
  const otra = (await (await newTask({ title: 'La siguiente' })).json()).task
  const arranca = await call('POST', `/tasks/${otra.id}/timer`, { body: { action: 'start' }, token: auth })
  assert.equal(arranca.status, 200, 'completar la anterior libero el cronometro')
  await call('POST', `/tasks/${otra.id}/timer`, { body: { action: 'stop' }, token: auth })
})

test('/me/today arma el resumen del widget', async () => {
  const hoy = '2026-08-03'
  await newTask({ title: 'Primera del dia', dueAt: `${hoy}T08:00:00-06:00` })
  const segunda = (await (await newTask({ title: 'Segunda', dueAt: `${hoy}T15:00:00-06:00` })).json()).task
  await call('PATCH', `/tasks/${segunda.id}`, { body: { status: 'done' }, token: auth })

  const today = await (await call('GET', `/me/today?date=${hoy}`, { token: auth })).json()
  assert.equal(today.date, hoy)
  assert.equal(today.user.name, 'Omar')
  assert.deepEqual(today.counts, { total: 2, pending: 1, done: 1 })
  assert.equal(today.next.title, 'Primera del dia')
  assert.equal(today.running, null)
})

test('un usuario no ve ni toca las tareas de otro', async () => {
  const { task } = await (await newTask({ title: 'Privada' })).json()

  assert.equal((await call('PATCH', `/tasks/${task.id}`, { body: { title: 'Hackeada' }, token: otherAuth })).status, 404)
  assert.equal((await call('DELETE', `/tasks/${task.id}`, { token: otherAuth })).status, 404)

  const ajenas = await (await call('GET', '/tasks', { token: otherAuth })).json()
  assert.equal(ajenas.tasks.length, 0)
})

test('borrar quita la tarea y la segunda vez es 404', async () => {
  const { task } = await (await newTask({ title: 'Temporal' })).json()
  assert.equal((await call('DELETE', `/tasks/${task.id}`, { token: auth })).status, 204)
  assert.equal((await call('DELETE', `/tasks/${task.id}`, { token: auth })).status, 404)
})

test('registra el push token y lo reasigna si cambia de dueño', async () => {
  const token = 'ExponentPushToken[abc123]'

  const res = await call('POST', '/me/devices', { body: { token, platform: 'ios' }, token: auth })
  assert.equal(res.status, 201)
  assert.equal((await res.json()).device.platform, 'ios')

  const reasignado = await call('POST', '/me/devices', { body: { token, platform: 'ios' }, token: otherAuth })
  assert.equal(reasignado.status, 201, 'el mismo token no explota, cambia de usuario')

  const malo = await call('POST', '/me/devices', { body: { token: 'abc', platform: 'ios' }, token: auth })
  assert.equal(malo.status, 400)
  assert.equal((await call('POST', '/me/devices', { body: { token, platform: 'nokia' }, token: auth })).status, 400)
})

test('/tasks/catalogs es publico para pintar las opciones', async () => {
  const catalogs = await (await call('GET', '/tasks/catalogs')).json()
  assert.deepEqual(catalogs.size, ['quick', 'medium', 'deep'])
  assert.equal(catalogs.sizeMinutes.deep, 50)
  assert.ok(catalogs.focusArea.includes('creativity'))
})
