import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { WORKSPACE_ICONS, makeWorkspace } from '../src/domain/workspace.js'

import { dropDb, freshDb } from './helpers/db.js'
import { codeMailer } from './helpers/mailer.js'

process.env.JWT_SECRET ??= 'test-secret'
const DB = 'test-workspaces.db'
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

before(async () => {
  auth = await signUp('workspaces@nexgen.mx', 'Omar')
})

// --- dominio puro ------------------------------------------------------------------------------

test('un espacio necesita nombre', () => {
  assert.throws(() => makeWorkspace({ name: '   ' }), /Revisa los datos/)
})

test('el nombre tiene tope: si no cabe en la card, no cabe', () => {
  assert.throws(() => makeWorkspace({ name: 'a'.repeat(41) }), /Revisa los datos/)
  assert.ok(makeWorkspace({ name: 'a'.repeat(40) }))
})

test('icono y acento se validan contra su catalogo', () => {
  assert.throws(() => makeWorkspace({ name: 'Tesis', icon: 'no-existe' }), /Revisa los datos/)
  assert.throws(() => makeWorkspace({ name: 'Tesis', accent: 'fucsia' }), /Revisa los datos/)
  assert.ok(WORKSPACE_ICONS.includes('work'))
  // `home-chrome` es la variante de la barra de pestañas, no un objeto que alguien elegiria.
  assert.ok(!WORKSPACE_ICONS.includes('home-chrome'))
})

test('makeWorkspace mezcla sobre lo que ya hay, para servir de PATCH', () => {
  const base = { name: 'Tesis', icon: 'academic', accent: 'olive', position: 3 }
  const next = makeWorkspace({ name: 'Tesis final' }, base)
  assert.equal(next.name, 'Tesis final')
  assert.equal(next.icon, 'academic', 'lo que no viene se conserva')
  assert.equal(next.position, 3)
})

// --- endpoint ------------------------------------------------------------------------------------

test('los catalogos son publicos: la pantalla de crear se pinta sin sesion', async () => {
  const [status, body] = await json(await call('GET', '/workspaces/catalogs'))
  assert.equal(status, 200)
  assert.ok(body.icon.includes('work'))
  assert.ok(body.accent.includes('forest'))
  assert.equal(body.name.max, 40)
})

test('todas las rutas de espacios exigen token', async () => {
  for (const [method, path] of [
    ['GET', '/workspaces'],
    ['POST', '/workspaces'],
    ['PATCH', '/workspaces/1'],
    ['DELETE', '/workspaces/1'],
  ]) {
    // Sin body en GET: fetch lo rechaza antes de salir a la red.
    const res = await call(method, path, method === 'GET' ? {} : { body: { name: 'x' } })
    assert.equal(res.status, 401, `${method} ${path}`)
  }
})

test('crear un espacio lo pone al final y arranca sin tareas', async () => {
  const [status, body] = await json(
    await call('POST', '/workspaces', {
      body: { name: 'Personal', icon: 'user', accent: 'clay' },
      token: auth,
    })
  )
  assert.equal(status, 201)
  assert.equal(body.workspace.name, 'Personal')
  assert.equal(body.workspace.position, 0, 'el primero')
  assert.equal(body.workspace.total, 0)
  assert.equal(body.workspace.done, 0)

  const segundo = await call('POST', '/workspaces', { body: { name: 'Trabajo' }, token: auth })
  const { workspace } = await segundo.json()
  assert.equal(workspace.position, 1, 'nace al final, no al principio')
  assert.equal(workspace.icon, 'work', 'default del catalogo')
})

test('el progreso sale contado desde SQL, en una sola llamada', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Mudanza', icon: 'home' }, token: auth })
  ).json()

  const ids = []
  for (const title of ['Cajas', 'Camion', 'Llaves']) {
    const res = await call('POST', '/tasks', {
      body: { title, workspaceId: workspace.id, dueAt: '2026-08-01T12:00:00-06:00' },
      token: auth,
    })
    const { task } = await res.json()
    assert.equal(task.workspaceId, workspace.id, 'la tarea recuerda su espacio')
    ids.push(task.id)
  }
  await call('PATCH', `/tasks/${ids[0]}`, { body: { status: 'done' }, token: auth })

  const [, body] = await json(await call('GET', '/workspaces', { token: auth }))
  const mudanza = body.workspaces.find((w) => w.id === workspace.id)
  assert.equal(mudanza.total, 3)
  assert.equal(mudanza.done, 1)
})

test('un PATCH de tarea no le borra el espacio', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Tesis', icon: 'academic' }, token: auth })
  ).json()
  const { task } = await (
    await call('POST', '/tasks', { body: { title: 'Capitulo 1', workspaceId: workspace.id }, token: auth })
  ).json()

  const res = await call('PATCH', `/tasks/${task.id}`, { body: { title: 'Capitulo uno' }, token: auth })
  const { task: saved } = await res.json()
  assert.equal(saved.title, 'Capitulo uno')
  assert.equal(saved.workspaceId, workspace.id, 'el PATCH conserva lo que no manda')
})

test('renombrar conserva lo que no viene en el parche', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Viejo', icon: 'moon', accent: 'copper' }, token: auth })
  ).json()

  const [status, body] = await json(
    await call('PATCH', `/workspaces/${workspace.id}`, { body: { name: 'Nuevo' }, token: auth })
  )
  assert.equal(status, 200)
  assert.equal(body.workspace.name, 'Nuevo')
  assert.equal(body.workspace.icon, 'moon')
  assert.equal(body.workspace.accent, 'copper')
})

test('BORRAR UN ESPACIO NO BORRA SU TRABAJO: las tareas sobreviven sueltas', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Efimero', icon: 'leaf' }, token: auth })
  ).json()
  const { task } = await (
    await call('POST', '/tasks', {
      body: { title: 'No me pierdas', workspaceId: workspace.id, dueAt: '2026-08-02T12:00:00-06:00' },
      token: auth,
    })
  ).json()

  const res = await call('DELETE', `/workspaces/${workspace.id}`, { token: auth })
  assert.equal(res.status, 204)

  // Es el modo de falla que importa: perder trabajo por reorganizar carpetas.
  const [status, body] = await json(await call('GET', '/tasks?date=2026-08-02', { token: auth }))
  assert.equal(status, 200)
  const survivor = body.tasks.find((t) => t.id === task.id)
  assert.ok(survivor, 'la tarea sigue existiendo')
  assert.equal(survivor.workspaceId, null, 'y quedo suelta, no huerfana de un id que no existe')
})

test('borrar dos veces es 404', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Doble', icon: 'check' }, token: auth })
  ).json()
  assert.equal((await call('DELETE', `/workspaces/${workspace.id}`, { token: auth })).status, 204)
  assert.equal((await call('DELETE', `/workspaces/${workspace.id}`, { token: auth })).status, 404)
})

test('un usuario no ve ni toca los espacios de otro', async () => {
  const otra = await signUp('workspaces-otro@nexgen.mx', 'Ana')
  const [, mios] = await json(await call('GET', '/workspaces', { token: auth }))
  const [, suyos] = await json(await call('GET', '/workspaces', { token: otra }))
  assert.ok(mios.workspaces.length > 0)
  assert.equal(suyos.workspaces.length, 0)

  const ajeno = mios.workspaces[0].id
  assert.equal((await call('PATCH', `/workspaces/${ajeno}`, { body: { name: 'Mio' }, token: otra })).status, 404)
  assert.equal((await call('DELETE', `/workspaces/${ajeno}`, { token: otra })).status, 404)
})

// --- el espacio como pantalla propia -------------------------------------------------------------

test('GET /workspaces/:id trae el espacio con su progreso', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Detalle', icon: 'graph-up' }, token: auth })
  ).json()
  for (const [title, done] of [['Una', true], ['Dos', false], ['Tres', false]]) {
    const { task } = await (
      await call('POST', '/tasks', {
        body: { title, workspaceId: workspace.id, dueAt: '2026-08-05T12:00:00-06:00' },
        token: auth,
      })
    ).json()
    if (done) await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: auth })
  }

  const [status, body] = await json(await call('GET', `/workspaces/${workspace.id}`, { token: auth }))
  assert.equal(status, 200)
  assert.equal(body.workspace.name, 'Detalle')
  assert.equal(body.workspace.total, 3)
  assert.equal(body.workspace.done, 1)
})

test('un espacio que no existe o no es tuyo es 404, no una lista vacia', async () => {
  assert.equal((await call('GET', '/workspaces/999999', { token: auth })).status, 404)
  const otra = await signUp('workspaces-detalle@nexgen.mx', 'Ana')
  const [, mios] = await json(await call('GET', '/workspaces', { token: auth }))
  assert.equal((await call('GET', `/workspaces/${mios.workspaces[0].id}`, { token: otra })).status, 404)
})

test('?workspaceId= trae las tareas del espacio, de todos los dias', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Filtrado', icon: 'leaf' }, token: auth })
  ).json()
  // Dos dias distintos y una sin fecha: la pantalla del espacio las quiere TODAS.
  for (const dueAt of ['2026-08-06T12:00:00-06:00', '2026-08-07T12:00:00-06:00', null]) {
    await call('POST', '/tasks', {
      body: { title: `Del espacio ${dueAt ?? 'sin fecha'}`, workspaceId: workspace.id, dueAt },
      token: auth,
    })
  }
  // Y una FUERA del espacio, el mismo dia, que no debe salir.
  await call('POST', '/tasks', {
    body: { title: 'Ajena al espacio', dueAt: '2026-08-06T12:00:00-06:00' },
    token: auth,
  })

  const [status, body] = await json(
    await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: auth })
  )
  assert.equal(status, 200)
  assert.equal(body.tasks.length, 3)
  assert.ok(body.tasks.every((t) => t.workspaceId === workspace.id))
  assert.ok(!body.tasks.some((t) => t.title === 'Ajena al espacio'))
})

test('un workspaceId basura no filtra nada en vez de reventar', async () => {
  const [status, body] = await json(await call('GET', '/tasks?workspaceId=abc', { token: auth }))
  assert.equal(status, 200, 'Number("abc") || null cae en null, o sea sin filtro')
  assert.ok(body.tasks.length > 0)
})

test('/me/stats?workspaceId= acota las estadisticas al espacio', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Medido', icon: 'trophy' }, token: auth })
  ).json()
  const mk = async (title, workspaceId) => {
    const { task } = await (
      await call('POST', '/tasks', {
        body: { title, workspaceId, size: 'deep', dueAt: '2026-08-08T12:00:00-06:00' },
        token: auth,
      })
    ).json()
    await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: auth })
  }
  await mk('Dentro 1', workspace.id)
  await mk('Dentro 2', workspace.id)
  await mk('Fuera', null)

  const scoped = await (
    await call('GET', `/me/stats?date=2026-08-08&workspaceId=${workspace.id}`, { token: auth })
  ).json()
  const all = await (await call('GET', '/me/stats?date=2026-08-08', { token: auth })).json()

  assert.equal(scoped.totals.done, 2, 'solo las del espacio')
  assert.ok(all.totals.done > scoped.totals.done, 'sin filtro cuenta mas')
  const day = scoped.byDay.find((d) => d.date === '2026-08-08')
  assert.equal(day.planned, 2, 'planned tambien va acotado')
})

test('/me/stats con un espacio ajeno devuelve ceros, no un 404', async () => {
  // Un 404 aqui diria si un id que no es tuyo existe o no.
  const res = await call('GET', '/me/stats?date=2026-08-08&workspaceId=999999', { token: auth })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).totals.done, 0)
})
