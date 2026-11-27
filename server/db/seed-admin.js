import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createStore } from './index.js';
import { hashPassword, normalizeEmail, encryptSecret, generateTotpSecret, buildOtpAuthUrl } from '../auth/crypto.js';

async function seedAdmin() {
  const config = loadConfig();
  const emailRaw = (process.env.ADMIN_EMAIL || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const fullName = (process.env.ADMIN_NAME || 'Taller KAELION').trim();
  const enableMfa = String(process.env.ADMIN_ENABLE_MFA || 'false').toLowerCase() === 'true';

  if (!emailRaw || !password || password.length < 12) {
    throw new Error('Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) antes de ejecutar seed:admin');
  }

  const store = createStore(config);
  try {
    const emailNormalized = normalizeEmail(emailRaw);
    const passwordHash = await hashPassword(password);
    let mfaSecretPlain = null;
    let mfaSecretEnc = null;
    if (enableMfa) {
      mfaSecretPlain = generateTotpSecret();
      mfaSecretEnc = encryptSecret(mfaSecretPlain, config.security.sessionSecret);
    }

    const existing = await store.findUserByEmail(emailNormalized);
    if (existing) {
      await store.updateUser(existing.id, {
        fullName,
        passwordHash,
        emailVerifiedAt: new Date(),
        status: 'active',
        ...(enableMfa ? { mfaSecretEnc, mfaEnabled: true } : {}),
      });
      console.log(`Cuenta administrativa actualizada: ${emailNormalized}`);
    } else {
      await store.createUser({
        emailNormalized,
        emailRaw,
        fullName,
        passwordHash,
        role: 'admin',
        emailVerifiedAt: new Date(),
        mfaSecretEnc,
        mfaEnabled: enableMfa,
      });
      console.log(`Cuenta administrativa creada: ${emailNormalized}`);
    }

    if (mfaSecretPlain) {
      console.log('MFA TOTP activado. Escanea o guarda esta URI en tu app autenticadora:');
      console.log(buildOtpAuthUrl({ issuer: 'KAELION Taller', accountName: emailNormalized, secret: mfaSecretPlain }));
    }
  } finally {
    await store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  seedAdmin().catch((err) => {
    console.error('Error al crear cuenta administrativa:', err.message);
    process.exitCode = 1;
  });
}
