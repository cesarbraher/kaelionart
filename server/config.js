import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = __dirname;
export const REPO_ROOT = resolve(__dirname, '..');

function parsePositiveInt(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return parsed;
}

function normalizeOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Origen no permitido: ${origin}`);
  }
  return `${url.protocol}//${url.host}`;
}

export function loadConfig(env = process.env) {
  const nodeEnv = (env.NODE_ENV || 'development').trim();
  const isProduction = nodeEnv === 'production';

  const host = (env.HOST || '127.0.0.1').trim();
  const port = parsePositiveInt(env.PORT, 3000, 'PORT');

  const appOrigin = normalizeOrigin(env.APP_ORIGIN || `http://${host}:${port}`);
  if (isProduction && !appOrigin.startsWith('https://')) {
    throw new Error('APP_ORIGIN debe usar HTTPS en producción');
  }

  const allowedOriginsRaw = (env.ALLOWED_ORIGINS || appOrigin)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
  const allowedOrigins = new Set([appOrigin, ...allowedOriginsRaw]);

  const dbDriver = (env.DB_DRIVER || 'mysql').trim().toLowerCase();
  if (!['mysql', 'memory'].includes(dbDriver)) {
    throw new Error('DB_DRIVER debe ser mysql o memory');
  }
  if (isProduction && dbDriver !== 'mysql') {
    throw new Error('DB_DRIVER=memory no está permitido en producción');
  }

  const mysqlTls = (env.MYSQL_TLS || 'off').trim().toLowerCase();
  if (!['on', 'off'].includes(mysqlTls)) {
    throw new Error('MYSQL_TLS debe ser on u off');
  }

  const sessionSecret = (env.SESSION_SECRET || '').trim();
  if (isProduction && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción');
  }

  const stripeMode = (env.STRIPE_MODE || (isProduction ? 'live' : 'test')).trim().toLowerCase();
  if (!['test', 'live'].includes(stripeMode)) {
    throw new Error('STRIPE_MODE debe ser test o live');
  }

  const privateStoragePath = resolve(
    SERVER_ROOT,
    (env.PRIVATE_STORAGE_PATH || '../private_storage').trim()
  );

  // Garantiza que el almacenamiento privado nunca quede dentro de carpetas públicas conocidas
  const publicDirs = ['assets', 'css', 'js', 'data', 'en', 'portal', 'admin'].map((d) =>
    resolve(REPO_ROOT, d)
  );
  for (const pubDir of publicDirs) {
    if (privateStoragePath === pubDir || privateStoragePath.startsWith(pubDir + '\\') || privateStoragePath.startsWith(pubDir + '/')) {
      throw new Error('PRIVATE_STORAGE_PATH no puede estar dentro de una carpeta pública');
    }
  }

  const mysqlHost = (env.MYSQL_HOST || '127.0.0.1').trim();
  if (dbDriver === 'mysql' && mysqlTls === 'off' && !['127.0.0.1', '::1', 'localhost'].includes(mysqlHost)) {
    throw new Error('MYSQL_TLS=on es obligatorio para conexiones MySQL remotas');
  }

  let mysqlCa = undefined;
  if (mysqlTls === 'on' && env.MYSQL_CA_FILE) {
    mysqlCa = readFileSync(resolve(SERVER_ROOT, env.MYSQL_CA_FILE), 'utf8');
  }

  const smtpPort = parsePositiveInt(env.SMTP_PORT, 465, 'SMTP_PORT');

  return {
    nodeEnv,
    isProduction,
    host,
    port,
    appOrigin,
    allowedOrigins,
    cookieSecure: isProduction || appOrigin.startsWith('https://'),
    dbDriver,
    mysql: {
      host: mysqlHost,
      port: parsePositiveInt(env.MYSQL_PORT, 3306, 'MYSQL_PORT'),
      database: (env.MYSQL_DATABASE || '').trim(),
      user: (env.MYSQL_USER || '').trim(),
      password: env.MYSQL_PASSWORD || '',
      tls: mysqlTls === 'on',
      ca: mysqlCa,
    },
    stripe: {
      mode: stripeMode,
      secretKey: (env.STRIPE_SECRET_KEY || '').trim(),
      priceId: (env.STRIPE_PRICE_ID || '').trim(),
      webhookSecret: (env.STRIPE_WEBHOOK_SECRET || '').trim(),
      promoAmountCents: 25000,
      promoCurrency: 'mxn',
      promoProductCode: 'smart_logo_promo',
      promoProductName: 'Diseño inteligente de logotipos',
    },
    smtp: {
      host: (env.SMTP_HOST || '').trim(),
      port: smtpPort,
      user: (env.SMTP_USER || '').trim(),
      password: env.SMTP_PASSWORD || '',
      from: (env.SMTP_FROM || 'KAELION Digital Art <info@kaelion.art>').trim(),
      replyTo: (env.SMTP_REPLY_TO || 'info@kaelion.art').trim(),
    },
    security: {
      sessionSecret: sessionSecret || 'dev-only-insecure-session-secret-do-not-use-in-prod',
      sessionTtlHours: parsePositiveInt(env.SESSION_TTL_HOURS, 24, 'SESSION_TTL_HOURS'),
      downloadLinkTtlSeconds: parsePositiveInt(env.DOWNLOAD_LINK_TTL_SECONDS, 120, 'DOWNLOAD_LINK_TTL_SECONDS'),
    },
    storage: {
      privatePath: privateStoragePath,
      uploadMaxBytes: parsePositiveInt(env.UPLOAD_MAX_BYTES, 10 * 1024 * 1024, 'UPLOAD_MAX_BYTES'),
      orderReferenceQuotaBytes: parsePositiveInt(env.ORDER_REFERENCE_QUOTA_BYTES, 40 * 1024 * 1024, 'ORDER_REFERENCE_QUOTA_BYTES'),
    },
    timezoneDisplay: (env.TIMEZONE_DISPLAY || 'America/Mexico_City').trim(),
  };
}
