import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { INVITE_ALPHABET, INVITE_CODE, normalizeInviteCode } from '../src/domain/invite.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-invites.db'
await freshDb(DB)

const { buildApp } = await import('../src/composition.js')
const mail = codeMailer()

/** El mailer falso solo sabe de codigos OTP; se le añade el gemelo de invitaciones para espiarlo. */
const sent = []
const mailer = {
  ...mail.mailer,
  async sendInvite(payload) {
    sent.push(payload)
  },
}

const { app, close } = buildApp({ dbPath: DB, jwtSecret: 'test-secret', mailer })
const server = app.listen(0)
const url = `http://localhost:${server.address().port}`

after(() => {
  server.close()
  close()
  dropDb(DB)
})

let omar
let ana

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

const json = async (res) => [res.status, await res.json()]

const makeSpace = async (name, token = omar) =>
  (await (await call('POST', '/workspaces', { body: { name, icon: 'work' }, token })).json()).workspace

const invite = async (workspaceId, body = {}, token = omar) =>
  (await (await call('POST', `/workspaces/${workspaceId}/invites`, { body, token })).json()).invite

/**
 * El dueño aprueba una solicitud. Es el segundo tiempo de entrar con un codigo ABIERTO.
 *
 * Existe porque `POST /join` con un codigo abierto ya no mete a nadie: deja una solicitud. Un codigo
 * atado a un correo si entra directo, y por eso varios tests de aqui usan `{ email }`.
 */
const approve = async (workspaceId, personId, ok = true, token = omar) =>
  call('POST', `/workspaces/${workspaceId}/requests/${personId}`, { body: { approve: ok }, token })

/** El id de una cuenta, leyendo su propio perfil. Los tests solo tienen tokens. */
const idOf = async (token) => (await (await call('GET', '/me', { token })).json()).user.id

before(async () => {
  omar = await signUp('inv-omar@nexgen.mx', 'Omar')
  ana = await signUp('inv-ana@nexgen.mx', 'Ana')
})

// --- dominio puro ------------------------------------------------------------------------------

test('el alfabeto no tiene las letras que se confunden al dictar', () => {
  for (const confusa of ['I', 'L', 'O', 'U']) {
    assert.ok(!INVITE_ALPHABET.includes(confusa), `${confusa} se confunde y no debe estar`)
  }
  assert.equal(INVITE_ALPHABET.length, 32, 'base32: 32^6 son mil millones de combinaciones')
})

test('normalizar arregla lo que la gente teclea de verdad', () => {
  assert.equal(normalizeInviteCode(' abc-123 '), 'ABC123', 'minusculas, guiones y espacios')
  assert.equal(normalizeInviteCode('OI L23'), '0112 3'.replace(' ', ''), 'O->0 e I/L->1')
  assert.equal(normalizeInviteCode(null), '', 'nada no revienta')
})

// --- crear -------------------------------------------------------------------------------------

test('crear devuelve un codigo del alfabeto y con la forma esperada', async () => {
  const space = await makeSpace('Con codigo')
  const [status, body] = await json(await call('POST', `/workspaces/${space.id}/invites`, { token: omar }))
  assert.equal(status, 201)
  assert.match(body.invite.code, INVITE_CODE)
  assert.equal(body.invite.email, null, 'un codigo abierto no lleva correo atado')
})

test('invitar por correo manda UN correo, y reinvitar no crea otro codigo', async () => {
  const space = await makeSpace('Por correo')
  sent.length = 0

  const primera = await invite(space.id, { email: 'inv-ana@nexgen.mx' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'inv-ana@nexgen.mx')
  assert.equal(sent[0].code, primera.code)
  assert.equal(sent[0].workspace, 'Por correo')

  // Volver a invitar al mismo correo devuelve el codigo que ya existe: dos vivos para la misma
  // persona no sirven de nada y hacen ambiguo revocar "el suyo".
  const [, body] = await json(
    await call('POST', `/workspaces/${space.id}/invites`, {
      body: { email: 'inv-ana@nexgen.mx' },
      token: omar,
    })
  )
  assert.equal(body.invite.code, primera.code)
  assert.equal(body.resent, true)
})

test('un correo mal escrito se rechaza antes de crear nada', async () => {
  const space = await makeSpace('Correo malo')
  const res = await call('POST', `/workspaces/${space.id}/invites`, {
    body: { email: 'no-es-un-correo' },
    token: omar,
  })
  assert.equal(res.status, 400)
})

test('invitar y listar son del DUEÑO: un miembro recibe 404', async () => {
  const space = await makeSpace('Solo el dueño')
  // Ana entra de verdad, por la puerta. Con un codigo NOMINAL: aqui lo que se prueba es el permiso
  // del miembro, no la aprobacion — un codigo abierto obligaria a aprobar antes de llegar al grano.
  const abierta = await invite(space.id, { email: 'inv-ana@nexgen.mx' })
  await call('POST', '/workspaces/join', { body: { code: abierta.code }, token: ana })

  assert.equal((await call('POST', `/workspaces/${space.id}/invites`, { token: ana })).status, 404)
  assert.equal((await call('GET', `/workspaces/${space.id}/invites`, { token: ana })).status, 404)
  // Pero SI puede ver con quien trabaja.
  assert.equal((await call('GET', `/workspaces/${space.id}/members`, { token: ana })).status, 200)
})

// --- aceptar -----------------------------------------------------------------------------------

test('un codigo ABIERTO deja una solicitud, y aprobarla mete al miembro y CONSUME el codigo', async () => {
  const space = await makeSpace('Se consume')
  const code = (await invite(space.id)).code
  const anaId = await idOf(ana)

  // Primer tiempo: pide entrar. Todavia NO es miembro.
  const [status, body] = await json(
    await call('POST', '/workspaces/join', { body: { code }, token: ana })
  )
  assert.equal(status, 200)
  assert.equal(body.workspace.name, 'Se consume')
  assert.equal(body.joined, false, 'un codigo abierto no mete a nadie por si solo')

  const [, antes] = await json(await call('GET', '/workspaces', { token: ana }))
  assert.ok(!antes.workspaces.some((w) => w.id === space.id), 'todavia no esta dentro')

  // El dueño la ve.
  const [, pend] = await json(await call('GET', '/workspaces/requests', { token: omar }))
  assert.ok(pend.requests.some((r) => r.person.id === anaId && r.workspace.id === space.id))

  // Segundo tiempo: aprobar. Ahora si.
  assert.equal((await approve(space.id, anaId)).status, 200)
  const [, mios] = await json(await call('GET', '/workspaces', { token: ana }))
  assert.ok(mios.workspaces.some((w) => w.id === space.id))

  // Y el codigo ya no vale: se consume al APROBAR, no al pedir.
  assert.equal((await call('POST', '/workspaces/join', { body: { code }, token: ana })).status, 404)
})

test('rechazar NO mete a nadie y deja el codigo vivo para otra persona', async () => {
  const space = await makeSpace('Rechaza')
  const code = (await invite(space.id)).code
  const anaId = await idOf(ana)

  await call('POST', '/workspaces/join', { body: { code }, token: ana })
  const [status, body] = await json(await approve(space.id, anaId, false))
  assert.equal(status, 200)
  assert.equal(body.approved, false)

  const [, mios] = await json(await call('GET', '/workspaces', { token: ana }))
  assert.ok(!mios.workspaces.some((w) => w.id === space.id), 'rechazada no entra')

  /*
    El codigo sigue vivo, y eso es a proposito: uno abierto puede tener a varias personas detras, y
    decirle que no a una no puede invalidarlo para las demas.
  */
  const [otra] = await json(await call('POST', '/workspaces/join', { body: { code }, token: ana }))
  assert.equal(otra, 200)
})

test('un codigo con CORREO entra directo: el dueño ya dijo a quien', async () => {
  const space = await makeSpace('Nominal')
  const code = (await invite(space.id, { email: 'inv-ana@nexgen.mx' })).code

  const [status, body] = await json(
    await call('POST', '/workspaces/join', { body: { code }, token: ana })
  )
  assert.equal(status, 200)
  assert.equal(body.joined, true, 'nominal no pasa por aprobacion')

  const [, mios] = await json(await call('GET', '/workspaces', { token: ana }))
  assert.ok(mios.workspaces.some((w) => w.id === space.id))
})

test('un codigo se acepta como lo teclee la gente', async () => {
  const space = await makeSpace('Tecleado')
  const code = (await invite(space.id)).code
  const tercero = await signUp('inv-tercero@nexgen.mx', 'Beto')

  // Minusculas y con un guion en medio: el mismo codigo.
  const raro = `${code.slice(0, 3)}-${code.slice(3)}`.toLowerCase()
  assert.equal(
    (await call('POST', '/workspaces/join', { body: { code: raro }, token: tercero })).status,
    200
  )
})

test('estar ya dentro da 409, no un duplicado', async () => {
  const space = await makeSpace('Repetido')
  // Nominal para estar dentro DE VERDAD: con un codigo abierto la primera llamada solo dejaria una
  // solicitud, y la segunda daria 200 otra vez en vez del conflicto que este test busca.
  const dentro = await invite(space.id, { email: 'inv-ana@nexgen.mx' })
  await call('POST', '/workspaces/join', { body: { code: dentro.code }, token: ana })
  const res = await call('POST', '/workspaces/join', {
    body: { code: (await invite(space.id)).code },
    token: ana,
  })
  assert.equal(res.status, 409)
})

test('un codigo atado a un correo NO lo puede usar otra persona', async () => {
  const space = await makeSpace('Nominal')
  const code = (await invite(space.id, { email: 'inv-ana@nexgen.mx' })).code
  const beto = await signUp('inv-beto@nexgen.mx', 'Beto')

  assert.equal((await call('POST', '/workspaces/join', { body: { code }, token: beto })).status, 403)
  // Y sigue sirviendo para quien era.
  assert.equal((await call('POST', '/workspaces/join', { body: { code }, token: ana })).status, 200)
})

test('un codigo inventado y uno mal formado se distinguen, pero ninguno delata nada', async () => {
  // Mal formado: 400, y ni siquiera toca la base.
  assert.equal((await call('POST', '/workspaces/join', { body: { code: 'xx' }, token: ana })).status, 400)
  // Bien formado pero inexistente: 404 con el MISMO texto que uno vencido.
  const [status, body] = await json(
    await call('POST', '/workspaces/join', { body: { code: 'ZZZZZZ' }, token: ana })
  )
  assert.equal(status, 404)
  assert.match(body.error, /no existe o ya venció/)
})

// --- vista previa ------------------------------------------------------------------------------

test('la vista previa dice de que espacio es SIN consumir el codigo', async () => {
  const space = await makeSpace('Se mira antes')
  const code = (await invite(space.id)).code
  const beto = await signUp('inv-mira@nexgen.mx', 'Beto')

  const [status, body] = await json(
    await call('POST', '/workspaces/join/check', { body: { code }, token: beto })
  )
  assert.equal(status, 200)
  assert.equal(body.workspace.name, 'Se mira antes')
  assert.equal(body.invitedBy.name, 'Omar')
  assert.equal(body.members, 1, 'cuantos son, no quienes son')

  // Lo que NO puede salir: el correo atado, la lista de miembros, nada del perfil de nadie.
  assert.equal(body.email, undefined)
  assert.equal(body.invitedBy.email, undefined, 'toPublicMember son cuatro campos')
  assert.deepEqual(Object.keys(body.invitedBy).sort(), ['accentColor', 'avatar', 'id', 'name'])

  // Y el codigo sigue vivo.
  assert.equal((await call('POST', '/workspaces/join', { body: { code }, token: beto })).status, 200)
})

// --- revocar -----------------------------------------------------------------------------------

test('revocar el codigo de OTRO espacio no lo borra', async () => {
  const mio = await makeSpace('Mio')
  const otro = await makeSpace('Otro')
  const code = (await invite(otro.id)).code

  // Conocer el codigo no basta: la ruta lleva el espacio y el borrado usa los DOS.
  assert.equal((await call('DELETE', `/workspaces/${mio.id}/invites/${code}`, { token: omar })).status, 404)

  // Sigue funcionando.
  const beto = await signUp('inv-revoca@nexgen.mx', 'Beto')
  assert.equal((await call('POST', '/workspaces/join', { body: { code }, token: beto })).status, 200)
})

test('revocar de verdad invalida el codigo', async () => {
  const space = await makeSpace('Se revoca')
  const code = (await invite(space.id)).code
  assert.equal(
    (await call('DELETE', `/workspaces/${space.id}/invites/${code}`, { token: omar })).status,
    204
  )
  const beto = await signUp('inv-revocado@nexgen.mx', 'Beto')
  assert.equal((await call('POST', '/workspaces/join', { body: { code }, token: beto })).status, 404)
})

// --- colaboradores -----------------------------------------------------------------------------

test('"personas con las que trabajaste antes" trae UNA fila por persona, la del espacio con mas tareas', async () => {
  const flojo = await makeSpace('Poco trabajo')
  const fuerte = await makeSpace('Mucho trabajo')
  const co = await signUp('inv-colab@nexgen.mx', 'Colab')

  // Nominales: lo que se prueba es el REPARTO de colaboradores, no la aprobacion.
  for (const space of [flojo, fuerte]) {
    const nominal = await invite(space.id, { email: 'inv-colab@nexgen.mx' })
    await call('POST', '/workspaces/join', { body: { code: nominal.code }, token: co })
  }
  await call('POST', '/tasks', { body: { title: 'Una', workspaceId: flojo.id }, token: omar })
  for (const t of ['A', 'B', 'C']) {
    await call('POST', '/tasks', { body: { title: t, workspaceId: fuerte.id }, token: omar })
  }

  const [status, body] = await json(await call('GET', '/workspaces/collaborators', { token: omar }))
  assert.equal(status, 200)

  const filas = body.collaborators.filter((c) => c.person.name === 'Colab')
  assert.equal(filas.length, 1, 'una sola fila por persona')
  assert.equal(filas[0].workspace.name, 'Mucho trabajo', 'el espacio donde mas han colaborado')
  assert.equal(filas[0].tasks, 3)
  assert.deepEqual(Object.keys(filas[0].person).sort(), ['accentColor', 'avatar', 'id', 'name'])
})

test('no aparece gente con la que no compartes nada', async () => {
  const solo = await signUp('inv-solo@nexgen.mx', 'Solo')
  const [, body] = await json(await call('GET', '/workspaces/collaborators', { token: solo }))
  assert.deepEqual(body.collaborators, [])
})

// --- invitar por persona ---------------------------------------------------------------------

test('invitar por personId manda el correo SIN que el cliente lo conozca', async () => {
  // Ana ya trabaja con Omar en algun sitio, asi que sale en su lista de colaboradores.
  const viejo = await makeSpace('Ya compartido')
  await call('POST', '/workspaces/join', { body: { code: (await invite(viejo.id)).code }, token: ana })

  const [, lista] = await json(await call('GET', '/workspaces/collaborators', { token: omar }))
  const fila = lista.collaborators.find((c) => c.person.name === 'Ana')
  assert.ok(fila, 'Ana tiene que salir en la lista')
  assert.ok(!('email' in fila.person), 'la lista NO lleva correos: por eso invitar va por id')

  const nuevo = await makeSpace('Recien creado')
  sent.length = 0
  const [status, body] = await json(
    await call('POST', `/workspaces/${nuevo.id}/invites`, {
      body: { personId: fila.person.id },
      token: omar,
    })
  )

  assert.equal(status, 201)
  assert.equal(sent.length, 1, 'el API resolvio el buzon por su cuenta')
  assert.equal(sent[0].to, 'inv-ana@nexgen.mx')
  assert.equal(body.invite.email, 'inv-ana@nexgen.mx')
  assert.equal(sent[0].code, body.invite.code)
})

test('no se puede invitar por id a alguien con quien no trabajas', async () => {
  // Existe, esta verificado, y aun asi no se le puede nombrar: el mismo 404 que un id inventado, o
  // el endpoint seria un detector de cuentas.
  const extrano = await signUp('inv-extrano@nexgen.mx', 'Extraño')
  const suyo = (await (await call('GET', '/me', { token: extrano })).json()).user

  const space = await makeSpace('Ajeno a ese')
  sent.length = 0
  const res = await call('POST', `/workspaces/${space.id}/invites`, {
    body: { personId: suyo.id },
    token: omar,
  })

  assert.equal(res.status, 404)
  assert.match((await res.json()).error, /Esa persona no existe/)
  assert.equal(sent.length, 0, 'no sale ningun correo')

  const inventado = await call('POST', `/workspaces/${space.id}/invites`, {
    body: { personId: 999999 },
    token: omar,
  })
  assert.equal(inventado.status, 404, 'un id inventado da lo mismo que uno real ajeno')
})

test('invitar a quien YA esta dentro da 409 en vez de un codigo inutil', async () => {
  const space = await makeSpace('Ana ya entro')
  const dentro = await invite(space.id, { email: 'inv-ana@nexgen.mx' })
  await call('POST', '/workspaces/join', { body: { code: dentro.code }, token: ana })

  const [, lista] = await json(await call('GET', '/workspaces/collaborators', { token: omar }))
  const ella = lista.collaborators.find((c) => c.person.name === 'Ana')

  const res = await call('POST', `/workspaces/${space.id}/invites`, {
    body: { personId: ella.person.id },
    token: omar,
  })
  assert.equal(res.status, 409)
  assert.match((await res.json()).error, /ya está en el espacio/)
})

// --- limite de intentos --------------------------------------------------------------------------

test('la vista previa y el aceptar comparten el contador: el preview no es un oraculo gratis', async () => {
  const beto = await signUp('inv-limite@nexgen.mx', 'Beto')
  // JOIN_POLICY son 10 por ventana. Se gastan con la VISTA PREVIA, que es la puerta barata.
  for (let i = 0; i < 10; i++) {
    await call('POST', '/workspaces/join/check', { body: { code: 'ZZZZZZ' }, token: beto })
  }
  // Y el que cuenta de verdad ya esta frenado, aunque no se haya usado ni una vez.
  const res = await call('POST', '/workspaces/join', { body: { code: 'ZZZZZZ' }, token: beto })
  assert.equal(res.status, 429)
  assert.match((await res.json()).error, /Espera unos minutos/)
})

test('todas las rutas de invitacion exigen token', async () => {
  for (const [method, path] of [
    ['GET', '/workspaces/collaborators'],
    ['POST', '/workspaces/join'],
    ['POST', '/workspaces/join/check'],
    ['GET', '/workspaces/1/members'],
    ['GET', '/workspaces/1/invites'],
    ['POST', '/workspaces/1/invites'],
    ['DELETE', '/workspaces/1/invites/ABC123'],
  ]) {
    const res = await call(method, path, method === 'GET' ? {} : { body: {} })
    assert.equal(res.status, 401, `${method} ${path}`)
  }
})
