import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-onboarding.db'
const EXPIRED_DB = 'test-onboarding-expirado.db'
await freshDb(DB)
await freshDb(EXPIRED_DB)

const { buildApp } = await import('../src/composition.js')

const mail = codeMailer()
const main = buildApp({ dbPath: DB, jwtSecret: 'test-secret', mailer: mail.mailer })
const mainServer = main.app.listen(0)
const url = `http://localhost:${mainServer.address().port}`

// Segunda app con reglas imposibles: el codigo nace vencido y no hay cooldown.
// Asi se prueban expiracion y reenvio sin un solo setTimeout.
const expiredMail = codeMailer()
const expired = buildApp({
  dbPath: EXPIRED_DB,
  jwtSecret: 'test-secret',
  mailer: expiredMail.mailer,
  otp: { ttlMinutes: -1, resendCooldownSeconds: 0 },
})
const expiredServer = expired.app.listen(0)
const expiredUrl = `http://localhost:${expiredServer.address().port}`

after(() => {
  mainServer.close()
  main.close()
  expiredServer.close()
  expired.close()
  dropDb(DB)
  dropDb(EXPIRED_DB)
})

const call = (base, method, path, { body, token } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  })

let pending

before(async () => {
  const res = await call(url, 'POST', '/auth/register', {
    body: { email: 'nuevo@nexgen.mx', password: 'supersecreta1', name: 'Nuevo' },
  })
  pending = (await res.json()).token
})

test('el token sin verificar solo abre /me, verify y resend', async () => {
  assert.equal((await call(url, 'GET', '/me', { token: pending })).status, 200)
  assert.equal((await call(url, 'GET', '/tasks', { token: pending })).status, 403)
  assert.equal((await call(url, 'GET', '/me/today', { token: pending })).status, 403)
  assert.equal((await call(url, 'POST', '/me/devices', { token: pending, body: {} })).status, 403)
  assert.equal(
    (await call(url, 'PATCH', '/me/profile', { token: pending, body: { accentColor: 'clay' } })).status,
    403
  )
})

test('un codigo mal formado no consume intento', async () => {
  for (const code of ['123', 'abcdef', '', null]) {
    const res = await call(url, 'POST', '/auth/verify', { token: pending, body: { code } })
    assert.equal(res.status, 400)
    assert.ok((await res.json()).fields.code)
  }

  const ok = await call(url, 'POST', '/auth/verify', { token: pending, body: { code: mail.lastCode() } })
  assert.equal(ok.status, 200, 'los 5 intentos siguen intactos')
})

test('el codigo equivocado gasta intentos y a los 5 pide uno nuevo', async () => {
  const res = await call(url, 'POST', '/auth/register', {
    body: { email: 'intentos@nexgen.mx', password: 'supersecreta1', name: 'Intentos' },
  })
  const token = (await res.json()).token
  const real = mail.lastCode()
  const wrong = real === '000000' ? '111111' : '000000'

  for (let i = 1; i <= 5; i++) {
    const bad = await call(url, 'POST', '/auth/verify', { token, body: { code: wrong } })
    assert.equal(bad.status, 400)
    assert.match((await bad.json()).fields.code, i < 5 ? /no es/ : /Muchos intentos/)
  }

  // Ya quemado, ni el codigo bueno pasa: hay que pedir otro.
  const blocked = await call(url, 'POST', '/auth/verify', { token, body: { code: real } })
  assert.equal(blocked.status, 400)
  assert.match((await blocked.json()).fields.code, /Muchos intentos/)
})

test('verificar abre el resto de la API y es idempotente', async () => {
  const res = await call(url, 'POST', '/auth/register', {
    body: { email: 'abre@nexgen.mx', password: 'supersecreta1', name: 'Abre' },
  })
  const first = (await res.json()).token

  const done = await call(url, 'POST', '/auth/verify', { token: first, body: { code: mail.lastCode() } })
  assert.equal(done.status, 200)
  const { token, user } = await done.json()
  assert.equal(user.emailVerified, true)
  assert.equal((await call(url, 'GET', '/tasks', { token })).status, 200)

  // Un reintento devuelve token fresco en vez de trabar la app.
  const again = await call(url, 'POST', '/auth/verify', { token, body: { code: '000000' } })
  assert.equal(again.status, 200)
  assert.equal((await again.json()).user.emailVerified, true)
})

test('el reenvio tiene cooldown y no aplica a cuentas verificadas', async () => {
  const res = await call(url, 'POST', '/auth/register', {
    body: { email: 'reenvio@nexgen.mx', password: 'supersecreta1', name: 'Reenvio' },
  })
  const token = (await res.json()).token

  // El codigo del registro acaba de salir, asi que el primer reenvio ya cae en el cooldown.
  const tooSoon = await call(url, 'POST', '/auth/resend', { token })
  assert.equal(tooSoon.status, 429)

  await call(url, 'POST', '/auth/verify', { token, body: { code: mail.lastCode() } })
  const verifiedToken = (
    await (await call(url, 'POST', '/auth/login', { body: { email: 'reenvio@nexgen.mx', password: 'supersecreta1' } })).json()
  ).token
  assert.equal((await call(url, 'POST', '/auth/resend', { token: verifiedToken })).status, 409)
})

test('un codigo vencido se rechaza y el reenvio manda otro', async () => {
  const res = await call(expiredUrl, 'POST', '/auth/register', {
    body: { email: 'vencido@nexgen.mx', password: 'supersecreta1', name: 'Vencido' },
  })
  const token = (await res.json()).token

  const dead = await call(expiredUrl, 'POST', '/auth/verify', { token, body: { code: expiredMail.lastCode() } })
  assert.equal(dead.status, 400)
  assert.match((await dead.json()).fields.code, /vencio/)

  // Sin cooldown el reenvio pasa, y el codigo nuevo tambien nace vencido en esta app.
  assert.equal((await call(expiredUrl, 'POST', '/auth/resend', { token })).status, 202)
  assert.equal(expiredMail.sent.length, 2)
})

/** Registra, verifica y devuelve el token listo para tocar /me/profile. */
async function verifiedToken(email) {
  const res = await call(url, 'POST', '/auth/register', {
    body: { email, password: 'supersecreta1', name: 'Perfil' },
  })
  const verified = await call(url, 'POST', '/auth/verify', {
    token: (await res.json()).token,
    body: { code: mail.lastCode() },
  })
  return (await verified.json()).token
}

test('birthDate exige una fecha real en ISO y una edad posible', async () => {
  const token = await verifiedToken('fecha@nexgen.mx')

  for (const birthDate of [
    '17/03/1995', // formato de la app, no ISO
    '1995-3-7', // sin ceros
    '1995-03-17T00:00:00Z', // fecha con hora
    '2026-02-31', // dia que no existe: Date lo correria a marzo
    '2026-13-01', // mes que no existe
    '1919-12-31', // antes del limite
    '2026-01-01', // menor de 5 anos
    1995, // el ano suelto ya no vale
    '',
  ]) {
    const res = await call(url, 'PATCH', '/me/profile', { token, body: { birthDate } })
    assert.equal(res.status, 400, `${birthDate} deberia rechazarse`)
    assert.ok((await res.json()).fields.birthDate, 'el error va en fields.birthDate')
  }

  const ok = await call(url, 'PATCH', '/me/profile', { token, body: { birthDate: '1995-02-28' } })
  assert.equal((await ok.json()).user.birthDate, '1995-02-28')

  // 29 de febrero de un ano bisiesto es fecha real y tiene que pasar.
  const leap = await call(url, 'PATCH', '/me/profile', { token, body: { birthDate: '1996-02-29' } })
  assert.equal((await leap.json()).user.birthDate, '1996-02-29')

  // null la borra; no mandarla no la toca.
  const cleared = await call(url, 'PATCH', '/me/profile', { token, body: { birthDate: null } })
  assert.equal((await cleared.json()).user.birthDate, null)

  const untouched = await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: 'clay' } })
  assert.equal((await untouched.json()).user.birthDate, null)
})

test('PATCH /me/profile valida, mergea y sella onboarded_at una sola vez', async () => {
  const token = await verifiedToken('perfil@nexgen.mx')

  const invalid = await call(url, 'PATCH', '/me/profile', { token, body: { focusAreas: ['ocio'] } })
  assert.equal(invalid.status, 400)
  assert.ok((await invalid.json()).fields.focusAreas)

  const tooMany = await call(url, 'PATCH', '/me/profile', {
    token,
    body: { focusAreas: ['work', 'study', 'home', 'health'] },
  })
  assert.equal(tooMany.status, 400)

  const first = await call(url, 'PATCH', '/me/profile', {
    token,
    body: { focusAreas: ['work'], accentColor: 'copper', peakEnergy: 'morning' },
  })
  const saved = (await first.json()).user
  assert.deepEqual(saved.focusAreas, ['work'])
  assert.ok(saved.onboardedAt)

  // Un PATCH parcial no borra lo demas ni mueve la fecha de onboarding.
  const second = await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: 'forest' } })
  const merged = (await second.json()).user
  assert.equal(merged.accentColor, 'forest')
  assert.equal(merged.peakEnergy, 'morning', 'lo que no viene en el parche se conserva')
  assert.deepEqual(merged.focusAreas, ['work'])
  assert.equal(merged.onboardedAt, saved.onboardedAt)
})
