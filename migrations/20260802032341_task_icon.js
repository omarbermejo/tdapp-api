/**
 * La cara de una tarea, elegida a mano.
 *
 * Hasta ahora el icono de una fila se DERIVABA de su clasificacion (`iconForTag` en el front), y eso
 * bastaba mientras la clasificacion fuera lo unico que se elegia. Con el asistente nuevo la persona
 * escoge icono y clasificacion por separado, asi que o el icono se puede guardar o los dos pasos son
 * el mismo paso.
 *
 * NULLABLE y sin default: null significa "no elegi", y entonces se sigue derivando de la
 * clasificacion como siempre. Un default aqui le pondria la misma cara a todo lo que ya existe.
 *
 * Guarda el SLUG (`work`, `leaf`, `trophy`), nunca una imagen: los archivos viven en
 * `assets/icons3d/` dentro del bundle de la app. El catalogo se valida en `domain/task.js`, como el
 * resto — la tabla no lleva CHECK porque ALTER TABLE en SQLite no puede añadirlos.
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE tasks ADD COLUMN icon TEXT')
}

export async function down(knex) {
  await knex.raw('ALTER TABLE tasks DROP COLUMN icon')
}
