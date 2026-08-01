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

// --- la frontera: espacios compartidos -----------------------------------------------------------

/**
 * Mete a alguien en un espacio escribiendo la fila a mano.
 *
 * Los endpoints de invitacion todavia no existen, y este archivo prueba la FRONTERA, no el camino para
 * llegar a ella. Se abre una segunda conexion al mismo fichero: con WAL encendido conviven sin
 * bloquearse, y es la unica forma de montar el escenario sin depender del paso siguiente.
 */
const joinAsMember = async (workspaceId, userId) => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  db.exec('PRAGMA foreign_keys = ON')
  db.prepare('INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(
    workspaceId,
    userId,
    'member'
  )
  db.close()
}

/** El id de la cuenta detras de un token, para poder meterla en un espacio. */
const idOf = async (token) => (await (await call('GET', '/me', { token })).json()).user.id

test('el dueño de un espacio nuevo nace como miembro suyo', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Con dueño', icon: 'work' }, token: auth })
  ).json()
  // Si la fila de membresia no se escribiera, el espacio seria invisible para su propio dueño:
  // listWithCounts pregunta por workspace_members, no por user_id.
  const [, body] = await json(await call('GET', '/workspaces', { token: auth }))
  assert.ok(body.workspaces.some((w) => w.id === workspace.id))
})

test('un MIEMBRO ve las tareas del espacio, y antes de entrar no', async () => {
  const ana = await signUp('frontera-ana@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Compartido', icon: 'work' }, token: auth })
  ).json()
  await call('POST', '/tasks', {
    body: { title: 'De Omar', workspaceId: workspace.id, dueAt: '2026-09-20T12:00:00-06:00' },
    token: auth,
  })

  // Antes de entrar: el espacio no existe para ella.
  const antes = await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: ana })
  assert.deepEqual((await antes.json()).tasks, [], 'sin membresia no ve nada')

  await joinAsMember(workspace.id, await idOf(ana))

  const despues = await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: ana })
  const titles = (await despues.json()).tasks.map((t) => t.title)
  assert.deepEqual(titles, ['De Omar'], 'como miembro ve el trabajo del espacio')
})

test('un miembro CIERRA una tarea ajena y el merito es SUYO', async () => {
  const ana = await signUp('frontera-cierra@nexgen.mx', 'Ana')
  const anaId = await idOf(ana)
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Merito', icon: 'work' }, token: auth })
  ).json()
  await joinAsMember(workspace.id, anaId)

  const { task } = await (
    await call('POST', '/tasks', {
      body: { title: 'La cierra Ana', workspaceId: workspace.id, dueAt: '2026-09-21T12:00:00-06:00' },
      token: auth,
    })
  ).json()

  const res = await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: ana })
  assert.equal(res.status, 200, 'un miembro puede cerrarla aunque no sea suya')
  const { task: cerrada } = await res.json()
  assert.equal(cerrada.status, 'done')
  assert.equal(cerrada.completedBy, anaId, 'el merito es de quien cerro, no del dueño')
})

test('reabrir y volver a cerrar no le quita el merito a quien la cerro primero', async () => {
  const ana = await signUp('frontera-reabre@nexgen.mx', 'Ana')
  const anaId = await idOf(ana)
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Reabre', icon: 'work' }, token: auth })
  ).json()
  await joinAsMember(workspace.id, anaId)
  const { task } = await (
    await call('POST', '/tasks', { body: { title: 'Ida y vuelta', workspaceId: workspace.id }, token: auth })
  ).json()

  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: ana })
  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'pending' }, token: auth })
  const reabierta = await (await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: auth })).json()
  assert.equal(reabierta.tasks[0].completedBy, null, 'reabrir borra el merito, como borra la hora')

  await call('PATCH', `/tasks/${task.id}`, { body: { status: 'done' }, token: auth })
  const otra = await (await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: auth })).json()
  assert.equal(otra.tasks[0].completedBy, await idOf(auth), 'la cierra Omar, el merito es de Omar')
})

test('un miembro TRABAJA pero no ADMINISTRA', async () => {
  const ana = await signUp('frontera-permisos@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Permisos', icon: 'work' }, token: auth })
  ).json()
  await joinAsMember(workspace.id, await idOf(ana))

  // Trabajar: si.
  const crea = await call('POST', '/tasks', {
    body: { title: 'Aporte de Ana', workspaceId: workspace.id },
    token: ana,
  })
  assert.equal(crea.status, 201, 'un miembro mete tareas en el espacio')

  // Administrar: no. Mismo 404 que un espacio inexistente, para no delatar que existe.
  assert.equal(
    (await call('PATCH', `/workspaces/${workspace.id}`, { body: { name: 'Mio' }, token: ana })).status,
    404
  )
  assert.equal((await call('DELETE', `/workspaces/${workspace.id}`, { token: ana })).status, 404)
})

test('nadie mete ni MUEVE una tarea a un espacio del que no es miembro', async () => {
  const ana = await signUp('frontera-ajeno@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Cerrado', icon: 'work' }, token: auth })
  ).json()

  const crear = await call('POST', '/tasks', {
    body: { title: 'Colada', workspaceId: workspace.id },
    token: ana,
  })
  assert.equal(crear.status, 400)
  assert.ok((await crear.json()).fields.workspaceId)

  // Y moverla despues es la misma puerta.
  const { task } = await (await call('POST', '/tasks', { body: { title: 'Suya' }, token: ana })).json()
  const mover = await call('PATCH', `/tasks/${task.id}`, {
    body: { workspaceId: workspace.id },
    token: ana,
  })
  assert.equal(mover.status, 400)
})

test('el anillo de un espacio compartido cuenta el trabajo de TODOS', async () => {
  const ana = await signUp('frontera-anillo@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Anillo', icon: 'work' }, token: auth })
  ).json()
  await joinAsMember(workspace.id, await idOf(ana))

  await call('POST', '/tasks', { body: { title: 'De Omar', workspaceId: workspace.id }, token: auth })
  await call('POST', '/tasks', { body: { title: 'De Ana', workspaceId: workspace.id }, token: ana })

  const [, body] = await json(await call('GET', `/workspaces/${workspace.id}`, { token: auth }))
  assert.equal(body.workspace.total, 2, 'con el filtro viejo por dueño esto habria dado 1')
})

test('el modo general NO cambia: Omar no ve las tareas de Ana en su dia', async () => {
  // Es la decision que deja en paz al widget, a la Live Activity y a la racha.
  const ana = await signUp('frontera-general@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'General', icon: 'work' }, token: auth })
  ).json()
  await joinAsMember(workspace.id, await idOf(ana))
  await call('POST', '/tasks', {
    body: { title: 'De Ana, en el espacio', workspaceId: workspace.id, dueAt: '2026-09-22T12:00:00-06:00' },
    token: ana,
  })

  const dia = await (await call('GET', '/me/today?date=2026-09-22', { token: auth })).json()
  assert.ok(
    !dia.tasks.some((t) => t.title === 'De Ana, en el espacio'),
    'sin espacio activo, el dia de Omar sigue siendo solo suyo'
  )
})

test('dos personas cronometran a la vez en el mismo espacio, sin pisarse', async () => {
  const ana = await signUp('timer-ana@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Relojes', icon: 'work' }, token: auth })
  ).json()
  await joinAsMember(workspace.id, await idOf(ana))

  const mk = async (title) =>
    (await (await call('POST', '/tasks', { body: { title, workspaceId: workspace.id }, token: auth })).json())
      .task

  const deOmar = await mk('La cronometra Omar')
  const deAna = await mk('La cronometra Ana')

  // Con el esquema viejo esto era imposible: el indice unico estaba keyeado por el DUEÑO de la fila,
  // asi que el reloj de Ana ocupaba la ranura de Omar y el segundo start daba 409.
  assert.equal(
    (await call('POST', `/tasks/${deOmar.id}/timer`, { body: { action: 'start' }, token: auth })).status,
    200
  )
  assert.equal(
    (await call('POST', `/tasks/${deAna.id}/timer`, { body: { action: 'start' }, token: ana })).status,
    200,
    'Ana arranca el suyo aunque Omar tenga uno corriendo'
  )

  // Y cada quien ve SU reloj: la misma tarea sale corriendo para uno y parada para el otro.
  const vistaDeOmar = await (await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: auth })).json()
  const vistaDeAna = await (await call('GET', `/tasks?workspaceId=${workspace.id}`, { token: ana })).json()
  assert.equal(vistaDeOmar.tasks.find((t) => t.id === deOmar.id).running, true)
  assert.equal(vistaDeAna.tasks.find((t) => t.id === deOmar.id).running, false, 'el reloj de Omar no es de Ana')
  assert.equal(vistaDeAna.tasks.find((t) => t.id === deAna.id).running, true)

  // Pero cada quien sigue topado a UNO: el indice se movio, no desaparecio.
  assert.equal(
    (await call('POST', `/tasks/${deAna.id}/timer`, { body: { action: 'start' }, token: auth })).status,
    409,
    'Omar ya tiene uno corriendo'
  )
})

// --- espacio activo y clasificacion ---------------------------------------------------------------

test('activar un espacio lo devuelve resuelto en el perfil', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', {
      body: { name: 'Activo', icon: 'academic', accent: 'olive', tag: 'study' },
      token: auth,
    })
  ).json()
  assert.equal(workspace.tag, 'study')

  const [status, body] = await json(
    await call('PATCH', '/me/profile', { body: { activeWorkspaceId: workspace.id }, token: auth })
  )
  assert.equal(status, 200)
  // Sale el OBJETO y no solo el id: la pastilla se pinta en el primer frame, sin segunda peticion.
  assert.deepEqual(body.user.activeWorkspace, {
    id: workspace.id,
    name: 'Activo',
    icon: 'academic',
    accent: 'olive',
    tag: 'study',
  })
})

test('un PATCH de OTRO campo no te saca del espacio', async () => {
  // La trampa del gate: `active_workspace_id` esta en PROFILE_COLUMNS, que genera el SET del upsert.
  // Sin conservar el valor actual, cambiar el color te devolveria al modo general.
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Persiste', icon: 'work' }, token: auth })
  ).json()
  await call('PATCH', '/me/profile', { body: { activeWorkspaceId: workspace.id }, token: auth })

  const [, body] = await json(
    await call('PATCH', '/me/profile', { body: { accentColor: 'copper' }, token: auth })
  )
  assert.equal(body.user.accentColor, 'copper')
  assert.equal(body.user.activeWorkspace?.id, workspace.id, 'el espacio activo sobrevive')
})

test('null vuelve al modo general, y un espacio ajeno se rechaza', async () => {
  const otra = await signUp('activo-otro@nexgen.mx', 'Ana')
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Solo mio', icon: 'work' }, token: auth })
  ).json()

  const ajeno = await call('PATCH', '/me/profile', {
    body: { activeWorkspaceId: workspace.id },
    token: otra,
  })
  assert.equal(ajeno.status, 400)

  await call('PATCH', '/me/profile', { body: { activeWorkspaceId: workspace.id }, token: auth })
  const [, body] = await json(
    await call('PATCH', '/me/profile', { body: { activeWorkspaceId: null }, token: auth })
  )
  assert.equal(body.user.activeWorkspace, null)
})

test('borrar el espacio activo devuelve sola a la persona al modo general', async () => {
  // Es el ON DELETE SET NULL: la reconciliacion entera, sin una linea de codigo que mantener.
  const { workspace } = await (
    await call('POST', '/workspaces', { body: { name: 'Efimero activo', icon: 'work' }, token: auth })
  ).json()
  await call('PATCH', '/me/profile', { body: { activeWorkspaceId: workspace.id }, token: auth })
  await call('DELETE', `/workspaces/${workspace.id}`, { token: auth })

  const [, body] = await json(await call('GET', '/me', { token: auth }))
  assert.equal(body.user.activeWorkspace, null)
})

test('la tarea HEREDA la clasificacion de su espacio, y su foco propio la sobreescribe', async () => {
  const { workspace } = await (
    await call('POST', '/workspaces', {
      body: { name: 'Con etiqueta', icon: 'graph-up', tag: 'business' },
      token: auth,
    })
  ).json()

  const hereda = await (
    await call('POST', '/tasks', {
      body: { title: 'Sin foco propio', workspaceId: workspace.id, dueAt: '2026-10-01T12:00:00-06:00' },
      token: auth,
    })
  ).json()
  assert.equal(hereda.task.workspaceTag, 'business')
  assert.equal(hereda.task.focusArea, null, 'la tarea no gana un foco: lo hereda al pintarse')

  const propio = await (
    await call('POST', '/tasks', {
      body: { title: 'Con foco', workspaceId: workspace.id, focusArea: 'health' },
      token: auth,
    })
  ).json()
  assert.equal(propio.task.focusArea, 'health', 'el override manda')
  assert.equal(propio.task.workspaceTag, 'business')
})

test('las 10 clasificaciones contienen los 7 focos: ensanchar no rompe nada', async () => {
  const [, cat] = await json(await call('GET', '/workspaces/catalogs'))
  const [, focos] = await json(await call('GET', '/auth/catalogs'))
  for (const foco of focos.focusAreas) {
    assert.ok(cat.tag.includes(foco), `${foco} sigue siendo una clasificacion valida`)
  }
  assert.equal(cat.tag.length, 10)
  assert.ok(['fitness', 'event', 'business'].every((t) => cat.tag.includes(t)))
})

test('una clasificacion inventada se rechaza, y un espacio sin ella es valido', async () => {
  const malo = await call('POST', '/workspaces', {
    body: { name: 'Raro', tag: 'no-existe' },
    token: auth,
  })
  assert.equal(malo.status, 400)

  const [status, body] = await json(
    await call('POST', '/workspaces', { body: { name: 'Sin clasificar' }, token: auth })
  )
  assert.equal(status, 201)
  assert.equal(body.workspace.tag, null, 'sin clasificar es un estado legitimo')

  // Y editarlo por otra cosa NO le inventa una: makeWorkspace valida el merge.
  const [, tras] = await json(
    await call('PATCH', `/workspaces/${body.workspace.id}`, { body: { name: 'Otro nombre' }, token: auth })
  )
  assert.equal(tras.workspace.tag, null)
})
