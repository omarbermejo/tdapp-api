import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-recovery.db'
const EXPIRED_DB = 'test-recovery-expirado.db'
await freshDb(DB)
await freshDb(EXPIRED_DB)

const { buildApp } = await import('../src/composition.js')
const identity = { verify: async (idToken, name) => ({ ...JSON.parse(idToken), ...(name && { name }) }) }

const mail = codeMailer()
const main = buildApp({
  dbPath: DB,
  jwtSecret: 'test-secret',
  google: identity,
  apple: identity,
  mailer: mail.mailer,
})
const mainServer = main.app.listen(0)
const url = `http://localhost:${mainServer.address().port}`

// Segunda app con reglas imposibles: el codigo nace vencido y no hay cooldown. Es como se prueban
// expiracion y reenvio sin un solo setTimeout (mismo truco que tests/onboarding.test.js).
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
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

const PASSWORD = 'supersecreta1'
const NEW_PASSWORD = 'otradistinta9'

/**
 * Un correo distinto por test: FORGOT_POLICY cuenta por correo con ventana de 15 minutos, y
 * compartir uno haria que el orden de los tests decidiera quien recibe el 429.
 */
const register = async (base, email) => {
  const res = await call(base, 'POST', '/auth/register', { body: { email, password: PASSWORD, name: 'Omar' } })
  assert.equal(res.status, 201)
  return res.json()
}

test('un correo sin cuenta recibe 202 y no dispara ningun correo', async () => {
  const before = mail.sent.length
  const res = await call(url, 'POST', '/auth/forgot', { body: { email: 'nadie@nexgen.mx' } })
  assert.equal(res.status, 202)
  assert.equal(mail.sent.length, before, 'no salio nada')
})

test('una cuenta de Google recibe 202 y tampoco dispara correo', async () => {
  const login = await call(url, 'POST', '/auth/google', {
    body: { idToken: JSON.stringify({ email: 'conguugle@nexgen.mx', name: 'Omar', emailVerified: true }) },
  })
  assert.equal(login.status, 200)

  const before = mail.sent.length
  const res = await call(url, 'POST', '/auth/forgot', { body: { email: 'conguugle@nexgen.mx' } })
  assert.equal(res.status, 202, 'mismo 202: decir "esa cuenta es de Google" confirmaria que existe')
  assert.equal(mail.sent.length, before)
})

test('una cuenta real recibe el codigo, marcado como password_reset', async () => {
  await register(url, 'real@nexgen.mx')
  const before = mail.sent.length

  const res = await call(url, 'POST', '/auth/forgot', { body: { email: 'real@nexgen.mx' } })
  assert.equal(res.status, 202)
  assert.equal(mail.sent.length, before + 1)
  assert.equal(mail.sent.at(-1).purpose, 'password_reset')
  assert.match(mail.lastCode(), /^\d{6}$/)
})

/**
 * Sin skipIfActive esto seria un 429, y un 429 solo puede salir de una cuenta que existe: el
 * endpoint se convertiria en el buscador de correos que el 202 esta evitando.
 */
test('pedirlo dos veces seguidas sigue siendo 202 y no manda un segundo correo', async () => {
  await register(url, 'dosveces@nexgen.mx')
  assert.equal((await call(url, 'POST', '/auth/forgot', { body: { email: 'dosveces@nexgen.mx' } })).status, 202)
  const after = mail.sent.length

  const res = await call(url, 'POST', '/auth/forgot', { body: { email: 'dosveces@nexgen.mx' } })
  assert.equal(res.status, 202)
  assert.equal(mail.sent.length, after, 'el codigo que ya tiene en la bandeja sirve')
})

/** El PK compuesto (user_id, purpose) haciendo su trabajo: dos codigos vivos que no se pisan. */
test('los dos propositos conviven y no se pueden intercambiar', async () => {
  await register(url, 'dospropositos@nexgen.mx')
  const verifyCode = mail.lastCode()

  assert.equal(
    (await call(url, 'POST', '/auth/forgot', { body: { email: 'dospropositos@nexgen.mx' } })).status,
    202
  )
  const resetCode = mail.lastCode()
  assert.notEqual(verifyCode, resetCode)

  // El de verificar no sirve para resetear.
  const wrong = await call(url, 'POST', '/auth/reset', {
    body: { email: 'dospropositos@nexgen.mx', code: verifyCode, password: NEW_PASSWORD },
  })
  assert.equal(wrong.status, 400)
  assert.match((await wrong.json()).fields.code, /codigo/)

  // El de resetear si.
  const right = await call(url, 'POST', '/auth/reset', {
    body: { email: 'dospropositos@nexgen.mx', code: resetCode, password: NEW_PASSWORD },
  })
  assert.equal(right.status, 200)
})

test('/reset con un correo sin cuenta da 400 con fields.code, nunca 404', async () => {
  const res = await call(url, 'POST', '/auth/reset', {
    body: { email: 'nadie2@nexgen.mx', code: '123456', password: NEW_PASSWORD },
  })
  assert.equal(res.status, 400, 'un 404 aqui volveria a delatar que correos existen')
  assert.ok((await res.json()).fields.code)
})

/** Validar la contraseña primero es lo que evita que un dedazo queme el codigo. */
test('una contraseña corta no quema el codigo', async () => {
  await register(url, 'cortita@nexgen.mx')
  assert.equal((await call(url, 'POST', '/auth/forgot', { body: { email: 'cortita@nexgen.mx' } })).status, 202)
  const code = mail.lastCode()

  const short = await call(url, 'POST', '/auth/reset', {
    body: { email: 'cortita@nexgen.mx', code, password: 'corta' },
  })
  assert.equal(short.status, 400)
  assert.ok((await short.json()).fields.password)

  // El mismo codigo sigue sirviendo.
  const good = await call(url, 'POST', '/auth/reset', {
    body: { email: 'cortita@nexgen.mx', code, password: NEW_PASSWORD },
  })
  assert.equal(good.status, 200)
})

test('resetear deja la cuenta verificada, cambia la contraseña y devuelve sesion', async () => {
  const { user } = await register(url, 'completo@nexgen.mx')
  assert.equal(user.emailVerified, false, 'nace sin verificar')

  assert.equal((await call(url, 'POST', '/auth/forgot', { body: { email: 'completo@nexgen.mx' } })).status, 202)
  const res = await call(url, 'POST', '/auth/reset', {
    body: { email: 'completo@nexgen.mx', code: mail.lastCode(), password: NEW_PASSWORD },
  })
  assert.equal(res.status, 200)

  const session = await res.json()
  assert.ok(session.token)
  // El codigo llego a ese buzon y volvio escrito: eso ES la verificacion. Sin esto, quien recupera
  // su contraseña saldria a la pantalla del codigo a demostrar otra vez lo que acaba de demostrar.
  assert.equal(session.user.emailVerified, true)
  assert.equal(session.user.password ?? session.user.passwordHash, undefined, 'nunca se filtra el hash')

  // Y el token sirve de verdad, no solo viene en el JSON.
  assert.equal((await call(url, 'GET', '/tasks', { token: session.token })).status, 200)

  const old = await call(url, 'POST', '/auth/login', { body: { email: 'completo@nexgen.mx', password: PASSWORD } })
  assert.equal(old.status, 401, 'la contraseña vieja ya no entra')
  const fresh = await call(url, 'POST', '/auth/login', {
    body: { email: 'completo@nexgen.mx', password: NEW_PASSWORD },
  })
  assert.equal(fresh.status, 200)
})

test('cinco codigos malos queman el intento y piden uno nuevo', async () => {
  await register(url, 'quemado@nexgen.mx')
  assert.equal((await call(url, 'POST', '/auth/forgot', { body: { email: 'quemado@nexgen.mx' } })).status, 202)

  const bad = () =>
    call(url, 'POST', '/auth/reset', {
      body: { email: 'quemado@nexgen.mx', code: '000000', password: NEW_PASSWORD },
    })

  for (let i = 0; i < 4; i++) assert.equal((await bad()).status, 400)
  const last = await bad()
  assert.equal(last.status, 400)
  assert.match((await last.json()).fields.code, /Muchos intentos/)
})

/** En la app de reglas imposibles el codigo nace vencido y el cooldown es cero. */
test('un codigo vencido se rechaza y se puede pedir otro sin esperar', async () => {
  await register(expiredUrl, 'vencido@nexgen.mx')
  assert.equal(
    (await call(expiredUrl, 'POST', '/auth/forgot', { body: { email: 'vencido@nexgen.mx' } })).status,
    202
  )
  const before = expiredMail.sent.length

  const dead = await call(expiredUrl, 'POST', '/auth/reset', {
    body: { email: 'vencido@nexgen.mx', code: expiredMail.lastCode(), password: NEW_PASSWORD },
  })
  assert.equal(dead.status, 400)
  assert.match((await dead.json()).fields.code, /vencio/)

  // Sin cooldown y con el anterior ya borrado, el siguiente /forgot si manda otro correo.
  assert.equal(
    (await call(expiredUrl, 'POST', '/auth/forgot', { body: { email: 'vencido@nexgen.mx' } })).status,
    202
  )
  assert.equal(expiredMail.sent.length, before + 1)
})

/**
 * El limitador frena por correo aunque la cuenta no exista. Si solo frenara a las reales, el propio
 * 429 seria el buscador de correos que el 202 esta evitando.
 */
test('el sexto /forgot seguido es 429, exista o no la cuenta', async () => {
  const body = { email: 'inundado@nexgen.mx' }
  for (let i = 0; i < 5; i++) {
    assert.equal((await call(url, 'POST', '/auth/forgot', { body })).status, 202, `intento ${i + 1}`)
  }

  const res = await call(url, 'POST', '/auth/forgot', { body })
  assert.equal(res.status, 429)
  assert.match((await res.json()).error, /Espera/)
})
