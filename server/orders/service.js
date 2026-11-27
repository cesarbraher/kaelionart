import { generateFolio, isValidEmail } from '../auth/crypto.js';
import { FINAL_FILE_PURPOSES } from '../files/service.js';
import { getClientIp, HttpError } from '../lib/http.js';

function cleanRequired(val, label, min = 2, max = 2000) {
  const s = String(val ?? '').trim();
  if (s.length < min || s.length > max) {
    throw new HttpError(400, 'validation_error', `El campo "${label}" es obligatorio (entre ${min} y ${max} caracteres).`);
  }
  return s;
}

function cleanOptional(val, max = 1000) {
  return String(val ?? '').trim().slice(0, max);
}

function cleanReferenceLinks(links) {
  if (!links) return [];
  const arr = Array.isArray(links)
    ? links
    : String(links)
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

  if (arr.length > 8) {
    throw new HttpError(400, 'too_many_links', 'Máximo 8 enlaces de referencia.');
  }

  const out = [];
  for (const raw of arr) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('protocol');
      }
      out.push(u.href);
    } catch {
      throw new HttpError(400, 'invalid_reference_url', `Enlace de referencia inválido: ${raw}`);
    }
  }
  return out;
}

export function validateBriefPayload(body, fallbackEmail = '') {
  const contactEmail = String(body.contactEmail || fallbackEmail || '').trim();
  if (!isValidEmail(contactEmail.toLowerCase())) {
    throw new HttpError(400, 'invalid_contact_email', 'Ingresa un correo de contacto válido en el brief.');
  }
  return {
    brandName: cleanRequired(body.brandName, 'Nombre de marca', 2, 160),
    contactName: cleanRequired(body.contactName, 'Nombre de contacto', 2, 160),
    contactPhone: cleanRequired(body.contactPhone, 'Teléfono o WhatsApp', 7, 40),
    contactEmail,
    activity: cleanRequired(body.activity, 'Actividad o giro', 5, 2000),
    targetAudience: cleanRequired(body.targetAudience, 'Público objetivo', 3, 2000),
    differentiator: cleanRequired(body.differentiator, 'Diferenciador', 3, 2000),
    personality: cleanRequired(body.personality, 'Personalidad de marca', 3, 255),
    usageChannels: cleanRequired(body.usageChannels, 'Usos principales', 3, 255),
    slogan: cleanOptional(body.slogan, 255),
    colorPreferences: cleanOptional(body.colorPreferences, 1000),
    stylePreferences: cleanOptional(body.stylePreferences, 1000),
    avoidElements: cleanOptional(body.avoidElements, 1000),
    referenceLinks: cleanReferenceLinks(body.referenceLinks),
    notes: cleanOptional(body.notes, 2000),
  };
}

export function createOrderService({ store, config, mailService }) {
  async function createOrder({ body, user, req }) {
    const brief = validateBriefPayload(body, user.emailRaw);
    const folio = generateFolio();

    const result = await store.withTransaction(async (tx) => {
      const created = await tx.createOrderWithBrief({
        folio,
        userId: user.id,
        productCode: config.stripe.promoProductCode,
        productName: config.stripe.promoProductName,
        currency: config.stripe.promoCurrency,
        amountTotalCents: config.stripe.promoAmountCents,
        brief,
      });
      await tx.insertAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'order.created',
        orderId: created.order.id,
        targetType: 'order',
        targetId: created.order.folio,
        outcome: 'ok',
        ipAddress: getClientIp(req),
      });
      return created;
    });

    return result;
  }

  async function updateBrief({ orderId, body, user, req }) {
    const order = await store.findOrderById(orderId);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
    if (user.role !== 'admin' && order.userId !== user.id) {
      throw new HttpError(403, 'forbidden', 'No tienes permiso para modificar este brief.');
    }
    if (!['brief_saved', 'awaiting_payment'].includes(order.status)) {
      throw new HttpError(409, 'brief_locked', 'El brief ya no puede editarse después de confirmar el pago.');
    }
    const briefData = validateBriefPayload(body, user.emailRaw);
    const updated = await store.updateBrief(order.id, briefData);
    await store.insertAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'order.brief_updated',
      orderId: order.id,
      outcome: 'ok',
      ipAddress: getClientIp(req),
    });
    return { order, brief: updated };
  }

  async function listOrdersForUser(user) {
    return store.listOrdersByUser(user.id);
  }

  async function getOrderDetail({ orderId, user }) {
    const order = await store.findOrderById(orderId);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
    if (user.role !== 'admin' && order.userId !== user.id) {
      throw new HttpError(403, 'forbidden', 'No tienes acceso a este pedido.');
    }

    const isAdmin = user.role === 'admin';
    const [brief, proposals, revisions, allFiles, attempts, owner] = await Promise.all([
      store.getBriefByOrderId(order.id),
      store.listProposalsByOrder(order.id, { publishedOnly: !isAdmin }),
      store.listRevisionsByOrder(order.id),
      store.listPrivateFilesByOrder(order.id),
      store.listCheckoutAttemptsByOrder(order.id),
      isAdmin ? store.findUserById(order.userId) : Promise.resolve(null),
    ]);

    const visibleFiles = allFiles
      .filter((f) => {
        if (isAdmin) return true;
        if (FINAL_FILE_PURPOSES.includes(f.purpose)) return order.status === 'delivered';
        if (f.purpose === 'proposal') return proposals.some((p) => p.fileId === f.id);
        return true;
      })
      .map((f) => ({
        id: f.id,
        purpose: f.purpose,
        version: f.version,
        originalName: f.originalName,
        mimeType: f.mimeType,
        detectedExt: f.detectedExt,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        createdAt: f.createdAt,
      }));

    return {
      order,
      brief,
      proposals,
      revisions,
      files: visibleFiles,
      checkoutAttempts: attempts.map((a) => ({
        id: a.id,
        status: a.status,
        amountTotalCents: a.amountTotalCents,
        currency: a.currency,
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
      })),
      ...(isAdmin && owner
        ? { client: { id: owner.id, fullName: owner.fullName, email: owner.emailRaw } }
        : {}),
    };
  }

  async function adminSaveProposalDraft({ orderId, position, title, concept, fileId, adminUser, req }) {
    const pos = Number(position);
    if (![1, 2, 3].includes(pos)) {
      throw new HttpError(400, 'invalid_position', 'La posición de propuesta debe ser 1, 2 o 3.');
    }
    const cleanTitle = cleanRequired(title, 'Título de propuesta', 2, 160);
    const cleanConcept = cleanRequired(concept, 'Concepto creativo', 5, 2000);

    const order = await store.findOrderById(orderId);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
    if (order.status !== 'paid') {
      throw new HttpError(409, 'invalid_state', 'Solo se pueden preparar propuestas iniciales cuando el pedido está pagado.');
    }

    const file = await store.findPrivateFileById(fileId);
    if (!file || file.orderId !== order.id || file.purpose !== 'proposal') {
      throw new HttpError(400, 'invalid_proposal_file', 'El archivo de propuesta no pertenece a este pedido.');
    }

    const proposal = await store.upsertProposalDraft({
      orderId: order.id,
      position: pos,
      title: cleanTitle,
      concept: cleanConcept,
      fileId: file.id,
      version: 1,
    });

    await store.insertAuditLog({
      actorUserId: adminUser.id,
      actorRole: 'admin',
      action: 'admin.proposal_saved',
      orderId: order.id,
      targetType: 'proposal',
      targetId: proposal.id,
      outcome: 'ok',
      metadataJson: { position: pos },
      ipAddress: getClientIp(req),
    });

    return proposal;
  }

  async function adminPublishProposals({ orderId, adminUser, req }) {
    const result = await store.withTransaction(async (tx) => {
      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (order.status !== 'paid') {
        throw new HttpError(409, 'invalid_state', 'Las 3 propuestas solo pueden publicarse desde el estado paid.');
      }

      const drafts = (await tx.listProposalsByOrder(order.id)).filter((p) => p.version === 1);
      const positions = new Set(drafts.map((p) => p.position));
      if (!positions.has(1) || !positions.has(2) || !positions.has(3)) {
        throw new HttpError(
          400,
          'three_proposals_required',
          'Debes cargar las tres propuestas (posiciones 1, 2 y 3) antes de publicarlas juntas.'
        );
      }

      const published = await tx.publishProposalsForOrder(order.id, new Date());
      const updatedOrder = await tx.updateOrder(order.id, { status: 'proposals_ready' });

      const owner = await tx.findUserById(order.userId);
      const brief = await tx.getBriefByOrderId(order.id);
      if (owner) {
        await tx.enqueueOutbox({
          orderId: order.id,
          recipientEmail: owner.emailRaw,
          templateName: 'proposals_ready',
          subject: `Tus 3 propuestas están listas — Folio ${order.folio}`,
          payloadJson: {
            folio: order.folio,
            brandName: brief?.brandName || '',
            portalUrl: `${config.appOrigin}/portal/?order=${order.id}`,
          },
        });
      }

      await tx.insertAuditLog({
        actorUserId: adminUser.id,
        actorRole: 'admin',
        action: 'admin.proposals_published',
        orderId: order.id,
        outcome: 'ok',
        metadataJson: { count: published.length },
        ipAddress: getClientIp(req),
      });

      return { order: updatedOrder, proposals: published };
    });

    mailService.kickOutbox();
    return result;
  }

  async function clientSelectProposal({ orderId, proposalId, user, req }) {
    return store.withTransaction(async (tx) => {
      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (order.userId !== user.id) {
        throw new HttpError(403, 'forbidden', 'Solo el titular del pedido puede elegir la propuesta.');
      }
      if (order.status !== 'proposals_ready') {
        throw new HttpError(409, 'invalid_state', 'La selección solo está disponible cuando las propuestas están listas.');
      }

      const proposal = await tx.findProposalById(proposalId);
      if (!proposal || proposal.orderId !== order.id || !proposal.isPublished) {
        throw new HttpError(404, 'proposal_not_found', 'Propuesta no válida para este pedido.');
      }

      const updatedOrder = await tx.updateOrder(order.id, {
        status: 'proposal_selected',
        selectedProposalId: proposal.id,
      });

      await tx.insertAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'order.proposal_selected',
        orderId: order.id,
        targetType: 'proposal',
        targetId: proposal.id,
        outcome: 'ok',
        metadataJson: { position: proposal.position },
        ipAddress: getClientIp(req),
      });

      return { order: updatedOrder, selectedProposal: proposal };
    });
  }

  async function clientRequestRevision({ orderId, comments, user, req }) {
    const cleanComments = cleanRequired(comments, 'Comentarios agrupados de ajuste', 5, 3000);

    return store.withTransaction(async (tx) => {
      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (order.userId !== user.id) {
        throw new HttpError(403, 'forbidden', 'Solo el titular del pedido puede solicitar ajustes.');
      }
      if (!['proposal_selected', 'revision_ready'].includes(order.status)) {
        throw new HttpError(
          409,
          'invalid_state',
          'No puedes enviar una ronda de ajuste en el estado actual del pedido.'
        );
      }
      if (!order.selectedProposalId) {
        throw new HttpError(409, 'no_proposal_selected', 'Primero debes elegir una propuesta.');
      }
      if (order.revisionRoundsUsed >= order.maxRevisionRounds) {
        throw new HttpError(
          409,
          'max_revisions_reached',
          `Ya utilizaste el máximo de ${order.maxRevisionRounds} rondas de ajustes incluidas en la promoción.`
        );
      }

      const nextRound = order.revisionRoundsUsed + 1;
      const revision = await tx.createRevisionRequest({
        orderId: order.id,
        proposalId: order.selectedProposalId,
        roundNumber: nextRound,
        comments: cleanComments,
      });

      const updatedOrder = await tx.updateOrder(order.id, {
        status: 'revision_requested',
        revisionRoundsUsed: nextRound,
      });

      await tx.insertAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'order.revision_requested',
        orderId: order.id,
        targetType: 'revision_request',
        targetId: revision.id,
        outcome: 'ok',
        metadataJson: { roundNumber: nextRound },
        ipAddress: getClientIp(req),
      });

      return { order: updatedOrder, revision };
    });
  }

  async function adminDeliverRevision({ orderId, roundNumber, responseNotes, revisedFileId, adminUser, req }) {
    const round = Number(roundNumber);
    const cleanNotes = cleanOptional(responseNotes, 2000);

    const result = await store.withTransaction(async (tx) => {
      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (order.status !== 'revision_requested') {
        throw new HttpError(409, 'invalid_state', 'El pedido no tiene una ronda de revisión abierta.');
      }

      const revision = await tx.findRevisionByOrderAndRound(order.id, round);
      if (!revision || revision.status !== 'open') {
        throw new HttpError(404, 'revision_not_found', 'Ronda de revisión no encontrada o ya atendida.');
      }

      const file = await tx.findPrivateFileById(revisedFileId);
      if (!file || file.orderId !== order.id || file.purpose !== 'revision') {
        throw new HttpError(400, 'invalid_revision_file', 'Debes adjuntar el archivo actualizado de la propuesta.');
      }

      const updatedRevision = await tx.addressRevisionRequest(revision.id, {
        responseNotes: cleanNotes,
        revisedFileId: file.id,
        addressedAt: new Date(),
      });
      const updatedOrder = await tx.updateOrder(order.id, { status: 'revision_ready' });

      const owner = await tx.findUserById(order.userId);
      const brief = await tx.getBriefByOrderId(order.id);
      if (owner) {
        await tx.enqueueOutbox({
          orderId: order.id,
          recipientEmail: owner.emailRaw,
          templateName: 'revision_ready',
          subject: `Ajuste listo (Ronda ${round} de 3) — Folio ${order.folio}`,
          payloadJson: {
            folio: order.folio,
            roundNumber: round,
            brandName: brief?.brandName || '',
            portalUrl: `${config.appOrigin}/portal/?order=${order.id}`,
          },
        });
      }

      await tx.insertAuditLog({
        actorUserId: adminUser.id,
        actorRole: 'admin',
        action: 'admin.revision_delivered',
        orderId: order.id,
        targetType: 'revision_request',
        targetId: revision.id,
        outcome: 'ok',
        metadataJson: { roundNumber: round, revisedFileId: file.id },
        ipAddress: getClientIp(req),
      });

      return { order: updatedOrder, revision: updatedRevision };
    });

    mailService.kickOutbox();
    return result;
  }

  async function clientApproveOrder({ orderId, user, req }) {
    return store.withTransaction(async (tx) => {
      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (order.userId !== user.id) {
        throw new HttpError(403, 'forbidden', 'Solo el titular del pedido puede aprobar la versión final.');
      }
      if (!['proposal_selected', 'revision_ready'].includes(order.status)) {
        throw new HttpError(
          409,
          'invalid_state',
          'La aprobación solo está disponible tras elegir una propuesta o revisar un ajuste entregado.'
        );
      }

      const approvedVersion = 1 + order.revisionRoundsUsed;
      const updatedOrder = await tx.updateOrder(order.id, {
        status: 'approved',
        approvedAt: new Date(),
        approvedByUserId: user.id,
        approvedVersion,
      });

      await tx.insertAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'order.approved',
        orderId: order.id,
        outcome: 'ok',
        metadataJson: { approvedVersion, roundsUsed: order.revisionRoundsUsed },
        ipAddress: getClientIp(req),
      });

      return { order: updatedOrder };
    });
  }

  async function adminConfirmDelivery({ orderId, adminUser, req }) {
    const result = await store.withTransaction(async (tx) => {
      const order = await tx.findOrderById(orderId, { forUpdate: true });
      if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
      if (order.status !== 'approved') {
        throw new HttpError(
          409,
          'approval_required',
          'Solo se puede confirmar el paquete final después de que el cliente apruebe la versión revisada.'
        );
      }

      const files = await tx.listPrivateFilesByOrder(order.id);
      const presentPurposes = new Set(files.map((f) => f.purpose));
      const missing = FINAL_FILE_PURPOSES.filter((p) => !presentPurposes.has(p));
      if (missing.length > 0) {
        throw new HttpError(
          400,
          'missing_final_formats',
          `Faltan formatos finales obligatorios antes de entregar: ${missing.join(', ')}.`
        );
      }

      const updatedOrder = await tx.updateOrder(order.id, {
        status: 'delivered',
        deliveredAt: new Date(),
      });

      const owner = await tx.findUserById(order.userId);
      const brief = await tx.getBriefByOrderId(order.id);
      if (owner) {
        await tx.enqueueOutbox({
          orderId: order.id,
          recipientEmail: owner.emailRaw,
          templateName: 'order_delivered',
          subject: `Tus archivos finales están listos — Folio ${order.folio}`,
          payloadJson: {
            folio: order.folio,
            brandName: brief?.brandName || '',
            portalUrl: `${config.appOrigin}/portal/?order=${order.id}`,
          },
        });
      }

      await tx.insertAuditLog({
        actorUserId: adminUser.id,
        actorRole: 'admin',
        action: 'admin.order_delivered',
        orderId: order.id,
        outcome: 'ok',
        metadataJson: { formats: FINAL_FILE_PURPOSES },
        ipAddress: getClientIp(req),
      });

      return { order: updatedOrder };
    });

    mailService.kickOutbox();
    return result;
  }

  return {
    createOrder,
    updateBrief,
    listOrdersForUser,
    getOrderDetail,
    adminSaveProposalDraft,
    adminPublishProposals,
    clientSelectProposal,
    clientRequestRevision,
    adminDeliverRevision,
    clientApproveOrder,
    adminConfirmDelivery,
  };
}
