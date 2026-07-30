import { createTask } from './application/create-task.js'
import { deleteTask } from './application/delete-task.js'
import { getProfile } from './application/get-profile.js'
import { getToday } from './application/get-today.js'
import { listTasks } from './application/list-tasks.js'
import { loginUser } from './application/login-user.js'
import { loginWithIdentity } from './application/login-with-identity.js'
import { registerDevice } from './application/register-device.js'
import { registerUser } from './application/register-user.js'
import { toggleTimer } from './application/toggle-timer.js'
import { updateTask } from './application/update-task.js'
import { config } from './infrastructure/config.js'
import { createDeviceRepository } from './infrastructure/db/device-repository.js'
import { openDatabase } from './infrastructure/db/sqlite.js'
import { createTaskRepository } from './infrastructure/db/task-repository.js'
import { createUserRepository } from './infrastructure/db/user-repository.js'
import { createApp } from './infrastructure/http/app.js'
import { createAppleVerifier } from './infrastructure/security/apple-verifier.js'
import { createGoogleVerifier } from './infrastructure/security/google-verifier.js'
import { scryptHasher } from './infrastructure/security/password-hasher.js'
import { createTokenService } from './infrastructure/security/token-service.js'

/** Composition root: el unico lugar que conoce todas las capas a la vez. */
export function buildApp(overrides = {}) {
  const settings = { ...config, ...overrides }

  const db = openDatabase(settings.dbPath)
  const deps = {
    users: createUserRepository(db),
    tasks: createTaskRepository(db),
    devices: createDeviceRepository(db),
    hasher: scryptHasher,
    tokens: createTokenService({ secret: settings.jwtSecret, expiresIn: settings.jwtExpiresIn }),
    // overrides.google/apple existen para que los tests no llamen al proveedor de verdad.
    google: settings.google ?? createGoogleVerifier({ clientIds: settings.googleClientIds }),
    apple: settings.apple ?? createAppleVerifier({ clientIds: settings.appleClientIds }),
  }

  const useCases = {
    registerUser: registerUser(deps),
    loginUser: loginUser(deps),
    loginWithGoogle: loginWithIdentity(deps, deps.google),
    loginWithApple: loginWithIdentity(deps, deps.apple),
    getProfile: getProfile(deps),

    createTask: createTask(deps),
    listTasks: listTasks(deps),
    updateTask: updateTask(deps),
    deleteTask: deleteTask(deps),
    toggleTimer: toggleTimer(deps),
    getToday: getToday(deps),
    registerDevice: registerDevice(deps),
  }

  return {
    app: createApp({ useCases, tokens: deps.tokens, corsOrigin: settings.corsOrigin }),
    settings,
    close: () => db.close(),
  }
}
