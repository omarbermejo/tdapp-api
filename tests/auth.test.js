import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test.db'
// El esquema sale de las migraciones: openDatabase ya no crea tablas.
await freshDb(DB)

const { buildApp } = await import('../src/composition.js')
// ponytail: stubs de los proveedores en vez de mockear HTTP.
// En los tests el idToken ES el payload que Google o Apple devolverian.
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

const post = (path, body, token) =>
  fetch(url + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body ?? {}),
  })

const account = { email: 'Omar@Nexgen.MX', password: 'supersecreta1', name: 'Omar' }

test('register crea la cuenta sin verificar y manda el codigo', async () => {
  const res = await post('/auth/register', account)
  assert.equal(res.status, 201)

  const { token, user } = await res.json()
  assert.equal(user.email, 'omar@nexgen.mx', 'el email se normaliza a minusculas')
  assert.equal(user.emailVerified, false)
  assert.equal(user.onboardedAt, null)
  assert.equal(user.password ?? user.passwordHash, undefined, 'nunca se filtra el hash')
  assert.equal(mail.sent.length, 1, 'salio un correo')
  assert.match(mail.lastCode(), /^\d{6}$/)

  // Sin verificar solo abre /me: es de ahi que la app saca en que paso va.
  assert.equal((await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200)
  assert.equal((await fetch(`${url}/tasks`, { headers: { Authorization: `Bearer ${token}` } })).status, 403)
})

test('el perfil se guarda despues de verificar, no en el registro', async () => {
  const first = await (await post('/auth/login', { email: 'omar@nexgen.mx', password: 'supersecreta1' })).json()

  const verified = await post('/auth/verify', { code: mail.lastCode() }, first.token)
  assert.equal(verified.status, 200)
  const { token, user } = await verified.json()
  assert.equal(user.emailVerified, true)
  assert.equal(user.diagnosis, 'undisclosed', 'el perfil sigue en defaults')

  const saved = await fetch(`${url}/me/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      birthYear: 1995,
      diagnosis: 'combined',
      treatment: 'medication',
      focusAreas: ['work', 'study'],
      peakEnergy: 'night',
      reminderStyle: 'persistent',
      accentColor: 'leaf',
    }),
  })
  assert.equal(saved.status, 200)
  const profile = (await saved.json()).user
  assert.deepEqual(profile.focusAreas, ['work', 'study'])
  assert.equal(profile.accentColor, 'leaf')
  assert.ok(profile.onboardedAt, 'onboarded_at queda sellado')

  const me = await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal((await me.json()).user.peakEnergy, 'night')
})

test('register solo exige email, password y nombre', async () => {
  const res = await post('/auth/register', { email: 'minimo@nexgen.mx', password: 'supersecreta1', name: 'Ana' })
  assert.equal(res.status, 201)
  const { user } = await res.json()
  assert.equal(user.diagnosis, 'undisclosed')
  assert.equal(user.reminderStyle, 'firm')
  assert.deepEqual(user.focusAreas, [])
  assert.equal(user.emailVerified, false)
})

test('register rechaza datos invalidos y correos ya verificados', async () => {
  // Omar quedo verificado en el test anterior: ese correo si esta tomado.
  assert.equal((await post('/auth/register', account)).status, 409)

  const bad = await post('/auth/register', { email: 'nope', password: 'corta', name: 'A' })
  assert.equal(bad.status, 400)
  const { fields } = await bad.json()
  assert.deepEqual(Object.keys(fields).sort(), ['email', 'name', 'password'])
})

test('registrar otra vez un correo sin verificar se queda con la cuenta', async () => {
  const first = await post('/auth/register', {
    email: 'pendiente@nexgen.mx',
    password: 'supersecreta1',
    name: 'Primero',
  })
  assert.equal(first.status, 201)
  const id = (await first.json()).user.id
  const enviados = mail.sent.length

  const again = await post('/auth/register', {
    email: 'pendiente@nexgen.mx',
    password: 'otrapassword9',
    name: 'Segundo',
  })
  assert.equal(again.status, 201, 'nadie queda bloqueado por un correo que nunca se verifico')
  assert.equal(mail.sent.length, enviados, 'el codigo anterior sigue vivo: no se manda otro')

  const nueva = await post('/auth/login', { email: 'pendiente@nexgen.mx', password: 'otrapassword9' })
  assert.equal(nueva.status, 200, 'las credenciales nuevas son las que valen')
  assert.equal((await nueva.json()).user.id, id, 'no se creo una cuenta nueva')

  const vieja = await post('/auth/login', { email: 'pendiente@nexgen.mx', password: 'supersecreta1' })
  assert.equal(vieja.status, 401)
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

test('/auth/google crea la cuenta verificada y la reusa despues', async () => {
  const idToken = JSON.stringify({ email: 'google@nexgen.mx', name: 'Omar de Google' })

  const first = await post('/auth/google', { idToken })
  assert.equal(first.status, 200)
  const nuevo = await first.json()
  assert.ok(nuevo.token)
  assert.equal(nuevo.user.diagnosis, 'undisclosed', 'entra con los defaults del perfil')
  assert.equal(nuevo.user.emailVerified, true, 'el proveedor ya verifico el correo: se salta el OTP')
  assert.equal(nuevo.user.onboardedAt, null, 'pero si pasa por onboarding')

  const second = await post('/auth/google', { idToken })
  assert.equal((await second.json()).user.id, nuevo.user.id, 'no duplica cuenta por el mismo correo')

  // La cuenta de Google no tiene password usable: nadie entra por /auth/login con ella.
  const porPassword = await post('/auth/login', { email: 'google@nexgen.mx', password: 'oauth-sin-password' })
  assert.equal(porPassword.status, 401)
})

test('/auth/apple usa el nombre que manda la app en la primera autorizacion', async () => {
  const idToken = JSON.stringify({ email: 'apple@nexgen.mx', name: 'apple@nexgen.mx' })

  const res = await post('/auth/apple', { idToken, name: 'Omar de Apple' })
  assert.equal(res.status, 200)
  const { user } = await res.json()
  assert.equal(user.name, 'Omar de Apple')

  // La segunda vez Apple ya no manda nombre y la cuenta se reusa sin tocarlo.
  const again = await post('/auth/apple', { idToken })
  const repeat = await again.json()
  assert.equal(repeat.user.id, user.id)
  assert.equal(repeat.user.name, 'Omar de Apple')
})

test('/auth/catalogs expone las opciones para la app', async () => {
  const catalogs = await (await fetch(`${url}/auth/catalogs`)).json()
  assert.ok(catalogs.focusAreas.includes('creativity'))
  assert.equal(catalogs.reminderStyle.length, 3)
})
