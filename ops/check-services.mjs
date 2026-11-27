import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

class CheckError extends Error {}

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new CheckError('Falta ' + name);
  }
  return value;
}

function port(env, name, fallback) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new CheckError(name + ' debe ser un puerto TCP válido');
  }
  return value;
}

async function checkMySQL(env) {
  const host = required(env, 'MYSQL_HOST');
  const tlsMode = env.MYSQL_TLS || 'off';
  if (!['off', 'on'].includes(tlsMode)) throw new CheckError('MYSQL_TLS debe ser on u off');
  if (tlsMode === 'off' && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new CheckError('MYSQL_TLS=on es obligatorio para conexiones remotas');
  }

  const options = {
    host,
    port: port(env, 'MYSQL_PORT', 3306),
    user: required(env, 'MYSQL_USER'),
    password: required(env, 'MYSQL_PASSWORD'),
    database: required(env, 'MYSQL_DATABASE'),
    connectTimeout: 8000,
  };
  if (tlsMode === 'on') {
    options.ssl = { rejectUnauthorized: true, verifyIdentity: true };
    if (env.MYSQL_CA_FILE) options.ssl.ca = readFileSync(env.MYSQL_CA_FILE, 'utf8');
  }

  const { createConnection } = await import('mysql2/promise');
  const connection = await createConnection(options);
  try {
    const [rows] = await connection.query({ sql: 'SELECT 1 AS ok', timeout: 8000 });
    if (rows[0]?.ok !== 1) throw new CheckError('La consulta de prueba no devolvió el resultado esperado');
  } finally {
    connection.destroy();
  }
}

async function checkSMTP(env) {
  const smtpPort = port(env, 'SMTP_PORT', 587);
  const options = {
    host: required(env, 'SMTP_HOST'),
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: smtpPort !== 465,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: { user: required(env, 'SMTP_USER'), pass: required(env, 'SMTP_PASSWORD') },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  };

  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(options);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function checkStripe(env, request = fetch) {
  const secretKey = required(env, 'STRIPE_SECRET_KEY');
  if (!/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(secretKey)) {
    throw new CheckError('STRIPE_SECRET_KEY debe pertenecer al sandbox');
  }

  const priceId = required(env, 'STRIPE_PRICE_ID');
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new CheckError('STRIPE_PRICE_ID debe ser un identificador price_ válido');
  }

  const response = await request('https://api.stripe.com/v1/prices/' + priceId, {
    headers: { Authorization: 'Bearer ' + secretKey },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new CheckError('Stripe devolvió HTTP ' + response.status);

  const price = await response.json();
  if (price.object !== 'price' || price.id !== priceId || price.livemode !== false ||
      price.active !== true || price.type !== 'one_time' ||
      price.billing_scheme !== 'per_unit' || price.currency !== 'mxn' ||
      price.unit_amount !== 25_000) {
    throw new CheckError('El precio debe estar activo en sandbox y cobrar 250.00 MXN en un solo pago');
  }
}

const checks = {
  mysql: { run: checkMySQL, success: 'MySQL: consulta de solo lectura exitosa.' },
  smtp: { run: checkSMTP, success: 'SMTP: conexión cifrada y autenticación verificadas.' },
  stripe: { run: checkStripe, success: 'Stripe: precio activo de 250.00 MXN en sandbox.' },
};

async function main(args) {
  const [selection = 'all'] = args;
  if (args.length > 1 || (selection !== 'all' && !Object.hasOwn(checks, selection))) {
    console.error('Uso: npm run check -- [all|mysql|smtp|stripe]');
    return 2;
  }

  const chosen = selection === 'all' ? Object.keys(checks) : [selection];
  const results = await Promise.allSettled(chosen.map((name) => checks[name].run(process.env)));
  let exitCode = 0;

  for (const [index, result] of results.entries()) {
    const name = chosen[index];
    if (result.status === 'fulfilled') {
      console.log(checks[name].success);
      continue;
    }

    const error = result.reason;
    const safeCode = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : '';
    const safeMessage = error instanceof CheckError ? error.message : safeCode || 'Error de conexión o configuración';
    console.error(name + ': ' + safeMessage);
    exitCode = 1;
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
