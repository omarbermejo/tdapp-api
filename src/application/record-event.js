import { recipientsOf, toPublicEvent } from '../domain/event.js'

/**
 * Deja constancia de que le paso algo a una tarea, y se lo cuenta a quien esta escuchando.
 *
 * No es un endpoint: lo llaman `create-task`, `update-task` y `delete-task` despues de haber
 * guardado. Va DESPUES a proposito — un evento de algo que no llego a escribirse seria una noticia
 * falsa — y por eso nunca puede tumbar la peticion: si esto falla, la tarea ya esta bien guardada y
 * lo unico que se pierde es una fila del historial. De ahi el try/catch.
 *
 * El reparto es a ESCRITURA (una fila por destinatario) y no a lectura, y eso decide tres cosas:
 * leer el feed es un escaneo de indice trivial, `read_at` puede ser por persona porque ya hay fila
 * por persona, y meter a alguien nuevo en un espacio no le reescribe una historia que no vivio.
 */
export const recordEvent =
  ({ events, hub }) =>
  async (task, { actorId, kind, meta = null }) => {
    if (!kind) return

    const createdAt = new Date().toISOString()

    for (const userId of recipientsOf(task)) {
      try {
        const row = await events.add({
          userId,
          actorId,
          taskId: task.id ?? null,
          workspaceId: task.workspaceId ?? null,
          kind,
          // El titulo se COPIA: es el que tenia cuando paso, no el de ahora. Sin esto, un borrado no
          // tendria nada que pintar y un renombrado enseñaria el nombre nuevo en la fila que anuncia
          // el viejo.
          taskTitle: task.title,
          meta,
          createdAt,
          /**
           * Lo que hiciste tu nace leido.
           *
           * La fila existe igual — el historial es completo y dice "completaste X" — pero no suma al
           * globo. En el espacio personal tu eres siempre el actor, asi que sin esto la campana
           * tendria un punto encendido de forma permanente y dejaria de significar nada. El dia que
           * otra persona toque tus tareas, la misma regla enciende el globo sola.
           */
          readAt: actorId === userId ? createdAt : null,
        })

        // El hub es una estructura de datos, no una conexion: sin nadie escuchando esto es un no-op,
        // y por eso los tests y el modo sin sockets no se enteran de que existe.
        hub?.publish(userId, { type: 'event', event: toPublicEvent(row) })
      } catch (error) {
        // Un fallo aqui no puede tumbar la peticion: la tarea ya se guardo.
        console.error('No se pudo registrar el evento', error)
      }
    }
  }
