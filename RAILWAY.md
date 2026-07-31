# Railway — el despliegue del API

El API vive en **https://tdapp-api-production.up.railway.app**

Este documento es el runbook: qué hay montado, por qué está montado así, y qué hacer cuando algo falle.
La configuración declarada vive en [`railway.json`](railway.json); aquí está el *porqué*, que en un JSON no
cabe.

## Coordenadas

| | |
|---|---|
| proyecto | `supportive-embrace` · `bcea9c6c-d3f4-48bd-81b6-00b9655ef938` |
| entorno | `production` · `bd6616c5-d688-4206-a05c-b4b5bbb2aefd` |
| servicio | `tdapp-api` · `86e5a60b-5283-42b0-b724-6b19c33cdab3` |
| dominio | `tdapp-api-production.up.railway.app` |
| volumen | `tdapp-api-volume`, montado en `/data`, 500 MB |
| builder | Nixpacks |
| réplicas | 1 (obligatorio, ver abajo) |

## Variables de entorno

Se consultan con `railway variables` y se ponen con `railway variables --set "CLAVE=valor"`.

| variable | valor | por qué |
|---|---|---|
| `JWT_SECRET` | *(secreto, 32 bytes hex)* | `config.js` lanza al importarse si falta |
| `DB_PATH` | `/data/tdapp.db` | **dentro del volumen.** Fuera de `/data` cada deploy borraría las cuentas |
| `PORT` | `3000` | Railway no la inyecta solo; sin ella el enrutado del dominio no encuentra el proceso |
| `JWT_EXPIRES_IN` | `30d` | |
| `GOOGLE_CLIENT_IDS` | dos IDs separados por coma (iOS, Android) | deben coincidir con los `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` de la app |
| `APPLE_CLIENT_IDS` | `com.tdapp.tdapp` | es el *bundle identifier*, no un client id aparte |
| `MAIL_FROM` | `tdapp <onboarding@resend.dev>` | |
| `NPM_CONFIG_OMIT` | `dev` | ver "por qué no se instalan las devDependencies" |
| `RESEND_API_KEY` | **sin poner** | mientras esté vacía, el código de verificación **sale en los logs** en vez de por correo |
| `CORS_ORIGIN` | sin poner → `*` | aceptable: la auth va por Bearer y no hay cookies, así que no hay CSRF que explotar. Acotar si algún día se sirve web desde un dominio propio |

`RAILWAY_ENVIRONMENT` la inyecta la plataforma y `main.js` la usa para **no** imprimir la IP de LAN, que
dentro de un contenedor no lleva a ninguna parte.

## Cómo desplegar

```bash
cd tdapp-api
railway up --detach          # sube el directorio (no el git) y construye
railway logs                 # los de runtime cuando ya arrancó; los de build mientras construye
railway redeploy --yes       # reinicia sin reconstruir
railway variables            # ver la config actual
```

El arranque correcto se ve así en los logs — si no aparecen las dos partes, algo va mal:

```
> node ... scripts/migrate.js && node ... src/main.js
Sin migraciones pendientes (9 aplicadas en /data/tdapp.db)
API   http://localhost:3000
```

## Las cuatro decisiones que no son obvias

### 1. La migración va dentro de `npm start`, no en `preDeployCommand`

Estuvo un rato como `preDeployCommand` y **costó cuatro despliegues encontrarlo**, porque el síntoma
mentía: el build terminaba bien, la imagen se subía a la registry… y el servicio **nunca arrancaba ni
dejaba un solo log de runtime**.

Ésa es la firma exacta de un pre-deploy que falla: bloquea la promoción del deployment, y sus logs no
salen junto a los del servicio, así que no hay nada que leer. Se parece a un cuelgue del build cuando en
realidad el build ya había acabado.

Encadenar la migración al arranque (`migrate.js && main.js`) quita esa fase silenciosa y manda su salida a
los logs normales. Es idempotente —`migrate.js` consulta lo pendiente y sale si no hay nada—, así que
reiniciar no cuesta nada.

### 2. No se instalan las devDependencies (`NPM_CONFIG_OMIT=dev`)

`better-sqlite3@13` **no publica binarios precompilados**: siempre compila con node-gyp, y eso pide Python
y un toolchain de C que la imagen no tiene. `npm ci` reventaba el build.

Pero el runtime no lo usa: el API lee y escribe con `node:sqlite` desde el principio, y `better-sqlite3`
solo existía para que knex pudiera migrar. De ahí [`scripts/migrate.js`](scripts/migrate.js), que aplica
las mismas 9 migraciones sin tocar ninguna, con un shim de dos métodos, y escribe la misma tabla
`knex_migrations` para que knex siga funcionando en desarrollo.

Va como **variable de entorno**, no como `buildCommand`. Nixpacks corre su propia fase `npm ci` e ignora
el `buildCommand` (que es la fase siguiente), y meter ahí un `npm ci` propio da
`EBUSY: rmdir '/app/node_modules/.cache'`, porque Nixpacks tiene un cache montado dentro de
`node_modules` y `npm ci` borra el directorio entero.

### 3. `PORT` hay que ponerla a mano

Railway no la inyectó, así que el API caía en su default 3000 mientras el dominio se creó con
`Target port: -`. Resultado: el dominio no encontraba a quién enrutar y todo daba error de conexión.
`main.js` ya escucha en `0.0.0.0`, que es la otra mitad del requisito.

### 4. Una sola réplica, y no es negociable

La base es SQLite en un volumen: dos réplicas no pueden compartirlo. Y el rate limit de
`/auth/login` cuenta **en memoria del proceso**, así que con N réplicas el límite real sería N veces el
declarado. Cuando haga falta escalar, las dos cosas se mudan a la vez (Postgres + almacén compartido).

## Verificación después de un deploy

```bash
API=https://tdapp-api-production.up.railway.app
curl -s $API/health                                  # {"ok":true}
curl -s $API/auth/catalogs                           # los catálogos, sin token
curl -s -o /dev/null -w '%{http_code}\n' $API/tasks  # 401
```

Comprobado en el despliegue inicial, con evidencia:

- registro → OTP (de los logs) → `/auth/verify` → `emailVerified: true`
- login → `/tasks`, `/me/today`, `/me/streak` responden con datos
- rate limit: 8 intentos dan 401, **el 9.º da 429** con mensaje genérico
- reinicio: el usuario y su tarea sobreviven, y la migración dice *"Sin migraciones pendientes
  (9 aplicadas)"* — eso prueba a la vez que el volumen persiste y que el migrador es idempotente

## Trampas conocidas

- **El token de `/auth/register` es anterior a la verificación.** Sigue diciendo
  `Verifica tu correo para continuar` aunque ya hayas verificado. Hay que usar el token que devuelve
  `/auth/verify`, o hacer login otra vez.
- **El servidor calcula "hoy" en UTC** (`new Date().toISOString().slice(0,10)`). No es un bug del
  despliegue: `toISOString()` ignora `TZ`, así que poner `TZ` **no lo arreglaría**. La app ya esquiva
  esto mandando `?date=` con su fecha local en `today`, `streak` y la sincronización de widgets. Solo
  aparece si llamas sin el parámetro, p. ej. con curl.
- **El OTP sale en los logs** mientras `RESEND_API_KEY` esté vacía. Cómodo para probar, inaceptable
  cuando haya usuarios de verdad.
- **Quedó un usuario de prueba** (`humo-…@nexgen.mx`, id 1) del humo test inicial. Inocuo: cada usuario
  solo ve sus tareas.
- `expo-widgets` estuvo un tiempo en las `dependencies` de este repo, instalado por error desde el
  directorio equivocado. Nada del backend lo importa. Si reaparece, fuera.
