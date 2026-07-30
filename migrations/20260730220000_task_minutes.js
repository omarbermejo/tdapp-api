/**
 * Cuanto dura una tarea, en minutos y no en tres cajones.
 *
 * `size` (quick/medium/deep) sigue vivo: es el marco grueso, y "¿que tan grande se siente
 * esto?" se contesta mejor que "¿cuantos minutos?". Pero solo puede decir 5, 25 o 50, y hay
 * tareas de 15 y de 90.
 *
 * La columna es NULL por defecto a proposito, y eso ES el dato: null significa "no lo decidi,
 * usa lo que sugiere el tamaño". Solo cuando alguien pone un numero pasa a mandar. Asi las
 * filas viejas no necesitan backfill y nadie tiene que elegir minutos para poder anotar.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE tasks ADD COLUMN minutes INTEGER')
}

export async function down(knex) {
  await knex.raw('ALTER TABLE tasks DROP COLUMN minutes')
}
