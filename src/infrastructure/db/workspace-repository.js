/**
 * Las columnas propias, con los alias que hacen falta.
 *
 * `created_at AS createdAt` no es cosmetico: `toPublicWorkspace` lee `row.createdAt`, asi que sin el
 * alias devolveria `undefined` y el campo saldria vacio del API sin que nada fallara. Aqui no hay un
 * `toDomain` como en task-repository porque solo existe UNA forma de fila y los alias la resuelven
 * enteros; el dia que haya dos consultas con formas distintas, ese mapeo se promueve a funcion.
 */
const COLUMNS = 'id, user_id AS userId, name, icon, accent, position, tag, created_at AS createdAt'

export function createWorkspaceRepository(db) {
  const insert = db.prepare(
    'INSERT INTO workspaces (user_id, name, icon, accent, position, tag) VALUES (?, ?, ?, ?, ?, ?)'
  )
  /** El espacio si eres su DUEÑO. Es el permiso de administrar: renombrar, invitar, borrar. */
  const owned = db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE user_id = ? AND id = ?`)

  /** Sin control de acceso. Solo para resolver un codigo de invitacion. Ver `findAny`. */
  const anyById = db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE id = ?`)

  /**
   * El espacio si eres MIEMBRO (el dueño lo es, por el backfill de la migracion).
   *
   * Es el permiso de trabajar: meter una tarea, verla, cerrarla. Separado de `owned` a proposito —
   * son dos preguntas distintas y mezclarlas en un solo metodo es como se cuelan los permisos.
   */
  const joined = db.prepare(`SELECT ${COLUMNS} FROM workspaces w
    WHERE w.id = ?
      AND EXISTS (SELECT 1 FROM workspace_members m
                   WHERE m.workspace_id = w.id AND m.user_id = ?)`)
  const patch = db.prepare(
    'UPDATE workspaces SET name = ?, icon = ?, accent = ?, position = ?, tag = ? WHERE user_id = ? AND id = ?'
  )
  const del = db.prepare('DELETE FROM workspaces WHERE user_id = ? AND id = ?')

  /** La fila de membresia del dueño. Nace con el espacio, dentro de la misma transaccion. */
  const joinOwner = db.prepare(
    `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')`
  )

  // node:sqlite no trae helper de transaccion: a mano y con ROLLBACK en el catch, como en
  // `user-repository.js` y `task-repository.js`.
  const inTransaction = (work) => {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** El siguiente hueco al final. COALESCE porque MAX de cero filas es NULL, no 0. */
  const lastPosition = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS last FROM workspaces WHERE user_id = ?'
  )

  /**
   * Los espacios con su progreso, en una sola consulta.
   *
   * El conteo va en SQL y no plegando tareas en memoria porque la pantalla de inicio solo necesita
   * dos numeros por espacio: traerse las tareas para contarlas seria traer cientos de filas para
   * calcular un porcentaje.
   *
   * `SUM(t.status = 'done')` funciona porque SQLite evalua la comparacion a 1/0. El COALESCE cubre el
   * espacio sin ninguna tarea, donde el LEFT JOIN deja el SUM en NULL — y ese caso es el normal, no
   * el raro: un espacio recien creado esta vacio.
   *
   * El JOIN llevaba `AND t.user_id = w.user_id`, blindaje redundante mientras un espacio era de una
   * sola persona. **Se fue al compartirlos**: con el puesto, el anillo de un espacio compartido
   * contaria solo lo del dueño y el progreso de un equipo de tres se veria como el de uno. Lo que
   * acota el conteo es `t.workspace_id = w.id`, que ya es la pertenencia real de la tarea.
   */
  const COUNTED = `SELECT
      w.id, w.name, w.icon, w.accent, w.position, w.tag, w.created_at AS createdAt,
      COUNT(t.id) AS total,
      COALESCE(SUM(t.status = 'done'), 0) AS done
    FROM workspaces w
    LEFT JOIN tasks t ON t.workspace_id = w.id`

  /**
   * Los espacios de los que eres MIEMBRO, no solo los tuyos: uno al que te invitaron tiene que salir
   * en tu lista o la invitacion no sirve de nada. El dueño entra por el mismo camino, gracias a su
   * fila con rol `owner`.
   */
  const MEMBER_OF = `EXISTS (SELECT 1 FROM workspace_members m
                              WHERE m.workspace_id = w.id AND m.user_id = ?)`

  const withCounts = db.prepare(`${COUNTED}
    WHERE ${MEMBER_OF}
    GROUP BY w.id
    ORDER BY w.position, w.id`)

  /** El mismo conteo para UNO solo: es la cabecera de la pantalla de detalle. */
  const oneWithCounts = db.prepare(`${COUNTED}
    WHERE ${MEMBER_OF} AND w.id = ?
    GROUP BY w.id`)

  return {
    async listWithCounts(userId) {
      return withCounts.all(userId)
    },

    /** Puedes TRABAJAR en el. Es lo que valida meter o mover una tarea a un espacio. */
    async findById(userId, id) {
      return joined.get(Number(id), userId)
    },

    /** Puedes ADMINISTRARLO: renombrar, recolorear, invitar, expulsar, borrar. Solo el dueño. */
    async findOwned(userId, id) {
      return owned.get(userId, Number(id))
    },

    /**
     * El espacio, sin preguntar de quien es.
     *
     * Es el UNICO metodo sin control de acceso, y existe para un solo caso: resolver un codigo de
     * invitacion, donde por definicion todavia no eres nada del espacio. Quien lo llame tiene que
     * haber validado el codigo primero — el permiso ahi lo da el codigo, no la membresia.
     */
    async findAny(id) {
      return anyById.get(Number(id))
    },

    /** Con `total` y `done`. Lo usa la pantalla de detalle; `findById` basta para validar un PATCH. */
    async findByIdWithCounts(userId, id) {
      return oneWithCounts.get(userId, Number(id))
    },

    /**
     * Crea el espacio y mete al dueño como miembro, EN UNA TRANSACCION.
     *
     * Las dos cosas o ninguna: un espacio sin su fila de membresia seria invisible para su propio
     * dueño — `listWithCounts` y `findById` preguntan por `workspace_members`, no por `user_id`.
     */
    async create(userId, workspace) {
      return inTransaction(() => {
        const { lastInsertRowid } = insert.run(
          userId,
          workspace.name,
          workspace.icon,
          workspace.accent,
          workspace.position,
          workspace.tag
        )
        const id = Number(lastInsertRowid)
        joinOwner.run(id, userId)
        return owned.get(userId, id)
      })
    },

    async update(userId, id, workspace) {
      patch.run(
        workspace.name, workspace.icon, workspace.accent, workspace.position, workspace.tag,
        userId, Number(id)
      )
      return owned.get(userId, Number(id))
    },

    async remove(userId, id) {
      // Las tareas del espacio sobreviven: la FK las deja con workspace_id = NULL (ON DELETE SET NULL).
      return del.run(userId, Number(id)).changes > 0
    },

    async nextPosition(userId) {
      return lastPosition.get(userId).last + 1
    },
  }
}
