import { createHmac } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

export function serializeCookie(name, value, { httpOnly = true, secure = false, sameSite = 'Lax', path = '/', maxAgeSeconds } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAgeSeconds === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  return parts.join('; ');
}

export function applySecurityHeaders(res, { isPrivate = true, isHttps = false, isSandboxAttachment = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (isPrivate) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }
  if (isSandboxAttachment) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}

export function sendJson(res, status, payload, { isHttps = false, extraHeaders = {} } = {}) {
  applySecurityHeaders(res, { isPrivate: true, isHttps });
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...extraHeaders,
  });
  res.end(body);
}

export async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new HttpError(413, 'payload_too_large', 'El cuerpo de la solicitud excede el tamaño permitido.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req, maxBytes = 256 * 1024) {
  const raw = await readRawBody(req, maxBytes);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected JSON object');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'invalid_json', 'El cuerpo JSON no es válido.');
  }
}

export async function readMultipartForm(req, maxBytes) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!match) {
    throw new HttpError(400, 'invalid_content_type', 'Se esperaba multipart/form-data.');
  }
  const boundary = match[1] || match[2];
  const raw = await readRawBody(req, maxBytes + 256 * 1024);

  const boundaryBuf = Buffer.from(`--${boundary}`, 'latin1');
  const fields = {};
  const files = [];

  let offset = raw.indexOf(boundaryBuf);
  while (offset !== -1) {
    offset += boundaryBuf.length;
    if (raw.slice(offset, offset + 2).toString('latin1') === '--') break;
    if (raw.slice(offset, offset + 2).toString('latin1') === '\r\n') offset += 2;

    const nextBoundary = raw.indexOf(boundaryBuf, offset);
    if (nextBoundary === -1) break;

    let partEnd = nextBoundary;
    if (raw[partEnd - 2] === 13 && raw[partEnd - 1] === 10) partEnd -= 2;

    const part = raw.subarray(offset, partEnd);
    const headerSep = part.indexOf(Buffer.from('\r\n\r\n', 'latin1'));
    if (headerSep !== -1) {
      const headerStr = part.subarray(0, headerSep).toString('utf8');
      const body = part.subarray(headerSep + 4);
      const dispLine = headerStr.split('\r\n').find((l) => /^content-disposition:/i.test(l)) || '';
      const typeLine = headerStr.split('\r\n').find((l) => /^content-type:/i.test(l)) || '';
      const nameMatch = dispLine.match(/name="([^"]+)"/i);
      const fileMatch = dispLine.match(/filename="([^"]*)"/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (fileMatch) {
          const mimeType = typeLine.replace(/^content-type:\s*/i, '').trim() || 'application/octet-stream';
          files.push({
            fieldName,
            originalName: fileMatch[1] || 'archivo',
            mimeType,
            buffer: Buffer.from(body),
          });
        } else {
          fields[fieldName] = body.toString('utf8');
        }
      }
    }

    offset = nextBoundary;
  }

  return { fields, files };
}

export function createRateLimiter() {
  const buckets = new Map();

  return {
    consume(key, { max = 10, windowMs = 15 * 60 * 1000 } = {}) {
      const now = Date.now();
      let entry = buckets.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        buckets.set(key, entry);
      }
      entry.count += 1;
      if (buckets.size > 10000) {
        for (const [k, v] of buckets) {
          if (v.resetAt <= now) buckets.delete(k);
        }
      }
      if (entry.count > max) {
        const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        const err = new HttpError(
          429,
          'rate_limited',
          `Demasiados intentos. Intenta de nuevo en ${retryAfterSec} segundos.`,
          { retryAfterSec }
        );
        err.retryAfterSec = retryAfterSec;
        throw err;
      }
    },
    reset() {
      buckets.clear();
    },
  };
}

export function signHmacHex(data, secret) {
  return createHmac('sha256', secret).update(data).digest('hex');
}
