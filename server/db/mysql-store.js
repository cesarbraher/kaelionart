// mysql2/promise se carga de forma diferida al inicializar el pool MySQL.

function toMysqlDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

function fromMysqlDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (s.endsWith('Z')) return s;
  return new Date(s.replace(' ', 'T') + 'Z').toISOString();
}

function parseJsonField(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    emailNormalized: row.email_normalized,
    emailRaw: row.email_raw,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    role: row.role,
    emailVerifiedAt: fromMysqlDate(row.email_verified_at),
    mfaSecretEnc: row.mfa_secret_enc,
    mfaEnabled: Boolean(row.mfa_enabled),
    status: row.status,
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at),
  };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    folio: row.folio,
    userId: Number(row.user_id),
    status: row.status,
    productCode: row.product_code,
    productName: row.product_name,
    currency: row.currency,
    amountTotalCents: Number(row.amount_total_cents),
    selectedProposalId: row.selected_proposal_id ? Number(row.selected_proposal_id) : null,
    revisionRoundsUsed: Number(row.revision_rounds_used),
    maxRevisionRounds: Number(row.max_revision_rounds),
    paidAt: fromMysqlDate(row.paid_at),
    approvedAt: fromMysqlDate(row.approved_at),
    approvedByUserId: row.approved_by_user_id ? Number(row.approved_by_user_id) : null,
    approvedVersion: row.approved_version ? Number(row.approved_version) : null,
    deliveredAt: fromMysqlDate(row.delivered_at),
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at),
  };
}

function mapBrief(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    brandName: row.brand_name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    activity: row.activity,
    targetAudience: row.target_audience,
    differentiator: row.differentiator,
    personality: row.personality,
    usageChannels: row.usage_channels,
    slogan: row.slogan || '',
    colorPreferences: row.color_preferences || '',
    stylePreferences: row.style_preferences || '',
    avoidElements: row.avoid_elements || '',
    referenceLinks: parseJsonField(row.reference_links, []),
    notes: row.notes || '',
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at),
  };
}

function mapAttempt(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    stripeSessionId: row.stripe_session_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    checkoutUrl: row.checkout_url,
    amountTotalCents: Number(row.amount_total_cents),
    currency: row.currency,
    expiresAt: fromMysqlDate(row.expires_at),
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at),
  };
}

function mapFile(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    uploadedByUserId: Number(row.uploaded_by_user_id),
    purpose: row.purpose,
    version: Number(row.version),
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    detectedExt: row.detected_ext,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: fromMysqlDate(row.created_at),
  };
}

function mapProposal(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    position: Number(row.position),
    title: row.title,
    concept: row.concept,
    fileId: Number(row.file_id),
    version: Number(row.version),
    isPublished: Boolean(row.is_published),
    publishedAt: fromMysqlDate(row.published_at),
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at),
  };
}

function mapRevision(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    proposalId: Number(row.proposal_id),
    roundNumber: Number(row.round_number),
    comments: row.comments,
    status: row.status,
    responseNotes: row.response_notes || '',
    revisedFileId: row.revised_file_id ? Number(row.revised_file_id) : null,
    createdAt: fromMysqlDate(row.created_at),
    addressedAt: fromMysqlDate(row.addressed_at),
  };
}

function mapOutbox(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    orderId: row.order_id ? Number(row.order_id) : null,
    recipientEmail: row.recipient_email,
    templateName: row.template_name,
    subject: row.subject,
    payloadJson: parseJsonField(row.payload_json, {}),
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error,
    nextAttemptAt: fromMysqlDate(row.next_attempt_at),
    sentAt: fromMysqlDate(row.sent_at),
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at),
  };
}

function mapAudit(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    actorUserId: row.actor_user_id ? Number(row.actor_user_id) : null,
    actorRole: row.actor_role,
    action: row.action,
    orderId: row.order_id ? Number(row.order_id) : null,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    metadataJson: parseJsonField(row.metadata_json, {}),
    ipAddress: row.ip_address,
    createdAt: fromMysqlDate(row.created_at),
  };
}

function createRepo(executor, pool) {
  const repo = {
    async withTransaction(fn) {
      if (!pool) {
        return fn(repo);
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const txRepo = createRepo(conn, null);
        const result = await fn(txRepo);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },

    async createUser({ emailNormalized, emailRaw, fullName, passwordHash, role = 'client', emailVerifiedAt = null, mfaSecretEnc = null, mfaEnabled = false }) {
      const [res] = await executor.execute(
        `INSERT INTO users (email_normalized, email_raw, full_name, password_hash, role, email_verified_at, mfa_secret_enc, mfa_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [emailNormalized, emailRaw, fullName, passwordHash, role, toMysqlDate(emailVerifiedAt), mfaSecretEnc, mfaEnabled ? 1 : 0]
      );
      return repo.findUserById(Number(res.insertId));
    },

    async findUserByEmail(emailNormalized) {
      const [rows] = await executor.execute('SELECT * FROM users WHERE email_normalized = ? LIMIT 1', [emailNormalized]);
      return mapUser(rows[0]);
    },

    async findUserById(id) {
      const [rows] = await executor.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      return mapUser(rows[0]);
    },

    async updateUser(id, fields) {
      const colMap = {
        fullName: 'full_name',
        passwordHash: 'password_hash',
        emailVerifiedAt: 'email_verified_at',
        mfaSecretEnc: 'mfa_secret_enc',
        mfaEnabled: 'mfa_enabled',
        status: 'status',
      };
      const sets = [];
      const params = [];
      for (const [k, v] of Object.entries(fields)) {
        if (!colMap[k]) continue;
        sets.push(`${colMap[k]} = ?`);
        if (k === 'emailVerifiedAt') params.push(toMysqlDate(v));
        else if (k === 'mfaEnabled') params.push(v ? 1 : 0);
        else params.push(v);
      }
      if (sets.length === 0) return repo.findUserById(id);
      params.push(id);
      await executor.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
      return repo.findUserById(id);
    },

    async createEmailToken({ userId, tokenHash, purpose, expiresAt }) {
      const [res] = await executor.execute(
        'INSERT INTO email_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)',
        [userId, tokenHash, purpose, toMysqlDate(expiresAt)]
      );
      return Number(res.insertId);
    },

    async findValidEmailToken(tokenHash, purpose) {
      const [rows] = await executor.execute(
        `SELECT * FROM email_tokens
         WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(3)
         LIMIT 1`,
        [tokenHash, purpose]
      );
      if (!rows[0]) return null;
      return {
        id: Number(rows[0].id),
        userId: Number(rows[0].user_id),
        purpose: rows[0].purpose,
        expiresAt: fromMysqlDate(rows[0].expires_at),
      };
    },

    async markEmailTokenUsed(id) {
      await executor.execute('UPDATE email_tokens SET used_at = UTC_TIMESTAMP(3) WHERE id = ?', [id]);
    },

    async createSession({ tokenHash, csrfToken, userId, ipAddress, userAgent, expiresAt }) {
      const [res] = await executor.execute(
        `INSERT INTO sessions (token_hash, csrf_token, user_id, ip_address, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tokenHash, csrfToken, userId, ipAddress || null, userAgent ? String(userAgent).slice(0, 255) : null, toMysqlDate(expiresAt)]
      );
      return {
        id: Number(res.insertId),
        csrfToken,
        userId,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async findActiveSessionByTokenHash(tokenHash) {
      const [rows] = await executor.execute(
        `SELECT s.id AS session_id, s.csrf_token, s.user_id, s.expires_at,
                u.id AS u_id, u.email_normalized, u.email_raw, u.full_name, u.password_hash,
                u.role, u.email_verified_at, u.mfa_secret_enc, u.mfa_enabled, u.status,
                u.created_at, u.updated_at
         FROM sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active'
         LIMIT 1`,
        [tokenHash]
      );
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        id: Number(r.session_id),
        csrfToken: r.csrf_token,
        userId: Number(r.user_id),
        expiresAt: fromMysqlDate(r.expires_at),
        user: mapUser({ ...r, id: r.u_id }),
      };
    },

    async findActiveSessionById(id) {
      const [rows] = await executor.execute(
        `SELECT s.id AS session_id, s.user_id, u.status
         FROM sessions s INNER JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active'
         LIMIT 1`,
        [id]
      );
      return rows[0] ? { id: Number(rows[0].session_id), userId: Number(rows[0].user_id) } : null;
    },

    async revokeSessionByTokenHash(tokenHash) {
      await executor.execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ? AND revoked_at IS NULL', [tokenHash]);
    },

    async revokeAllSessionsForUser(userId) {
      await executor.execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    },

    async createOrderWithBrief({ folio, userId, productCode, productName, currency, amountTotalCents, brief }) {
      const [oRes] = await executor.execute(
        `INSERT INTO orders (folio, user_id, status, product_code, product_name, currency, amount_total_cents)
         VALUES (?, ?, 'brief_saved', ?, ?, ?, ?)`,
        [folio, userId, productCode, productName, currency, amountTotalCents]
      );
      const orderId = Number(oRes.insertId);
      await executor.execute(
        `INSERT INTO briefs (
          order_id, brand_name, contact_name, contact_phone, contact_email,
          activity, target_audience, differentiator, personality, usage_channels,
          slogan, color_preferences, style_preferences, avoid_elements, reference_links, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, brief.brandName, brief.contactName, brief.contactPhone, brief.contactEmail,
          brief.activity, brief.targetAudience, brief.differentiator, brief.personality, brief.usageChannels,
          brief.slogan || null, brief.colorPreferences || null, brief.stylePreferences || null,
          brief.avoidElements || null, JSON.stringify(brief.referenceLinks || []), brief.notes || null,
        ]
      );
      return {
        order: await repo.findOrderById(orderId),
        brief: await repo.getBriefByOrderId(orderId),
      };
    },

    async findOrderById(id, { forUpdate = false } = {}) {
      const sql = `SELECT * FROM orders WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`;
      const [rows] = await executor.execute(sql, [id]);
      return mapOrder(rows[0]);
    },

    async findOrderByFolio(folio) {
      const [rows] = await executor.execute('SELECT * FROM orders WHERE folio = ? LIMIT 1', [folio]);
      return mapOrder(rows[0]);
    },

    async listOrdersByUser(userId) {
      const [rows] = await executor.execute(
        `SELECT o.*, b.brand_name
         FROM orders o LEFT JOIN briefs b ON b.order_id = o.id
         WHERE o.user_id = ? ORDER BY o.created_at DESC`,
        [userId]
      );
      return rows.map((r) => ({ ...mapOrder(r), brandName: r.brand_name || '' }));
    },

    async listAllOrders({ status, search } = {}) {
      const where = [];
      const params = [];
      if (status && status !== 'all') {
        where.push('o.status = ?');
        params.push(status);
      }
      if (search && search.trim()) {
        where.push('(o.folio LIKE ? OR b.brand_name LIKE ? OR u.email_normalized LIKE ?)');
        const q = `%${search.trim()}%`;
        params.push(q, q, q);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await executor.execute(
        `SELECT o.*, b.brand_name, u.full_name AS client_name, u.email_raw AS client_email
         FROM orders o
         LEFT JOIN briefs b ON b.order_id = o.id
         INNER JOIN users u ON u.id = o.user_id
         ${clause}
         ORDER BY o.created_at DESC
         LIMIT 200`,
        params
      );
      return rows.map((r) => ({
        ...mapOrder(r),
        brandName: r.brand_name || '',
        clientName: r.client_name,
        clientEmail: r.client_email,
      }));
    },

    async updateOrder(id, fields) {
      const colMap = {
        status: 'status',
        selectedProposalId: 'selected_proposal_id',
        revisionRoundsUsed: 'revision_rounds_used',
        paidAt: 'paid_at',
        approvedAt: 'approved_at',
        approvedByUserId: 'approved_by_user_id',
        approvedVersion: 'approved_version',
        deliveredAt: 'delivered_at',
      };
      const sets = [];
      const params = [];
      for (const [k, v] of Object.entries(fields)) {
        if (!colMap[k]) continue;
        sets.push(`${colMap[k]} = ?`);
        if (['paidAt', 'approvedAt', 'deliveredAt'].includes(k)) params.push(toMysqlDate(v));
        else params.push(v);
      }
      if (sets.length === 0) return repo.findOrderById(id);
      params.push(id);
      await executor.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params);
      return repo.findOrderById(id);
    },

    async getBriefByOrderId(orderId) {
      const [rows] = await executor.execute('SELECT * FROM briefs WHERE order_id = ? LIMIT 1', [orderId]);
      return mapBrief(rows[0]);
    },

    async updateBrief(orderId, brief) {
      await executor.execute(
        `UPDATE briefs SET
          brand_name = ?, contact_name = ?, contact_phone = ?, contact_email = ?,
          activity = ?, target_audience = ?, differentiator = ?, personality = ?, usage_channels = ?,
          slogan = ?, color_preferences = ?, style_preferences = ?, avoid_elements = ?, reference_links = ?, notes = ?
         WHERE order_id = ?`,
        [
          brief.brandName, brief.contactName, brief.contactPhone, brief.contactEmail,
          brief.activity, brief.targetAudience, brief.differentiator, brief.personality, brief.usageChannels,
          brief.slogan || null, brief.colorPreferences || null, brief.stylePreferences || null,
          brief.avoidElements || null, JSON.stringify(brief.referenceLinks || []), brief.notes || null,
          orderId,
        ]
      );
      return repo.getBriefByOrderId(orderId);
    },

    async listCheckoutAttemptsByOrder(orderId) {
      const [rows] = await executor.execute(
        'SELECT * FROM checkout_attempts WHERE order_id = ? ORDER BY created_at DESC',
        [orderId]
      );
      return rows.map(mapAttempt);
    },

    async findOpenCheckoutAttemptByOrder(orderId) {
      const [rows] = await executor.execute(
        `SELECT * FROM checkout_attempts
         WHERE order_id = ? AND status IN ('open', 'async_pending')
         ORDER BY created_at DESC LIMIT 1`,
        [orderId]
      );
      return mapAttempt(rows[0]);
    },

    async findCheckoutAttemptBySessionId(stripeSessionId) {
      const [rows] = await executor.execute(
        'SELECT * FROM checkout_attempts WHERE stripe_session_id = ? LIMIT 1',
        [stripeSessionId]
      );
      return mapAttempt(rows[0]);
    },

    async createCheckoutAttempt({ orderId, stripeSessionId, idempotencyKey, status, checkoutUrl, amountTotalCents, currency, expiresAt }) {
      const [res] = await executor.execute(
        `INSERT INTO checkout_attempts (order_id, stripe_session_id, idempotency_key, status, checkout_url, amount_total_cents, currency, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, stripeSessionId, idempotencyKey, status, checkoutUrl || null, amountTotalCents, currency, toMysqlDate(expiresAt)]
      );
      const [rows] = await executor.execute('SELECT * FROM checkout_attempts WHERE id = ?', [res.insertId]);
      return mapAttempt(rows[0]);
    },

    async updateCheckoutAttempt(id, fields) {
      const colMap = { status: 'status', checkoutUrl: 'checkout_url', expiresAt: 'expires_at' };
      const sets = [];
      const params = [];
      for (const [k, v] of Object.entries(fields)) {
        if (!colMap[k]) continue;
        sets.push(`${colMap[k]} = ?`);
        params.push(k === 'expiresAt' ? toMysqlDate(v) : v);
      }
      if (sets.length === 0) return null;
      params.push(id);
      await executor.execute(`UPDATE checkout_attempts SET ${sets.join(', ')} WHERE id = ?`, params);
      const [rows] = await executor.execute('SELECT * FROM checkout_attempts WHERE id = ?', [id]);
      return mapAttempt(rows[0]);
    },

    async findStripeEventById(stripeEventId) {
      const [rows] = await executor.execute(
        'SELECT * FROM stripe_events WHERE stripe_event_id = ? LIMIT 1',
        [stripeEventId]
      );
      return rows[0] || null;
    },

    async insertStripeEvent({ stripeEventId, eventType, livemode, orderId, outcome }) {
      await executor.execute(
        `INSERT INTO stripe_events (stripe_event_id, event_type, livemode, order_id, outcome)
         VALUES (?, ?, ?, ?, ?)`,
        [stripeEventId, eventType, livemode ? 1 : 0, orderId || null, outcome]
      );
    },

    async createPrivateFile({ orderId, uploadedByUserId, purpose, version = 1, storageKey, originalName, mimeType, detectedExt, sizeBytes, sha256 }) {
      const [res] = await executor.execute(
        `INSERT INTO private_files (order_id, uploaded_by_user_id, purpose, version, storage_key, original_name, mime_type, detected_ext, size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, uploadedByUserId, purpose, version, storageKey, originalName, mimeType, detectedExt, sizeBytes, sha256]
      );
      return repo.findPrivateFileById(Number(res.insertId));
    },

    async findPrivateFileById(id) {
      const [rows] = await executor.execute('SELECT * FROM private_files WHERE id = ? LIMIT 1', [id]);
      return mapFile(rows[0]);
    },

    async listPrivateFilesByOrder(orderId, { purpose } = {}) {
      const params = [orderId];
      let sql = 'SELECT * FROM private_files WHERE order_id = ?';
      if (purpose) {
        sql += ' AND purpose = ?';
        params.push(purpose);
      }
      sql += ' ORDER BY created_at ASC';
      const [rows] = await executor.execute(sql, params);
      return rows.map(mapFile);
    },

    async sumFileBytesByOrderAndPurpose(orderId, purpose) {
      const [rows] = await executor.execute(
        'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM private_files WHERE order_id = ? AND purpose = ?',
        [orderId, purpose]
      );
      return Number(rows[0]?.total || 0);
    },

    async upsertProposalDraft({ orderId, position, title, concept, fileId, version = 1 }) {
      await executor.execute(
        `INSERT INTO proposals (order_id, position, title, concept, file_id, version, is_published)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE title = VALUES(title), concept = VALUES(concept), file_id = VALUES(file_id)`,
        [orderId, position, title, concept, fileId, version]
      );
      const [rows] = await executor.execute(
        'SELECT * FROM proposals WHERE order_id = ? AND position = ? AND version = ? LIMIT 1',
        [orderId, position, version]
      );
      return mapProposal(rows[0]);
    },

    async listProposalsByOrder(orderId, { publishedOnly = false } = {}) {
      const sql = publishedOnly
        ? 'SELECT * FROM proposals WHERE order_id = ? AND is_published = 1 ORDER BY position ASC, version DESC'
        : 'SELECT * FROM proposals WHERE order_id = ? ORDER BY position ASC, version DESC';
      const [rows] = await executor.execute(sql, [orderId]);
      return rows.map(mapProposal);
    },

    async findProposalById(id) {
      const [rows] = await executor.execute('SELECT * FROM proposals WHERE id = ? LIMIT 1', [id]);
      return mapProposal(rows[0]);
    },

    async publishProposalsForOrder(orderId, publishedAt) {
      await executor.execute(
        'UPDATE proposals SET is_published = 1, published_at = ? WHERE order_id = ? AND version = 1',
        [toMysqlDate(publishedAt), orderId]
      );
      return repo.listProposalsByOrder(orderId, { publishedOnly: true });
    },

    async listRevisionsByOrder(orderId) {
      const [rows] = await executor.execute(
        'SELECT * FROM revision_requests WHERE order_id = ? ORDER BY round_number ASC',
        [orderId]
      );
      return rows.map(mapRevision);
    },

    async findRevisionByOrderAndRound(orderId, roundNumber) {
      const [rows] = await executor.execute(
        'SELECT * FROM revision_requests WHERE order_id = ? AND round_number = ? LIMIT 1',
        [orderId, roundNumber]
      );
      return mapRevision(rows[0]);
    },

    async createRevisionRequest({ orderId, proposalId, roundNumber, comments }) {
      const [res] = await executor.execute(
        `INSERT INTO revision_requests (order_id, proposal_id, round_number, comments, status)
         VALUES (?, ?, ?, ?, 'open')`,
        [orderId, proposalId, roundNumber, comments]
      );
      const [rows] = await executor.execute('SELECT * FROM revision_requests WHERE id = ?', [res.insertId]);
      return mapRevision(rows[0]);
    },

    async addressRevisionRequest(id, { responseNotes, revisedFileId, addressedAt }) {
      await executor.execute(
        `UPDATE revision_requests
         SET status = 'addressed', response_notes = ?, revised_file_id = ?, addressed_at = ?
         WHERE id = ?`,
        [responseNotes || null, revisedFileId || null, toMysqlDate(addressedAt), id]
      );
      const [rows] = await executor.execute('SELECT * FROM revision_requests WHERE id = ?', [id]);
      return mapRevision(rows[0]);
    },

    async enqueueOutbox({ orderId = null, recipientEmail, templateName, subject, payloadJson }) {
      const [res] = await executor.execute(
        `INSERT INTO outbox (order_id, recipient_email, template_name, subject, payload_json, status, next_attempt_at)
         VALUES (?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP(3))`,
        [orderId, recipientEmail, templateName, subject, JSON.stringify(payloadJson || {})]
      );
      const [rows] = await executor.execute('SELECT * FROM outbox WHERE id = ?', [res.insertId]);
      return mapOutbox(rows[0]);
    },

    async listDueOutbox(limit = 20) {
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const [rows] = await executor.query(
        `SELECT * FROM outbox
         WHERE status = 'pending' AND attempts < max_attempts AND next_attempt_at <= UTC_TIMESTAMP(3)
         ORDER BY created_at ASC LIMIT ${safeLimit}`
      );
      return rows.map(mapOutbox);
    },

    async listOutbox({ limit = 50 } = {}) {
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
      const [rows] = await executor.query(`SELECT * FROM outbox ORDER BY created_at DESC LIMIT ${safeLimit}`);
      return rows.map(mapOutbox);
    },

    async markOutboxSent(id, sentAt) {
      await executor.execute(
        `UPDATE outbox SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?`,
        [toMysqlDate(sentAt), id]
      );
    },

    async markOutboxAttemptFailed(id, { attempts, status, lastError, nextAttemptAt }) {
      await executor.execute(
        `UPDATE outbox SET attempts = ?, status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
        [attempts, status, String(lastError || '').slice(0, 255), toMysqlDate(nextAttemptAt), id]
      );
    },

    async resetOutboxForRetry(id) {
      await executor.execute(
        `UPDATE outbox SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = UTC_TIMESTAMP(3) WHERE id = ?`,
        [id]
      );
    },

    async insertAuditLog({ actorUserId = null, actorRole = 'system', action, orderId = null, targetType = null, targetId = null, outcome = 'ok', metadataJson = {}, ipAddress = null }) {
      await executor.execute(
        `INSERT INTO audit_log (actor_user_id, actor_role, action, order_id, target_type, target_id, outcome, metadata_json, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [actorUserId, actorRole, action, orderId, targetType, targetId ? String(targetId) : null, outcome, JSON.stringify(metadataJson || {}), ipAddress]
      );
    },

    async listAuditLogs({ orderId, limit = 100 } = {}) {
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
      if (orderId) {
        const [rows] = await executor.execute(
          `SELECT * FROM audit_log WHERE order_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
          [orderId]
        );
        return rows.map(mapAudit);
      }
      const [rows] = await executor.query(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ${safeLimit}`);
      return rows.map(mapAudit);
    },

    async close() {
      if (pool) await pool.end();
    },
  };

  return repo;
}

export function createMySqlStore(config) {
  const poolOptions = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 8000,
  };
  if (config.mysql.tls) {
    poolOptions.ssl = { rejectUnauthorized: true };
    if (config.mysql.ca) poolOptions.ssl.ca = config.mysql.ca;
  }

  let poolPromise = null;
  async function getPool() {
    if (!poolPromise) {
      poolPromise = import('mysql2/promise').then(({ default: mysql }) => mysql.createPool(poolOptions));
    }
    return poolPromise;
  }

  const lazyExecutor = {
    async execute(sql, params) {
      const pool = await getPool();
      return pool.execute(sql, params);
    },
    async query(sql, params) {
      const pool = await getPool();
      return pool.query(sql, params);
    },
  };

  const lazyPool = {
    async getConnection() {
      const pool = await getPool();
      return pool.getConnection();
    },
    async end() {
      if (poolPromise) {
        const pool = await poolPromise;
        await pool.end();
      }
    },
  };

  return createRepo(lazyExecutor, lazyPool);
}
