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
| `POST` | `/me/devices` | `{ token, platform }` guarda el Expo push token |

`/me/today` devuelve `{ date, user, counts, next, running, tasks }`: exactamente lo que
necesitan el widget de iOS, el de Android y la Live Activity, sin encadenar peticiones.

## Errores

Siempre JSON. `{ "error": "..." }` y, cuando es validación, `{ "error": "...", "fields": { "title": "..." } }`
para que la app marque el campo exacto.

`400` validación · `401` sin token o credenciales malas · `404` no existe o no es tuyo ·
`409` duplicado o timer ocupado · `500` bug nuestro.

## Deuda consciente

- **Sin scheduler de push.** `dueAt` se guarda pero nadie envía nada: la app programa
  notificaciones locales con `expo-notifications`, que sobreviven a que se cierre la app y
  no cuestan servidor. Los tokens ya se recolectan para cuando haga falta push de verdad
  (rachas, recordatorios entre dispositivos).
- **Sin rate limit en `/auth/login`.** Agregar antes de exponerlo a internet.
- **Sin refresh tokens.** El JWT dura 30 días y ya.
- **SQLite.** Migrar a Postgres cuando haya más de una instancia.
