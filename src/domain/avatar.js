/**
 * Que caras puede llevar una persona, y como se ganan las demas.
 *
 * El set completo de memojis vive en los assets de la app (`assets/avatars/memoji-NN.webp`) y son
 * cuarenta y cinco. Aqui NO estan los cuarenta y cinco a proposito: solo las que el producto ofrece.
 * Las que no aparecen en ninguna lista de este archivo no existen para nadie — la app no las pinta y
 * el API no las acepta.
 *
 * Esto es un giro respecto a como nacio el campo: al principio `avatar` se validaba por patron
 * (`/^memoji-\d{2}$/`) con el argumento de que el catalogo es cosa del cliente y el backend no podia
 * comprobar nada real. Eso dejo de ser cierto en cuanto las caras se ganan: ahora el catalogo no
 * describe que archivos existen sino QUIEN PUEDE USAR CADA UNO, y eso es permiso, no assets. Un
 * permiso que valide el cliente no es un permiso.
 */

/**
 * Las ocho que trae cualquiera desde el primer dia.
 *
 * Ocho y no tres: la primera pantalla tiene que poder representar a quien la abre — tonos de piel y
 * de pelo distintos — o la mecanica de desbloqueo se lee como que la app te niega tu propia cara.
 * Y ocho y no veinte porque lo que se regala entero no se gana despues.
 */
export const FREE_AVATARS = [
  'memoji-01',
  'memoji-02',
  'memoji-03',
  'memoji-04',
  'memoji-05',
  'memoji-06',
  'memoji-07',
  'memoji-08',
]

/**
 * Los cinco logros, en orden de dificultad, y las tres caras que abre cada uno.
 *
 * Se ELIGE UNA de las tres, no se ganan las tres. Es la diferencia entre una recompensa y un
 * inventario: elegir obliga a mirar las tres y quedarse con la que te representa, y deja las otras
 * dos como algo que esa persona decidio no ser. Un logro que suelta tres caras a la vez se pasa de
 * largo.
 *
 * Las metas salen de datos que YA existen y que no se pueden falsear desde la app: `done` es el
 * conteo historico de tareas cerradas (`GET /me/tasks/summary`) y `best` es la mejor racha del
 * historial (`GET /me/streak`). Ninguna se guarda como bandera — se derivan, igual que `stageOf`, y
 * por eso no hay forma de que un logro y la realidad se contradigan.
 *
 * La progresion mezcla los dos ejes a proposito: dos de volumen, dos de constancia, y el ultimo de
 * volumen otra vez. Quien cierra mucho de golpe y quien cierra poco todos los dias llegan los dos a
 * algun sitio.
 */
export const MILESTONES = [
  {
    id: 'first',
    label: 'Tu primera tarea',
    hint: 'Cierra una cosa. Con una basta.',
    goal: { metric: 'done', target: 1 },
    choices: ['memoji-09', 'memoji-10', 'memoji-11'],
  },
  {
    id: 'ten',
    label: 'Diez cerradas',
    hint: 'Diez tareas cerradas en total.',
    goal: { metric: 'done', target: 10 },
    choices: ['memoji-12', 'memoji-13', 'memoji-14'],
  },
  {
    id: 'week',
    label: 'Una semana seguida',
    hint: 'Siete dias seguidos cerrando algo.',
    goal: { metric: 'best', target: 7 },
    choices: ['memoji-15', 'memoji-16', 'memoji-17'],
  },
  {
    id: 'fifty',
    label: 'Cincuenta cerradas',
    hint: 'Cincuenta tareas cerradas en total.',
    goal: { metric: 'done', target: 50 },
    choices: ['memoji-18', 'memoji-19', 'memoji-20'],
  },
  {
    id: 'month',
    label: 'Un mes seguido',
    hint: 'Treinta dias seguidos cerrando algo.',
    goal: { metric: 'best', target: 30 },
    choices: ['memoji-21', 'memoji-22', 'memoji-23'],
  },
]

/** Todas las que se ganan, en una lista plana. La app las pinta con candado hasta que se abren. */
export const LOCKED_AVATARS = MILESTONES.flatMap((milestone) => milestone.choices)

/**
 * Todo lo que la app puede pintar: veintitres de las cuarenta y cinco.
 *
 * Las veintidos restantes existen en el bundle pero no en el producto. Se quedan de reserva para
 * logros futuros, que es mas barato que volver a cortar la lamina.
 */
export const ALL_AVATARS = [...FREE_AVATARS, ...LOCKED_AVATARS]

export const isFreeAvatar = (avatar) => FREE_AVATARS.includes(avatar)

/** A que logro pertenece una cara, o undefined si es libre o no existe. */
export const milestoneOf = (avatar) => MILESTONES.find((m) => m.choices.includes(avatar))

/**
 * Cuanto lleva la persona en cada eje. Un solo sitio decide que numero mide cada meta.
 *
 * `done` no es el de una ventana: es el historico. Con el conteo de cuatro semanas de `/me/stats` un
 * logro se podria PERDER dejando pasar el tiempo, y un logro que se pierde solo no es un logro.
 */
export const progressOf = ({ done = 0, best = 0 } = {}) => ({ done, best })

/** Si una meta ya se cumplio con ese avance. */
export const isReached = (goal, progress) => progress[goal.metric] >= goal.target

/**
 * El estado completo del vestidor: que hay libre, que logro esta abierto, que se eligio y que falta.
 *
 * Se arma aqui y no en la app porque las tres piezas — el catalogo, el avance y lo ya reclamado —
 * solo coinciden en este lado. La app pinta lo que recibe.
 *
 * `claimed` es un Map de id de logro -> avatar elegido.
 */
export function avatarState({ progress, claimed = new Map() }) {
  const at = progressOf(progress)

  return {
    free: FREE_AVATARS,
    milestones: MILESTONES.map((milestone) => {
      const unlocked = isReached(milestone.goal, at)
      const chosen = claimed.get(milestone.id) ?? null

      return {
        id: milestone.id,
        label: milestone.label,
        hint: milestone.hint,
        choices: milestone.choices,
        metric: milestone.goal.metric,
        target: milestone.goal.target,
        // Lo que lleva, topado en la meta: pasado el objetivo, "50 de 50" dice mas que "173 de 50".
        progress: Math.min(at[milestone.goal.metric], milestone.goal.target),
        unlocked,
        chosen,
        // El estado que le importa a la app: hay un premio esperando a que lo recojan.
        claimable: unlocked && !chosen,
      }
    }),
  }
}

/** Las caras que esta persona puede llevar HOY: las libres mas las que ya eligio. */
export const ownedAvatars = (claimed = new Map()) => [...FREE_AVATARS, ...claimed.values()]
