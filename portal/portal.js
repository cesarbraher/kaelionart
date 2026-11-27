const STATUS_LABELS = {
  brief_saved: 'Brief guardado',
  awaiting_payment: 'Pendiente de pago',
  paid: 'Pagado · En taller',
  proposals_ready: '3 propuestas listas',
  proposal_selected: 'Propuesta elegida',
  revision_requested: 'Ajuste solicitado',
  revision_ready: 'Ajuste listo',
  approved: 'Aprobado · Preparando entrega',
  delivered: 'Entregado',
  refunded: 'Reembolsado',
  cancelled: 'Cancelado',
};

const FINAL_LABELS = {
  final_ai: 'Adobe Illustrator (.ai)',
  final_svg: 'Vector web (.svg)',
  final_pdf: 'PDF vectorial (.pdf)',
  final_png: 'Imagen transparente (.png)',
  final_jpg: 'Alta resolución (.jpg)',
};

const state = {
  user: null,
  csrfToken: '',
  timezone: 'America/Mexico_City',
  orders: [],
  selectedOrderId: null,
  selectedDetail: null,
  creatingNew: false,
  pollTimer: null,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: state.timezone || 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showFlash(message, kind = 'info') {
  const box = document.getElementById('global-flash');
  box.textContent = message;
  box.className = `alert alert--${kind}`;
}

function clearFlash() {
  const box = document.getElementById('global-flash');
  box.className = 'alert is-hidden';
  box.textContent = '';
}

async function api(path, { method = 'GET', body = null, isFormData = false } = {}) {
  const headers = {};
  if (state.csrfToken && method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  let payload;
  if (body !== null) {
    if (isFormData) {
      payload = body;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Error HTTP ${res.status}`);
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.authTab === tab);
  });
  document.getElementById('login-form').classList.toggle('is-hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('is-hidden', tab !== 'register');
  document.getElementById('reset-request-form').classList.toggle('is-hidden', tab !== 'reset');
  document.getElementById('reset-confirm-form').classList.toggle('is-hidden', tab !== 'reset-confirm');
}

function renderHeader() {
  const bar = document.getElementById('header-user-bar');
  if (!state.user) {
    bar.innerHTML = `
      <a class="btn btn--outline btn--sm" href="../privacidad.html">Privacidad</a>
      <a class="btn btn--outline btn--sm" href="../">Sitio público</a>
    `;
    return;
  }
  bar.innerHTML = `
    <span style="font-size:0.88rem;color:var(--ash-muted);">${esc(state.user.fullName)}</span>
    ${state.user.role === 'admin' ? '<a class="btn btn--outline btn--sm" href="../admin/">Panel Taller</a>' : ''}
    <a class="btn btn--outline btn--sm" href="../privacidad.html">Privacidad</a>
    <button type="button" id="btn-logout" class="btn btn--outline btn--sm">Cerrar sesión</button>
  `;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } finally {
      state.user = null;
      state.csrfToken = '';
      state.orders = [];
      state.selectedOrderId = null;
      state.selectedDetail = null;
      stopPaymentPoll();
      renderApp();
      showFlash('Sesión cerrada correctamente.', 'info');
    }
  });
}

function renderOrdersList() {
  const container = document.getElementById('orders-list');
  if (state.orders.length === 0) {
    container.innerHTML = '<p style="color:var(--ash-muted);font-size:0.9rem;margin:0;">Aún no tienes pedidos. Crea tu primer brief para iniciar.</p>';
    return;
  }
  container.innerHTML = state.orders
    .map(
      (o) => `
    <button type="button" class="order-item ${!state.creatingNew && o.id === state.selectedOrderId ? 'is-selected' : ''}" data-order-id="${o.id}">
      <div class="order-item__top">
        <span class="order-folio">${esc(o.folio)}</span>
        <span class="status-pill status-pill--${esc(o.status)}">${esc(STATUS_LABELS[o.status] || o.status)}</span>
      </div>
      <div class="order-brand">${esc(o.brandName || 'Sin nombre de marca')}</div>
      <div class="order-meta">${fmtDate(o.createdAt)} · $${(o.amountTotalCents / 100).toFixed(0)} MXN</div>
    </button>
  `
    )
    .join('');

  container.querySelectorAll('[data-order-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.creatingNew = false;
      selectOrder(Number(btn.dataset.orderId));
    });
  });
}

function buildTimelineHtml(status) {
  const steps = [
    { key: 'brief', label: '1. Brief' },
    { key: 'paid', label: '2. Pago' },
    { key: 'proposals', label: '3. Propuestas' },
    { key: 'revisions', label: '4. Ajustes' },
    { key: 'approved', label: '5. Aprobación' },
    { key: 'delivered', label: '6. Entrega' },
  ];
  const orderIdxMap = {
    brief_saved: 0,
    awaiting_payment: 1,
    paid: 2,
    proposals_ready: 2,
    proposal_selected: 3,
    revision_requested: 3,
    revision_ready: 3,
    approved: 4,
    delivered: 5,
  };
  const currentIdx = orderIdxMap[status] ?? 0;

  return `<div class="timeline" aria-label="Progreso del pedido">
    ${steps
      .map((s, idx) => {
        const cls = idx < currentIdx || status === 'delivered' ? 'is-done' : idx === currentIdx ? 'is-current' : '';
        return `<div class="timeline-step ${cls}">${s.label}</div>`;
      })
      .join('')}
  </div>`;
}

function renderBriefForm({ brief = null, order = null, editable = true }) {
  const b = brief || {};
  const linksText = Array.isArray(b.referenceLinks) ? b.referenceLinks.join('\n') : '';
  const disabled = editable ? '' : 'disabled';
  return `
    <form id="brief-form" class="form-grid" novalidate>
      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="bf-brand">Nombre de la marca *</label>
          <input id="bf-brand" name="brandName" type="text" value="${esc(b.brandName || '')}" required ${disabled} />
        </div>
        <div class="field">
          <label for="bf-slogan">Lema o eslogan (opcional)</label>
          <input id="bf-slogan" name="slogan" type="text" value="${esc(b.slogan || '')}" ${disabled} />
        </div>
      </div>

      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="bf-contact-name">Nombre de contacto *</label>
          <input id="bf-contact-name" name="contactName" type="text" value="${esc(b.contactName || state.user?.fullName || '')}" required ${disabled} />
        </div>
        <div class="field">
          <label for="bf-contact-phone">Teléfono / WhatsApp *</label>
          <input id="bf-contact-phone" name="contactPhone" type="tel" value="${esc(b.contactPhone || '')}" required ${disabled} />
        </div>
      </div>

      <div class="field">
        <label for="bf-contact-email">Correo de contacto *</label>
        <input id="bf-contact-email" name="contactEmail" type="email" value="${esc(b.contactEmail || state.user?.email || '')}" required ${disabled} />
      </div>

      <div class="field">
        <label for="bf-activity">Actividad o giro del negocio *</label>
        <textarea id="bf-activity" name="activity" required ${disabled}>${esc(b.activity || '')}</textarea>
      </div>

      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="bf-audience">Público objetivo *</label>
          <textarea id="bf-audience" name="targetAudience" required ${disabled}>${esc(b.targetAudience || '')}</textarea>
        </div>
        <div class="field">
          <label for="bf-diff">Diferenciador principal *</label>
          <textarea id="bf-diff" name="differentiator" required ${disabled}>${esc(b.differentiator || '')}</textarea>
        </div>
      </div>

      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="bf-personality">Personalidad de marca *</label>
          <input id="bf-personality" name="personality" type="text" placeholder="Ej. Sobria, artesanal, contemporánea" value="${esc(b.personality || '')}" required ${disabled} />
        </div>
        <div class="field">
          <label for="bf-usage">Usos principales *</label>
          <input id="bf-usage" name="usageChannels" type="text" placeholder="Ej. Redes sociales, papelería, letrero, web" value="${esc(b.usageChannels || '')}" required ${disabled} />
        </div>
      </div>

      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="bf-colors">Preferencias de color</label>
          <input id="bf-colors" name="colorPreferences" type="text" value="${esc(b.colorPreferences || '')}" ${disabled} />
        </div>
        <div class="field">
          <label for="bf-style">Estilo visual preferido</label>
          <input id="bf-style" name="stylePreferences" type="text" value="${esc(b.stylePreferences || '')}" ${disabled} />
        </div>
      </div>

      <div class="field">
        <label for="bf-avoid">Elementos o colores a evitar</label>
        <input id="bf-avoid" name="avoidElements" type="text" value="${esc(b.avoidElements || '')}" ${disabled} />
      </div>

      <div class="field">
        <label for="bf-links">Enlaces de referencia (uno por línea, https://...)</label>
        <textarea id="bf-links" name="referenceLinks" placeholder="https://ejemplo.com/referencia">${esc(linksText)}</textarea>
      </div>

      <div class="field">
        <label for="bf-notes">Notas adicionales</label>
        <textarea id="bf-notes" name="notes" ${disabled}>${esc(b.notes || '')}</textarea>
      </div>

      ${editable ? `<div class="inline-actions"><button type="submit" class="btn btn--primary">${order ? 'Actualizar brief' : 'Guardar brief y generar folio'}</button></div>` : ''}
    </form>
  `;
}

function renderNewOrderView() {
  const ws = document.getElementById('order-workspace');
  ws.innerHTML = `
    <div class="portal-card">
      <span class="promo-badge">Diseño inteligente de logotipos · $250 MXN</span>
      <h2 style="margin-top:0.5rem;">Nuevo encargo de logotipo</h2>
      <p style="color:var(--ash-muted);margin-top:0.25rem;">Guarda primero tu brief creativo para generar tu folio. Después podrás adjuntar imágenes de referencia y continuar al pago seguro con Stripe.</p>
      ${renderBriefForm({ editable: true })}
    </div>
  `;

  document.getElementById('brief-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const formData = Object.fromEntries(new FormData(ev.currentTarget).entries());
    try {
      const created = await api('/api/orders', { method: 'POST', body: formData });
      state.creatingNew = false;
      await refreshOrders(created.order.id);
      showFlash(`Brief guardado con folio ${created.order.folio}. Ya puedes adjuntar referencias y realizar tu pago de $250 MXN.`, 'success');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });
}

async function openSignedFile(orderId, fileId, inline = false) {
  const link = await api(`/api/orders/${orderId}/files/${fileId}/download-link`, {
    method: 'POST',
    body: { inline },
  });
  return link.url;
}

async function hydratePreviews(orderId) {
  const slots = document.querySelectorAll('[data-preview-file-id]');
  for (const el of slots) {
    const fileId = Number(el.dataset.previewFileId);
    const ext = el.dataset.previewExt;
    if (ext === 'png' || ext === 'jpg') {
      try {
        const url = await openSignedFile(orderId, fileId, true);
        el.innerHTML = `<img src="${esc(url)}" alt="Vista previa privada" />`;
      } catch {
        el.textContent = 'Vista previa no disponible';
      }
    } else {
      el.textContent = `Documento .${(ext || '').toUpperCase()} (descarga segura)`;
    }
  }
}

function stopPaymentPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function checkPaymentStatus(orderId, { autoPoll = false } = {}) {
  try {
    const st = await api(`/api/orders/${orderId}/payment-status`);
    const banner = document.getElementById('payment-status-banner');
    if (st.paymentState === 'pago_confirmado') {
      stopPaymentPoll();
      await selectOrder(orderId);
      showFlash(`Pago confirmado para el folio ${st.folio}. El taller ya recibió tu encargo.`, 'success');
      return;
    }
    if (banner) {
      banner.classList.remove('is-hidden');
      if (st.paymentState === 'esperando_confirmacion_webhook') {
        banner.className = 'alert alert--info';
        banner.textContent = 'Recibimos tu retorno desde Stripe. Esperando confirmación oficial del webhook para activar tu pedido…';
      } else if (st.paymentState === 'pago_diferido_pendiente') {
        banner.className = 'alert alert--info';
        banner.textContent = 'Tu pago diferido está pendiente de acreditación. Activaremos el taller automáticamente cuando Stripe confirme el cobro.';
      } else if (st.paymentState === 'pago_fallido' || st.paymentState === 'sesion_expirada') {
        banner.className = 'alert alert--error';
        banner.textContent = 'El intento anterior expiró o no se acreditó. Puedes iniciar un nuevo pago en el mismo folio.';
        stopPaymentPoll();
      }
    }
    if (autoPoll && !state.pollTimer) {
      let ticks = 0;
      state.pollTimer = setInterval(async () => {
        ticks += 1;
        if (ticks > 15) {
          stopPaymentPoll();
          return;
        }
        await checkPaymentStatus(orderId, { autoPoll: false });
      }, 3000);
    }
  } catch {
    // silencioso
  }
}

function renderOrderDetailView() {
  const detail = state.selectedDetail;
  const ws = document.getElementById('order-workspace');
  if (!detail) {
    renderNewOrderView();
    return;
  }

  const { order, brief, proposals, revisions, files } = detail;
  const refFiles = files.filter((f) => f.purpose === 'reference');
  const finalFiles = files.filter((f) => f.purpose.startsWith('final_'));
  const fileMap = new Map(files.map((f) => [f.id, f]));
  const canPay = ['brief_saved', 'awaiting_payment'].includes(order.status);
  const canEditBrief = ['brief_saved', 'awaiting_payment'].includes(order.status);
  const canUploadRef = ['brief_saved', 'awaiting_payment', 'paid'].includes(order.status);
  const canRequestRev =
    ['proposal_selected', 'revision_ready'].includes(order.status) &&
    order.revisionRoundsUsed < order.maxRevisionRounds;
  const canApprove = ['proposal_selected', 'revision_ready'].includes(order.status);

  ws.innerHTML = `
    <div class="portal-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
        <div>
          <span class="order-folio">${esc(order.folio)}</span>
          <h2 style="margin-top:0.2rem;">${esc(brief?.brandName || order.productName)}</h2>
          <p style="margin:0.2rem 0 0;color:var(--ash-muted);font-size:0.9rem;">
            ${esc(order.productName)} · $${(order.amountTotalCents / 100).toFixed(2)} ${esc(order.currency.toUpperCase())} · Creado ${fmtDate(order.createdAt)}
          </p>
        </div>
        <span class="status-pill status-pill--${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
      </div>

      ${buildTimelineHtml(order.status)}

      <div id="payment-status-banner" class="alert is-hidden"></div>

      ${
        canPay
          ? `<div class="portal-card portal-card--promo" style="margin-top:1rem;">
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem;">
                <div>
                  <h3 style="font-size:1.15rem;">Activa tu encargo con pago único</h3>
                  <p style="margin:0.25rem 0 0;color:var(--ash);font-size:0.9rem;">Total: <strong>$250.00 MXN</strong> vía Stripe Checkout. El trabajo comienza al confirmarse el pago.</p>
                </div>
                <div class="inline-actions">
                  <button type="button" id="btn-start-checkout" class="btn btn--primary">Pagar $250 MXN con Stripe</button>
                  <button type="button" id="btn-check-payment" class="btn btn--outline btn--sm">Comprobar pago</button>
                </div>
              </div>
            </div>`
          : ''
      }
    </div>

    ${
      proposals.length > 0
        ? `<div class="portal-card">
            <h3>Tus 3 propuestas originales</h3>
            <p style="color:var(--ash-muted);font-size:0.9rem;margin-top:0.25rem;">
              ${
                order.status === 'proposals_ready'
                  ? 'Elige tu propuesta favorita para continuar con ajustes (hasta 3 rondas) o aprobarla directamente.'
                  : 'Propuesta elegida resaltada en verde.'
              }
            </p>
            <div class="proposals-grid">
              ${proposals
                .map((p) => {
                  const pf = fileMap.get(p.fileId);
                  const chosen = order.selectedProposalId === p.id;
                  return `
                  <article class="proposal-card ${chosen ? 'is-chosen' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <span class="promo-badge">Propuesta ${p.position}</span>
                      ${chosen ? '<span class="status-pill status-pill--approved">Elegida</span>' : ''}
                    </div>
                    <div class="proposal-preview" data-preview-file-id="${p.fileId}" data-preview-ext="${esc(pf?.detectedExt || '')}">Cargando vista…</div>
                    <h4 style="font-size:1.05rem;">${esc(p.title)}</h4>
                    <p style="margin:0;font-size:0.88rem;color:var(--ash);">${esc(p.concept)}</p>
                    <div class="inline-actions" style="margin-top:auto;">
                      <button type="button" class="btn btn--outline btn--sm" data-download-file="${p.fileId}">Descargar</button>
                      ${
                        order.status === 'proposals_ready'
                          ? `<button type="button" class="btn btn--primary btn--sm" data-select-proposal="${p.id}">Elegir propuesta</button>`
                          : ''
                      }
                    </div>
                  </article>`;
                })
                .join('')}
            </div>
          </div>`
        : ''
    }

    ${
      ['proposal_selected', 'revision_requested', 'revision_ready', 'approved', 'delivered'].includes(order.status)
        ? `<div class="portal-card">
            <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
              <div>
                <h3>Ajustes y aprobación</h3>
                <p style="margin:0.2rem 0 0;color:var(--ash-muted);font-size:0.9rem;">
                  Rondas utilizadas: <strong>${order.revisionRoundsUsed} de ${order.maxRevisionRounds}</strong>.
                  ${order.approvedAt ? ` · Aprobado el ${fmtDate(order.approvedAt)} (v${order.approvedVersion})` : ''}
                </p>
              </div>
              ${
                canApprove
                  ? '<button type="button" id="btn-approve-order" class="btn btn--primary">Aprobar versión final</button>'
                  : ''
              }
            </div>

            ${
              revisions.length > 0
                ? `<div class="file-list" style="margin-top:1rem;">
                    ${revisions
                      .map((r) => {
                        const rf = r.revisedFileId ? fileMap.get(r.revisedFileId) : null;
                        return `
                        <div class="proposal-card">
                          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
                            <strong>Ronda ${r.roundNumber} de ${order.maxRevisionRounds}</strong>
                            <span class="status-pill ${r.status === 'addressed' ? 'status-pill--approved' : 'status-pill--revision_requested'}">${r.status === 'addressed' ? 'Atendida' : 'En revisión'}</span>
                          </div>
                          <p style="margin:0;font-size:0.9rem;"><strong>Tus comentarios:</strong> ${esc(r.comments)}</p>
                          ${r.responseNotes ? `<p style="margin:0;font-size:0.88rem;color:var(--ash-muted);"><strong>Respuesta del taller:</strong> ${esc(r.responseNotes)}</p>` : ''}
                          ${
                            rf
                              ? `<div class="proposal-preview" style="max-width:340px;" data-preview-file-id="${rf.id}" data-preview-ext="${esc(rf.detectedExt)}">Cargando versión…</div>
                                 <div><button type="button" class="btn btn--outline btn--sm" data-download-file="${rf.id}">Descargar versión ajustada</button></div>`
                              : ''
                          }
                        </div>`;
                      })
                      .join('')}
                  </div>`
                : ''
            }

            ${
              canRequestRev
                ? `<form id="revision-form" class="form-grid" style="margin-top:1rem;">
                    <div class="field">
                      <label for="rev-comments">Solicitar ronda de ajustes #${order.revisionRoundsUsed + 1} (agrupa todos tus cambios en un solo envío)</label>
                      <textarea id="rev-comments" name="comments" required placeholder="Describe con claridad los ajustes de tipografía, proporción, color o composición..."></textarea>
                    </div>
                    <div class="inline-actions">
                      <button type="submit" class="btn btn--outline">Enviar ronda ${order.revisionRoundsUsed + 1} de ${order.maxRevisionRounds}</button>
                    </div>
                  </form>`
                : ''
            }
          </div>`
        : ''
    }

    ${
      order.status === 'delivered'
        ? `<div class="portal-card">
            <h3>Paquete final entregado</h3>
            <p style="color:var(--ash-muted);font-size:0.9rem;margin-top:0.25rem;">
              Entregado el ${fmtDate(order.deliveredAt)}. Cada clic genera un enlace privado temporal válido por 2 minutos.
            </p>
            <div class="file-list">
              ${finalFiles
                .map(
                  (f) => `
                <div class="file-row">
                  <div>
                    <strong>${esc(FINAL_LABELS[f.purpose] || f.purpose)}</strong>
                    <div style="font-size:0.82rem;color:var(--ash-muted);">${esc(f.originalName)} · ${fmtBytes(f.sizeBytes)}</div>
                  </div>
                  <button type="button" class="btn btn--primary btn--sm" data-download-file="${f.id}">Descargar</button>
                </div>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }

    <div class="portal-card">
      <h3>Referencias visuales (JPEG / PNG)</h3>
      <p style="color:var(--ash-muted);font-size:0.88rem;margin-top:0.2rem;">Sube imágenes de inspiración si deseas guiar al taller (solo JPEG o PNG, máximo 10 MB por archivo).</p>
      ${
        canUploadRef
          ? `<form id="reference-upload-form" class="inline-actions" style="margin-top:0.75rem;">
              <input id="ref-file-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" required />
              <button type="submit" class="btn btn--outline btn--sm">Subir referencia</button>
            </form>`
          : ''
      }
      <div class="file-list">
        ${
          refFiles.length === 0
            ? '<p style="color:var(--ash-muted);font-size:0.88rem;margin:0;">Sin imágenes de referencia adjuntas.</p>'
            : refFiles
                .map(
                  (f) => `
              <div class="file-row">
                <div>
                  <strong>${esc(f.originalName)}</strong>
                  <div style="font-size:0.8rem;color:var(--ash-muted);">${fmtBytes(f.sizeBytes)} · ${fmtDate(f.createdAt)}</div>
                </div>
                <button type="button" class="btn btn--outline btn--sm" data-download-file="${f.id}">Descargar</button>
              </div>`
                )
                .join('')
        }
      </div>
    </div>

    <div class="portal-card">
      <h3>Brief del pedido</h3>
      ${renderBriefForm({ brief, order, editable: canEditBrief })}
    </div>
  `;

  document.getElementById('btn-start-checkout')?.addEventListener('click', async () => {
    clearFlash();
    try {
      const res = await api(`/api/orders/${order.id}/checkout`, { method: 'POST', body: {} });
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else if (res.message) {
        showFlash(res.message, 'info');
      }
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('btn-check-payment')?.addEventListener('click', () => {
    checkPaymentStatus(order.id, { autoPoll: false });
  });

  document.querySelectorAll('[data-select-proposal]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      clearFlash();
      try {
        await api(`/api/orders/${order.id}/select-proposal`, {
          method: 'POST',
          body: { proposalId: Number(btn.dataset.selectProposal) },
        });
        await selectOrder(order.id);
        showFlash('Propuesta seleccionada. Ahora puedes solicitar ajustes o aprobarla directamente.', 'success');
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  });

  document.getElementById('revision-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const comments = new FormData(ev.currentTarget).get('comments');
    try {
      await api(`/api/orders/${order.id}/revisions`, { method: 'POST', body: { comments } });
      await selectOrder(order.id);
      showFlash('Ronda de ajustes enviada al taller.', 'success');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('btn-approve-order')?.addEventListener('click', async () => {
    if (!window.confirm('¿Confirmas tu aprobación final? El taller preparará y entregará los 5 archivos definitivos (AI, SVG, PDF, PNG, JPG).')) {
      return;
    }
    clearFlash();
    try {
      await api(`/api/orders/${order.id}/approve`, { method: 'POST', body: {} });
      await selectOrder(order.id);
      showFlash('Versión aprobada. El taller preparará tu paquete final de 5 formatos.', 'success');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('reference-upload-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const input = document.getElementById('ref-file-input');
    if (!input.files || !input.files[0]) return;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      await api(`/api/orders/${order.id}/references`, { method: 'POST', body: fd, isFormData: true });
      await selectOrder(order.id);
      showFlash('Imagen de referencia subida correctamente.', 'success');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  if (canEditBrief) {
    document.getElementById('brief-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearFlash();
      const formData = Object.fromEntries(new FormData(ev.currentTarget).entries());
      try {
        await api(`/api/orders/${order.id}/brief`, { method: 'PUT', body: formData });
        await selectOrder(order.id);
        showFlash('Brief actualizado.', 'success');
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  }

  document.querySelectorAll('[data-download-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const url = await openSignedFile(order.id, Number(btn.dataset.downloadFile), false);
        window.location.href = url;
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  });

  hydratePreviews(order.id);
}

async function selectOrder(orderId) {
  stopPaymentPoll();
  state.selectedOrderId = orderId;
  state.selectedDetail = await api(`/api/orders/${orderId}`);
  renderOrdersList();
  renderOrderDetailView();
}

async function refreshOrders(selectId = null) {
  const { orders } = await api('/api/orders');
  state.orders = orders;
  renderOrdersList();
  const targetId = selectId || state.selectedOrderId || orders[0]?.id || null;
  if (targetId && orders.some((o) => o.id === targetId)) {
    await selectOrder(targetId);
  } else {
    state.creatingNew = true;
    renderNewOrderView();
  }
}

function renderApp() {
  renderHeader();
  const authSec = document.getElementById('auth-section');
  const wsSec = document.getElementById('workspace-section');
  if (!state.user) {
    authSec.classList.remove('is-hidden');
    wsSec.classList.add('is-hidden');
  } else {
    authSec.classList.add('is-hidden');
    wsSec.classList.remove('is-hidden');
  }
}

async function init() {
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearFlash();
      switchAuthTab(btn.dataset.authTab);
    });
  });

  document.getElementById('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const body = Object.fromEntries(new FormData(ev.currentTarget).entries());
    try {
      const res = await api('/api/auth/login', { method: 'POST', body });
      state.user = res.user;
      state.csrfToken = res.csrfToken;
      renderApp();
      await refreshOrders();
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const form = ev.currentTarget;
    const body = {
      fullName: form.fullName.value,
      email: form.email.value,
      password: form.password.value,
      privacyAccepted: form.privacyAccepted.checked,
    };
    try {
      const res = await api('/api/auth/register', { method: 'POST', body });
      let msg = res.message;
      if (res.devVerificationToken) {
        msg += ` (Modo desarrollo sin SMTP — token de prueba: ${res.devVerificationToken})`;
      }
      showFlash(msg, 'success');
      switchAuthTab('login');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('reset-request-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const body = Object.fromEntries(new FormData(ev.currentTarget).entries());
    try {
      const res = await api('/api/auth/request-reset', { method: 'POST', body });
      showFlash(res.message, 'info');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('reset-confirm-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const body = Object.fromEntries(new FormData(ev.currentTarget).entries());
    try {
      const res = await api('/api/auth/reset-password', { method: 'POST', body });
      showFlash(res.message, 'success');
      window.history.replaceState({}, '', window.location.pathname);
      switchAuthTab('login');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('btn-new-order').addEventListener('click', () => {
    state.creatingNew = true;
    renderOrdersList();
    renderNewOrderView();
  });

  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verify_token');
  const resetToken = params.get('reset_token');
  const checkoutParam = params.get('checkout');
  const orderParam = params.get('order') ? Number(params.get('order')) : null;

  if (verifyToken) {
    try {
      await api('/api/auth/verify-email', { method: 'POST', body: { token: verifyToken } });
      showFlash('Correo verificado correctamente. Ya puedes iniciar sesión.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } catch (err) {
      showFlash(err.message, 'error');
    }
  } else if (resetToken) {
    document.getElementById('reset-token-input').value = resetToken;
    switchAuthTab('reset-confirm');
    showFlash('Ingresa tu nueva contraseña para completar la recuperación.', 'info');
  }

  try {
    const me = await api('/api/auth/me');
    if (me.authenticated) {
      state.user = me.user;
      state.csrfToken = me.csrfToken;
      state.timezone = me.timezoneDisplay || 'America/Mexico_City';
      renderApp();
      await refreshOrders(orderParam);
      if (checkoutParam === 'return' && orderParam) {
        await checkPaymentStatus(orderParam, { autoPoll: true });
      } else if (checkoutParam === 'cancelled' && orderParam) {
        showFlash('El pago en Stripe fue cancelado. Tu brief sigue guardado y puedes reintentar cuando gustes.', 'info');
      }
      return;
    }
  } catch {
    // sin sesión
  }
  renderApp();
}

init();
