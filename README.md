# tdapp-api

API de tdapp. Node 24 + Express 5 + `node:sqlite`. Sin infraestructura: `npm start` y listo.

```bash
cp .env.example .env
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'  # pega esto en JWT_SECRET
npm install
npm run dev     # recarga al guardar
npm test        # 19 tests
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

Solo `email`, `password` y `name` son obligatorios al registrar. El resto del perfil
(`birthDate`, `focusAreas`, `peakEnergy`, `reminderStyle`, `reminderHour`, `accentColor`)
cae en defaults para que el onboarding se pueda saltar.

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
| `POST` | `/me/devices` | `{ token, platform }` guarda el Expo push token |

`/me/today` devuelve `{ date, user, counts, next, running, tasks }`: exactamente lo que
necesitan el widget de iOS, el de Android y la Live Activity, sin encadenar peticiones.

`/me/streak` devuelve `{ date, days, best, week }`, con `week` de lunes a domingo y un `done` por día.
Va aparte de `/today` porque son dos preguntas distintas: el widget de racha no necesita las tareas
del día ni al contrario, y juntarlas obligaría a la mitad de los widgets a traerse datos que no usan.

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

- **Sin scheduler de push.** `dueAt` se guarda pero nadie envía nada: la app programa
  notificaciones locales con `expo-notifications`, que sobreviven a que se cierre la app y
  no cuestan servidor. Los tokens ya se recolectan para cuando haga falta push de verdad
  (rachas, recordatorios entre dispositivos).
- **Sin refresh tokens.** El JWT dura 30 días y ya.
- **SQLite.** Migrar a Postgres cuando haya más de una instancia. Hasta entonces el despliegue está
  acotado a UNA: el freno del login vive en memoria del proceso, así que con réplicas cada una llevaría
  su cuenta y el límite real sería el doble o el triple.
- **`expo-widgets` no soporta Android todavía.** Su `WidgetsModule.kt` tiene 10 líneas contra 149 del
  de iOS y el widget de Glance pinta literalmente el nombre del widget (`Text(widgetName)`), así que
  el widget de Android va escrito a mano en Kotlin. No afecta al API — los dos comen del mismo
  `/me/today` y `/me/streak`.
