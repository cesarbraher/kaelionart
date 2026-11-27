const STATUS_LABELS = {
  brief_saved: 'Brief guardado',
  awaiting_payment: 'Pendiente de pago',
  paid: 'Pagado · En taller',
  proposals_ready: '3 propuestas listas',
  proposal_selected: 'Propuesta elegida',
  revision_requested: 'Ajuste solicitado',
  revision_ready: 'Ajuste listo',
  approved: 'Aprobado',
  delivered: 'Entregado',
  refunded: 'Reembolsado',
  cancelled: 'Cancelado',
};

const FINAL_SLOTS = [
  { purpose: 'final_ai', label: 'Editable Adobe Illustrator (.ai)', accept: '.ai' },
  { purpose: 'final_svg', label: 'Vector SVG (.svg)', accept: '.svg,image/svg+xml' },
  { purpose: 'final_pdf', label: 'PDF vectorial (.pdf)', accept: '.pdf,application/pdf' },
  { purpose: 'final_png', label: 'PNG alta resolución (.png)', accept: '.png,image/png' },
  { purpose: 'final_jpg', label: 'JPG alta resolución (.jpg)', accept: '.jpg,.jpeg,image/jpeg' },
];

const state = {
  user: null,
  csrfToken: '',
  timezone: 'America/Mexico_City',
  orders: [],
  selectedOrderId: null,
  selectedDetail: null,
  activeTab: 'orders',
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

function showFlash(message, kind = 'info') {
  const box = document.getElementById('admin-flash');
  box.textContent = message;
  box.className = `alert alert--${kind}`;
}

function clearFlash() {
  const box = document.getElementById('admin-flash');
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
    if (isFormData) payload = body;
    else {
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
    throw new Error(data.message || `Error HTTP ${res.status}`);
  }
  return data;
}

function renderHeader() {
  const bar = document.getElementById('admin-header-bar');
  if (!state.user) {
    bar.innerHTML = `
      <a class="btn btn--outline btn--sm" href="../portal/">Portal Clientes</a>
      <a class="btn btn--outline btn--sm" href="../">Sitio público</a>
    `;
    return;
  }
  bar.innerHTML = `
    <span style="font-size:0.88rem;color:var(--ash-muted);">${esc(state.user.fullName)} (Taller)</span>
    <a class="btn btn--outline btn--sm" href="../portal/">Vista Cliente</a>
    <button type="button" id="btn-admin-logout" class="btn btn--outline btn--sm">Cerrar sesión</button>
  `;
  document.getElementById('btn-admin-logout').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } finally {
      state.user = null;
      state.csrfToken = '';
      renderApp();
      showFlash('Sesión administrativa cerrada.', 'info');
    }
  });
}

function renderOrdersList() {
  const list = document.getElementById('admin-orders-list');
  if (state.orders.length === 0) {
    list.innerHTML = '<p style="color:var(--ash-muted);margin:0;font-size:0.9rem;">No hay pedidos que coincidan con el filtro.</p>';
    return;
  }
  list.innerHTML = state.orders
    .map(
      (o) => `
    <button type="button" class="order-item ${o.id === state.selectedOrderId ? 'is-selected' : ''}" data-order-id="${o.id}">
      <div class="order-item__top">
        <span class="order-folio">${esc(o.folio)}</span>
        <span class="status-pill status-pill--${esc(o.status)}">${esc(STATUS_LABELS[o.status] || o.status)}</span>
      </div>
      <div class="order-brand">${esc(o.brandName || 'Sin marca')}</div>
      <div class="order-meta">${esc(o.clientName || '')} · ${esc(o.clientEmail || '')}</div>
    </button>
  `
    )
    .join('');

  list.querySelectorAll('[data-order-id]').forEach((btn) => {
    btn.addEventListener('click', () => loadOrderDetail(Number(btn.dataset.orderId)));
  });
}

async function openSignedDownload(orderId, fileId) {
  const link = await api(`/api/orders/${orderId}/files/${fileId}/download-link`, {
    method: 'POST',
    body: { inline: false },
  });
  window.location.href = link.url;
}

function renderOrderDetail() {
  const container = document.getElementById('admin-order-detail');
  const detail = state.selectedDetail;
  if (!detail) {
    container.innerHTML = '<div class="portal-card"><p style="color:var(--ash-muted);margin:0;">Selecciona un pedido para gestionarlo.</p></div>';
    return;
  }

  const { order, brief, proposals, revisions, files, client } = detail;
  const refFiles = files.filter((f) => f.purpose === 'reference');
  const draftByPos = new Map(proposals.filter((p) => p.version === 1).map((p) => [p.position, p]));
  const allThreeReady = draftByPos.has(1) && draftByPos.has(2) && draftByPos.has(3);
  const finalByPurpose = new Map(files.filter((f) => f.purpose.startsWith('final_')).map((f) => [f.purpose, f]));
  const allFiveFinalsReady = FINAL_SLOTS.every((s) => finalByPurpose.has(s.purpose));

  container.innerHTML = `
    <div class="portal-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
        <div>
          <span class="order-folio">${esc(order.folio)}</span>
          <h2 style="margin-top:0.2rem;">${esc(brief?.brandName || 'Pedido')}</h2>
          <p style="margin:0.2rem 0 0;color:var(--ash-muted);font-size:0.9rem;">
            Cliente: ${esc(client?.fullName || '—')} (${esc(client?.email || '—')}) · Pagado: ${fmtDate(order.paidAt)}
          </p>
        </div>
        <span class="status-pill status-pill--${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
      </div>
    </div>

    <div class="portal-card">
      <h3>Brief del cliente</h3>
      <dl class="kv-grid" style="margin-top:0.75rem;">
        <div class="kv-item"><dt>Contacto</dt><dd>${esc(brief?.contactName)} · ${esc(brief?.contactPhone)} · ${esc(brief?.contactEmail)}</dd></div>
        <div class="kv-item"><dt>Lema</dt><dd>${esc(brief?.slogan || '—')}</dd></div>
        <div class="kv-item"><dt>Personalidad</dt><dd>${esc(brief?.personality)}</dd></div>
        <div class="kv-item"><dt>Usos principales</dt><dd>${esc(brief?.usageChannels)}</dd></div>
        <div class="kv-item"><dt>Actividad</dt><dd>${esc(brief?.activity)}</dd></div>
        <div class="kv-item"><dt>Público objetivo</dt><dd>${esc(brief?.targetAudience)}</dd></div>
        <div class="kv-item"><dt>Diferenciador</dt><dd>${esc(brief?.differentiator)}</dd></div>
        <div class="kv-item"><dt>Preferencias color / estilo</dt><dd>${esc(brief?.colorPreferences || '—')} / ${esc(brief?.stylePreferences || '—')}</dd></div>
        <div class="kv-item"><dt>Evitar</dt><dd>${esc(brief?.avoidElements || '—')}</dd></div>
        <div class="kv-item"><dt>Notas</dt><dd>${esc(brief?.notes || '—')}</dd></div>
      </dl>
      ${
        brief?.referenceLinks?.length
          ? `<div style="margin-top:0.75rem;"><strong style="font-size:0.85rem;">Enlaces de referencia:</strong><ul>${brief.referenceLinks
              .map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer" style="color:var(--carmine);text-decoration:underline;">${esc(u)}</a></li>`)
              .join('')}</ul></div>`
          : ''
      }
      ${
        refFiles.length
          ? `<div class="file-list" style="margin-top:0.75rem;">${refFiles
              .map(
                (f) => `<div class="file-row"><span>${esc(f.originalName)}</span><button type="button" class="btn btn--outline btn--sm" data-admin-dl="${f.id}">Descargar referencia</button></div>`
              )
              .join('')}</div>`
          : ''
      }
    </div>

    <div class="portal-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
        <div>
          <h3>Propuestas iniciales (3 obligatorias para publicar)</h3>
          <p style="margin:0.2rem 0 0;color:var(--ash-muted);font-size:0.88rem;">Carga las posiciones 1, 2 y 3 (PNG, JPG o PDF) y publícalas juntas al cliente.</p>
        </div>
        ${
          order.status === 'paid'
            ? `<button type="button" id="btn-publish-proposals" class="btn btn--primary" ${allThreeReady ? '' : 'disabled'}>Publicar las 3 propuestas juntas</button>`
            : ''
        }
      </div>

      <div class="proposals-grid">
        ${[1, 2, 3]
          .map((pos) => {
            const p = draftByPos.get(pos);
            return `
            <div class="proposal-card ${p && order.selectedProposalId === p.id ? 'is-chosen' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span class="promo-badge">Posición ${pos}</span>
                ${p ? `<span class="status-pill ${p.isPublished ? 'status-pill--approved' : ''}">${p.isPublished ? 'Publicada' : 'Cargada'}</span>` : '<span class="status-pill">Pendiente</span>'}
              </div>
              ${p ? `<strong>${esc(p.title)}</strong><p style="margin:0;font-size:0.85rem;color:var(--ash-muted);">${esc(p.concept)}</p>` : ''}
              ${
                order.status === 'paid'
                  ? `<form class="form-grid" data-proposal-form="${pos}">
                      <div class="field">
                        <label>Título</label>
                        <input name="title" type="text" value="${esc(p?.title || `Propuesta ${pos}`)}" required />
                      </div>
                      <div class="field">
                        <label>Concepto</label>
                        <textarea name="concept" required>${esc(p?.concept || '')}</textarea>
                      </div>
                      <div class="field">
                        <label>Archivo (PNG, JPG o PDF)</label>
                        <input name="file" type="file" accept=".png,.jpg,.jpeg,.pdf" required />
                      </div>
                      <button type="submit" class="btn btn--outline btn--sm">Guardar posición ${pos}</button>
                    </form>`
                  : p
                  ? `<button type="button" class="btn btn--outline btn--sm" data-admin-dl="${p.fileId}">Descargar archivo</button>`
                  : ''
              }
            </div>`;
          })
          .join('')}
      </div>
    </div>

    <div class="portal-card">
      <h3>Rondas de ajustes (${order.revisionRoundsUsed} de ${order.maxRevisionRounds})</h3>
      ${
        revisions.length === 0
          ? '<p style="color:var(--ash-muted);font-size:0.9rem;margin:0.5rem 0 0;">Sin solicitudes de ajuste registradas.</p>'
          : `<div class="file-list">
              ${revisions
                .map(
                  (r) => `
                <div class="proposal-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong>Ronda ${r.roundNumber}</strong>
                    <span class="status-pill ${r.status === 'addressed' ? 'status-pill--approved' : 'status-pill--revision_requested'}">${r.status === 'addressed' ? 'Entregada' : 'Pendiente del taller'}</span>
                  </div>
                  <p style="margin:0;font-size:0.9rem;"><strong>Comentarios del cliente:</strong> ${esc(r.comments)}</p>
                  ${
                    r.status === 'open' && order.status === 'revision_requested'
                      ? `<form class="form-grid" data-revision-deliver-form="${r.roundNumber}">
                          <div class="field">
                            <label>Notas del taller</label>
                            <textarea name="responseNotes" placeholder="Resumen de los ajustes aplicados..."></textarea>
                          </div>
                          <div class="field">
                            <label>Archivo actualizado (PNG, JPG o PDF)</label>
                            <input name="file" type="file" accept=".png,.jpg,.jpeg,.pdf" required />
                          </div>
                          <button type="submit" class="btn btn--primary btn--sm">Entregar ronda ${r.roundNumber}</button>
                        </form>`
                      : `<p style="margin:0;font-size:0.86rem;color:var(--ash-muted);">Respuesta: ${esc(r.responseNotes || '—')}</p>
                         ${r.revisedFileId ? `<button type="button" class="btn btn--outline btn--sm" data-admin-dl="${r.revisedFileId}">Descargar versión enviada</button>` : ''}`
                  }
                </div>`
                )
                .join('')}
            </div>`
      }
    </div>

    <div class="portal-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
        <div>
          <h3>Paquete final de entrega (AI, SVG, PDF, PNG, JPG)</h3>
          <p style="margin:0.2rem 0 0;color:var(--ash-muted);font-size:0.88rem;">
            ${
              order.status === 'approved'
                ? `Aprobado por el cliente el ${fmtDate(order.approvedAt)} (v${order.approvedVersion}). Sube los 5 formatos y confirma la entrega.`
                : order.status === 'delivered'
                ? `Entregado el ${fmtDate(order.deliveredAt)}.`
                : 'Se habilita únicamente después de que el cliente apruebe su propuesta.'
            }
          </p>
        </div>
        ${
          order.status === 'approved'
            ? `<button type="button" id="btn-confirm-delivery" class="btn btn--primary" ${allFiveFinalsReady ? '' : 'disabled'}>Confirmar entrega final</button>`
            : ''
        }
      </div>

      ${
        ['approved', 'delivered'].includes(order.status)
          ? `<div class="file-list" style="margin-top:0.85rem;">
              ${FINAL_SLOTS.map((slot) => {
                const existing = finalByPurpose.get(slot.purpose);
                return `
                <div class="file-row">
                  <div>
                    <strong>${slot.label}</strong>
                    <div style="font-size:0.8rem;color:var(--ash-muted);">${existing ? `Cargado: ${esc(existing.originalName)}` : 'Pendiente'}</div>
                  </div>
                  <div class="inline-actions">
                    ${existing ? `<button type="button" class="btn btn--outline btn--sm" data-admin-dl="${existing.id}">Descargar</button>` : ''}
                    <form class="inline-actions" data-final-upload-form="${slot.purpose}">
                      <input name="file" type="file" accept="${slot.accept}" required />
                      <button type="submit" class="btn btn--outline btn--sm">${existing ? 'Reemplazar' : 'Subir'}</button>
                    </form>
                  </div>
                </div>`;
              }).join('')}
            </div>`
          : ''
      }
    </div>
  `;

  container.querySelectorAll('[data-admin-dl]').forEach((btn) => {
    btn.addEventListener('click', () => openSignedDownload(order.id, Number(btn.dataset.adminDl)).catch((e) => showFlash(e.message, 'error')));
  });

  container.querySelectorAll('[data-proposal-form]').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearFlash();
      const fd = new FormData(form);
      fd.append('position', form.dataset.proposalForm);
      try {
        await api(`/api/admin/orders/${order.id}/proposals`, { method: 'POST', body: fd, isFormData: true });
        await loadOrderDetail(order.id);
        showFlash(`Propuesta ${form.dataset.proposalForm} guardada.`, 'success');
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  });

  document.getElementById('btn-publish-proposals')?.addEventListener('click', async () => {
    clearFlash();
    try {
      await api(`/api/admin/orders/${order.id}/proposals/publish`, { method: 'POST', body: {} });
      await refreshOrders();
      await loadOrderDetail(order.id);
      showFlash('Las 3 propuestas fueron publicadas y se encoló el correo al cliente.', 'success');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  container.querySelectorAll('[data-revision-deliver-form]').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearFlash();
      const round = form.dataset.revisionDeliverForm;
      const fd = new FormData(form);
      try {
        await api(`/api/admin/orders/${order.id}/revisions/${round}/deliver`, { method: 'POST', body: fd, isFormData: true });
        await refreshOrders();
        await loadOrderDetail(order.id);
        showFlash(`Ronda ${round} entregada al cliente.`, 'success');
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  });

  container.querySelectorAll('[data-final-upload-form]').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearFlash();
      const fd = new FormData(form);
      fd.append('purpose', form.dataset.finalUploadForm);
      try {
        await api(`/api/admin/orders/${order.id}/final-files`, { method: 'POST', body: fd, isFormData: true });
        await loadOrderDetail(order.id);
        showFlash(`Archivo ${form.dataset.finalUploadForm} cargado.`, 'success');
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  });

  document.getElementById('btn-confirm-delivery')?.addEventListener('click', async () => {
    clearFlash();
    try {
      await api(`/api/admin/orders/${order.id}/deliver`, { method: 'POST', body: {} });
      await refreshOrders();
      await loadOrderDetail(order.id);
      showFlash('Entrega final confirmada. El cliente ya puede descargar los 5 formatos.', 'success');
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });
}

async function loadOrderDetail(orderId) {
  state.selectedOrderId = orderId;
  state.selectedDetail = await api(`/api/admin/orders/${orderId}`);
  renderOrdersList();
  renderOrderDetail();
}

async function refreshOrders() {
  const status = document.getElementById('filter-status').value;
  const q = document.getElementById('filter-search').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  const { orders } = await api(`/api/admin/orders?${params.toString()}`);
  state.orders = orders;
  renderOrdersList();
}

async function refreshOutbox() {
  const { items } = await api('/api/admin/outbox');
  const tbody = document.getElementById('outbox-tbody');
  tbody.innerHTML = items
    .map(
      (i) => `
    <tr>
      <td>#${i.id}</td>
      <td>${esc(i.recipientEmail)}</td>
      <td><strong>${esc(i.templateName)}</strong><div style="font-size:0.8rem;color:var(--ash-muted);">${esc(i.subject)}</div></td>
      <td><span class="status-pill ${i.status === 'sent' ? 'status-pill--approved' : 'status-pill--awaiting_payment'}">${esc(i.status)}</span>${i.lastError ? `<div style="font-size:0.75rem;color:#ffb4bc;">${esc(i.lastError)}</div>` : ''}</td>
      <td>${i.attempts}/${i.maxAttempts}</td>
      <td>${fmtDate(i.sentAt || i.createdAt)}</td>
      <td>${i.status !== 'sent' ? `<button type="button" class="btn btn--outline btn--sm" data-retry-outbox="${i.id}">Reintentar</button>` : '—'}</td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-retry-outbox]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/outbox/${btn.dataset.retryOutbox}/retry`, { method: 'POST', body: {} });
        await refreshOutbox();
        showFlash('Reintento ejecutado.', 'info');
      } catch (err) {
        showFlash(err.message, 'error');
      }
    });
  });
}

async function refreshAudit() {
  const { logs } = await api('/api/admin/audit');
  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = logs
    .map(
      (l) => `
    <tr>
      <td>${fmtDate(l.createdAt)}</td>
      <td>${esc(l.actorRole)}${l.actorUserId ? ` (#${l.actorUserId})` : ''}</td>
      <td><code>${esc(l.action)}</code></td>
      <td>${l.orderId ? `#${l.orderId}` : '—'}</td>
      <td>${esc(l.outcome)}</td>
      <td><code style="font-size:0.76rem;">${esc(JSON.stringify(l.metadataJson || {}))}</code></td>
    </tr>`
    )
    .join('');
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('[data-admin-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.adminTab === tab));
  document.getElementById('tab-orders').classList.toggle('is-hidden', tab !== 'orders');
  document.getElementById('tab-outbox').classList.toggle('is-hidden', tab !== 'outbox');
  document.getElementById('tab-audit').classList.toggle('is-hidden', tab !== 'audit');
  if (tab === 'outbox') refreshOutbox().catch((e) => showFlash(e.message, 'error'));
  if (tab === 'audit') refreshAudit().catch((e) => showFlash(e.message, 'error'));
}

function renderApp() {
  renderHeader();
  const isAdmin = state.user && state.user.role === 'admin';
  document.getElementById('admin-auth-section').classList.toggle('is-hidden', isAdmin);
  document.getElementById('admin-workspace').classList.toggle('is-hidden', !isAdmin);
}

async function init() {
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.adminTab));
  });

  document.getElementById('admin-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFlash();
    const body = Object.fromEntries(new FormData(ev.currentTarget).entries());
    try {
      const res = await api('/api/auth/admin/login', { method: 'POST', body });
      state.user = res.user;
      state.csrfToken = res.csrfToken;
      renderApp();
      await refreshOrders();
    } catch (err) {
      showFlash(err.message, 'error');
    }
  });

  document.getElementById('filter-status').addEventListener('change', () => refreshOrders());
  document.getElementById('btn-refresh-orders').addEventListener('click', () => refreshOrders());
  document.getElementById('btn-refresh-outbox').addEventListener('click', () => refreshOutbox());
  document.getElementById('btn-refresh-audit').addEventListener('click', () => refreshAudit());

  try {
    const me = await api('/api/auth/me');
    if (me.authenticated && me.user?.role === 'admin') {
      state.user = me.user;
      state.csrfToken = me.csrfToken;
      state.timezone = me.timezoneDisplay || 'America/Mexico_City';
      renderApp();
      await refreshOrders();
      return;
    }
  } catch {
    // no autenticado
  }
  renderApp();
}

init();
