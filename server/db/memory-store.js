// Almacén transaccional en memoria SOLO para desarrollo local y pruebas automatizadas.
// Bloqueado en producción por server/config.js.

function nowIso() {
  return new Date().toISOString();
}

function deepClone(obj) {
  return structuredClone(obj);
}

function createInitialState() {
  return {
    seq: {
      users: 0,
      emailTokens: 0,
      sessions: 0,
      orders: 0,
      briefs: 0,
      checkoutAttempts: 0,
      stripeEvents: 0,
      privateFiles: 0,
      proposals: 0,
      revisions: 0,
      outbox: 0,
      auditLog: 0,
    },
    users: [],
    emailTokens: [],
    sessions: [],
    orders: [],
    briefs: [],
    checkoutAttempts: [],
    stripeEvents: [],
    privateFiles: [],
    proposals: [],
    revisions: [],
    outbox: [],
    auditLog: [],
  };
}

export function createMemoryStore() {
  let state = createInitialState();
  let txChain = Promise.resolve();

  function dupError(msg) {
    const err = new Error(msg);
    err.code = 'ER_DUP_ENTRY';
    return err;
  }

  function buildApi(getState) {
    const api = {
      async withTransaction(fn) {
        const run = txChain.then(async () => {
          const snapshot = deepClone(state);
          try {
            return await fn(api);
          } catch (err) {
            state = snapshot;
            throw err;
          }
        });
        txChain = run.catch(() => {});
        return run;
      },

      async createUser({ emailNormalized, emailRaw, fullName, passwordHash, role = 'client', emailVerifiedAt = null, mfaSecretEnc = null, mfaEnabled = false }) {
        const s = getState();
        if (s.users.some((u) => u.emailNormalized === emailNormalized)) {
          throw dupError('Duplicate email_normalized');
        }
        const ts = nowIso();
        const user = {
          id: ++s.seq.users,
          emailNormalized,
          emailRaw,
          fullName,
          passwordHash,
          role,
          emailVerifiedAt: emailVerifiedAt ? new Date(emailVerifiedAt).toISOString() : null,
          mfaSecretEnc,
          mfaEnabled: Boolean(mfaEnabled),
          status: 'active',
          createdAt: ts,
          updatedAt: ts,
        };
        s.users.push(user);
        return deepClone(user);
      },

      async findUserByEmail(emailNormalized) {
        const u = getState().users.find((x) => x.emailNormalized === emailNormalized);
        return u ? deepClone(u) : null;
      },

      async findUserById(id) {
        const u = getState().users.find((x) => x.id === Number(id));
        return u ? deepClone(u) : null;
      },

      async updateUser(id, fields) {
        const u = getState().users.find((x) => x.id === Number(id));
        if (!u) return null;
        for (const [k, v] of Object.entries(fields)) {
          if (k === 'emailVerifiedAt') u.emailVerifiedAt = v ? new Date(v).toISOString() : null;
          else if (k === 'mfaEnabled') u.mfaEnabled = Boolean(v);
          else if (['fullName', 'passwordHash', 'mfaSecretEnc', 'status'].includes(k)) u[k] = v;
        }
        u.updatedAt = nowIso();
        return deepClone(u);
      },

      async createEmailToken({ userId, tokenHash, purpose, expiresAt }) {
        const s = getState();
        const rec = {
          id: ++s.seq.emailTokens,
          userId: Number(userId),
          tokenHash,
          purpose,
          expiresAt: new Date(expiresAt).toISOString(),
          usedAt: null,
          createdAt: nowIso(),
        };
        s.emailTokens.push(rec);
        return rec.id;
      },

      async findValidEmailToken(tokenHash, purpose) {
        const now = Date.now();
        const rec = getState().emailTokens.find(
          (t) => t.tokenHash === tokenHash && t.purpose === purpose && !t.usedAt && Date.parse(t.expiresAt) > now
        );
        return rec ? deepClone(rec) : null;
      },

      async markEmailTokenUsed(id) {
        const rec = getState().emailTokens.find((t) => t.id === Number(id));
        if (rec) rec.usedAt = nowIso();
      },

      async createSession({ tokenHash, csrfToken, userId, ipAddress, userAgent, expiresAt }) {
        const s = getState();
        const rec = {
          id: ++s.seq.sessions,
          tokenHash,
          csrfToken,
          userId: Number(userId),
          ipAddress: ipAddress || null,
          userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
          expiresAt: new Date(expiresAt).toISOString(),
          revokedAt: null,
          createdAt: nowIso(),
        };
        s.sessions.push(rec);
        return { id: rec.id, csrfToken: rec.csrfToken, userId: rec.userId, expiresAt: rec.expiresAt };
      },

      async findActiveSessionByTokenHash(tokenHash) {
        const s = getState();
        const now = Date.now();
        const sess = s.sessions.find((x) => x.tokenHash === tokenHash && !x.revokedAt && Date.parse(x.expiresAt) > now);
        if (!sess) return null;
        const user = s.users.find((u) => u.id === sess.userId && u.status === 'active');
        if (!user) return null;
        return {
          id: sess.id,
          csrfToken: sess.csrfToken,
          userId: sess.userId,
          expiresAt: sess.expiresAt,
          user: deepClone(user),
        };
      },

      async findActiveSessionById(id) {
        const s = getState();
        const now = Date.now();
        const sess = s.sessions.find((x) => x.id === Number(id) && !x.revokedAt && Date.parse(x.expiresAt) > now);
        if (!sess) return null;
        const user = s.users.find((u) => u.id === sess.userId && u.status === 'active');
        if (!user) return null;
        return { id: sess.id, userId: sess.userId };
      },

      async revokeSessionByTokenHash(tokenHash) {
        const sess = getState().sessions.find((x) => x.tokenHash === tokenHash && !x.revokedAt);
        if (sess) sess.revokedAt = nowIso();
      },

      async revokeAllSessionsForUser(userId) {
        const ts = nowIso();
        for (const sess of getState().sessions) {
          if (sess.userId === Number(userId) && !sess.revokedAt) sess.revokedAt = ts;
        }
      },

      async createOrderWithBrief({ folio, userId, productCode, productName, currency, amountTotalCents, brief }) {
        const s = getState();
        if (s.orders.some((o) => o.folio === folio)) throw dupError('Duplicate folio');
        const ts = nowIso();
        const order = {
          id: ++s.seq.orders,
          folio,
          userId: Number(userId),
          status: 'brief_saved',
          productCode,
          productName,
          currency,
          amountTotalCents: Number(amountTotalCents),
          selectedProposalId: null,
          revisionRoundsUsed: 0,
          maxRevisionRounds: 3,
          paidAt: null,
          approvedAt: null,
          approvedByUserId: null,
          approvedVersion: null,
          deliveredAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        s.orders.push(order);

        const briefRec = {
          id: ++s.seq.briefs,
          orderId: order.id,
          brandName: brief.brandName,
          contactName: brief.contactName,
          contactPhone: brief.contactPhone,
          contactEmail: brief.contactEmail,
          activity: brief.activity,
          targetAudience: brief.targetAudience,
          differentiator: brief.differentiator,
          personality: brief.personality,
          usageChannels: brief.usageChannels,
          slogan: brief.slogan || '',
          colorPreferences: brief.colorPreferences || '',
          stylePreferences: brief.stylePreferences || '',
          avoidElements: brief.avoidElements || '',
          referenceLinks: deepClone(brief.referenceLinks || []),
          notes: brief.notes || '',
          createdAt: ts,
          updatedAt: ts,
        };
        s.briefs.push(briefRec);
        return { order: deepClone(order), brief: deepClone(briefRec) };
      },

      async findOrderById(id) {
        const o = getState().orders.find((x) => x.id === Number(id));
        return o ? deepClone(o) : null;
      },

      async findOrderByFolio(folio) {
        const o = getState().orders.find((x) => x.folio === folio);
        return o ? deepClone(o) : null;
      },

      async listOrdersByUser(userId) {
        const s = getState();
        return s.orders
          .filter((o) => o.userId === Number(userId))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map((o) => {
            const b = s.briefs.find((br) => br.orderId === o.id);
            return { ...deepClone(o), brandName: b?.brandName || '' };
          });
      },

      async listAllOrders({ status, search } = {}) {
        const s = getState();
        const q = (search || '').trim().toLowerCase();
        return s.orders
          .map((o) => {
            const b = s.briefs.find((br) => br.orderId === o.id);
            const u = s.users.find((usr) => usr.id === o.userId);
            return {
              ...deepClone(o),
              brandName: b?.brandName || '',
              clientName: u?.fullName || '',
              clientEmail: u?.emailRaw || '',
            };
          })
          .filter((o) => (!status || status === 'all' || o.status === status))
          .filter(
            (o) =>
              !q ||
              o.folio.toLowerCase().includes(q) ||
              o.brandName.toLowerCase().includes(q) ||
              o.clientEmail.toLowerCase().includes(q)
          )
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      },

      async updateOrder(id, fields) {
        const o = getState().orders.find((x) => x.id === Number(id));
        if (!o) return null;
        for (const [k, v] of Object.entries(fields)) {
          if (['paidAt', 'approvedAt', 'deliveredAt'].includes(k)) {
            o[k] = v ? new Date(v).toISOString() : null;
          } else if (['status', 'selectedProposalId', 'revisionRoundsUsed', 'approvedByUserId', 'approvedVersion'].includes(k)) {
            o[k] = v;
          }
        }
        o.updatedAt = nowIso();
        return deepClone(o);
      },

      async getBriefByOrderId(orderId) {
        const b = getState().briefs.find((x) => x.orderId === Number(orderId));
        return b ? deepClone(b) : null;
      },

      async updateBrief(orderId, brief) {
        const b = getState().briefs.find((x) => x.orderId === Number(orderId));
        if (!b) return null;
        Object.assign(b, {
          brandName: brief.brandName,
          contactName: brief.contactName,
          contactPhone: brief.contactPhone,
          contactEmail: brief.contactEmail,
          activity: brief.activity,
          targetAudience: brief.targetAudience,
          differentiator: brief.differentiator,
          personality: brief.personality,
          usageChannels: brief.usageChannels,
          slogan: brief.slogan || '',
          colorPreferences: brief.colorPreferences || '',
          stylePreferences: brief.stylePreferences || '',
          avoidElements: brief.avoidElements || '',
          referenceLinks: deepClone(brief.referenceLinks || []),
          notes: brief.notes || '',
          updatedAt: nowIso(),
        });
        return deepClone(b);
      },

      async listCheckoutAttemptsByOrder(orderId) {
        return getState()
          .checkoutAttempts.filter((a) => a.orderId === Number(orderId))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map(deepClone);
      },

      async findOpenCheckoutAttemptByOrder(orderId) {
        const matches = getState()
          .checkoutAttempts.filter((a) => a.orderId === Number(orderId) && (a.status === 'open' || a.status === 'async_pending'))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        return matches[0] ? deepClone(matches[0]) : null;
      },

      async findCheckoutAttemptBySessionId(stripeSessionId) {
        const a = getState().checkoutAttempts.find((x) => x.stripeSessionId === stripeSessionId);
        return a ? deepClone(a) : null;
      },

      async createCheckoutAttempt({ orderId, stripeSessionId, idempotencyKey, status, checkoutUrl, amountTotalCents, currency, expiresAt }) {
        const s = getState();
        if (s.checkoutAttempts.some((x) => x.stripeSessionId === stripeSessionId || x.idempotencyKey === idempotencyKey)) {
          throw dupError('Duplicate checkout attempt');
        }
        const ts = nowIso();
        const rec = {
          id: ++s.seq.checkoutAttempts,
          orderId: Number(orderId),
          stripeSessionId,
          idempotencyKey,
          status,
          checkoutUrl: checkoutUrl || null,
          amountTotalCents: Number(amountTotalCents),
          currency,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          createdAt: ts,
          updatedAt: ts,
        };
        s.checkoutAttempts.push(rec);
        return deepClone(rec);
      },

      async updateCheckoutAttempt(id, fields) {
        const rec = getState().checkoutAttempts.find((x) => x.id === Number(id));
        if (!rec) return null;
        if (fields.status !== undefined) rec.status = fields.status;
        if (fields.checkoutUrl !== undefined) rec.checkoutUrl = fields.checkoutUrl;
        if (fields.expiresAt !== undefined) rec.expiresAt = fields.expiresAt ? new Date(fields.expiresAt).toISOString() : null;
        rec.updatedAt = nowIso();
        return deepClone(rec);
      },

      async findStripeEventById(stripeEventId) {
        const e = getState().stripeEvents.find((x) => x.stripeEventId === stripeEventId);
        return e ? deepClone(e) : null;
      },

      async insertStripeEvent({ stripeEventId, eventType, livemode, orderId, outcome }) {
        const s = getState();
        if (s.stripeEvents.some((x) => x.stripeEventId === stripeEventId)) {
          throw dupError('Duplicate stripe_event_id');
        }
        const ts = nowIso();
        s.stripeEvents.push({
          id: ++s.seq.stripeEvents,
          stripeEventId,
          eventType,
          livemode: Boolean(livemode),
          orderId: orderId ? Number(orderId) : null,
          outcome,
          processedAt: ts,
          createdAt: ts,
        });
      },

      async createPrivateFile({ orderId, uploadedByUserId, purpose, version = 1, storageKey, originalName, mimeType, detectedExt, sizeBytes, sha256 }) {
        const s = getState();
        const rec = {
          id: ++s.seq.privateFiles,
          orderId: Number(orderId),
          uploadedByUserId: Number(uploadedByUserId),
          purpose,
          version: Number(version),
          storageKey,
          originalName,
          mimeType,
          detectedExt,
          sizeBytes: Number(sizeBytes),
          sha256,
          createdAt: nowIso(),
        };
        s.privateFiles.push(rec);
        return deepClone(rec);
      },

      async findPrivateFileById(id) {
        const f = getState().privateFiles.find((x) => x.id === Number(id));
        return f ? deepClone(f) : null;
      },

      async listPrivateFilesByOrder(orderId, { purpose } = {}) {
        return getState()
          .privateFiles.filter((f) => f.orderId === Number(orderId) && (!purpose || f.purpose === purpose))
          .map(deepClone);
      },

      async sumFileBytesByOrderAndPurpose(orderId, purpose) {
        return getState()
          .privateFiles.filter((f) => f.orderId === Number(orderId) && f.purpose === purpose)
          .reduce((acc, f) => acc + f.sizeBytes, 0);
      },

      async upsertProposalDraft({ orderId, position, title, concept, fileId, version = 1 }) {
        const s = getState();
        const existing = s.proposals.find(
          (p) => p.orderId === Number(orderId) && p.position === Number(position) && p.version === Number(version)
        );
        const ts = nowIso();
        if (existing) {
          existing.title = title;
          existing.concept = concept;
          existing.fileId = Number(fileId);
          existing.updatedAt = ts;
          return deepClone(existing);
        }
        const rec = {
          id: ++s.seq.proposals,
          orderId: Number(orderId),
          position: Number(position),
          title,
          concept,
          fileId: Number(fileId),
          version: Number(version),
          isPublished: false,
          publishedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        s.proposals.push(rec);
        return deepClone(rec);
      },

      async listProposalsByOrder(orderId, { publishedOnly = false } = {}) {
        return getState()
          .proposals.filter((p) => p.orderId === Number(orderId) && (!publishedOnly || p.isPublished))
          .sort((a, b) => a.position - b.position || b.version - a.version)
          .map(deepClone);
      },

      async findProposalById(id) {
        const p = getState().proposals.find((x) => x.id === Number(id));
        return p ? deepClone(p) : null;
      },

      async publishProposalsForOrder(orderId, publishedAt) {
        const ts = new Date(publishedAt).toISOString();
        for (const p of getState().proposals) {
          if (p.orderId === Number(orderId) && p.version === 1) {
            p.isPublished = true;
            p.publishedAt = ts;
            p.updatedAt = ts;
          }
        }
        return api.listProposalsByOrder(orderId, { publishedOnly: true });
      },

      async listRevisionsByOrder(orderId) {
        return getState()
          .revisions.filter((r) => r.orderId === Number(orderId))
          .sort((a, b) => a.roundNumber - b.roundNumber)
          .map(deepClone);
      },

      async findRevisionByOrderAndRound(orderId, roundNumber) {
        const r = getState().revisions.find(
          (x) => x.orderId === Number(orderId) && x.roundNumber === Number(roundNumber)
        );
        return r ? deepClone(r) : null;
      },

      async createRevisionRequest({ orderId, proposalId, roundNumber, comments }) {
        const s = getState();
        if (s.revisions.some((r) => r.orderId === Number(orderId) && r.roundNumber === Number(roundNumber))) {
          throw dupError('Duplicate revision round');
        }
        const rec = {
          id: ++s.seq.revisions,
          orderId: Number(orderId),
          proposalId: Number(proposalId),
          roundNumber: Number(roundNumber),
          comments,
          status: 'open',
          responseNotes: '',
          revisedFileId: null,
          createdAt: nowIso(),
          addressedAt: null,
        };
        s.revisions.push(rec);
        return deepClone(rec);
      },

      async addressRevisionRequest(id, { responseNotes, revisedFileId, addressedAt }) {
        const r = getState().revisions.find((x) => x.id === Number(id));
        if (!r) return null;
        r.status = 'addressed';
        r.responseNotes = responseNotes || '';
        r.revisedFileId = revisedFileId ? Number(revisedFileId) : null;
        r.addressedAt = new Date(addressedAt).toISOString();
        return deepClone(r);
      },

      async enqueueOutbox({ orderId = null, recipientEmail, templateName, subject, payloadJson }) {
        const s = getState();
        const ts = nowIso();
        const rec = {
          id: ++s.seq.outbox,
          orderId: orderId ? Number(orderId) : null,
          recipientEmail,
          templateName,
          subject,
          payloadJson: deepClone(payloadJson || {}),
          status: 'pending',
          attempts: 0,
          maxAttempts: 5,
          lastError: null,
          nextAttemptAt: ts,
          sentAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        s.outbox.push(rec);
        return deepClone(rec);
      },

      async listDueOutbox(limit = 20) {
        const now = Date.now();
        return getState()
          .outbox.filter((o) => o.status === 'pending' && o.attempts < o.maxAttempts && Date.parse(o.nextAttemptAt) <= now)
          .slice(0, limit)
          .map(deepClone);
      },

      async listOutbox({ limit = 50 } = {}) {
        return getState()
          .outbox.slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, limit)
          .map(deepClone);
      },

      async markOutboxSent(id, sentAt) {
        const o = getState().outbox.find((x) => x.id === Number(id));
        if (!o) return;
        o.status = 'sent';
        o.sentAt = new Date(sentAt).toISOString();
        o.lastError = null;
        o.updatedAt = nowIso();
      },

      async markOutboxAttemptFailed(id, { attempts, status, lastError, nextAttemptAt }) {
        const o = getState().outbox.find((x) => x.id === Number(id));
        if (!o) return;
        o.attempts = attempts;
        o.status = status;
        o.lastError = String(lastError || '').slice(0, 255);
        o.nextAttemptAt = new Date(nextAttemptAt).toISOString();
        o.updatedAt = nowIso();
      },

      async resetOutboxForRetry(id) {
        const o = getState().outbox.find((x) => x.id === Number(id));
        if (!o) return;
        o.status = 'pending';
        o.attempts = 0;
        o.lastError = null;
        o.nextAttemptAt = nowIso();
        o.updatedAt = nowIso();
      },

      async insertAuditLog({ actorUserId = null, actorRole = 'system', action, orderId = null, targetType = null, targetId = null, outcome = 'ok', metadataJson = {}, ipAddress = null }) {
        const s = getState();
        s.auditLog.push({
          id: ++s.seq.auditLog,
          actorUserId: actorUserId ? Number(actorUserId) : null,
          actorRole,
          action,
          orderId: orderId ? Number(orderId) : null,
          targetType,
          targetId: targetId ? String(targetId) : null,
          outcome,
          metadataJson: deepClone(metadataJson || {}),
          ipAddress,
          createdAt: nowIso(),
        });
      },

      async listAuditLogs({ orderId, limit = 100 } = {}) {
        return getState()
          .auditLog.filter((a) => !orderId || a.orderId === Number(orderId))
          .slice()
          .sort((a, b) => b.id - a.id)
          .slice(0, limit)
          .map(deepClone);
      },

      async close() {},
    };

    return api;
  }

  return buildApi(() => state);
}
