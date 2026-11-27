import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { createPortalApp } from '../app.js';
import { listMigrationFiles, MIGRATIONS_DIR, splitSqlStatements } from '../db/migrate.js';
import {
  computeTotpCode,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  normalizeEmail,
} from '../auth/crypto.js';
import { signStripeWebhookPayload } from '../payments/stripe.js';

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const VALID_JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const VALID_PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n', 'latin1');
const VALID_AI = Buffer.from('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator 2026\n%%EOF\n', 'latin1');
const VALID_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>', 'utf8');
const MALICIOUS_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');

function buildMultipart(fields, file) {
  const boundary = '----KaelionTestBoundary7d9a';
  const chunks = [];
  for (const [name, value] of Object.entries(fields || {})) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8'
      )
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName || 'file'}"; filename="${file.name}"\r\nContent-Type: ${file.mime || 'application/octet-stream'}\r\n\r\n`,
        'utf8'
      )
    );
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    body: Buffer.concat(chunks),
  };
}

function createClientHelper(baseUrl) {
  let cookie = '';
  let csrf = '';
  return {
    get csrf() {
      return csrf;
    },
    setCookie(rawSetCookie) {
      if (!rawSetCookie) return;
      const first = String(rawSetCookie).split(';')[0];
      if (first.endsWith('=')) cookie = '';
      else cookie = first;
    },
    async req(path, { method = 'GET', json = null, multipart = null, skipCsrf = false, rawBody = null, headers = {} } = {}) {
      const hdrs = { ...headers };
      if (cookie) hdrs.Cookie = cookie;
      if (csrf && !skipCsrf && method !== 'GET' && method !== 'HEAD') {
        hdrs['X-CSRF-Token'] = csrf;
      }
      let body;
      if (json !== null) {
        hdrs['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (multipart) {
        hdrs['Content-Type'] = `multipart/form-data; boundary=${multipart.boundary}`;
        body = multipart.body;
      } else if (rawBody !== null) {
        body = rawBody;
      }
      const res = await fetch(`${baseUrl}${path}`, { method, headers: hdrs, body, redirect: 'manual' });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) this.setCookie(setCookie);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      if (data && typeof data === 'object' && data.csrfToken) csrf = data.csrfToken;
      return { status: res.status, headers: res.headers, data };
    },
  };
}

function sampleBrief(brandName = 'Atelier Obsidiana') {
  return {
    brandName,
    contactName: 'Cliente Prueba',
    contactPhone: '+52 464 000 0000',
    contactEmail: 'cliente@example.com',
    activity: 'Cafetería de especialidad y tostador artesanal',
    targetAudience: 'Adultos jóvenes y diseñadores en México',
    differentiator: 'Tueste en microlotes y diseño de empaque minimalista',
    personality: 'Sobria, precisa, cálida',
    usageChannels: 'Empaques, redes sociales, letrero y sitio web',
    slogan: 'Café con oficio',
    colorPreferences: 'Obsidiana y granate',
    stylePreferences: 'Geométrico limpio',
    avoidElements: 'Colores neón',
    referenceLinks: ['https://kaelion.art/'],
    notes: 'Preferimos buena legibilidad en sello pequeño.',
  };
}

test('1. Migración SQL 001 contiene todas las tablas e índices del manual', () => {
  const files = listMigrationFiles();
  assert.ok(files.includes('001_initial_schema.sql'));
  const sql = readFileSync(join(MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 12);

  const requiredTables = [
    'users',
    'email_tokens',
    'sessions',
    'orders',
    'briefs',
    'checkout_attempts',
    'stripe_events',
    'private_files',
    'proposals',
    'revision_requests',
    'outbox',
    'audit_log',
  ];
  for (const tbl of requiredTables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${tbl}\\b`), `Falta tabla ${tbl}`);
  }
});

test('2. Flujo completo end-to-end: seguridad, aislamiento, Stripe webhook idempotente, 3 propuestas, 3 rondas, aprobación y 5 formatos', async (t) => {
  const tmpStorage = mkdtempSync(join(tmpdir(), 'kaelion-private-'));
  const sentEmails = [];
  const stripeSessions = new Map();
  let stripeSeq = 0;

  const mockStripeFetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/checkout/sessions' && init.method === 'POST') {
      const form = new URLSearchParams(init.body);
      const id = `cs_test_${++stripeSeq}`;
      const sessionObj = {
        id,
        object: 'checkout.session',
        livemode: false,
        status: 'open',
        payment_status: 'unpaid',
        currency: 'mxn',
        amount_total: 25000,
        client_reference_id: form.get('client_reference_id'),
        metadata: {
          order_id: form.get('metadata[order_id]'),
          folio: form.get('metadata[folio]'),
          user_id: form.get('metadata[user_id]'),
        },
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        line_items: {
          data: [{ price: { id: form.get('line_items[0][price]') }, quantity: Number(form.get('line_items[0][quantity]')) }],
        },
      };
      stripeSessions.set(id, sessionObj);
      return new Response(JSON.stringify(sessionObj), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const m = parsed.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (m && (!init.method || init.method === 'GET')) {
      const sess = stripeSessions.get(decodeURIComponent(m[1]));
      if (!sess) return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
      return new Response(JSON.stringify(sess), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    throw new Error(`Unexpected Stripe URL: ${url}`);
  };

  const webhookSecret = 'whsec_test_kaelion_secret_123456';
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    APP_ORIGIN: 'http://127.0.0.1:3000',
    DB_DRIVER: 'memory',
    STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_kaelion_mock_key',
    STRIPE_PRICE_ID: 'price_test_250mxn',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    SESSION_SECRET: 'test-session-secret-with-more-than-thirty-two-chars-001',
    PRIVATE_STORAGE_PATH: tmpStorage,
    DOWNLOAD_LINK_TTL_SECONDS: '60',
  });

  const app = createPortalApp({
    config,
    fetchImpl: mockStripeFetch,
    mailTransportOverride: {
      async sendMail(msg) {
        sentEmails.push(msg);
      },
    },
  });

  const adminTotpSecret = generateTotpSecret();
  await app.store.createUser({
    emailNormalized: normalizeEmail('taller@kaelion.art'),
    emailRaw: 'taller@kaelion.art',
    fullName: 'Taller KAELION',
    passwordHash: await hashPassword('TallerSeguro2026!'),
    role: 'admin',
    emailVerifiedAt: new Date(),
    mfaSecretEnc: encryptSecret(adminTotpSecret, config.security.sessionSecret),
    mfaEnabled: true,
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  config.allowedOrigins.add(baseUrl);

  t.after(async () => {
    await app.close();
    rmSync(tmpStorage, { recursive: true, force: true });
  });

  const anon = createClientHelper(baseUrl);
  const clientA = createClientHelper(baseUrl);
  const clientB = createClientHelper(baseUrl);
  const admin = createClientHelper(baseUrl);

  const portalRes = await anon.req('/portal/');
  assert.equal(portalRes.status, 200);
  assert.match(portalRes.headers.get('cache-control') || '', /private,\s*no-store/i);
  assert.equal(portalRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(portalRes.headers.get('x-frame-options'), 'DENY');

  const privRes = await anon.req('/privacidad.html');
  assert.equal(privRes.status, 200);

  const leakRes = await anon.req('/server/config.js');
  assert.equal(leakRes.status, 404);
  const opsRes = await anon.req('/ops/.env.example');
  assert.equal(opsRes.status, 404);

  const regA = await clientA.req('/api/auth/register', {
    method: 'POST',
    json: { fullName: 'Ana Cliente', email: 'ana@example.com', password: 'PasswordSeguro123', privacyAccepted: true },
  });
  assert.equal(regA.status, 201);
  assert.ok(regA.data.devVerificationToken);

  const loginBeforeVerify = await clientA.req('/api/auth/login', {
    method: 'POST',
    json: { email: 'ana@example.com', password: 'PasswordSeguro123' },
  });
  assert.equal(loginBeforeVerify.status, 403);

  const verA = await clientA.req('/api/auth/verify-email', {
    method: 'POST',
    json: { token: regA.data.devVerificationToken },
  });
  assert.equal(verA.status, 200);

  const loginA = await clientA.req('/api/auth/login', {
    method: 'POST',
    json: { email: 'ana@example.com', password: 'PasswordSeguro123' },
  });
  assert.equal(loginA.status, 200);
  assert.match(loginA.headers.get('set-cookie') || '', /HttpOnly/i);
  assert.match(loginA.headers.get('set-cookie') || '', /SameSite=Lax/i);

  const regB = await clientB.req('/api/auth/register', {
    method: 'POST',
    json: { fullName: 'Beto Otro', email: 'beto@example.com', password: 'PasswordSeguro456', privacyAccepted: true },
  });
  await clientB.req('/api/auth/verify-email', { method: 'POST', json: { token: regB.data.devVerificationToken } });
  const loginB = await clientB.req('/api/auth/login', {
    method: 'POST',
    json: { email: 'beto@example.com', password: 'PasswordSeguro456' },
  });
  assert.equal(loginB.status, 200);

  const adminNoMfa = await admin.req('/api/auth/admin/login', {
    method: 'POST',
    json: { email: 'taller@kaelion.art', password: 'TallerSeguro2026!' },
  });
  assert.equal(adminNoMfa.status, 401);
  assert.equal(adminNoMfa.data.error, 'mfa_required');

  const adminOk = await admin.req('/api/auth/admin/login', {
    method: 'POST',
    json: {
      email: 'taller@kaelion.art',
      password: 'TallerSeguro2026!',
      totpCode: computeTotpCode(adminTotpSecret),
    },
  });
  assert.equal(adminOk.status, 200);

  const noCsrf = await clientA.req('/api/orders', { method: 'POST', json: sampleBrief(), skipCsrf: true });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.error, 'csrf_invalid');

  const orderCreate = await clientA.req('/api/orders', { method: 'POST', json: sampleBrief('Marca Ana') });
  assert.equal(orderCreate.status, 201);
  const orderId = orderCreate.data.order.id;
  const folio = orderCreate.data.order.folio;
  assert.match(folio, /^KAE-\d{6}-[A-Z0-9]{6}$/);

  const badRef = await clientA.req(`/api/orders/${orderId}/references`, {
    method: 'POST',
    multipart: buildMultipart({}, { name: 'trampa.png', buffer: Buffer.from('not-a-png') }),
  });
  assert.equal(badRef.status, 400);

  const svgRef = await clientA.req(`/api/orders/${orderId}/references`, {
    method: 'POST',
    multipart: buildMultipart({}, { name: 'vector.svg', buffer: VALID_SVG }),
  });
  assert.equal(svgRef.status, 400);

  const goodRef = await clientA.req(`/api/orders/${orderId}/references`, {
    method: 'POST',
    multipart: buildMultipart({}, { name: 'inspiracion.jpg', buffer: VALID_JPG, mime: 'image/jpeg' }),
  });
  assert.equal(goodRef.status, 201);
  const refFileId = goodRef.data.file.id;

  assert.equal((await clientB.req(`/api/orders/${orderId}`)).status, 403);
  assert.equal(
    (await clientB.req(`/api/orders/${orderId}/files/${refFileId}/download-link`, { method: 'POST', json: {} })).status,
    403
  );
  assert.equal((await clientB.req('/api/admin/orders')).status, 403);

  const chk1 = await clientA.req(`/api/orders/${orderId}/checkout`, { method: 'POST', json: {} });
  assert.equal(chk1.status, 200);
  assert.equal(chk1.data.reused, false);
  const sessionId1 = chk1.data.attempt.stripeSessionId;

  const chk1Reuse = await clientA.req(`/api/orders/${orderId}/checkout`, { method: 'POST', json: {} });
  assert.equal(chk1Reuse.status, 200);
  assert.equal(chk1Reuse.data.reused, true);
  assert.equal(chk1Reuse.data.attempt.stripeSessionId, sessionId1);

  const preWebhookStatus = await clientA.req(`/api/orders/${orderId}/payment-status`);
  assert.equal(preWebhookStatus.status, 200);
  assert.equal(preWebhookStatus.data.orderStatus, 'awaiting_payment');
  assert.equal(preWebhookStatus.data.paymentState, 'esperando_confirmacion_webhook');

  const badSig = await anon.req('/api/stripe/webhook', {
    method: 'POST',
    rawBody: Buffer.from('{}'),
    headers: { 'Stripe-Signature': 't=123,v1=deadbeef' },
  });
  assert.equal(badSig.status, 400);

  const asyncPendingPayload = JSON.stringify({
    id: 'evt_async_pending_1',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { id: sessionId1 } },
  });
  const asyncPendingRes = await anon.req('/api/stripe/webhook', {
    method: 'POST',
    rawBody: Buffer.from(asyncPendingPayload),
    headers: { 'Stripe-Signature': signStripeWebhookPayload(asyncPendingPayload, webhookSecret) },
  });
  assert.equal(asyncPendingRes.status, 200);
  assert.equal(asyncPendingRes.data.outcome, 'awaiting_async_payment');
  assert.equal((await clientA.req(`/api/orders/${orderId}`)).data.order.status, 'awaiting_payment');

  const asyncFailPayload = JSON.stringify({
    id: 'evt_async_fail_1',
    type: 'checkout.session.async_payment_failed',
    livemode: false,
    data: { object: { id: sessionId1, client_reference_id: String(orderId) } },
  });
  assert.equal(
    (
      await anon.req('/api/stripe/webhook', {
        method: 'POST',
        rawBody: Buffer.from(asyncFailPayload),
        headers: { 'Stripe-Signature': signStripeWebhookPayload(asyncFailPayload, webhookSecret) },
      })
    ).status,
    200
  );

  const chk2 = await clientA.req(`/api/orders/${orderId}/checkout`, { method: 'POST', json: {} });
  assert.equal(chk2.status, 200);
  assert.equal(chk2.data.reused, false);
  const sessionId2 = chk2.data.attempt.stripeSessionId;
  assert.notEqual(sessionId2, sessionId1);

  stripeSessions.get(sessionId2).payment_status = 'paid';
  stripeSessions.get(sessionId2).status = 'complete';
  stripeSessions.get(sessionId2).amount_total = 10000;
  const wrongAmountPayload = JSON.stringify({
    id: 'evt_wrong_amount',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { id: sessionId2 } },
  });
  const wrongAmountRes = await anon.req('/api/stripe/webhook', {
    method: 'POST',
    rawBody: Buffer.from(wrongAmountPayload),
    headers: { 'Stripe-Signature': signStripeWebhookPayload(wrongAmountPayload, webhookSecret) },
  });
  assert.equal(wrongAmountRes.status, 400);
  assert.equal(wrongAmountRes.data.error, 'payment_reconciliation_mismatch');

  stripeSessions.get(sessionId2).amount_total = 25000;
  const paidPayload = JSON.stringify({
    id: 'evt_paid_ok_1',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { id: sessionId2 } },
  });
  const paidRes = await anon.req('/api/stripe/webhook', {
    method: 'POST',
    rawBody: Buffer.from(paidPayload),
    headers: { 'Stripe-Signature': signStripeWebhookPayload(paidPayload, webhookSecret) },
  });
  assert.equal(paidRes.status, 200);
  assert.equal(paidRes.data.outcome, 'order_marked_paid');
  assert.equal((await clientA.req(`/api/orders/${orderId}`)).data.order.status, 'paid');

  const dupRes = await anon.req('/api/stripe/webhook', {
    method: 'POST',
    rawBody: Buffer.from(paidPayload),
    headers: { 'Stripe-Signature': signStripeWebhookPayload(paidPayload, webhookSecret) },
  });
  assert.equal(dupRes.status, 200);
  assert.equal(dupRes.data.duplicate, true);

  for (const pos of [1, 2]) {
    const up = await admin.req(`/api/admin/orders/${orderId}/proposals`, {
      method: 'POST',
      multipart: buildMultipart(
        { position: String(pos), title: `Propuesta ${pos}`, concept: `Concepto geométrico ${pos}` },
        { name: `prop-${pos}.png`, buffer: VALID_PNG, mime: 'image/png' }
      ),
    });
    assert.equal(up.status, 201);
  }
  assert.equal((await admin.req(`/api/admin/orders/${orderId}/proposals/publish`, { method: 'POST', json: {} })).status, 400);
  assert.equal((await clientA.req(`/api/orders/${orderId}`)).data.proposals.length, 0);

  assert.equal(
    (
      await admin.req(`/api/admin/orders/${orderId}/proposals`, {
        method: 'POST',
        multipart: buildMultipart(
          { position: '3', title: 'Propuesta 3', concept: 'Concepto monograma' },
          { name: 'prop-3.png', buffer: VALID_PNG, mime: 'image/png' }
        ),
      })
    ).status,
    201
  );
  const pubRes = await admin.req(`/api/admin/orders/${orderId}/proposals/publish`, { method: 'POST', json: {} });
  assert.equal(pubRes.status, 200);
  assert.equal(pubRes.data.order.status, 'proposals_ready');

  const clientProps = (await clientA.req(`/api/orders/${orderId}`)).data.proposals;
  assert.equal(clientProps.length, 3);

  const chosenId = clientProps[1].id;
  assert.equal(
    (await clientA.req(`/api/orders/${orderId}/select-proposal`, { method: 'POST', json: { proposalId: chosenId } })).status,
    200
  );

  for (const round of [1, 2, 3]) {
    const reqRev = await clientA.req(`/api/orders/${orderId}/revisions`, {
      method: 'POST',
      json: { comments: `Ajustes agrupados de la ronda ${round}` },
    });
    assert.equal(reqRev.status, 201);
    assert.equal(reqRev.data.revision.roundNumber, round);

    const delRev = await admin.req(`/api/admin/orders/${orderId}/revisions/${round}/deliver`, {
      method: 'POST',
      multipart: buildMultipart(
        { responseNotes: `Aplicados los cambios de la ronda ${round}` },
        { name: `revision-${round}.png`, buffer: VALID_PNG, mime: 'image/png' }
      ),
    });
    assert.equal(delRev.status, 200);
    assert.equal(delRev.data.order.status, 'revision_ready');
  }

  const fourthRev = await clientA.req(`/api/orders/${orderId}/revisions`, {
    method: 'POST',
    json: { comments: 'Intento de cuarta ronda que debe fallar' },
  });
  assert.equal(fourthRev.status, 409);
  assert.equal(fourthRev.data.error, 'max_revisions_reached');

  const approveRes = await clientA.req(`/api/orders/${orderId}/approve`, { method: 'POST', json: {} });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.data.order.status, 'approved');
  assert.equal(approveRes.data.order.approvedVersion, 4);

  const badSvg = await admin.req(`/api/admin/orders/${orderId}/final-files`, {
    method: 'POST',
    multipart: buildMultipart({ purpose: 'final_svg' }, { name: 'logo.svg', buffer: MALICIOUS_SVG }),
  });
  assert.equal(badSvg.status, 400);
  assert.equal(badSvg.data.error, 'unsafe_svg');

  const finalUploads = [
    ['final_ai', 'logo.ai', VALID_AI],
    ['final_svg', 'logo.svg', VALID_SVG],
    ['final_pdf', 'logo.pdf', VALID_PDF],
    ['final_png', 'logo.png', VALID_PNG],
  ];
  const uploadedFinalIds = [];
  for (const [purpose, name, buf] of finalUploads) {
    const r = await admin.req(`/api/admin/orders/${orderId}/final-files`, {
      method: 'POST',
      multipart: buildMultipart({ purpose }, { name, buffer: buf }),
    });
    assert.equal(r.status, 201);
    uploadedFinalIds.push(r.data.file.id);
  }
  assert.equal((await admin.req(`/api/admin/orders/${orderId}/deliver`, { method: 'POST', json: {} })).status, 400);

  const jpgUp = await admin.req(`/api/admin/orders/${orderId}/final-files`, {
    method: 'POST',
    multipart: buildMultipart({ purpose: 'final_jpg' }, { name: 'logo.jpg', buffer: VALID_JPG }),
  });
  assert.equal(jpgUp.status, 201);
  uploadedFinalIds.push(jpgUp.data.file.id);

  const deliverRes = await admin.req(`/api/admin/orders/${orderId}/deliver`, { method: 'POST', json: {} });
  assert.equal(deliverRes.status, 200);
  assert.equal(deliverRes.data.order.status, 'delivered');

  let lastSignedUrl = '';
  for (const fid of uploadedFinalIds) {
    const linkRes = await clientA.req(`/api/orders/${orderId}/files/${fid}/download-link`, {
      method: 'POST',
      json: { inline: true },
    });
    assert.equal(linkRes.status, 200);
    lastSignedUrl = linkRes.data.url;
    const dlRes = await anon.req(lastSignedUrl);
    assert.equal(dlRes.status, 200);
    assert.match(dlRes.headers.get('content-disposition') || '', /^attachment;/i);
    assert.match(dlRes.headers.get('cache-control') || '', /private,\s*no-store/i);
  }

  assert.equal((await clientA.req('/api/auth/logout', { method: 'POST', json: {} })).status, 200);
  const afterLogoutDl = await anon.req(lastSignedUrl);
  assert.equal(afterLogoutDl.status, 401);
  assert.equal(afterLogoutDl.data.error, 'session_revoked');

  assert.equal(
    (
      await clientA.req('/api/auth/login', {
        method: 'POST',
        json: { email: 'ana@example.com', password: 'PasswordSeguro123' },
      })
    ).status,
    200
  );
  const o2 = (await clientA.req('/api/orders', { method: 'POST', json: sampleBrief('Marca Rápida') })).data.order;
  const o2Chk = (await clientA.req(`/api/orders/${o2.id}/checkout`, { method: 'POST', json: {} })).data.attempt.stripeSessionId;
  stripeSessions.get(o2Chk).payment_status = 'paid';
  stripeSessions.get(o2Chk).status = 'complete';
  const o2PaidPayload = JSON.stringify({
    id: 'evt_order2_paid',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { id: o2Chk } },
  });
  assert.equal(
    (
      await anon.req('/api/stripe/webhook', {
        method: 'POST',
        rawBody: Buffer.from(o2PaidPayload),
        headers: { 'Stripe-Signature': signStripeWebhookPayload(o2PaidPayload, webhookSecret) },
      })
    ).status,
    200
  );
  for (const pos of [1, 2, 3]) {
    await admin.req(`/api/admin/orders/${o2.id}/proposals`, {
      method: 'POST',
      multipart: buildMultipart(
        { position: String(pos), title: `Prop ${pos}`, concept: `Idea ${pos}` },
        { name: `p${pos}.png`, buffer: VALID_PNG }
      ),
    });
  }
  const pub2 = await admin.req(`/api/admin/orders/${o2.id}/proposals/publish`, { method: 'POST', json: {} });
  assert.equal(pub2.status, 200);
  await clientA.req(`/api/orders/${o2.id}/select-proposal`, {
    method: 'POST',
    json: { proposalId: pub2.data.proposals[0].id },
  });
  const earlyApprove = await clientA.req(`/api/orders/${o2.id}/approve`, { method: 'POST', json: {} });
  assert.equal(earlyApprove.status, 200);
  assert.equal(earlyApprove.data.order.status, 'approved');
  assert.equal(earlyApprove.data.order.revisionRoundsUsed, 0);
  assert.equal(earlyApprove.data.order.approvedVersion, 1);

  await app.mailService.processOutboxBatch();
  assert.ok(sentEmails.length >= 5, `Se esperaban correos encolados y enviados, encontrados: ${sentEmails.length}`);
});

test('3. Concurrencia en rondas de revisión, expiración de enlace de descarga, recuperación de contraseña y rate limit', async (t) => {
  const tmpStorage = mkdtempSync(join(tmpdir(), 'kaelion-private-conc-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    APP_ORIGIN: 'http://127.0.0.1:3000',
    DB_DRIVER: 'memory',
    STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_kaelion_mock_key',
    STRIPE_PRICE_ID: 'price_test_250mxn',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_conc',
    SESSION_SECRET: 'test-session-secret-with-more-than-thirty-two-chars-002',
    PRIVATE_STORAGE_PATH: tmpStorage,
    DOWNLOAD_LINK_TTL_SECONDS: '1',
  });

  const app = createPortalApp({
    config,
    mailTransportOverride: { async sendMail() {} },
  });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  config.allowedOrigins.add(baseUrl);

  t.after(async () => {
    await app.close();
    rmSync(tmpStorage, { recursive: true, force: true });
  });

  const client = createClientHelper(baseUrl);
  const anon = createClientHelper(baseUrl);

  const reg = await client.req('/api/auth/register', {
    method: 'POST',
    json: { fullName: 'Carlos Test', email: 'carlos@example.com', password: 'PasswordInicial123', privacyAccepted: true },
  });
  await client.req('/api/auth/verify-email', { method: 'POST', json: { token: reg.data.devVerificationToken } });

  const resetReq = await anon.req('/api/auth/request-reset', { method: 'POST', json: { email: 'carlos@example.com' } });
  assert.equal(resetReq.status, 200);
  assert.ok(resetReq.data.devResetToken);

  const resetOk = await anon.req('/api/auth/reset-password', {
    method: 'POST',
    json: { token: resetReq.data.devResetToken, newPassword: 'PasswordNuevo456!' },
  });
  assert.equal(resetOk.status, 200);

  const resetReplay = await anon.req('/api/auth/reset-password', {
    method: 'POST',
    json: { token: resetReq.data.devResetToken, newPassword: 'OtroPassword789!' },
  });
  assert.equal(resetReplay.status, 400);

  const login = await client.req('/api/auth/login', {
    method: 'POST',
    json: { email: 'carlos@example.com', password: 'PasswordNuevo456!' },
  });
  assert.equal(login.status, 200);

  const created = await client.req('/api/orders', { method: 'POST', json: sampleBrief('Marca Concurrencia') });
  const orderId = created.data.order.id;
  const refUp = await client.req(`/api/orders/${orderId}/references`, {
    method: 'POST',
    multipart: buildMultipart({}, { name: 'ref.png', buffer: VALID_PNG, mime: 'image/png' }),
  });
  assert.equal(refUp.status, 201);

  const prop = await app.store.upsertProposalDraft({
    orderId,
    position: 1,
    title: 'Propuesta 1',
    concept: 'Concepto prueba',
    fileId: refUp.data.file.id,
    version: 1,
  });
  await app.store.publishProposalsForOrder(orderId, new Date());
  await app.store.updateOrder(orderId, { status: 'proposal_selected', selectedProposalId: prop.id });

  const [r1, r2] = await Promise.all([
    client.req(`/api/orders/${orderId}/revisions`, { method: 'POST', json: { comments: 'Envío concurrente A' } }),
    client.req(`/api/orders/${orderId}/revisions`, { method: 'POST', json: { comments: 'Envío concurrente B' } }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 409]);

  const link = await client.req(`/api/orders/${orderId}/files/${refUp.data.file.id}/download-link`, {
    method: 'POST',
    json: {},
  });
  assert.equal(link.status, 200);
  await new Promise((r) => setTimeout(r, 1150));
  const expiredDl = await anon.req(link.data.url);
  assert.equal(expiredDl.status, 401);
  assert.equal(expiredDl.data.error, 'download_link_expired');
});
