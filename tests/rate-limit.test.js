import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { LOGIN_POLICY, createLimiter } from '../src/domain/rate-limit.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-rate-limit.db'
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

const login = (email, password) => call('POST', '/auth/login', { body: { email, password } })

before(async () => {
  const res = await call('POST', '/auth/register', {
    body: { email: 'freno@nexgen.mx', password: 'supersecreta1', name: 'Omar' },
  })
  const { token } = await res.json()
  await call('POST', '/auth/verify', { body: { code: mail.lastCode() }, token })
})

// --- la politica, pura ---------------------------------------------------------------------------

test('la politica deja pasar hasta `tries` y frena el siguiente', () => {
  const limiter = createLimiter({ tries: 3, windowMs: 1000 })
  assert.equal(limiter.hit('k', 0), false, '1o pasa')
  assert.equal(limiter.hit('k', 1), false, '2o pasa')
  assert.equal(limiter.hit('k', 2), false, '3o pasa: es el limite exacto')
  assert.equal(limiter.hit('k', 3), true, '4o frena')
})

test('la ventana DESLIZA: no se perdona todo de golpe al cambiar de cubo', () => {
  const limiter = createLimiter({ tries: 2, windowMs: 100 })
  limiter.hit('k', 0)
  limiter.hit('k', 50)
  assert.equal(limiter.hit('k', 60), true, 'frenado')
  // A los 101ms el primero (t=0) ya cayo de la ventana, pero el de t=50 sigue dentro.
  assert.equal(limiter.count('k', 101), 2, 'quedan los de 50 y 60, no cero')
})

test('pasada la ventana entera se olvida todo', () => {
  const limiter = createLimiter({ tries: 2, windowMs: 100 })
  limiter.hit('k', 0)
  limiter.hit('k', 1)
  assert.equal(limiter.hit('k', 2), true)
  assert.equal(limiter.hit('k', 500), false, 'ventana nueva, cuenta limpia')
})

test('las claves no se pisan entre si', () => {
  const limiter = createLimiter({ tries: 1, windowMs: 1000 })
  limiter.hit('a', 0)
  assert.equal(limiter.hit('a', 1), true)
  assert.equal(limiter.hit('b', 1), false, 'la clave b arranca de cero')
})

test('clear olvida una clave: entrar bien no debe arrastrar los fallos', () => {
  const limiter = createLimiter({ tries: 2, windowMs: 1000 })
  limiter.hit('k', 0)
  limiter.hit('k', 1)
  limiter.clear('k')
  assert.equal(limiter.count('k', 2), 0)
  assert.equal(limiter.hit('k', 2), false)
})

test('el limitador no crece sin techo (seria el propio agujero)', () => {
  const limiter = createLimiter({ tries: 1, windowMs: 60_000 })
  // Muchas mas claves que el techo, como un atacante rotando IPs.
  for (let i = 0; i < 12_000; i++) limiter.hit(`ip:${i}`, i)
  assert.ok(limiter.size <= 10_000, `se quedo en ${limiter.size}, deberia topar en 10000`)
})

test('la politica de login es 8 intentos por 10 minutos', () => {
  assert.equal(LOGIN_POLICY.tries, 8)
  assert.equal(LOGIN_POLICY.windowMs, 10 * 60_000)
})

// --- el endpoint --------------------------------------------------------------------------------

test('/auth/login frena tras 8 intentos fallidos y contesta 429', async () => {
  // Los 8 primeros son 401 (credenciales malas), no 429.
  for (let i = 0; i < LOGIN_POLICY.tries; i++) {
    const res = await login('freno@nexgen.mx', 'incorrecta')
    assert.equal(res.status, 401, `intento ${i + 1} deberia ser 401`)
  }

  const frenado = await login('freno@nexgen.mx', 'incorrecta')
  assert.equal(frenado.status, 429, 'el noveno se frena')
  const body = await frenado.json()
  assert.match(body.error, /Espera unos minutos/)
  // Sin filtrar cual limite salto ni cuanto queda: eso le diria al atacante como afinar.
  assert.ok(!/ip|correo|email|segundo/i.test(body.error), 'el mensaje no da pistas')
})

test('la contraseña BUENA tampoco pasa mientras esta frenado', async () => {
  // El limite va antes del caso de uso, asi que ni llega a comparar el hash.
  const res = await login('freno@nexgen.mx', 'supersecreta1')
  assert.equal(res.status, 429)
})

test('el freno es por correo, no solo por IP', async () => {
  // Otra cuenta desde la MISMA IP: si el limite fuera solo por correo, esta pasaria. Como tambien
  // cuenta por IP y esa IP ya se paso, se frena igual — que es lo correcto.
  const res = await login('otro-sin-registrar@nexgen.mx', 'lo-que-sea')
  assert.equal(res.status, 429, 'la IP ya esta frenada')
})

test('el resto de /auth sigue abierto: el freno es solo del login', async () => {
  // Registrarse no se limita: el coste de una cuenta nueva ya lo pone la verificacion por correo.
  const res = await call('POST', '/auth/register', {
    body: { email: 'nuevo@nexgen.mx', password: 'supersecreta1', name: 'Ana' },
  })
  assert.equal(res.status, 201)
  assert.equal((await call('GET', '/auth/catalogs')).status, 200)
})
