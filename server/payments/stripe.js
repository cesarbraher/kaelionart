import { createHmac, timingSafeEqual } from 'node:crypto';
import { getClientIp, HttpError } from '../lib/http.js';

export function signStripeWebhookPayload(rawPayloadString, webhookSecret, timestampSec = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestampSec}.${rawPayloadString}`;
  const sig = createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestampSec},v1=${sig}`;
}

export function verifyStripeSignature(rawBodyBuffer, signatureHeader, webhookSecret, toleranceSeconds = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!webhookSecret) {
    throw new HttpError(500, 'webhook_secret_missing', 'STRIPE_WEBHOOK_SECRET no está configurado en el servidor.');
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.trim()) {
    throw new HttpError(400, 'missing_stripe_signature', 'Falta el encabezado Stripe-Signature.');
  }

  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k === 't') timestamp = Number(v);
    if (k === 'v1' && v) signatures.push(v);
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new HttpError(400, 'malformed_stripe_signature', 'Encabezado Stripe-Signature mal formado.');
  }
  if (Math.abs(nowSec - timestamp) > toleranceSeconds) {
    throw new HttpError(400, 'expired_stripe_signature', 'La marca de tiempo del webhook de Stripe expiró.');
  }

  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBodyBuffer.toString('utf8')}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  const matched = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });

  if (!matched) {
    throw new HttpError(400, 'invalid_stripe_signature', 'Firma de webhook de Stripe inválida.');
  }
  return true;
}

export function createStripeService({ store, config, mailService, fetchImpl = fetch }) {
  function assertStripeConfigured() {
    if (!config.stripe.secretKey || !config.stripe.priceId) {
      throw new HttpError(
        503,
        'stripe_not_configured',
        'Stripe no está configurado en el servidor (STRIPE_SECRET_KEY / STRIPE_PRICE_ID).'
      );
    }
    const isTestKey = /^(sk|rk)_test_/.test(config.stripe.secretKey);
    const isLiveKey = /^(sk|rk)_live_/.test(config.stripe.secretKey);
    if (config.stripe.mode === 'test' && !isTestKey) {
      throw new HttpError(500, 'stripe_mode_mismatch', 'STRIPE_MODE=test requiere una clave de sandbox (_test_).');
    }
    if (config.stripe.mode === 'live' && !isLiveKey) {
      throw new HttpError(500, 'stripe_mode_mismatch', 'STRIPE_MODE=live requiere una clave de producción (_live_).');
    }
  }

  async function stripeRequest(path, { method = 'GET', formParams = null, idempotencyKey = null } = {}) {
    assertStripeConfigured();
    const headers = {
      Authorization: `Bearer ${config.stripe.secretKey}`,
    };
    let body;
    if (formParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(formParams).toString();
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const response = await fetchImpl(`https://api.stripe.com${path}`, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data?.error?.message || `Error HTTP ${response.status} al comunicar con Stripe.`;
      throw new HttpError(502, 'stripe_api_error', msg);
    }
    return data;
  }

  async function retrieveCheckoutSessionWithLineItems(sessionId) {
    const session = await stripeRequest(
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`
    );
    return session;
  }

  async function createOrReuseCheckoutSession({ orderId, user, req }) {
    const order = await store.findOrderById(orderId);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
    if (user.role !== 'admin' && order.userId !== user.id) {
      throw new HttpError(403, 'forbidden', 'No puedes iniciar pagos para un pedido que no es tuyo.');
    }
    if (!['brief_saved', 'awaiting_payment'].includes(order.status)) {
      throw new HttpError(409, 'order_not_payable', `El pedido en estado ${order.status} no admite un nuevo pago.`);
    }

    const existingOpen = await store.findOpenCheckoutAttemptByOrder(order.id);
    if (existingOpen) {
      if (existingOpen.status === 'async_pending') {
        return {
          reused: true,
          pendingAsync: true,
          attempt: existingOpen,
          checkoutUrl: existingOpen.checkoutUrl,
          message: 'Existe un pago en proceso de confirmación bancaria. Espera su acreditación.',
        };
      }

      const notExpiredLocally = !existingOpen.expiresAt || Date.parse(existingOpen.expiresAt) > Date.now() + 60_000;
      if (notExpiredLocally && existingOpen.checkoutUrl) {
        try {
          const remote = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(existingOpen.stripeSessionId)}`);
          if (remote.status === 'open' && remote.url) {
            return { reused: true, attempt: existingOpen, checkoutUrl: remote.url };
          }
          if (remote.status === 'expired') {
            await store.updateCheckoutAttempt(existingOpen.id, { status: 'expired' });
          } else if (remote.status === 'complete') {
            return {
              reused: true,
              pendingWebhook: true,
              attempt: existingOpen,
              checkoutUrl: null,
              message: 'Tu pago ya fue completado en Stripe y está en espera de confirmación del webhook.',
            };
          }
        } catch {
          return { reused: true, attempt: existingOpen, checkoutUrl: existingOpen.checkoutUrl };
        }
      } else {
        await store.updateCheckoutAttempt(existingOpen.id, { status: 'expired' });
      }
    }

    const priorAttempts = await store.listCheckoutAttemptsByOrder(order.id);
    const attemptNumber = priorAttempts.length + 1;
    const idempotencyKey = `kaelion-checkout-order-${order.id}-attempt-${attemptNumber}`;

    const successUrl = `${config.appOrigin}/portal/?checkout=return&order=${order.id}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.appOrigin}/portal/?checkout=cancelled&order=${order.id}`;

    const createdSession = await stripeRequest('/v1/checkout/sessions', {
      method: 'POST',
      idempotencyKey,
      formParams: {
        mode: 'payment',
        'line_items[0][price]': config.stripe.priceId,
        'line_items[0][quantity]': '1',
        client_reference_id: String(order.id),
        customer_email: user.emailRaw,
        'metadata[order_id]': String(order.id),
        'metadata[folio]': order.folio,
        'metadata[user_id]': String(order.userId),
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
    });

    const expiresAt = createdSession.expires_at
      ? new Date(createdSession.expires_at * 1000)
      : new Date(Date.now() + 30 * 60 * 1000);

    const attempt = await store.withTransaction(async (tx) => {
      const lockedOrder = await tx.findOrderById(order.id, { forUpdate: true });
      if (!['brief_saved', 'awaiting_payment'].includes(lockedOrder.status)) {
        throw new HttpError(409, 'order_not_payable', 'El pedido cambió de estado antes de crear Checkout.');
      }
      const att = await tx.createCheckoutAttempt({
        orderId: order.id,
        stripeSessionId: createdSession.id,
        idempotencyKey,
        status: 'open',
        checkoutUrl: createdSession.url,
        amountTotalCents: config.stripe.promoAmountCents,
        currency: config.stripe.promoCurrency,
        expiresAt,
      });
      if (lockedOrder.status === 'brief_saved') {
        await tx.updateOrder(order.id, { status: 'awaiting_payment' });
      }
      await tx.insertAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'payment.checkout_created',
        orderId: order.id,
        targetType: 'checkout_attempt',
        targetId: att.id,
        outcome: 'ok',
        metadataJson: { stripeSessionId: createdSession.id, attemptNumber },
        ipAddress: req ? getClientIp(req) : null,
      });
      return att;
    });

    return {
      reused: false,
      attempt,
      checkoutUrl: attempt.checkoutUrl,
    };
  }

  async function getOrderPaymentStatus({ orderId, user }) {
    const order = await store.findOrderById(orderId);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
    if (user.role !== 'admin' && order.userId !== user.id) {
      throw new HttpError(403, 'forbidden', 'Acceso denegado.');
    }
    const attempts = await store.listCheckoutAttemptsByOrder(order.id);
    const latest = attempts[0] || null;

    let stateLabel = 'pendiente_pago';
    if (order.paidAt || !['brief_saved', 'awaiting_payment', 'cancelled'].includes(order.status)) {
      stateLabel = 'pago_confirmado';
    } else if (latest?.status === 'async_pending') {
      stateLabel = 'pago_diferido_pendiente';
    } else if (latest?.status === 'failed') {
      stateLabel = 'pago_fallido';
    } else if (latest?.status === 'expired') {
      stateLabel = 'sesion_expirada';
    } else if (latest?.status === 'open') {
      stateLabel = 'esperando_confirmacion_webhook';
    }

    return {
      orderId: order.id,
      folio: order.folio,
      orderStatus: order.status,
      paidAt: order.paidAt,
      paymentState: stateLabel,
      latestAttempt: latest
        ? {
            status: latest.status,
            expiresAt: latest.expiresAt,
            createdAt: latest.createdAt,
          }
        : null,
    };
  }

  async function handleWebhook({ rawBody, signatureHeader, ipAddress }) {
    verifyStripeSignature(rawBody, signatureHeader, config.stripe.webhookSecret);

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid_webhook_json', 'Cuerpo JSON de webhook inválido.');
    }

    if (!event?.id || !event?.type || !event?.data?.object) {
      throw new HttpError(400, 'invalid_webhook_event', 'Estructura de evento Stripe incompleta.');
    }

    const expectedLivemode = config.stripe.mode === 'live';
    if (Boolean(event.livemode) !== expectedLivemode) {
      throw new HttpError(400, 'livemode_mismatch', 'El modo del evento Stripe no corresponde a este entorno.');
    }

    const existingEvent = await store.findStripeEventById(event.id);
    if (existingEvent) {
      return { received: true, duplicate: true, outcome: existingEvent.outcome };
    }

    const supportedTypes = new Set([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
    ]);

    if (!supportedTypes.has(event.type)) {
      await store.insertStripeEvent({
        stripeEventId: event.id,
        eventType: event.type,
        livemode: Boolean(event.livemode),
        orderId: null,
        outcome: 'ignored_event_type',
      });
      return { received: true, outcome: 'ignored_event_type' };
    }

    const eventSession = event.data.object;
    const sessionId = eventSession.id;
    if (!sessionId) {
      throw new HttpError(400, 'missing_session_id', 'Evento sin ID de Checkout Session.');
    }

    if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      const targetAttemptStatus = event.type === 'checkout.session.expired' ? 'expired' : 'failed';
      const outcome = await store.withTransaction(async (tx) => {
        if (await tx.findStripeEventById(event.id)) return 'duplicate';
        const attempt = await tx.findCheckoutAttemptBySessionId(sessionId);
        const orderId = attempt?.orderId || Number(eventSession.client_reference_id || eventSession.metadata?.order_id) || null;
        if (attempt && attempt.status !== 'complete') {
          await tx.updateCheckoutAttempt(attempt.id, { status: targetAttemptStatus });
        }
        await tx.insertStripeEvent({
          stripeEventId: event.id,
          eventType: event.type,
          livemode: Boolean(event.livemode),
          orderId,
          outcome: targetAttemptStatus,
        });
        await tx.insertAuditLog({
          actorRole: 'stripe_webhook',
          action: `payment.${targetAttemptStatus}`,
          orderId,
          targetType: 'checkout_attempt',
          targetId: attempt?.id || sessionId,
          outcome: 'ok',
          metadataJson: { stripeEventId: event.id, eventType: event.type },
          ipAddress,
        });
        return targetAttemptStatus;
      });
      return { received: true, outcome };
    }

    const verifiedSession = await retrieveCheckoutSessionWithLineItems(sessionId);

    if (Boolean(verifiedSession.livemode) !== expectedLivemode) {
      throw new HttpError(400, 'session_livemode_mismatch', 'Modo de sesión incompatible con el entorno.');
    }

    const orderIdRaw = verifiedSession.client_reference_id || verifiedSession.metadata?.order_id;
    const orderId = Number(orderIdRaw);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new HttpError(400, 'missing_order_reference', 'La sesión de Stripe no está asociada a un pedido interno válido.');
    }

    const lineItems = verifiedSession.line_items?.data || [];
    const exactItemMatch =
      lineItems.length === 1 &&
      lineItems[0]?.price?.id === config.stripe.priceId &&
      Number(lineItems[0]?.quantity) === 1;

    const amountOk =
      String(verifiedSession.currency || '').toLowerCase() === config.stripe.promoCurrency &&
      Number(verifiedSession.amount_total) === config.stripe.promoAmountCents;

    if (!exactItemMatch || !amountOk) {
      await store.insertAuditLog({
        actorRole: 'stripe_webhook',
        action: 'payment.reconciliation_mismatch',
        orderId,
        targetType: 'stripe_event',
        targetId: event.id,
        outcome: 'rejected',
        metadataJson: {
          currency: verifiedSession.currency,
          amountTotal: verifiedSession.amount_total,
          priceId: lineItems[0]?.price?.id || null,
          quantity: lineItems[0]?.quantity || null,
        },
        ipAddress,
      });
      throw new HttpError(400, 'payment_reconciliation_mismatch', 'El precio, cantidad, moneda o importe no coincide con la promoción vigente ($250 MXN).');
    }

    if (verifiedSession.payment_status !== 'paid') {
      const outcome = await store.withTransaction(async (tx) => {
        if (await tx.findStripeEventById(event.id)) return 'duplicate';
        const attempt = await tx.findCheckoutAttemptBySessionId(sessionId);
        if (attempt && attempt.status === 'open') {
          await tx.updateCheckoutAttempt(attempt.id, { status: 'async_pending' });
        }
        await tx.insertStripeEvent({
          stripeEventId: event.id,
          eventType: event.type,
          livemode: Boolean(event.livemode),
          orderId,
          outcome: 'awaiting_async_payment',
        });
        return 'awaiting_async_payment';
      });
      return { received: true, outcome };
    }

    const result = await store.withTransaction(async (tx) => {
      const dup = await tx.findStripeEventById(event.id);
      if (dup) return { duplicate: true, outcome: dup.outcome };

      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) {
        throw new HttpError(404, 'order_not_found', 'Pedido referenciado no existe.');
      }

      const attempt = await tx.findCheckoutAttemptBySessionId(sessionId);
      if (!attempt || attempt.orderId !== order.id) {
        throw new HttpError(400, 'session_order_mismatch', 'La sesión de Stripe no corresponde al folio del pedido.');
      }

      if (verifiedSession.metadata?.folio && verifiedSession.metadata.folio !== order.folio) {
        throw new HttpError(400, 'folio_mismatch', 'El folio de metadatos no coincide con el pedido.');
      }

      await tx.updateCheckoutAttempt(attempt.id, { status: 'complete' });

      let outcome = 'already_paid';
      if (order.status === 'brief_saved' || order.status === 'awaiting_payment') {
        await tx.updateOrder(order.id, { status: 'paid', paidAt: new Date() });
        outcome = 'order_marked_paid';

        const owner = await tx.findUserById(order.userId);
        const brief = await tx.getBriefByOrderId(order.id);
        if (owner) {
          await tx.enqueueOutbox({
            orderId: order.id,
            recipientEmail: owner.emailRaw,
            templateName: 'payment_confirmed',
            subject: `Pago confirmado — Folio ${order.folio} | KAELION Digital Art`,
            payloadJson: {
              folio: order.folio,
              brandName: brief?.brandName || '',
              portalUrl: `${config.appOrigin}/portal/?order=${order.id}`,
            },
          });
        }
      }

      await tx.insertStripeEvent({
        stripeEventId: event.id,
        eventType: event.type,
        livemode: Boolean(event.livemode),
        orderId: order.id,
        outcome,
      });

      await tx.insertAuditLog({
        actorRole: 'stripe_webhook',
        action: 'payment.confirmed',
        orderId: order.id,
        targetType: 'stripe_event',
        targetId: event.id,
        outcome,
        metadataJson: {
          stripeSessionId: sessionId,
          amountTotalCents: verifiedSession.amount_total,
          currency: verifiedSession.currency,
        },
        ipAddress,
      });

      return { duplicate: false, outcome };
    });

    if (!result.duplicate && result.outcome === 'order_marked_paid') {
      mailService.kickOutbox();
    }

    return { received: true, ...result };
  }

  return {
    createOrReuseCheckoutSession,
    getOrderPaymentStatus,
    handleWebhook,
  };
}
