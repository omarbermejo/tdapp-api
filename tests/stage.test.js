import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { dropDb, freshDb } from './helpers/db.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-stage.db'
await freshDb(DB)

const { buildApp } = await import('../src/composition.js')
const sent = []
const { app, close } = buildApp({
  dbPath: DB,
  jwtSecret: 'test-secret',
  // El idToken ES el payload que devolveria el proveedor.
  google: { verify: async (idToken) => JSON.parse(idToken) },
  apple: { verify: async (idToken) => JSON.parse(idToken) },
  mailer: { sendVerificationCode: async (mail) => sent.push(mail) },
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
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body && method !== 'GET' && { body: JSON.stringify(body) }),
  })

const codeFor = (email) => sent.findLast((m) => m.to === email)?.code

test('el stage viene del API y avanza verify -> onboarding -> ready', async () => {
  const account = { email: 'stage@nexgen.mx', password: 'supersecreta1', name: 'Omar' }
  const { user, token } = await (await call('POST', '/auth/register', { body: account })).json()
  assert.equal(user.stage, 'verify', 'recien registrado le falta el correo')

  const verified = await (
    await call('POST', '/auth/verify', { body: { code: codeFor(account.email) }, token })
  ).json()
  assert.equal(verified.user.stage, 'onboarding', 'verificado pero sin perfil')

  const done = await (
    await call('PATCH', '/me/profile', {
      body: { diagnosis: 'combined', focusAreas: ['work'] },
      token: verified.token,
    })
  ).json()
  assert.equal(done.user.stage, 'ready')

  const me = await (await call('GET', '/me', { token: verified.token })).json()
  assert.equal(me.user.stage, 'ready', 'GET /me devuelve el mismo stage')
})

test('sin verificar el correo no pasa a la app', async () => {
  const account = { email: 'bloqueado@nexgen.mx', password: 'supersecreta1', name: 'Ana' }
  const { token } = await (await call('POST', '/auth/register', { body: account })).json()

  for (const [method, path] of [
    ['GET', '/tasks'],
    ['POST', '/tasks'],
    ['GET', '/me/today'],
    ['PATCH', '/me/profile'],
    ['POST', '/me/devices'],
  ]) {
    const res = await call(method, path, { token, body: { title: 'x' } })
    assert.equal(res.status, 403, `${method} ${path} deberia bloquear a los sin verificar`)
  }

  // GET /me queda abierto: es de donde la app saca en que paso va.
  assert.equal((await call('GET', '/me', { token })).status, 200)
})

test('entrar con Google deja la cuenta verificada, sin pasar por el OTP', async () => {
  const idToken = JSON.stringify({ email: 'porgoogle@nexgen.mx', name: 'Por Google' })

  const { user, token } = await (await call('POST', '/auth/google', { body: { idToken } })).json()
  assert.equal(user.emailVerified, true, 'el proveedor ya verifico el correo')
  assert.equal(user.stage, 'onboarding', 'cae directo en onboarding, no en verify')
  assert.equal(codeFor('porgoogle@nexgen.mx'), undefined, 'no se le manda codigo')

  // Y el token que emite ya sirve para entrar a la app.
  assert.equal((await call('GET', '/me/today', { token })).status, 200)
})

test('entrar con Apple deja la cuenta verificada', async () => {
  const idToken = JSON.stringify({ email: 'porapple@nexgen.mx', name: 'Por Apple' })
  const { user } = await (await call('POST', '/auth/apple', { body: { idToken } })).json()
  assert.equal(user.emailVerified, true)
  assert.equal(user.stage, 'onboarding')
})

test('re-registrarse con el codigo aun vivo no cobra 429', async () => {
  const account = { email: 'reintento@nexgen.mx', password: 'supersecreta1', name: 'Leo' }

  const first = await call('POST', '/auth/register', { body: account })
  assert.equal(first.status, 201)
  const codigo = codeFor(account.email)

  // Cerro la app en la pantalla del codigo y volvio a registrarse: debe poder, con el
  // mismo codigo que ya tiene en la bandeja.
  const second = await call('POST', '/auth/register', { body: account })
  assert.equal(second.status, 201, 'volver a registrarse dentro del cooldown no debe fallar')
  assert.equal(codeFor(account.email), codigo, 'no se manda un codigo nuevo, el viejo sigue vivo')

  const { token } = await second.json()
  const ok = await call('POST', '/auth/verify', { body: { code: codigo }, token })
  assert.equal(ok.status, 200, 'el codigo original sigue sirviendo')
})

test('el reenvio explicito si respeta el cooldown', async () => {
  const account = { email: 'cooldown@nexgen.mx', password: 'supersecreta1', name: 'Sam' }
  const { token } = await (await call('POST', '/auth/register', { body: account })).json()

  const res = await call('POST', '/auth/resend', { token })
  assert.equal(res.status, 429, 'pedirlo a mano justo despues del registro espera el cooldown')
})
