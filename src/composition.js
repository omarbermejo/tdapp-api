import { authenticate } from './application/authenticate.js'
import { createTask } from './application/create-task.js'
import { deleteAccount } from './application/delete-account.js'
import { deleteTask } from './application/delete-task.js'
import { forgotPassword } from './application/forgot-password.js'
import { getProfile } from './application/get-profile.js'
import { getStats } from './application/get-stats.js'
import { getStreak } from './application/get-streak.js'
import { getTaskCounts } from './application/get-task-counts.js'
import { getToday } from './application/get-today.js'
import { listTasks } from './application/list-tasks.js'
import { loginUser } from './application/login-user.js'
import { loginWithIdentity } from './application/login-with-identity.js'
import { registerDevice } from './application/register-device.js'
import { registerUser } from './application/register-user.js'
import { resendCode } from './application/resend-code.js'
import { resetPassword } from './application/reset-password.js'
import { sendVerificationCode } from './application/send-verification-code.js'
import { toggleTimer } from './application/toggle-timer.js'
import { updateProfile } from './application/update-profile.js'
import { updateTask } from './application/update-task.js'
import { verifyEmail } from './application/verify-email.js'
import { OTP_RULES } from './domain/otp.js'
import { config } from './infrastructure/config.js'
import { createDeviceRepository } from './infrastructure/db/device-repository.js'
import { createOtpRepository } from './infrastructure/db/otp-repository.js'
import { openDatabase } from './infrastructure/db/sqlite.js'
import { createTaskRepository } from './infrastructure/db/task-repository.js'
import { createUserRepository } from './infrastructure/db/user-repository.js'
import { createApp } from './infrastructure/http/app.js'
import { createConsoleMailer } from './infrastructure/mail/console-mailer.js'
import { createResendMailer } from './infrastructure/mail/resend-mailer.js'
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
    otps: createOtpRepository(db),
    hasher: scryptHasher,
    tokens: createTokenService({ secret: settings.jwtSecret, expiresIn: settings.jwtExpiresIn }),
    // overrides.google/apple/mailer existen para que los tests no llamen a nadie de verdad.
    google: settings.google ?? createGoogleVerifier({ clientIds: settings.googleClientIds }),
    apple: settings.apple ?? createAppleVerifier({ clientIds: settings.appleClientIds }),
    mailer:
      settings.mailer ??
      (settings.resendApiKey
        ? createResendMailer({ apiKey: settings.resendApiKey, from: settings.mailFrom })
        : createConsoleMailer()),
    // overrides.otp deja probar expiracion y cooldown sin esperas reales.
    otpRules: { ...OTP_RULES, ...(settings.otp ?? {}) },
  }
  // El emisor de codigos es una dependencia mas: lo comparten el registro y el reenvio.
  deps.sendCode = sendVerificationCode(deps)

  const useCases = {
    // Lo usa requireAuth en cada request autenticado, no un endpoint.
    authenticate: authenticate(deps),
    registerUser: registerUser(deps),
    loginUser: loginUser(deps),
    loginWithGoogle: loginWithIdentity(deps, deps.google, 'google'),
    loginWithApple: loginWithIdentity(deps, deps.apple, 'apple'),
    verifyEmail: verifyEmail(deps),
    resendCode: resendCode(deps),
    forgotPassword: forgotPassword(deps),
    resetPassword: resetPassword(deps),
    getProfile: getProfile(deps),
    updateProfile: updateProfile(deps),
    deleteAccount: deleteAccount(deps),

    createTask: createTask(deps),
    listTasks: listTasks(deps),
    updateTask: updateTask(deps),
    deleteTask: deleteTask(deps),
    toggleTimer: toggleTimer(deps),
    getToday: getToday(deps),
    getStreak: getStreak(deps),
    getStats: getStats(deps),
    getTaskCounts: getTaskCounts(deps),
    registerDevice: registerDevice(deps),
  }

  return {
    app: createApp({ useCases, tokens: deps.tokens, corsOrigin: settings.corsOrigin }),
    settings,
    close: () => db.close(),
  }
}
