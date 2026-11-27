import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function generateFolio(date = new Date()) {
  const ym = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[buf[i] % alphabet.length];
  }
  return `KAE-${ym}-${suffix}`;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$16384$8$1$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith('scrypt$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6) return false;
  const [, , , , salt, expectedHex] = parts;
  const derived = await scryptAsync(password, salt, 64);
  const actual = Buffer.from(derived);
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function deriveKey(masterSecret, purpose) {
  return createHash('sha256').update(`${purpose}:${masterSecret}`).digest();
}

export function encryptSecret(plaintext, masterSecret) {
  const key = deriveKey(masterSecret, 'kaelion-mfa-aes256gcm');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext, masterSecret) {
  const parts = String(ciphertext || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
  const [ivHex, tagHex, dataHex] = parts;
  const key = deriveKey(masterSecret, 'kaelion-mfa-aes256gcm');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// RFC 4648 Base32 para secretos TOTP
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(str) {
  const cleaned = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function computeTotpCode(secretBase32, timestampMs = Date.now(), stepSeconds = 30) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32, code, timestampMs = Date.now(), windowSteps = 1) {
  const cleaned = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    const expected = computeTotpCode(secretBase32, timestampMs + delta * 30_000);
    if (timingSafeEqual(Buffer.from(cleaned), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUrl({ issuer, accountName, secret }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function signDownloadToken(payload, masterSecret) {
  const key = deriveKey(masterSecret, 'kaelion-download-token');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyDownloadToken(token, masterSecret, nowMs = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const key = deriveKey(masterSecret, 'kaelion-download-token');
  const expectedSig = createHmac('sha256', key).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}
