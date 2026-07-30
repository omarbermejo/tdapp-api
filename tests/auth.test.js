import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test, { after } from 'node:test'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test.db'
rmSync(DB, { force: true })

const { buildApp } = await import('../src/composition.js')
// ponytail: stub de Google en vez de mockear HTTP. En los tests el idToken ES el payload que Google devolveria.
const { app, close } = buildApp({
  dbPath: DB,
  jwtSecret: 'test-secret',
  google: { verify: async (idToken) => JSON.parse(idToken) },
})
const server = app.listen(0)
const url = `http://localhost:${server.address().port}`

after(() => {
  server.close()
  close()
  rmSync(DB, { force: true })
  rmSync(`${DB}-wal`, { force: true })
  rmSync(`${DB}-shm`, { force: true })
})

const post = (path, body) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const account = { email: 'Omar@Nexgen.MX', password: 'supersecreta1', name: 'Omar' }

test('register guarda el perfil completo y devuelve token', async () => {
  const res = await post('/auth/register', {
    ...account,
    birthYear: 1995,
    diagnosis: 'combined',
    treatment: 'medication',
    focusAreas: ['work', 'study'],
    peakEnergy: 'night',
    reminderStyle: 'persistent',
    accentColor: 'lime',
  })
  assert.equal(res.status, 201)

  const { token, user } = await res.json()
  assert.equal(user.email, 'omar@nexgen.mx', 'el email se normaliza a minusculas')
  assert.deepEqual(user.focusAreas, ['work', 'study'])
  assert.equal(user.accentColor, 'lime')
  assert.equal(user.password ?? user.passwordHash, undefined, 'nunca se filtra el hash')

  const me = await fetch(`${url}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal((await me.json()).user.peakEnergy, 'night')
})

test('register solo exige email, password y nombre', async () => {
  const res = await post('/auth/register', { email: 'minimo@nexgen.mx', password: 'supersecreta1', name: 'Ana' })
  assert.equal(res.status, 201)
  const { user } = await res.json()
  assert.equal(user.diagnosis, 'undisclosed')
  assert.equal(user.reminderStyle, 'firm')
  assert.deepEqual(user.focusAreas, [])
})

test('register rechaza duplicados y datos invalidos', async () => {
  assert.equal((await post('/auth/register', account)).status, 409)

  const bad = await post('/auth/register', { email: 'nope', password: 'corta', name: 'A', focusAreas: ['x'] })
  assert.equal(bad.status, 400)
  const { fields } = await bad.json()
  assert.deepEqual(Object.keys(fields).sort(), ['email', 'focusAreas', 'name', 'password'])

  const tooManyFocus = await post('/auth/register', {
    email: 'focos@nexgen.mx',
    password: 'supersecreta1',
    name: 'Leo',
    focusAreas: ['work', 'study', 'home', 'health'],
  })
  assert.equal(tooManyFocus.status, 400)
})

test('login valida credenciales', async () => {
  assert.equal((await post('/auth/login', { email: 'omar@nexgen.mx', password: 'otracosa1' })).status, 401)
  assert.equal((await post('/auth/login', { email: 'fantasma@nexgen.mx', password: 'supersecreta1' })).status, 401)

  const ok = await post('/auth/login', { email: ' OMAR@nexgen.mx ', password: 'supersecreta1' })
  assert.equal(ok.status, 200)
  assert.ok((await ok.json()).token)
})

test('/auth/me exige token valido', async () => {
  assert.equal((await fetch(`${url}/auth/me`)).status, 401)
  assert.equal((await fetch(`${url}/auth/me`, { headers: { Authorization: 'Bearer basura' } })).status, 401)
})

test('/auth/google crea la cuenta la primera vez y la reusa despues', async () => {
  const idToken = JSON.stringify({ email: 'google@nexgen.mx', name: 'Omar de Google' })

  const first = await post('/auth/google', { idToken })
  assert.equal(first.status, 200)
  const nuevo = await first.json()
  assert.ok(nuevo.token)
  assert.equal(nuevo.user.diagnosis, 'undisclosed', 'entra con los defaults del perfil')

  const second = await post('/auth/google', { idToken })
  assert.equal((await second.json()).user.id, nuevo.user.id, 'no duplica cuenta por el mismo correo')

  // La cuenta de Google no tiene password usable: nadie entra por /auth/login con ella.
  const porPassword = await post('/auth/login', { email: 'google@nexgen.mx', password: 'google-oauth' })
  assert.equal(porPassword.status, 401)
})

test('/auth/catalogs expone las opciones para la app', async () => {
  const catalogs = await (await fetch(`${url}/auth/catalogs`)).json()
  assert.ok(catalogs.focusAreas.includes('creativity'))
  assert.equal(catalogs.reminderStyle.length, 3)
})
