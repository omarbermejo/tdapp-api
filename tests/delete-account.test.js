import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test, { after } from 'node:test'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-delete.db'
await freshDb(DB)

const { buildApp } = await import('../src/composition.js')
const identity = { verify: async (idToken, name) => ({ ...JSON.parse(idToken), ...(name && { name }) }) }
const mail = codeMailer()
const { app, close } = buildApp({
  dbPath: DB,
  jwtSecret: 'test-secret',
  google: identity,
  apple: identity,
  mailer: mail.mailer,
})
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
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

const register = async (email) => {
  const res = await call('POST', '/auth/register', {
    body: { email, password: 'supersecreta1', name: 'Omar' },
  })
  assert.equal(res.status, 201)
  return res.json()
}

/** Cuenta las filas de ese usuario en las cinco tablas, leyendo la base por fuera del API. */
const rowsOf = (userId) => {
  const db = new DatabaseSync(DB)
  try {
    const count = (sql) => db.prepare(sql).get(userId).n
    return {
      users: count('SELECT count(*) AS n FROM users WHERE id = ?'),
      profiles: count('SELECT count(*) AS n FROM user_profiles WHERE user_id = ?'),
      tasks: count('SELECT count(*) AS n FROM tasks WHERE user_id = ?'),
      devices: count('SELECT count(*) AS n FROM devices WHERE user_id = ?'),
      otps: count('SELECT count(*) AS n FROM otp_codes WHERE user_id = ?'),
    }
  } finally {
    db.close()
  }
}

test('sin token no se borra nada', async () => {
  assert.equal((await call('DELETE', '/me')).status, 401)
})

/**
 * El caso con el que App Review prueba esto: cuenta recien creada, sin verificar. Por eso el
 * endpoint vive ARRIBA de requireVerified.
 */
test('una cuenta sin verificar se puede borrar', async () => {
  const { token, user } = await register('sinverificar@nexgen.mx')
  assert.equal(user.emailVerified, false)

  const res = await call('DELETE', '/me', { body: { password: 'supersecreta1' }, token })
  assert.equal(res.status, 204)
  assert.equal(rowsOf(user.id).users, 0)
})

test('con la contraseña equivocada no se borra', async () => {
  const { token, user } = await register('malpass@nexgen.mx')

  const res = await call('DELETE', '/me', { body: { password: 'nomeacuerdo1' }, token })
  assert.equal(res.status, 401)
  assert.match((await res.json()).error, /contraseña/)
  assert.equal(rowsOf(user.id).users, 1, 'la cuenta sigue ahi')

  // Sin cuerpo ninguno tampoco: `password` ausente no puede valer por vacio.
  assert.equal((await call('DELETE', '/me', { token })).status, 401)
  assert.equal(rowsOf(user.id).users, 1)
})

/**
 * El CASCADE tiene que tener algo real que arrastrar: sin la tarea, el device y el codigo
 * pendiente este test pasaria sin probar nada.
 */
test('borrar la cuenta se lleva tareas, perfil, dispositivos y codigos', async () => {
  const { token: pending, user } = await register('completa@nexgen.mx')
  const verified = await call('POST', '/auth/verify', { body: { code: mail.lastCode() }, token: pending })
  assert.equal(verified.status, 200)
  // El token del registro lleva `ev: false` y requireVerified lo lee de ahi, no de la base:
  // hay que quedarse con el que emite /auth/verify o /tasks contesta 403.
  const { token } = await verified.json()

  assert.equal(
    (await call('POST', '/tasks', { body: { title: 'Algo que dejar huerfano' }, token })).status,
    201
  )
  assert.equal(
    (await call('POST', '/me/devices', { body: { token: 'ExponentPushToken[x]', platform: 'ios' }, token }))
      .status,
    201
  )
  // Un codigo pendiente: pedir reenvio con el correo ya verificado da 409, asi que se emite
  // por el camino que si existe — registrarse de nuevo con ese correo no se puede, y el de
  // verificacion ya se consumio. Se siembra directo, que es para lo que sirve leer la base.
  const seed = new DatabaseSync(DB)
  seed
    .prepare(
      `INSERT INTO otp_codes (user_id, purpose, code_hash, expires_at)
       VALUES (?, 'email_verify', 'x', datetime('now', '+10 minutes'))`
    )
    .run(user.id)
  seed.close()

  const before = rowsOf(user.id)
  assert.deepEqual(before, { users: 1, profiles: 1, tasks: 1, devices: 1, otps: 1 })

  assert.equal((await call('DELETE', '/me', { body: { password: 'supersecreta1' }, token })).status, 204)
  assert.deepEqual(rowsOf(user.id), { users: 0, profiles: 0, tasks: 0, devices: 0, otps: 0 })
})

/** Una cuenta de Google no tiene contraseña que teclear, asi que no se le pide ninguna. */
test('una cuenta de Google se borra sin mandar contraseña', async () => {
  const res = await call('POST', '/auth/google', {
    body: { idToken: JSON.stringify({ email: 'google@nexgen.mx', name: 'Omar', emailVerified: true }) },
  })
  assert.equal(res.status, 200)
  const { token, user } = await res.json()
  assert.equal(user.authProvider, 'google')

  assert.equal((await call('DELETE', '/me', { token })).status, 204)
  assert.equal(rowsOf(user.id).users, 0)
})

test('el token de una cuenta borrada ya no abre nada', async () => {
  const { token } = await register('zombie@nexgen.mx')
  assert.equal((await call('DELETE', '/me', { body: { password: 'supersecreta1' }, token })).status, 204)

  // 401 y no 404: es lo unico que hace que la app borre la sesion que tiene guardada.
  assert.equal((await call('GET', '/me', { token })).status, 401)
  assert.equal((await call('GET', '/tasks', { token })).status, 401)
  assert.equal((await call('DELETE', '/me', { body: { password: 'supersecreta1' }, token })).status, 401)
})

/**
 * El agujero que abrio borrar cuentas, y que no puede volver.
 *
 * `users.id` es INTEGER PRIMARY KEY sin AUTOINCREMENT, asi que SQLite recicla el rowid: al borrar la
 * cuenta con el id mas alto, la siguiente que se registre nace con ESE id. Como el JWT dura 30 dias y
 * solo lleva `sub`, el token de la cuenta muerta pasaba a leer y escribir los datos de otra persona.
 *
 * Este test lo monta a proposito: borra la ultima cuenta y registra otra, que hereda el id.
 */
test('el token de una cuenta borrada no se apropia de la cuenta que hereda su id', async () => {
  const { token: viejo, user: muerta } = await register('reciclada@nexgen.mx')
  assert.equal((await call('DELETE', '/me', { body: { password: 'supersecreta1' }, token: viejo })).status, 204)

  const { token: nuevo, user: nueva } = await register('heredera@nexgen.mx')
  assert.equal(nueva.id, muerta.id, 'el id se reciclo: es justo lo que hace peligroso al token viejo')
  assert.notEqual(nueva.email, muerta.email)

  // El token viejo firma bien y su `sub` apunta a una fila que EXISTE. Lo que lo frena es que fue
  // emitido antes de que naciera esa fila.
  assert.equal((await call('GET', '/me', { token: viejo })).status, 401)
  assert.equal(
    (await call('POST', '/tasks', { body: { title: 'Escrita por un fantasma' }, token: viejo })).status,
    401
  )
  assert.equal(
    (await call('DELETE', '/me', { body: { password: 'supersecreta1' }, token: viejo })).status,
    401,
    'y menos todavia puede borrar la cuenta heredera'
  )

  // La cuenta nueva funciona con normalidad: el arreglo no la estorba.
  assert.equal((await call('GET', '/me', { token: nuevo })).status, 200)
})
