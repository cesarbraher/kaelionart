import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { sha256Hex, signDownloadToken, verifyDownloadToken } from '../auth/crypto.js';
import { getClientIp, HttpError } from '../lib/http.js';

export const FINAL_FILE_PURPOSES = [
  'final_ai',
  'final_svg',
  'final_pdf',
  'final_png',
  'final_jpg',
];

const PURPOSE_RULES = {
  reference: { allowedExts: ['jpg', 'jpeg', 'png'], attachmentOnly: false },
  proposal: { allowedExts: ['png', 'jpg', 'jpeg', 'pdf'], attachmentOnly: false },
  revision: { allowedExts: ['png', 'jpg', 'jpeg', 'pdf'], attachmentOnly: false },
  final_ai: { allowedExts: ['ai'], attachmentOnly: true },
  final_svg: { allowedExts: ['svg'], attachmentOnly: true },
  final_pdf: { allowedExts: ['pdf'], attachmentOnly: true },
  final_png: { allowedExts: ['png'], attachmentOnly: true },
  final_jpg: { allowedExts: ['jpg', 'jpeg'], attachmentOnly: true },
};

const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  ai: 'application/postscript',
};

function sanitizeFilename(name, fallbackExt) {
  const base = String(name || 'archivo')
    .replace(/[\\/]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .trim()
    .slice(0, 120);
  if (!base) return `archivo.${fallbackExt}`;
  return base;
}

export function detectFileFormat(buffer, originalName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, 'empty_file', 'El archivo está vacío.');
  }

  const ext = extname(String(originalName || '')).replace(/^\./, '').toLowerCase();

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    if (!['jpg', 'jpeg'].includes(ext)) {
      throw new HttpError(400, 'extension_mismatch', 'El contenido es JPEG pero la extensión no coincide.');
    }
    return { ext: 'jpg', mimeType: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (ext !== 'png') {
      throw new HttpError(400, 'extension_mismatch', 'El contenido es PNG pero la extensión no coincide.');
    }
    return { ext: 'png', mimeType: 'image/png' };
  }

  const headAscii = buffer.subarray(0, 32).toString('latin1');

  // PDF o Adobe Illustrator compatible con PDF
  if (headAscii.startsWith('%PDF-')) {
    if (ext === 'pdf') return { ext: 'pdf', mimeType: 'application/pdf' };
    if (ext === 'ai') return { ext: 'ai', mimeType: 'application/postscript' };
    throw new HttpError(400, 'extension_mismatch', 'El contenido PDF/AI no coincide con la extensión del archivo.');
  }

  // Adobe Illustrator PostScript
  if (headAscii.startsWith('%!PS-Adobe')) {
    if (ext === 'ai') return { ext: 'ai', mimeType: 'application/postscript' };
    throw new HttpError(400, 'extension_mismatch', 'El archivo PostScript debe tener extensión .ai.');
  }

  // SVG (validado estrictamente y siempre servido como adjunto sandbox)
  if (ext === 'svg') {
    const text = buffer.toString('utf8');
    if (!/<svg[\s>]/i.test(text)) {
      throw new HttpError(400, 'invalid_svg', 'El archivo .svg no contiene un elemento <svg> válido.');
    }
    if (/<script\b|javascript:|on[a-z]+\s*=/i.test(text)) {
      throw new HttpError(400, 'unsafe_svg', 'El archivo SVG contiene scripts o manejadores no permitidos.');
    }
    return { ext: 'svg', mimeType: 'image/svg+xml' };
  }

  throw new HttpError(400, 'unsupported_file_type', 'Formato de archivo no permitido o firma binaria inválida.');
}

export function createFileService({ store, config }) {
  const baseStorageDir = resolve(config.storage.privatePath);

  function resolveSafePath(storageKey) {
    const target = resolve(baseStorageDir, storageKey);
    if (target !== baseStorageDir && !target.startsWith(baseStorageDir + sep)) {
      throw new HttpError(400, 'invalid_storage_path', 'Ruta de almacenamiento inválida.');
    }
    return target;
  }

  async function saveUploadedFile({ order, user, purpose, originalName, buffer, version = 1, req }) {
    const rule = PURPOSE_RULES[purpose];
    if (!rule) {
      throw new HttpError(400, 'invalid_purpose', 'Finalidad de archivo no válida.');
    }

    if (buffer.length > config.storage.uploadMaxBytes) {
      throw new HttpError(
        413,
        'file_too_large',
        `El archivo excede el límite de ${Math.round(config.storage.uploadMaxBytes / (1024 * 1024))} MB.`
      );
    }

    const detected = detectFileFormat(buffer, originalName);
    if (!rule.allowedExts.includes(detected.ext)) {
      throw new HttpError(
        400,
        'format_not_allowed_for_purpose',
        `Para ${purpose} solo se permiten archivos: ${rule.allowedExts.join(', ').toUpperCase()}.`
      );
    }

    if (purpose === 'reference') {
      const currentBytes = await store.sumFileBytesByOrderAndPurpose(order.id, 'reference');
      if (currentBytes + buffer.length > config.storage.orderReferenceQuotaBytes) {
        throw new HttpError(
          413,
          'order_quota_exceeded',
          'Se excedió la cuota total de archivos de referencia para este pedido.'
        );
      }
    }

    const storageKey = `order-${order.id}/${randomUUID()}.${detected.ext}`;
    const fullPath = resolveSafePath(storageKey);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, buffer);

    const cleanName = sanitizeFilename(originalName, detected.ext);
    const sha256 = sha256Hex(buffer);

    const record = await store.createPrivateFile({
      orderId: order.id,
      uploadedByUserId: user.id,
      purpose,
      version,
      storageKey,
      originalName: cleanName,
      mimeType: EXT_TO_MIME[detected.ext] || detected.mimeType,
      detectedExt: detected.ext,
      sizeBytes: buffer.length,
      sha256,
    });

    await store.insertAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'file.upload',
      orderId: order.id,
      targetType: 'private_file',
      targetId: record.id,
      outcome: 'ok',
      metadataJson: { purpose, ext: detected.ext, sizeBytes: buffer.length },
      ipAddress: req ? getClientIp(req) : null,
    });

    return record;
  }

  async function canUserAccessFile({ file, order, user }) {
    if (!file || !order || file.orderId !== order.id) return false;
    if (user.role === 'admin') return true;
    if (order.userId !== user.id) return false;

    if (FINAL_FILE_PURPOSES.includes(file.purpose)) {
      return order.status === 'delivered';
    }

    if (file.purpose === 'proposal') {
      const proposals = await store.listProposalsByOrder(order.id, { publishedOnly: true });
      return proposals.some((p) => p.fileId === file.id);
    }

    return true;
  }

  async function createSignedDownloadLink({ orderId, fileId, session, inline = false, req }) {
    const order = await store.findOrderById(orderId);
    if (!order) throw new HttpError(404, 'order_not_found', 'Pedido no encontrado.');
    const file = await store.findPrivateFileById(fileId);
    if (!file || file.orderId !== order.id) {
      throw new HttpError(404, 'file_not_found', 'Archivo no encontrado.');
    }

    const allowed = await canUserAccessFile({ file, order, user: session.user });
    if (!allowed) {
      await store.insertAuditLog({
        actorUserId: session.user.id,
        actorRole: session.user.role,
        action: 'file.download_denied',
        orderId: order.id,
        targetType: 'private_file',
        targetId: file.id,
        outcome: 'denied',
        ipAddress: req ? getClientIp(req) : null,
      });
      throw new HttpError(403, 'forbidden', 'No tienes permiso para acceder a este archivo.');
    }

    const rule = PURPOSE_RULES[file.purpose] || { attachmentOnly: true };
    const isRaster = file.detectedExt === 'png' || file.detectedExt === 'jpg';
    const disposition = inline && !rule.attachmentOnly && isRaster ? 'inline' : 'attachment';

    const exp = Date.now() + config.security.downloadLinkTtlSeconds * 1000;
    const token = signDownloadToken(
      {
        fileId: file.id,
        orderId: order.id,
        userId: session.user.id,
        sessionId: session.id,
        disposition,
        exp,
      },
      config.security.sessionSecret
    );

    return {
      url: `/api/files/download/${encodeURIComponent(token)}`,
      expiresAt: new Date(exp).toISOString(),
      disposition,
      fileName: file.originalName,
    };
  }

  async function resolveDownloadToken(token, req) {
    const payload = verifyDownloadToken(token, config.security.sessionSecret);
    if (!payload) {
      throw new HttpError(401, 'download_link_expired', 'El enlace privado de descarga venció o no es válido.');
    }

    // Verifica que la sesión asociada siga activa (si se cerró sesión, el enlace queda revocado al instante)
    const activeSession = await store.findActiveSessionById(payload.sessionId);
    if (!activeSession || activeSession.userId !== payload.userId) {
      throw new HttpError(401, 'session_revoked', 'La sesión asociada al enlace ya no está activa.');
    }

    const user = await store.findUserById(payload.userId);
    const order = await store.findOrderById(payload.orderId);
    const file = await store.findPrivateFileById(payload.fileId);

    if (!user || !order || !file || !(await canUserAccessFile({ file, order, user }))) {
      throw new HttpError(403, 'forbidden', 'Acceso denegado al archivo privado.');
    }

    const fullPath = resolveSafePath(file.storageKey);
    await stat(fullPath);
    const data = await readFile(fullPath);

    await store.insertAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'file.download',
      orderId: order.id,
      targetType: 'private_file',
      targetId: file.id,
      outcome: 'ok',
      metadataJson: { purpose: file.purpose, disposition: payload.disposition },
      ipAddress: req ? getClientIp(req) : null,
    });

    const isEditableOrVector = ['svg', 'pdf', 'ai'].includes(file.detectedExt) || FINAL_FILE_PURPOSES.includes(file.purpose);
    const disposition = isEditableOrVector ? 'attachment' : payload.disposition;

    return {
      file,
      data,
      disposition,
      isSandboxAttachment: isEditableOrVector,
    };
  }

  return {
    saveUploadedFile,
    canUserAccessFile,
    createSignedDownloadLink,
    resolveDownloadToken,
  };
}
