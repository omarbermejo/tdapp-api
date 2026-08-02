import { authenticate } from './application/authenticate.js'
import { claimAvatar } from './application/claim-avatar.js'
import { acceptInvite } from './application/accept-invite.js'
import { createInvite } from './application/create-invite.js'
import { countUnread } from './application/count-unread.js'
import { createTask } from './application/create-task.js'
import { createWorkspace } from './application/create-workspace.js'
import { deleteAccount } from './application/delete-account.js'
import { deleteTask } from './application/delete-task.js'
import { deleteWorkspace } from './application/delete-workspace.js'
import { forgotPassword } from './application/forgot-password.js'
import { getProfile } from './application/get-profile.js'
import { getAvatars } from './application/get-avatars.js'
import { getStats } from './application/get-stats.js'
import { getStreak } from './application/get-streak.js'
import { getTaskCounts } from './application/get-task-counts.js'
import { getToday } from './application/get-today.js'
import { getWorkspace } from './application/get-workspace.js'
import { listEvents } from './application/list-events.js'
import { listTasks } from './application/list-tasks.js'
import { listCollaborators } from './application/list-collaborators.js'
import { listInvites } from './application/list-invites.js'
import { listMembers } from './application/list-members.js'
import { listWorkspaces } from './application/list-workspaces.js'
import { loginUser } from './application/login-user.js'
import { loginWithIdentity } from './application/login-with-identity.js'
import { orderTasks } from './application/order-tasks.js'
import { previewInvite } from './application/preview-invite.js'
import { readEvents } from './application/read-events.js'
import { recordEvent } from './application/record-event.js'
import { registerDevice } from './application/register-device.js'
import { registerUser } from './application/register-user.js'
import { resendCode } from './application/resend-code.js'
import { resetPassword } from './application/reset-password.js'
import { revokeInvite } from './application/revoke-invite.js'
import { sendVerificationCode } from './application/send-verification-code.js'
import { toggleTimer } from './application/toggle-timer.js'
import { updateProfile } from './application/update-profile.js'
import { updateTask } from './application/update-task.js'
import { updateWorkspace } from './application/update-workspace.js'
import { verifyEmail } from './application/verify-email.js'
import { OTP_RULES } from './domain/otp.js'
import { config } from './infrastructure/config.js'
import { createAvatarRepository } from './infrastructure/db/avatar-repository.js'
import { createDeviceRepository } from './infrastructure/db/device-repository.js'
import { createEventRepository } from './infrastructure/db/event-repository.js'
import { createInviteRepository } from './infrastructure/db/invite-repository.js'
import { createMemberRepository } from './infrastructure/db/member-repository.js'
import { createOtpRepository } from './infrastructure/db/otp-repository.js'
import { openDatabase } from './infrastructure/db/sqlite.js'
import { createTaskRepository } from './infrastructure/db/task-repository.js'
import { createUserRepository } from './infrastructure/db/user-repository.js'
import { createWorkspaceRepository } from './infrastructure/db/workspace-repository.js'
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
    workspaces: createWorkspaceRepository(db),
    members: createMemberRepository(db),
    invites: createInviteRepository(db),
    avatars: createAvatarRepository(db),
    devices: createDeviceRepository(db),
    events: createEventRepository(db),
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
  /**
   * El registro de novedades es una DEPENDENCIA, no un caso de uso suelto: lo llaman crear, editar y
   * borrar tarea, y ninguno deberia conocer ni la tabla ni el hub. Se arma aqui, como `sendCode`.
   *
   * `hub` entra por `overrides` y por defecto no existe: sin nadie escuchando, `record-event` solo
   * escribe la fila. Eso es lo que hace que los quince archivos de tests no se enteren de los sockets.
   */
  deps.recordEvent = recordEvent(deps)

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

    // El vestidor: que caras hay, cuales se ganaron y cual se elige de cada logro.
    getAvatars: getAvatars(deps),
    claimAvatar: claimAvatar(deps),

    createTask: createTask(deps),
    listTasks: listTasks(deps),
    updateTask: updateTask(deps),
    deleteTask: deleteTask(deps),
    orderTasks: orderTasks(deps),
    toggleTimer: toggleTimer(deps),
    getToday: getToday(deps),
    getStreak: getStreak(deps),
    getStats: getStats(deps),
    getTaskCounts: getTaskCounts(deps),

    listEvents: listEvents(deps),
    readEvents: readEvents(deps),
    countUnread: countUnread(deps),

    listWorkspaces: listWorkspaces(deps),
    getWorkspace: getWorkspace(deps),
    createWorkspace: createWorkspace(deps),
    updateWorkspace: updateWorkspace(deps),
    deleteWorkspace: deleteWorkspace(deps),

    // Invitaciones y gente: quien entra a un espacio y con quien ya has trabajado.
    createInvite: createInvite(deps),
    listInvites: listInvites(deps),
    revokeInvite: revokeInvite(deps),
    previewInvite: previewInvite(deps),
    acceptInvite: acceptInvite(deps),
    listMembers: listMembers(deps),
    listCollaborators: listCollaborators(deps),

    registerDevice: registerDevice(deps),
  }

  return {
    app: createApp({ useCases, tokens: deps.tokens, corsOrigin: settings.corsOrigin }),
    settings,
    close: () => db.close(),
  }
}
