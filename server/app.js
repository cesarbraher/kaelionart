import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { loadConfig, REPO_ROOT } from './config.js';
import { createStore } from './db/index.js';
import { createAuthService, publicUser } from './auth/service.js';
import { createMailService } from './mail/service.js';
import { createFileService, FINAL_FILE_PURPOSES } from './files/service.js';
import { createStripeService } from './payments/stripe.js';
import { createOrderService } from './orders/service.js';
import {
  applySecurityHeaders,
  createRateLimiter,
  getClientIp,
  HttpError,
  readJsonBody,
  readMultipartForm,
  readRawBody,
  sendJson,
} from './lib/http.js';

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const ALLOWED_STATIC_ROOTS = [
  'assets',
  'css',
  'js',
  'data',
  'en',
  'portal',
  'admin',
];

const ALLOWED_STATIC_FILES = new Set([
  '/index.html',
  '/privacidad.html',
  '/manifest.webmanifest',
  '/sw.js',
]);

function isPrivateStaticPath(pathname) {
  return pathname === '/portal' || pathname.startsWith('/portal/') || pathname === '/admin' || pathname.startsWith('/admin/');
}

function resolveAllowedStaticFile(pathname) {
  let normalized = pathname;
  if (normalized === '/') normalized = '/index.html';
  else if (normalized === '/en' || normalized === '/en/') normalized = '/en/index.html';
  else if (normalized === '/portal' || normalized === '/portal/') normalized = '/portal/index.html';
  else if (normalized === '/admin' || normalized === '/admin/') normalized = '/admin/index.html';

  if (normalized.includes('..') || normalized.includes('\0') || normalized.includes('\\')) {
    return null;
  }

  const isExplicitFile = ALLOWED_STATIC_FILES.has(normalized);
  const firstSegment = normalized.slice(1).split('/')[0];
  if (!isExplicitFile && !ALLOWED_STATIC_ROOTS.includes(firstSegment)) {
    return null;
  }

  const fullPath = resolve(REPO_ROOT, normalized.slice(1));
  if (fullPath !== REPO_ROOT && !fullPath.startsWith(REPO_ROOT + sep)) {
    return null;
  }
  return fullPath;
}

export function createPortalApp({
  config = loadConfig(),
  store = createStore(config),
  fetchImpl = fetch,
  mailTransportOverride = null,
} = {}) {
  const rateLimiter = createRateLimiter();
  const mailService = createMailService({ store, config, transportOverride: mailTransportOverride });
  const authService = createAuthService({ store, config, mailService, rateLimiter });
  const fileService = createFileService({ store, config });
  const stripeService = createStripeService({ store, config, mailService, fetchImpl });
  const orderService = createOrderService({ store, config, mailService });

  const isHttps = config.appOrigin.startsWith('https://');

  function json(res, status, payload, extraHeaders = {}) {
    sendJson(res, status, payload, { isHttps, extraHeaders });
  }

  async function requireAuth(req, { requireAdmin = false, requireCsrf = false } = {}) {
    const session = await authService.authenticateRequest(req);
    if (!session) {
      throw new HttpError(401, 'unauthenticated', 'Debes iniciar sesión para continuar.');
    }
    if (requireAdmin && session.user.role !== 'admin') {
      throw new HttpError(403, 'admin_required', 'Esta acción está reservada para el taller KAELION.');
    }
    if (requireCsrf) {
      authService.assertCsrf(req, session);
    }
    return session;
  }

  async function handleApi(req, res, url) {
    const method = req.method || 'GET';
    const path = url.pathname;

    if (method === 'GET' && path === '/api/health') {
      return json(res, 200, {
        ok: true,
        service: 'kaelion-portal',
        timezoneDisplay: config.timezoneDisplay,
        promo: {
          productName: config.stripe.promoProductName,
          amountCents: config.stripe.promoAmountCents,
          currency: config.stripe.promoCurrency,
        },
      });
    }

    if (method === 'POST' && path === '/api/stripe/webhook') {
      const rawBody = await readRawBody(req, 512 * 1024);
      const result = await stripeService.handleWebhook({
        rawBody,
        signatureHeader: req.headers['stripe-signature'],
        ipAddress: getClientIp(req),
      });
      return json(res, 200, result);
    }

    const downloadMatch = path.match(/^\/api\/files\/download\/([^/]+)$/);
    if (method === 'GET' && downloadMatch) {
      const ip = getClientIp(req);
      rateLimiter.consume(`download:${ip}`, { max: 60, windowMs: 5 * 60 * 1000 });
      const token = decodeURIComponent(downloadMatch[1]);
      const resolved = await fileService.resolveDownloadToken(token, req);
      applySecurityHeaders(res, {
        isPrivate: true,
        isHttps,
        isSandboxAttachment: resolved.isSandboxAttachment,
      });
      const safeName = resolved.file.originalName.replace(/"/g, '');
      res.writeHead(200, {
        'Content-Type': resolved.file.mimeType,
        'Content-Length': resolved.data.length,
        'Content-Disposition': `${resolved.disposition}; filename="${safeName}"`,
      });
      res.end(resolved.data);
      return;
    }

    if (method === 'POST' && path === '/api/auth/register') {
      const body = await readJsonBody(req);
      const result = await authService.register(body, req);
      return json(res, 201, result);
    }

    if (method === 'POST' && path === '/api/auth/verify-email') {
      const body = await readJsonBody(req);
      const result = await authService.verifyEmail(body, req);
      return json(res, 200, result);
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const body = await readJsonBody(req);
      const result = await authService.login(body, req);
      return json(res, 200, { user: result.user, csrfToken: result.csrfToken }, { 'Set-Cookie': result.cookieHeader });
    }

    if (method === 'POST' && path === '/api/auth/admin/login') {
      const body = await readJsonBody(req);
      const result = await authService.login({ ...body, requiredRole: 'admin' }, req);
      return json(res, 200, { user: result.user, csrfToken: result.csrfToken }, { 'Set-Cookie': result.cookieHeader });
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      const session = await authService.authenticateRequest(req);
      if (session) authService.assertCsrf(req, session);
      const result = await authService.logout(req, session);
      return json(res, 200, { ok: true }, { 'Set-Cookie': result.cookieHeader });
    }

    if (method === 'GET' && path === '/api/auth/me') {
      const session = await authService.authenticateRequest(req);
      if (!session) return json(res, 200, { authenticated: false, user: null });
      return json(res, 200, {
        authenticated: true,
        user: publicUser(session.user),
        csrfToken: session.csrfToken,
        timezoneDisplay: config.timezoneDisplay,
      });
    }

    if (method === 'POST' && path === '/api/auth/request-reset') {
      const body = await readJsonBody(req);
      const result = await authService.requestPasswordReset(body, req);
      return json(res, 200, result);
    }

    if (method === 'POST' && path === '/api/auth/reset-password') {
      const body = await readJsonBody(req);
      const result = await authService.resetPassword(body, req);
      return json(res, 200, result);
    }

    if (method === 'GET' && path === '/api/orders') {
      const session = await requireAuth(req);
      const orders = await orderService.listOrdersForUser(session.user);
      return json(res, 200, { orders });
    }

    if (method === 'POST' && path === '/api/orders') {
      const session = await requireAuth(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const result = await orderService.createOrder({ body, user: session.user, req });
      return json(res, 201, result);
    }

    let m;

    if ((m = path.match(/^\/api\/orders\/(\d+)$/)) && method === 'GET') {
      const session = await requireAuth(req);
      const detail = await orderService.getOrderDetail({ orderId: Number(m[1]), user: session.user });
      return json(res, 200, detail);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/brief$/)) && method === 'PUT') {
      const session = await requireAuth(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const result = await orderService.updateBrief({ orderId: Number(m[1]), body, user: session.user, req });
      return json(res, 200, result);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/references$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireCsrf: true });
      const order = await store.findOrderById(Number(m[1]));
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (session.user.role !== 'admin' && order.userId !== session.user.id) {
        throw new HttpError(403, 'forbidden', 'No puedes subir referencias a otro pedido.');
      }
      if (!['brief_saved', 'awaiting_payment', 'paid'].includes(order.status)) {
        throw new HttpError(409, 'references_locked', 'No se admiten nuevas referencias en el estado actual.');
      }
      const { files } = await readMultipartForm(req, config.storage.uploadMaxBytes);
      if (files.length === 0) {
        throw new HttpError(400, 'missing_file', 'Adjunta una imagen JPEG o PNG.');
      }
      const saved = await fileService.saveUploadedFile({
        order,
        user: session.user,
        purpose: 'reference',
        originalName: files[0].originalName,
        buffer: files[0].buffer,
        req,
      });
      return json(res, 201, { file: saved });
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/checkout$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireCsrf: true });
      const result = await stripeService.createOrReuseCheckoutSession({
        orderId: Number(m[1]),
        user: session.user,
        req,
      });
      return json(res, 200, result);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/payment-status$/)) && method === 'GET') {
      const session = await requireAuth(req);
      const status = await stripeService.getOrderPaymentStatus({
        orderId: Number(m[1]),
        user: session.user,
      });
      return json(res, 200, status);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/select-proposal$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const result = await orderService.clientSelectProposal({
        orderId: Number(m[1]),
        proposalId: Number(body.proposalId),
        user: session.user,
        req,
      });
      return json(res, 200, result);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/revisions$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const result = await orderService.clientRequestRevision({
        orderId: Number(m[1]),
        comments: body.comments,
        user: session.user,
        req,
      });
      return json(res, 201, result);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/approve$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireCsrf: true });
      const result = await orderService.clientApproveOrder({
        orderId: Number(m[1]),
        user: session.user,
        req,
      });
      return json(res, 200, result);
    }

    if ((m = path.match(/^\/api\/orders\/(\d+)\/files\/(\d+)\/download-link$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireCsrf: true });
      const body = await readJsonBody(req);
      const link = await fileService.createSignedDownloadLink({
        orderId: Number(m[1]),
        fileId: Number(m[2]),
        session,
        inline: Boolean(body.inline),
        req,
      });
      return json(res, 200, link);
    }

    if (method === 'GET' && path === '/api/admin/orders') {
      await requireAuth(req, { requireAdmin: true });
      const orders = await store.listAllOrders({
        status: url.searchParams.get('status') || 'all',
        search: url.searchParams.get('q') || '',
      });
      return json(res, 200, { orders });
    }

    if ((m = path.match(/^\/api\/admin\/orders\/(\d+)$/)) && method === 'GET') {
      const session = await requireAuth(req, { requireAdmin: true });
      const detail = await orderService.getOrderDetail({ orderId: Number(m[1]), user: session.user });
      return json(res, 200, detail);
    }

    if ((m = path.match(/^\/api\/admin\/orders\/(\d+)\/proposals$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireAdmin: true, requireCsrf: true });
      const order = await store.findOrderById(Number(m[1]));
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      const { fields, files } = await readMultipartForm(req, config.storage.uploadMaxBytes);
      if (files.length === 0) throw new HttpError(400, 'missing_file', 'Adjunta el archivo de propuesta (PNG, JPG o PDF).');
      const savedFile = await fileService.saveUploadedFile({
        order,
        user: session.user,
        purpose: 'proposal',
        originalName: files[0].originalName,
        buffer: files[0].buffer,
        version: 1,
        req,
      });
      const proposal = await orderService.adminSaveProposalDraft({
        orderId: order.id,
        position: Number(fields.position),
        title: fields.title,
        concept: fields.concept,
        fileId: savedFile.id,
        adminUser: session.user,
        req,
      });
      return json(res, 201, { proposal, file: savedFile });
    }

    if ((m = path.match(/^\/api\/admin\/orders\/(\d+)\/proposals\/publish$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireAdmin: true, requireCsrf: true });
      const result = await orderService.adminPublishProposals({
        orderId: Number(m[1]),
        adminUser: session.user,
        req,
      });
      return json(res, 200, result);
    }

    if ((m = path.match(/^\/api\/admin\/orders\/(\d+)\/revisions\/(\d+)\/deliver$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireAdmin: true, requireCsrf: true });
      const order = await store.findOrderById(Number(m[1]));
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      const roundNumber = Number(m[2]);
      const { fields, files } = await readMultipartForm(req, config.storage.uploadMaxBytes);
      if (files.length === 0) throw new HttpError(400, 'missing_file', 'Adjunta la versión actualizada de la propuesta.');
      const savedFile = await fileService.saveUploadedFile({
        order,
        user: session.user,
        purpose: 'revision',
        originalName: files[0].originalName,
        buffer: files[0].buffer,
        version: roundNumber + 1,
        req,
      });
      const result = await orderService.adminDeliverRevision({
        orderId: order.id,
        roundNumber,
        responseNotes: fields.responseNotes || '',
        revisedFileId: savedFile.id,
        adminUser: session.user,
        req,
      });
      return json(res, 200, { ...result, file: savedFile });
    }

    if ((m = path.match(/^\/api\/admin\/orders\/(\d+)\/final-files$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireAdmin: true, requireCsrf: true });
      const order = await store.findOrderById(Number(m[1]));
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (!['approved', 'delivered'].includes(order.status)) {
        throw new HttpError(409, 'approval_required', 'Sube los archivos finales después de que el cliente apruebe la versión.');
      }
      const { fields, files } = await readMultipartForm(req, config.storage.uploadMaxBytes);
      const purpose = String(fields.purpose || '').trim();
      if (!FINAL_FILE_PURPOSES.includes(purpose)) {
        throw new HttpError(400, 'invalid_final_purpose', `Finalidad final inválida. Usa: ${FINAL_FILE_PURPOSES.join(', ')}`);
      }
      if (files.length === 0) throw new HttpError(400, 'missing_file', 'Adjunta el archivo final correspondiente.');
      const saved = await fileService.saveUploadedFile({
        order,
        user: session.user,
        purpose,
        originalName: files[0].originalName,
        buffer: files[0].buffer,
        version: order.approvedVersion || 1,
        req,
      });
      return json(res, 201, { file: saved });
    }

    if ((m = path.match(/^\/api\/admin\/orders\/(\d+)\/deliver$/)) && method === 'POST') {
      const session = await requireAuth(req, { requireAdmin: true, requireCsrf: true });
      const result = await orderService.adminConfirmDelivery({
        orderId: Number(m[1]),
        adminUser: session.user,
        req,
      });
      return json(res, 200, result);
    }

    if (method === 'GET' && path === '/api/admin/audit') {
      await requireAuth(req, { requireAdmin: true });
      const orderId = url.searchParams.get('orderId') ? Number(url.searchParams.get('orderId')) : undefined;
      const logs = await store.listAuditLogs({ orderId, limit: 100 });
      return json(res, 200, { logs });
    }

    if (method === 'GET' && path === '/api/admin/outbox') {
      await requireAuth(req, { requireAdmin: true });
      const items = await store.listOutbox({ limit: 80 });
      return json(res, 200, { items });
    }

    if ((m = path.match(/^\/api\/admin\/outbox\/(\d+)\/retry$/)) && method === 'POST') {
      await requireAuth(req, { requireAdmin: true, requireCsrf: true });
      await store.resetOutboxForRetry(Number(m[1]));
      const result = await mailService.processOutboxBatch();
      return json(res, 200, { ok: true, result });
    }

    throw new HttpError(404, 'not_found', 'Ruta de API no encontrada.');
  }

  async function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }

    const fullPath = resolveAllowedStaticFile(url.pathname);
    if (!fullPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }

    try {
      const info = await stat(fullPath);
      if (!info.isFile()) {
        res.writeHead(404);
        res.end('No encontrado');
        return;
      }
      const data = await readFile(fullPath);
      const ext = extname(fullPath).toLowerCase();
      const isPrivate = isPrivateStaticPath(url.pathname);
      applySecurityHeaders(res, { isPrivate, isHttps });
      if (!isPrivate) {
        res.setHeader('Cache-Control', ext === '.html' ? 'public, max-age=300' : 'public, max-age=3600');
      }
      res.writeHead(200, {
        'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
        'Content-Length': data.length,
      });
      if (req.method === 'HEAD') res.end();
      else res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', config.appOrigin);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else {
        await handleStatic(req, res, url);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        const extra = err.retryAfterSec ? { 'Retry-After': String(err.retryAfterSec) } : {};
        return json(res, err.status, { error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }, extra);
      }
      if (config.nodeEnv !== 'test') {
        console.error('[server error]', err?.message || err);
      }
      return json(res, 500, { error: 'internal_error', message: 'Error interno del servidor.' });
    }
  });

  return {
    server,
    store,
    config,
    mailService,
    authService,
    fileService,
    stripeService,
    orderService,
    rateLimiter,
    async close() {
      mailService.stopWorker();
      await new Promise((resolveClose) => server.close(resolveClose));
      await store.close();
    },
  };
}
