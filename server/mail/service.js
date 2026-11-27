import { renderMailTemplate } from './templates.js';

export function createMailService({ store, config, transportOverride = null }) {
  let processing = false;
  let timer = null;

  async function buildTransport() {
    if (transportOverride) return transportOverride;
    if (!config.smtp.host || !config.smtp.user || !config.smtp.password) {
      return null;
    }
    const { default: nodemailer } = await import('nodemailer');
    return nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: config.smtp.port !== 465,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: { user: config.smtp.user, pass: config.smtp.password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
  }

  async function processOutboxBatch() {
    if (processing) return { processed: 0, sent: 0, failed: 0 };
    processing = true;
    let processed = 0;
    let sent = 0;
    let failed = 0;

    try {
      const due = await store.listDueOutbox(20);
      if (due.length === 0) return { processed: 0, sent: 0, failed: 0 };

      const transport = await buildTransport();
      for (const item of due) {
        processed += 1;
        const rendered = renderMailTemplate(item.templateName, item.payloadJson);
        try {
          if (!transport) {
            if (config.isProduction) {
              throw new Error('SMTP no configurado en producción');
            }
            // En desarrollo sin SMTP configurado, registra el envío simulado sin bloquear
            await store.markOutboxSent(item.id, new Date());
            sent += 1;
            continue;
          }

          await transport.sendMail({
            from: config.smtp.from,
            replyTo: config.smtp.replyTo || undefined,
            to: item.recipientEmail,
            subject: item.subject,
            text: rendered.text,
            html: rendered.html,
          });
          await store.markOutboxSent(item.id, new Date());
          sent += 1;
        } catch (err) {
          failed += 1;
          const nextAttempts = item.attempts + 1;
          const exhausted = nextAttempts >= item.maxAttempts;
          const backoffMs = Math.min(3600_000, 30_000 * 2 ** (nextAttempts - 1));
          await store.markOutboxAttemptFailed(item.id, {
            attempts: nextAttempts,
            status: exhausted ? 'failed' : 'pending',
            lastError: err?.code || err?.message || 'SMTP_ERROR',
            nextAttemptAt: new Date(Date.now() + backoffMs),
          });
        }
      }

      if (transport && !transportOverride && typeof transport.close === 'function') {
        transport.close();
      }
      return { processed, sent, failed };
    } finally {
      processing = false;
    }
  }

  function kickOutbox() {
    queueMicrotask(() => {
      processOutboxBatch().catch(() => {});
    });
  }

  function startWorker(intervalMs = 30_000) {
    if (timer) return;
    timer = setInterval(() => {
      processOutboxBatch().catch(() => {});
    }, intervalMs);
    timer.unref?.();
  }

  function stopWorker() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    processOutboxBatch,
    kickOutbox,
    startWorker,
    stopWorker,
  };
}
