/**
 * KAELION Digital Art — Portafolio de Clientes & Galería Multimedia (Imágenes, Videos, Webs)
 * Incluye Lightbox editorial, Reproductor de Reels Audiovisuales (Canvas + Video URL)
 * y Visor Web interactivo (Escritorio / Móvil).
 */

const WA_NUMBER = '524641093886';

const FALLBACK_PORTFOLIO = {
  clients: [
    { name: 'INEVISUAL', sector: 'Agencia & Publicidad · Gto.', service: 'Dirección Creativa & Branding' },
    { name: 'Casa Basalto', sector: 'Destilería Artesanal · México', service: 'Identidad & Fotografía' },
    { name: 'Atelier Vértice', sector: 'Arquitectura Contemporánea', service: 'Sitio Web Editorial' },
    { name: 'Sonora Nexo', sector: 'Producción Musical & Audio', service: 'Audiovisual & Gráfica' },
    { name: 'Foro Ceniza', sector: 'Cultura & Exposiciones', service: 'Campaña de Carteles' },
    { name: 'Norte Clásico', sector: 'Comercio & Retail Digital', service: 'Landing Page & Marketing' }
  ],
  caseStudies: [],
  gallery: []
};

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   Motor Visual para Reels de Video (Arte cinético fiel a paleta KAELION)
   ========================================================================== */
function drawReelFrame(ctx, w, h, t, style) {
  // Fondo Obsidiana
  ctx.fillStyle = '#111012';
  ctx.fillRect(0, 0, w, h);

  // Resplandor sutil Granate
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.65);
  grad.addColorStop(0, 'rgba(104, 40, 49, 0.36)');
  grad.addColorStop(1, 'rgba(17, 16, 18, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (style === 'waveform') {
    // Onda sonora armónica (concepto música & fluidez del Manifiesto)
    const cx = w * 0.5;
    const cy = h * 0.5;
    for (let layer = 0; layer < 4; layer++) {
      ctx.beginPath();
      const amp = (18 + layer * 10) * (h / 240);
      const freq = 0.015 + layer * 0.004;
      for (let x = 0; x <= w; x += 6) {
        const env = Math.sin((x / w) * Math.PI);
        const y = cy + Math.sin(x * freq + t * (1.4 + layer * 0.35)) * amp * env;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = layer === 0 ? '#B85B64' : layer === 1 ? 'rgba(212,209,210,0.65)' : 'rgba(154,150,156,0.28)';
      ctx.lineWidth = layer === 0 ? 2 : 1.1;
      ctx.stroke();
    }
    // Línea de horizonte
    ctx.strokeStyle = 'rgba(60, 58, 64, 0.8)';
    ctx.beginPath();
    ctx.moveTo(w * 0.1, cy);
    ctx.lineTo(w * 0.9, cy);
    ctx.stroke();
    // Indicador de pulso vertical
    const scanX = w * 0.1 + ((t * 48) % (w * 0.8));
    ctx.fillStyle = '#B85B64';
    ctx.fillRect(scanX, cy - 28, 1.5, 56);
    ctx.fillStyle = 'rgba(212, 209, 210, 0.72)';
    ctx.font = `${Math.max(10, Math.round(w * 0.024))}px "Source Sans 3", sans-serif`;
    ctx.fillText('KAELION AUDIOVISUAL · SONORA', w * 0.08, h * 0.86);
    ctx.fillText(`${Math.floor(cx)}Hz`, w * 0.8, h * 0.86);
  } else if (style === 'architecture') {
    // Retícula modular animada y bloques editoriales
    const cols = 6;
    const pad = w * 0.09;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    ctx.strokeStyle = 'rgba(60, 58, 64, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, innerW, innerH);

    for (let i = 0; i < cols; i++) {
      const colW = innerW / cols;
      const x = pad + i * colW;
      const ratio = 0.28 + 0.52 * (0.5 + 0.5 * Math.sin(t * 1.1 + i * 0.75));
      const barH = innerH * ratio;
      ctx.fillStyle = i === 2 ? 'rgba(184, 91, 100, 0.78)' : i === 4 ? 'rgba(104, 40, 49, 0.75)' : 'rgba(212, 209, 210, 0.16)';
      ctx.fillRect(x + 4, pad + innerH - barH, colW - 8, barH);
    }
    ctx.fillStyle = 'rgba(212, 209, 210, 0.78)';
    ctx.font = `${Math.max(10, Math.round(w * 0.025))}px "Source Serif 4", serif`;
    ctx.fillText('SISTEMA DE IDENTIDAD EN MOVIMIENTO', pad + 10, pad + 22);
  } else {
    // Orbital: Retícula áurea, compás y proporción Fibonacci
    const cx = w * 0.5;
    const cy = h * 0.5;
    const baseR = Math.min(w, h) * 0.34;
    const ratios = [1, 0.618, 0.382, 0.236];

    ctx.strokeStyle = 'rgba(60, 58, 64, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - baseR * 1.45, cy);
    ctx.lineTo(cx + baseR * 1.45, cy);
    ctx.moveTo(cx, cy - baseR * 1.15);
    ctx.lineTo(cx, cy + baseR * 1.15);
    ctx.stroke();

    ratios.forEach((r, idx) => {
      const radius = baseR * r;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = idx === 1 ? '#B85B64' : 'rgba(212, 209, 210, 0.42)';
      ctx.lineWidth = idx === 1 ? 1.8 : 1;
      ctx.stroke();

      // Punto orbital
      const angle = t * (0.6 + idx * 0.35) * (idx % 2 === 0 ? 1 : -1);
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      ctx.beginPath();
      ctx.arc(px, py, idx === 1 ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = idx === 1 ? '#B85B64' : '#D4D1D2';
      ctx.fill();
    });

    // Rectángulo áureo rotando suavemente
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t * 0.4) * 0.14);
    ctx.strokeStyle = 'rgba(212, 209, 210, 0.55)';
    ctx.strokeRect(-baseR * 0.8, -baseR * 0.494, baseR * 1.6, baseR * 0.988);
  }
  ctx.restore();
}

function buildWebThumbMarkup(item, isModal = false) {
  const variant = item.themeVariant || 'obsidian-editorial';
  return `
    <div class="web-thumb web-thumb--${esc(variant)}" style="${isModal ? 'min-height: 400px;' : ''}">
      <div class="web-thumb__bar">
        <div class="web-thumb__dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <span>https://${esc(item.domain || 'kaelion.art')}</span>
        <span>SSL</span>
      </div>
      <div class="web-thumb__canvas" style="${isModal ? 'padding: 2.2rem;' : ''}">
        <div class="web-thumb__nav">
          <strong>${esc(item.client)}</strong>
          <span>Inicio · Obra · Contacto</span>
        </div>
        <div class="web-thumb__hero" style="${isModal ? 'max-width: 460px; margin-block: 2rem;' : ''}">
          <h4 style="${isModal ? 'font-size: 1.85rem; margin-bottom: 0.9rem;' : ''}">${esc(item.title)}</h4>
          <div class="web-thumb__lines">
            <span style="width: 92%"></span>
            <span style="width: 76%"></span>
            <span style="width: 58%"></span>
          </div>
          <span class="web-thumb__cta">Atención WhatsApp</span>
        </div>
        <div class="web-thumb__nav" style="border-top: 1px solid rgba(154,150,156,0.25); padding-top: 0.5rem;">
          <span>Diseño por KAELION Digital Art</span>
          <span>${esc(item.year || '2026')}</span>
        </div>
      </div>
    </div>
  `;
}

export async function initPortfolioAndGallery() {
  const rosterEl = document.getElementById('clients-roster');
  const casesEl = document.getElementById('cases-grid');
  const galleryGrid = document.getElementById('gallery-grid');
  const filterTabs = document.querySelectorAll('[data-gallery-filter]');

  // Modal universal de galería
  const modal = document.getElementById('gallery-modal');
  const modalTitle = document.getElementById('gallery-modal-title');
  const modalStage = document.getElementById('gallery-modal-stage');
  const modalDesc = document.getElementById('gallery-modal-desc');
  const modalTags = document.getElementById('gallery-modal-tags');
  const modalWaLink = document.getElementById('gallery-modal-wa');
  const modalPrevBtn = document.getElementById('gallery-modal-prev');
  const modalNextBtn = document.getElementById('gallery-modal-next');
  const closeModalBtns = document.querySelectorAll('[data-close-gallery-modal]');

  let data = FALLBACK_PORTFOLIO;
  try {
    const res = await fetch('data/portfolio.json', { cache: 'no-cache' });
    if (res.ok) data = await res.json();
  } catch {
    // Respaldo
  }

  // 1. Renderizar Portafolio de Clientes
  if (rosterEl && Array.isArray(data.clients)) {
    rosterEl.innerHTML = data.clients.map((client) => `
      <div class="client-tile">
        <span class="client-tile__name">${esc(client.name)}</span>
        <span class="client-tile__sector">${esc(client.sector)}</span>
        <span class="client-tile__service">${esc(client.service)}</span>
      </div>
    `).join('');
  }

  if (casesEl && Array.isArray(data.caseStudies)) {
    casesEl.innerHTML = data.caseStudies.map((cs) => `
      <article class="case-card">
        <div class="case-card__top">
          <div class="case-card__head">
            <span>${esc(cs.discipline)}</span>
            <span>${esc(cs.year)}</span>
          </div>
          <h3 class="case-card__title">${esc(cs.client)}</h3>
          <p class="case-card__summary">${esc(cs.summary)}</p>
          <div class="tag-row">
            ${(cs.deliverables || []).map((d) => `<span class="tag">${esc(d)}</span>`).join('')}
          </div>
        </div>
        <blockquote class="case-card__quote">“${esc(cs.quote)}”</blockquote>
      </article>
    `).join('');
  }

  // 2. Renderizar Galería de Trabajos (Imágenes, Videos, Webs)
  const items = Array.isArray(data.gallery) ? data.gallery : [];
  let activeType = 'all';
  let visibleItems = [...items];
  let modalIndex = -1;
  let cardAnimIds = [];
  let modalAnimId = null;

  // Actualizar contadores en botones de filtro
  const countMap = {
    all: items.length,
    image: items.filter((i) => i.type === 'image').length,
    video: items.filter((i) => i.type === 'video').length,
    web: items.filter((i) => i.type === 'web').length
  };
  filterTabs.forEach((btn) => {
    const type = btn.dataset.galleryFilter;
    const countSpan = btn.querySelector('.filter-tab__count');
    if (countSpan && type in countMap) {
      countSpan.textContent = `(${countMap[type]})`;
    }
  });

  function stopCardAnimations() {
    cardAnimIds.forEach((id) => cancelAnimationFrame(id));
    cardAnimIds = [];
  }

  function startVideoThumbAnimations() {
    stopCardAnimations();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvases = galleryGrid?.querySelectorAll('canvas[data-reel-style]') || [];

    canvases.forEach((canvas, idx) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const style = canvas.dataset.reelStyle || 'orbital';
      canvas.width = 480;
      canvas.height = 330;

      if (reduceMotion) {
        drawReelFrame(ctx, canvas.width, canvas.height, 1.5 + idx, style);
        return;
      }

      let t = idx * 1.4;
      const tick = () => {
        t += 0.018;
        drawReelFrame(ctx, canvas.width, canvas.height, t, style);
        const rafId = requestAnimationFrame(tick);
        cardAnimIds[idx] = rafId;
      };
      cardAnimIds[idx] = requestAnimationFrame(tick);
    });
  }

  function renderGallery() {
    if (!galleryGrid) return;
    visibleItems = activeType === 'all' ? items : items.filter((item) => item.type === activeType);

    galleryGrid.innerHTML = visibleItems.map((item, idx) => {
      const typeLabel = item.type === 'image' ? 'Imagen' : item.type === 'video' ? 'Video' : 'Web';
      const actionLabel = item.type === 'image' ? 'Ampliar pieza' : item.type === 'video' ? 'Reproducir reel' : 'Vista previa web';
      let mediaMarkup = '';

      if (item.type === 'image') {
        mediaMarkup = `<img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy" />`;
      } else if (item.type === 'video') {
        mediaMarkup = `
          <canvas class="reel-canvas" data-reel-style="${esc(item.reelStyle || 'orbital')}" aria-label="${esc(item.title)}"></canvas>
          <div class="gallery-play-trigger" aria-hidden="true">
            <span class="gallery-play-circle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"></polygon></svg>
            </span>
          </div>
          <span class="gallery-card__duration">${esc(item.duration || '00:40')}</span>
        `;
      } else {
        mediaMarkup = buildWebThumbMarkup(item, false);
      }

      return `
        <article class="gallery-card">
          <div class="gallery-card__media" data-open-gallery="${idx}" role="button" tabindex="0" aria-label="${esc(actionLabel)}: ${esc(item.title)}">
            <span class="gallery-card__badge">${typeLabel}</span>
            ${mediaMarkup}
          </div>
          <div class="gallery-card__body">
            <span class="gallery-card__cat">${esc(item.category)} · ${esc(item.year)}</span>
            <h3 class="gallery-card__title">${esc(item.title)}</h3>
            <p class="gallery-card__desc">${esc(item.description)}</p>
            <div class="gallery-card__footer">
              <span style="color: var(--ash-muted);">${esc(item.client)}</span>
              <button type="button" class="gallery-card__action" data-open-gallery="${idx}">
                ${actionLabel} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    galleryGrid.querySelectorAll('[data-open-gallery]').forEach((el) => {
      const openHandler = () => openGalleryModal(Number(el.dataset.openGallery));
      el.addEventListener('click', openHandler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openHandler();
        }
      });
    });

    startVideoThumbAnimations();
  }

  function stopModalReel() {
    if (modalAnimId) {
      cancelAnimationFrame(modalAnimId);
      modalAnimId = null;
    }
  }

  function openGalleryModal(index) {
    if (!modal || !visibleItems[index]) return;
    stopModalReel();
    modalIndex = index;
    const item = visibleItems[index];

    if (modalTitle) modalTitle.textContent = `${item.title} — ${item.client}`;
    if (modalDesc) modalDesc.textContent = item.description;
    if (modalTags) {
      modalTags.innerHTML = (item.deliverables || []).map((d) => `<span class="tag">${esc(d)}</span>`).join('');
    }
    if (modalWaLink) {
      const msg = encodeURIComponent(`Hola KAELION Digital Art, vi "${item.title}" en su galería de kaelion.art y me gustaría cotizar un proyecto similar (${item.whatsappTopic || item.category}).`);
      modalWaLink.href = `https://wa.me/${WA_NUMBER}?text=${msg}`;
    }

    if (modalStage) {
      if (item.type === 'image') {
        modalStage.innerHTML = `<img src="${esc(item.image)}" alt="${esc(item.title)}" />`;
      } else if (item.type === 'video') {
        if (item.videoUrl) {
          modalStage.innerHTML = `<video src="${esc(item.videoUrl)}" controls autoplay playsinline style="width:100%; max-height:56vh; background:#111012;"></video>`;
        } else {
          modalStage.innerHTML = `
            <canvas id="modal-reel-canvas" width="900" height="480" style="width:100%; aspect-ratio:16/9; display:block;"></canvas>
            <div class="video-player-controls">
              <button type="button" class="btn btn--primary btn--sm" id="modal-reel-toggle">Pausar</button>
              <div class="video-scrubber"><div class="video-scrubber__fill" id="modal-reel-progress"></div></div>
              <span id="modal-reel-time" style="font-family:monospace; font-size:0.8rem; color:var(--ash-muted);">00:00 / ${esc(item.duration || '00:45')}</span>
            </div>
          `;
          const canvas = document.getElementById('modal-reel-canvas');
          const toggleBtn = document.getElementById('modal-reel-toggle');
          const fillEl = document.getElementById('modal-reel-progress');
          const timeEl = document.getElementById('modal-reel-time');
          const ctx = canvas?.getContext('2d');
          let playing = true;
          let t = 0;

          const loop = () => {
            if (ctx) {
              if (playing) t += 0.02;
              drawReelFrame(ctx, canvas.width, canvas.height, t, item.reelStyle || 'orbital');
              const pct = ((t * 5) % 100);
              if (fillEl) fillEl.style.width = `${pct}%`;
              const sec = Math.floor((pct / 100) * 45);
              if (timeEl) timeEl.textContent = `00:${String(sec).padStart(2, '0')} / ${item.duration || '00:45'}`;
            }
            modalAnimId = requestAnimationFrame(loop);
          };
          modalAnimId = requestAnimationFrame(loop);

          toggleBtn?.addEventListener('click', () => {
            playing = !playing;
            toggleBtn.textContent = playing ? 'Pausar' : 'Reproducir';
          });
        }
      } else {
        modalStage.innerHTML = `
          <div class="web-preview-toolbar">
            <span>Vista previa interactiva · ${esc(item.domain || 'kaelion.art')}</span>
            <div class="tab-group">
              <button type="button" class="tab-btn is-active" id="vp-desktop-btn">Escritorio</button>
              <button type="button" class="tab-btn" id="vp-mobile-btn">Móvil</button>
            </div>
          </div>
          <div style="padding: 1rem; background: #141316;">
            <div class="viewport-frame" id="web-viewport-frame">
              ${item.liveUrl
                ? `<iframe src="${esc(item.liveUrl)}" title="${esc(item.title)}" style="width:100%; height:440px; border:0; background:#111012;"></iframe>`
                : buildWebThumbMarkup(item, true)}
            </div>
          </div>
        `;
        const vpFrame = document.getElementById('web-viewport-frame');
        const desktopBtn = document.getElementById('vp-desktop-btn');
        const mobileBtn = document.getElementById('vp-mobile-btn');
        desktopBtn?.addEventListener('click', () => {
          vpFrame?.classList.remove('is-mobile');
          desktopBtn.classList.add('is-active');
          mobileBtn?.classList.remove('is-active');
        });
        mobileBtn?.addEventListener('click', () => {
          vpFrame?.classList.add('is-mobile');
          mobileBtn.classList.add('is-active');
          desktopBtn?.classList.remove('is-active');
        });
      }
    }

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeGalleryModal() {
    if (!modal) return;
    stopModalReel();
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  filterTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeType = btn.dataset.galleryFilter || 'all';
      filterTabs.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      renderGallery();
    });
  });

  closeModalBtns.forEach((btn) => btn.addEventListener('click', closeGalleryModal));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeGalleryModal();
  });

  modalPrevBtn?.addEventListener('click', () => {
    if (!visibleItems.length) return;
    openGalleryModal((modalIndex - 1 + visibleItems.length) % visibleItems.length);
  });

  modalNextBtn?.addEventListener('click', () => {
    if (!visibleItems.length) return;
    openGalleryModal((modalIndex + 1) % visibleItems.length);
  });

  document.addEventListener('keydown', (e) => {
    if (!modal?.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeGalleryModal();
    if (e.key === 'ArrowLeft') modalPrevBtn?.click();
    if (e.key === 'ArrowRight') modalNextBtn?.click();
  });

  renderGallery();
}
