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

test('reminderHour es un entero de 0 a 23 y sobrevive a un parche de otro campo', async () => {
  const token = await verifiedToken('hora@nexgen.mx')

  // Con el default puesto desde el registro ya hay a que hora agendar el aviso diario.
  const me = await call(url, 'GET', '/me', { token })
  assert.equal((await me.json()).user.reminderHour, 9)

  for (const reminderHour of [
    '9', // el valor del control sin parsear: si pasara, la app nunca se enteraria
    '09',
    9.5, // media hora no se agenda
    -1,
    24, // la hora 24 no existe: es la 0 del dia siguiente
    100,
    null, // no borra: sin hora no hay recordatorio
    true,
    '',
    [9],
  ]) {
    const res = await call(url, 'PATCH', '/me/profile', { token, body: { reminderHour } })
    assert.equal(res.status, 400, `${JSON.stringify(reminderHour)} deberia rechazarse`)
    assert.ok((await res.json()).fields.reminderHour, 'el error va en fields.reminderHour')
  }

  // Los extremos son horas de verdad: 0 es medianoche y 23 las once de la noche.
  for (const hour of [0, 23, 21]) {
    const ok = await call(url, 'PATCH', '/me/profile', { token, body: { reminderHour: hour } })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).user.reminderHour, hour)
  }

  const untouched = await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: 'clay' } })
  assert.equal((await untouched.json()).user.reminderHour, 21, 'un PATCH parcial no la regresa al default')
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

test('el avatar guarda el memoji, lo borra con null y sobrevive a un parche de otro campo', async () => {
  const token = await verifiedToken('avatar@nexgen.mx')

  // Nace sin avatar: null es "no eligio cara", y la app pinta la inicial del nombre.
  const nuevo = await call(url, 'GET', '/me', { token })
  assert.equal((await nuevo.json()).user.avatar, null)

  for (const avatar of [
    'memoji-7', // sin padding: la app siempre manda dos digitos
    'memoji-007',
    'Memoji-07', // el nombre del archivo va en minusculas
    'memoji_07',
    '../assets/memoji-07', // el identificador nunca es una ruta
    'https://x/memoji-07.webp',
    'memoji-07.webp', // la extension es cosa del bundle, no del dato
    'memoji-ab',
    7,
    ['memoji-07'],
    '',
  ]) {
    const res = await call(url, 'PATCH', '/me/profile', { token, body: { avatar } })
    assert.equal(res.status, 400, `${JSON.stringify(avatar)} deberia rechazarse`)
    assert.ok((await res.json()).fields.avatar, 'el error va en fields.avatar')
  }

  const ok = await call(url, 'PATCH', '/me/profile', { token, body: { avatar: 'memoji-07' } })
  assert.equal((await ok.json()).user.avatar, 'memoji-07')

  /*
    Una cara que existe en el bundle pero NO en el producto se rechaza con 400.

    Este assert es el que cambio de signo cuando las caras pasaron a ganarse: antes decia que
    memoji-45 entraba, porque el catalogo vivia del lado del cliente. Ahora el catalogo es permiso, y
    de las cuarenta y cinco del bundle el producto solo ofrece veintitres.
  */
  const reserva = await call(url, 'PATCH', '/me/profile', { token, body: { avatar: 'memoji-45' } })
  assert.equal(reserva.status, 400)
  assert.ok((await reserva.json()).fields.avatar)

  // Una de las que se ganan da 403 y no 400: existe, pero no es suya. Los datos estan bien; lo que
  // falta es el logro.
  const ajena = await call(url, 'PATCH', '/me/profile', { token, body: { avatar: 'memoji-09' } })
  assert.equal(ajena.status, 403)

  // Un parche de otro campo no lo mueve, y persiste en una lectura nueva.
  await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: 'clay' } })
  const me = await call(url, 'GET', '/me', { token })
  assert.equal((await me.json()).user.avatar, 'memoji-07', 'el avatar persiste entre peticiones')

  // null lo borra: volver a la inicial es una eleccion tan valida como elegir cara.
  const borrado = await call(url, 'PATCH', '/me/profile', { token, body: { avatar: null } })
  assert.equal((await borrado.json()).user.avatar, null)
})

test('el acento admite un color propio en hex, y SOBREVIVE a la relectura', async () => {
  const token = await verifiedToken('hex-acento@nexgen.mx')

  // Uno de los seis nombres nuevos: ensanchar el catalogo no rompe nada.
  const nombrado = await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: 'lilac' } })
  assert.equal(nombrado.status, 200)
  assert.equal((await nombrado.json()).user.accentColor, 'lilac')

  /*
    Y el hex de la opcion "Otro". La segunda mitad de este test es la que importa: el filtro de
    lectura de `toPublicUser` existia para que un nombre retirado no llegara a la app, y con un hex
    devolvia 'olive' en cada GET — el color se guardaba, la app lo pintaba optimista, y a la primera
    recarga volvia al verde sin decir nada.
  */
  const propio = await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: '#c17f86' } })
  assert.equal(propio.status, 200)
  assert.equal((await propio.json()).user.accentColor, '#c17f86', 'al escribir')

  const releido = await call(url, 'GET', '/me', { token })
  assert.equal((await releido.json()).user.accentColor, '#c17f86', 'y al LEER, que es donde fallaba')
})

test('lo que no es ni nombre ni hex se sigue rechazando', async () => {
  const token = await verifiedToken('hex-malo@nexgen.mx')

  for (const malo of ['rojo', '#ff', '#gggggg', 'rgb(1,2,3)', '#FF00AA ']) {
    const res = await call(url, 'PATCH', '/me/profile', { token, body: { accentColor: malo } })
    assert.equal(res.status, 400, `"${malo}" no deberia pasar`)
    assert.ok((await res.json()).fields.accentColor)
  }
})
