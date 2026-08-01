# tdapp-api

API de tdapp. Node 24 + Express 5 + `node:sqlite`. Sin infraestructura: `npm start` y listo.

```bash
cp .env.example .env
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'  # pega esto en JWT_SECRET
npm install
npm run dev     # recarga al guardar
npm test        # 145 tests
```

Al arrancar imprime la IP de LAN. Esa es la que usa el celular; `localhost` solo funciona en el simulador.

## Estructura

```
src/
  domain/          reglas de negocio puras (user, task, device, errors)
  application/     casos de uso, reciben sus dependencias por parametro
  infrastructure/  express, sqlite, jwt, verificadores de Google/Apple
  composition.js   composition root: el unico lugar que conoce todas las capas
```

## Auth

Todo lo de `/tasks` y `/me` va con `Authorization: Bearer <token>`.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | ping |
| `GET` | `/auth/catalogs` | opciones del perfil TDAH para pintar el registro |
| `POST` | `/auth/register` | `{ email, password, name, ...perfil }` → `{ token, user }` |
| `POST` | `/auth/login` | `{ email, password }` → `{ token, user }` |
| `POST` | `/auth/google` | `{ idToken }` → `{ token, user }`, crea la cuenta si el correo es nuevo |
| `POST` | `/auth/apple` | `{ idToken, name? }` → `{ token, user }` |
| `POST` | `/auth/forgot` | `{ email }` → **`202` siempre** |
| `POST` | `/auth/reset` | `{ email, code, password }` → `{ token, user }` |
| `DELETE` | `/me` | `{ password }` en cuentas de correo, vacío en las de Google/Apple → `204` |

**`/auth/forgot` contesta `202` exista la cuenta o no**, sea de Google o esté en cooldown. Si un correo
sin cuenta diera `404`, el endpoint sería un buscador de correos registrados: se pregunta uno a uno y la
respuesta lo dice. `/auth/reset` sostiene lo mismo — correo inexistente, cuenta de Google y código
equivocado dan el **mismo** `400`. Son los dos únicos endpoints de código que reciben el correo en el
body, y es inevitable: todavía no hay sesión de la que sacar de quién es la cuenta.

Lo que hace que el 202 no sea una mentira es `skipIfActive`: sin él, pedir el código dos veces seguidas
daría `429`, y un `429` solo puede salir de una cuenta real. El limitador (**5 por correo cada 15 min**)
salta *antes* del caso de uso y sin tocar la base, así que frena igual con un correo que no existe.

Resetear **deja el correo verificado de paso**: el código llegó a ese buzón y volvió escrito, que es
exactamente la prueba que pide la verificación. Sin eso, quien recupera su contraseña sin haber
verificado saldría a la pantalla del código a demostrar otra vez lo que acaba de demostrar.

**`DELETE /me` va antes del gate de correo verificado**, con `GET /me` y no con el resto: una cuenta sin
verificar también tiene derecho a irse, y es justo con una cuenta recién creada con la que App Review
prueba esto (guideline 5.1.1(v)). Un solo `DELETE FROM users` se lleva tareas, perfil, dispositivos y
códigos — las cuatro tablas hijas declaran `ON DELETE CASCADE` y `sqlite.js` prende `PRAGMA foreign_keys`.
El token sigue firmado hasta que venza y no hay lista negra: no abre nada porque cada consulta filtra por
`user_id` sobre una fila que ya no existe.

Solo `email`, `password` y `name` son obligatorios al registrar. El resto del perfil
(`birthDate`, `focusAreas`, `peakEnergy`, `reminderStyle`, `reminderHour`, `accentColor`, `avatar`)
cae en defaults para que el onboarding se pueda saltar.

`avatar` es el identificador del memoji (`memoji-07`), no un archivo ni una URL: las imágenes viven
en el bundle de la app. `null` significa "no eligió" y la app pinta la inicial del nombre. No sale en
`/auth/catalogs` porque su respuesta depende de quién pregunta — ver **Caras**.

## Tareas

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/tasks/catalogs` | `size`, `status`, `focusArea`, `sizeMinutes` (público) |
| `GET` | `/tasks` | filtros opcionales `?status=` `?date=YYYY-MM-DD` `?focusArea=` |
| `POST` | `/tasks` | `{ title, notes?, size?, focusArea?, dueAt? }` → `201` |
| `PATCH` | `/tasks/:id` | parcial; lo que no mandas no se toca |
| `DELETE` | `/tasks/:id` | `204` |
| `POST` | `/tasks/:id/timer` | `{ action: "start" \| "stop" }` |

- `size`: `quick` (5 min) · `medium` (25) · `deep` (50). Sale en `suggestedMinutes`.
- `dueAt` es ISO **con zona**, ej `2026-08-01T18:00:00-06:00`. El servidor guarda además
  `dueDate` (`2026-08-01`) tomándolo del propio string: filtrar "hoy" es comparar texto y
  no adivinar zonas horarias.
- Solo puede haber un timer corriendo por usuario; arrancar otro devuelve `409`.
- `elapsedSeconds` ya viene sumado con el tramo en curso, la app no calcula nada.

## Widget, Live Activity y notificaciones

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/me` | perfil |
| `GET` | `/me/today` | `?date=YYYY-MM-DD` — todo el día en una llamada |
| `GET` | `/me/streak` | `?date=YYYY-MM-DD` — racha, mejor marca y el punteo de la semana |
| `GET` | `/me/tasks/summary` | `{ counts: { total, pending, done } }` de toda la cuenta |
| `GET` | `/me/avatars` | `?date=` — el vestidor: caras libres y los cinco logros |
| `POST` | `/me/avatars` | `{ milestone, avatar }` — quedarse una de las tres |
| `POST` | `/me/devices` | `{ token, platform }` guarda el Expo push token |

`/me/today` devuelve `{ date, user, counts, next, running, tasks }`: exactamente lo que
necesitan el widget de iOS, el de Android y la Live Activity, sin encadenar peticiones.

`/me/streak` devuelve `{ date, days, best, week }`, con `week` de lunes a domingo y un `done` por día.
Va aparte de `/today` porque son dos preguntas distintas: el widget de racha no necesita las tareas
del día ni al contrario, y juntarlas obligaría a la mitad de los widgets a traerse datos que no usan.

`/me/tasks/summary` es de por vida a propósito, y por eso no lo cubre `/me/stats`: ese mira una
ventana de 28 días y solo tareas con fecha, así que su `totals.done` **encoge con el tiempo** y no
cuenta lo que nunca se agendó. Sirve para una gráfica de progreso, no para el contador de un perfil.
Tampoco es una columna contador: se deriva de la tabla con un `GROUP BY status`, igual que `stage`
se deriva de sus dos fechas.

## Caras

El bundle de la app trae 45 memojis; el producto ofrece 23. **8 son libres** desde el primer día y
**15 se ganan**, de tres en tres, en cinco logros (`domain/avatar.js`). Las otras 22 no existen para
nadie: no las pinta la app ni las acepta el API. Son reserva para logros futuros, que sale más barato
que volver a cortar la lámina de Figma.

De cada logro se elige **una** de las tres, no se ganan las tres. Elegir obliga a mirarlas y quedarse
con la que te representa; un logro que suelta tres caras a la vez se pasa de largo.

| Logro | Meta |
|---|---|
| `first` | 1 tarea cerrada |
| `ten` | 10 tareas cerradas |
| `week` | racha de 7 días |
| `fifty` | 50 tareas cerradas |
| `month` | racha de 30 días |

Dos de volumen, dos de constancia y uno más de volumen: quien cierra mucho de golpe y quien cierra
poco todos los días llegan los dos a algún sitio.

**Si un logro está cumplido no se guarda: se deriva** del conteo histórico de tareas cerradas y de la
mejor racha, que ya viven en `tasks`. Una columna `unlocked_at` sería un tercer estado capaz de
contradecirlos — el mismo argumento con el que `stage` no es columna. Lo único que `user_avatars`
guarda es la elección, que es lo único que no se puede recalcular.

`done` es el histórico y **no** la ventana de `/me/stats`: con la ventana, un logro se podría
**perder** dejando pasar el tiempo, y un logro que se pierde solo no es un logro.

El permiso lo comprueba `update-profile.js`, no la app: `PATCH /me/profile` con una cara no ganada da
**403**. Que la pantalla no la pinte no basta — un PATCH a mano se la pondría igual, y entonces el
candado sería decorativo. Ese es también el motivo de que `avatar` pasara de validarse por patrón
(`/^memoji-\d{2}$/`) a validarse contra un catálogo cerrado: dejó de describir qué archivos existen y
pasó a describir quién puede usar cada uno.

Dos decisiones de la racha, las dos en `domain/streak.js`:

- **Se agrupa por `due_date` y no por `completed_at`.** `due_date` es el día local que mandó el
  cliente; `completed_at` es UTC. Con el segundo, cerrar algo a las 11 de la noche en México contaría
  para el día siguiente y la racha se rompería sola.
- **El día de hoy no cuenta hasta que cierras algo, pero tampoco la rompe.** Una racha que se pone en
  cero a las 00:01 castiga por no haber hecho nada a medianoche, y ese es justo el mensaje que hace
  que alguien con TDAH abandone la app. La racha se mide desde el último día con algo cerrado: si es
  hoy o ayer, sigue viva.

## Errores

Siempre JSON. `{ "error": "..." }` y, cuando es validación, `{ "error": "...", "fields": { "title": "..." } }`
para que la app marque el campo exacto.

`400` validación · `401` sin token o credenciales malas · `404` no existe o no es tuyo ·
`409` duplicado o timer ocupado · `500` bug nuestro.

## Producción

```bash
npm start          # migra y arranca, en ese orden
npm run release    # solo migra. Va ANTES de arrancar o `openDatabase` lanza "Base sin migrar"
```

**La migración vive dentro de `npm start`, no en un hook de la plataforma.** En Railway estuvo un rato
como `preDeployCommand` y el síntoma fue engañoso: el build terminaba bien, la imagen se subía, y el
servicio **nunca arrancaba ni dejaba un solo log de runtime**. Un pre-deploy que falla bloquea la
promoción del deployment y sus logs no salen junto a los del servicio, así que no hay nada que leer.
Encadenarlo al arranque quita esa fase silenciosa y manda la salida de la migración a los logs normales,
donde sí se ve qué pasó. Es idempotente (`migrate.js` consulta lo pendiente y sale si no hay nada), así
que reiniciar no cuesta nada; con varias réplicas habría que volver a separarlo — pero eso ya lo impide
SQLite, no esto.

Requiere **Node ≥ 24** (declarado en `engines`): el runtime importa `DatabaseSync` de `node:sqlite`,
que en 22 necesita `--experimental-sqlite` y en 20 no existe.

| variable | ¿obligatoria? | para qué |
|---|---|---|
| `JWT_SECRET` | **sí** | firma los tokens. `config.js` lanza al importarse sin ella |
| `DB_PATH` | **en la práctica sí** | el disco de un contenedor es efímero: apúntala a un volumen montado o cada deploy borra las cuentas |
| `CORS_ORIGIN` | recomendada | por defecto `*`, que solo sirve para Expo web en dev |
| `PORT` | no | la inyecta la plataforma; el default es 3000 |
| `RESEND_API_KEY` | no | vacía = el código de verificación sale en los logs en vez del correo |
| `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | no | vacías = `/auth/google` y `/auth/apple` responden 401 |

`/auth/login` tiene freno de fuerza bruta: **8 intentos por ventana deslizante de 10 minutos**, contados
por IP **y** por correo (uno solo deja hueco: por IP se salta rotando IPs, por correo se salta barriendo
correos). El middleware va antes del caso de uso, así que un intento frenado no llega a comparar el hash
—que es la parte cara— y entrar bien perdona los fallos anteriores.

**`app.set('trust proxy', 1)` es obligatorio detrás de un proxy** y vale `1`, no `true`: sin él `req.ip`
es la IP del proxy para todo el tráfico y el primer usuario que falle ocho veces bloquea al resto; con
`true` se creería cualquier `X-Forwarded-For` de la petición y el atacante elegiría su propia IP.

## Deuda consciente

- **Sin push, y a propósito.** La app programa notificaciones locales con `expo-notifications`: el
  recordatorio diario a `reminder_hour` (trigger `DAILY`, repite sin que la app corra) y un aviso diez
  minutos antes de cada tarea pendiente con `due_at` dentro de los próximos 7 días, con techo explícito
  de 60 por el límite de 64 pendientes de iOS. Sobreviven a que se cierre la app y no cuestan servidor,
  así que el API no envía nada y no hay scheduler.

  `POST /me/devices`, `register-device.js`, `device-repository.js` y la tabla `devices` siguen en pie
  pero **nadie escribe en ellos**. La frase que estaba aquí antes decía que los tokens "ya se
  recolectan": era falsa. La app leía `extra.eas.projectId` de un `app.json` que nunca lo tuvo, así que
  `registerPushDevice` salía siempre por `return 'unsupported'` y la tabla lleva vacía desde el primer
  día. Ese código se borró de la app; el permiso del sistema se quedó, porque los avisos locales lo
  necesitan igual.

  El push se gana cuando exista algo que el teléfono NO pueda saber al agendar — un aviso que nombre tu
  próxima tarea (el texto se congela al agendar) o cualquier cosa entre dispositivos. Ese día hacen
  falta además: proyecto de EAS, `extra.eas.projectId` en `app.json`, `remote-notification` en
  `UIBackgroundModes` y un scheduler aquí, que es la parte cara.
- **Sin refresh tokens.** El JWT dura 30 días y ya.
- **SQLite.** Migrar a Postgres cuando haya más de una instancia. Hasta entonces el despliegue está
  acotado a UNA: el freno del login vive en memoria del proceso, así que con réplicas cada una llevaría
  su cuenta y el límite real sería el doble o el triple.
- **`expo-widgets` no soporta Android todavía.** Su `WidgetsModule.kt` tiene 10 líneas contra 149 del
  de iOS y el widget de Glance pinta literalmente el nombre del widget (`Text(widgetName)`), así que
  el widget de Android va escrito a mano en Kotlin. No afecta al API — los dos comen del mismo
  `/me/today` y `/me/streak`.
