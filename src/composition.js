import { getProfile } from './application/get-profile.js'
import { loginUser } from './application/login-user.js'
import { registerUser } from './application/register-user.js'
import { config } from './infrastructure/config.js'
import { openDatabase } from './infrastructure/db/sqlite.js'
import { createUserRepository } from './infrastructure/db/user-repository.js'
import { createApp } from './infrastructure/http/app.js'
import { scryptHasher } from './infrastructure/security/password-hasher.js'
import { createTokenService } from './infrastructure/security/token-service.js'

/** Composition root: el unico lugar que conoce todas las capas a la vez. */
export function buildApp(overrides = {}) {
  const settings = { ...config, ...overrides }

  const db = openDatabase(settings.dbPath)
  const deps = {
    users: createUserRepository(db),
    hasher: scryptHasher,
    tokens: createTokenService({ secret: settings.jwtSecret, expiresIn: settings.jwtExpiresIn }),
  }

  const useCases = {
    registerUser: registerUser(deps),
    loginUser: loginUser(deps),
    getProfile: getProfile(deps),
  }

  return {
    app: createApp({ useCases, tokens: deps.tokens, corsOrigin: settings.corsOrigin }),
    settings,
    close: () => db.close(),
  }
}
