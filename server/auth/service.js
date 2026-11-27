import { timingSafeEqual } from 'node:crypto';
import {
  decryptSecret,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  randomToken,
  sha256Hex,
  verifyPassword,
  verifyTotpCode,
} from './crypto.js';
import { getClientIp, HttpError, parseCookies, serializeCookie } from '../lib/http.js';

export const SESSION_COOKIE_NAME = 'kaelion_sid';

export function publicUser(user) {
  return {
    id: user.id,
    email: user.emailRaw,
    fullName: user.fullName,
    role: user.role,
    emailVerified: Boolean(user.emailVerifiedAt),
    mfaEnabled: Boolean(user.mfaEnabled),
  };
}

export function createAuthService({ store, config, mailService, rateLimiter }) {
  function buildSessionCookie(rawToken, clear = false) {
    return serializeCookie(SESSION_COOKIE_NAME, clear ? '' : rawToken, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: clear ? 0 : config.security.sessionTtlHours * 3600,
    });
  }

  async function authenticateRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken || rawToken.length < 20) return null;
    const tokenHash = sha256Hex(rawToken);
    const session = await store.findActiveSessionByTokenHash(tokenHash);
    if (!session) return null;
    return { ...session, rawTokenHash: tokenHash };
  }

  function assertCsrf(req, session) {
    const originHeader = req.headers.origin;
    if (originHeader && !config.allowedOrigins.has(originHeader)) {
      throw new HttpError(403, 'invalid_origin', 'Origen no autorizado para esta operación.');
    }
    const referer = req.headers.referer;
    if (!originHeader && referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (!config.allowedOrigins.has(refOrigin)) {
          throw new HttpError(403, 'invalid_origin', 'Referer no autorizado.');
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(403, 'invalid_origin', 'Referer inválido.');
      }
    }

    const provided = String(req.headers['x-csrf-token'] || '');
    const expected = String(session?.csrfToken || '');
    if (
      !provided ||
      !expected ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      throw new HttpError(403, 'csrf_invalid', 'Token de seguridad CSRF inválido o ausente.');
    }
  }

  async function register({ email, password, fullName, privacyAccepted }, req) {
    const ip = getClientIp(req);
    rateLimiter.consume(`register:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });

    const emailRaw = String(email || '').trim();
    const emailNormalized = normalizeEmail(emailRaw);
    const cleanName = String(fullName || '').trim();

    if (!isValidEmail(emailNormalized)) {
      throw new HttpError(400, 'invalid_email', 'Ingresa un correo electrónico válido.');
    }
    if (cleanName.length < 2 || cleanName.length > 160) {
      throw new HttpError(400, 'invalid_name', 'Ingresa tu nombre completo (entre 2 y 160 caracteres).');
    }
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
      throw new HttpError(400, 'weak_password', 'La contraseña debe tener al menos 10 caracteres.');
    }
    if (!privacyAccepted) {
      throw new HttpError(400, 'privacy_required', 'Debes aceptar el Aviso de Privacidad para crear tu cuenta.');
    }

    const existing = await store.findUserByEmail(emailNormalized);
    if (existing) {
      throw new HttpError(409, 'email_in_use', 'Ya existe una cuenta registrada con ese correo electrónico.');
    }

    const passwordHash = await hashPassword(password);
    const verifyRawToken = randomToken(32);
    const verifyTokenHash = sha256Hex(verifyRawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await store.withTransaction(async (tx) => {
      const created = await tx.createUser({
        emailNormalized,
        emailRaw,
        fullName: cleanName,
        passwordHash,
        role: 'client',
      });
      await tx.createEmailToken({
        userId: created.id,
        tokenHash: verifyTokenHash,
        purpose: 'verify_email',
        expiresAt,
      });
      const verifyUrl = `${config.appOrigin}/portal/?verify_token=${encodeURIComponent(verifyRawToken)}`;
      await tx.enqueueOutbox({
        recipientEmail: created.emailRaw,
        templateName: 'verify_email',
        subject: 'Verifica tu correo — Portal KAELION Digital Art',
        payloadJson: { fullName: created.fullName, verifyUrl },
      });
      await tx.insertAuditLog({
        actorUserId: created.id,
        actorRole: 'client',
        action: 'auth.register',
        targetType: 'user',
        targetId: created.id,
        outcome: 'ok',
        ipAddress: ip,
      });
      return created;
    });

    mailService.kickOutbox();

    return {
      user: publicUser(user),
      message: 'Cuenta creada. Revisa tu correo para verificar tu dirección antes de iniciar sesión.',
      ...(config.nodeEnv === 'test' || (config.nodeEnv === 'development' && !config.smtp.host)
        ? { devVerificationToken: verifyRawToken }
        : {}),
    };
  }

  async function verifyEmail({ token }, req) {
    const ip = getClientIp(req);
    rateLimiter.consume(`verify:${ip}`, { max: 20, windowMs: 15 * 60 * 1000 });

    const raw = String(token || '').trim();
    if (!raw || raw.length < 20) {
      throw new HttpError(400, 'invalid_token', 'El enlace de verificación no es válido.');
    }
    const tokenHash = sha256Hex(raw);

    const user = await store.withTransaction(async (tx) => {
      const tokenRec = await tx.findValidEmailToken(tokenHash, 'verify_email');
      if (!tokenRec) {
        throw new HttpError(400, 'invalid_or_expired_token', 'El enlace de verificación venció o ya fue utilizado.');
      }
      await tx.markEmailTokenUsed(tokenRec.id);
      const updated = await tx.updateUser(tokenRec.userId, { emailVerifiedAt: new Date() });
      await tx.insertAuditLog({
        actorUserId: tokenRec.userId,
        actorRole: updated?.role || 'client',
        action: 'auth.verify_email',
        targetType: 'user',
        targetId: tokenRec.userId,
        outcome: 'ok',
        ipAddress: ip,
      });
      return updated;
    });

    return { verified: true, user: publicUser(user) };
  }

  async function login({ email, password, totpCode, requiredRole = null }, req) {
    const ip = getClientIp(req);
    const emailNormalized = normalizeEmail(email);
    rateLimiter.consume(`login:${ip}:${emailNormalized}`, { max: 10, windowMs: 15 * 60 * 1000 });

    const user = await store.findUserByEmail(emailNormalized);
    const passwordOk = user ? await verifyPassword(String(password || ''), user.passwordHash) : false;

    if (!user || !passwordOk || user.status !== 'active') {
      await store.insertAuditLog({
        actorUserId: user?.id || null,
        actorRole: user?.role || 'anonymous',
        action: 'auth.login_failed',
        outcome: 'denied',
        metadataJson: { reason: 'bad_credentials' },
        ipAddress: ip,
      });
      throw new HttpError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.');
    }

    if (requiredRole && user.role !== requiredRole) {
      await store.insertAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.login_role_denied',
        outcome: 'denied',
        metadataJson: { requiredRole },
        ipAddress: ip,
      });
      throw new HttpError(403, 'forbidden_role', 'Esta cuenta no tiene acceso al panel solicitado.');
    }

    if (!user.emailVerifiedAt) {
      throw new HttpError(403, 'email_not_verified', 'Debes verificar tu correo electrónico antes de iniciar sesión.');
    }

    if (user.mfaEnabled && user.mfaSecretEnc) {
      if (!totpCode) {
        throw new HttpError(401, 'mfa_required', 'Ingresa el código de verificación de 6 dígitos (MFA).');
      }
      const secret = decryptSecret(user.mfaSecretEnc, config.security.sessionSecret);
      if (!verifyTotpCode(secret, totpCode)) {
        await store.insertAuditLog({
          actorUserId: user.id,
          actorRole: user.role,
          action: 'auth.mfa_failed',
          outcome: 'denied',
          ipAddress: ip,
        });
        throw new HttpError(401, 'invalid_mfa', 'El código MFA no es válido o venció.');
      }
    }

    const rawSessionToken = randomToken(32);
    const tokenHash = sha256Hex(rawSessionToken);
    const csrfToken = randomToken(32);
    const expiresAt = new Date(Date.now() + config.security.sessionTtlHours * 3600 * 1000);

    await store.createSession({
      tokenHash,
      csrfToken,
      userId: user.id,
      ipAddress: ip,
      userAgent: req.headers['user-agent'] || '',
      expiresAt,
    });

    await store.insertAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.login',
      outcome: 'ok',
      ipAddress: ip,
    });

    return {
      user: publicUser(user),
      csrfToken,
      cookieHeader: buildSessionCookie(rawSessionToken, false),
    };
  }

  async function logout(req, session) {
    if (session?.rawTokenHash) {
      await store.revokeSessionByTokenHash(session.rawTokenHash);
      await store.insertAuditLog({
        actorUserId: session.userId,
        actorRole: session.user.role,
        action: 'auth.logout',
        outcome: 'ok',
        ipAddress: getClientIp(req),
      });
    }
    return { cookieHeader: buildSessionCookie('', true) };
  }

  async function requestPasswordReset({ email }, req) {
    const ip = getClientIp(req);
    const emailNormalized = normalizeEmail(email);
    rateLimiter.consume(`reset_req:${ip}`, { max: 8, windowMs: 15 * 60 * 1000 });

    const user = isValidEmail(emailNormalized) ? await store.findUserByEmail(emailNormalized) : null;
    let devResetToken;
    if (user && user.status === 'active') {
      const rawToken = randomToken(32);
      const tokenHash = sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await store.withTransaction(async (tx) => {
        await tx.createEmailToken({
          userId: user.id,
          tokenHash,
          purpose: 'password_reset',
          expiresAt,
        });
        const resetUrl = `${config.appOrigin}/portal/?reset_token=${encodeURIComponent(rawToken)}`;
        await tx.enqueueOutbox({
          recipientEmail: user.emailRaw,
          templateName: 'password_reset',
          subject: 'Recuperación de acceso — KAELION Digital Art',
          payloadJson: { fullName: user.fullName, resetUrl },
        });
        await tx.insertAuditLog({
          actorUserId: user.id,
          actorRole: user.role,
          action: 'auth.password_reset_requested',
          outcome: 'ok',
          ipAddress: ip,
        });
      });
      mailService.kickOutbox();
      if (config.nodeEnv === 'test' || (config.nodeEnv === 'development' && !config.smtp.host)) {
        devResetToken = rawToken;
      }
    }

    return {
      message: 'Si el correo está registrado, recibirás un enlace de un solo uso para restablecer tu contraseña.',
      ...(devResetToken ? { devResetToken } : {}),
    };
  }

  async function resetPassword({ token, newPassword }, req) {
    const ip = getClientIp(req);
    rateLimiter.consume(`reset_confirm:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });

    if (typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128) {
      throw new HttpError(400, 'weak_password', 'La nueva contraseña debe tener al menos 10 caracteres.');
    }
    const tokenHash = sha256Hex(String(token || '').trim());
    const passwordHash = await hashPassword(newPassword);

    await store.withTransaction(async (tx) => {
      const tokenRec = await tx.findValidEmailToken(tokenHash, 'password_reset');
      if (!tokenRec) {
        throw new HttpError(400, 'invalid_or_expired_token', 'El enlace de recuperación venció o ya fue utilizado.');
      }
      await tx.markEmailTokenUsed(tokenRec.id);
      await tx.updateUser(tokenRec.userId, { passwordHash });
      await tx.revokeAllSessionsForUser(tokenRec.userId);
      await tx.insertAuditLog({
        actorUserId: tokenRec.userId,
        actorRole: 'client',
        action: 'auth.password_reset_completed',
        outcome: 'ok',
        ipAddress: ip,
      });
    });

    return { ok: true, message: 'Contraseña actualizada. Inicia sesión con tu nueva clave.' };
  }

  return {
    authenticateRequest,
    assertCsrf,
    register,
    verifyEmail,
    login,
    logout,
    requestPasswordReset,
    resetPassword,
  };
}
