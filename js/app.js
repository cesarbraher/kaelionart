/**
 * KAELION Digital Art — Controlador Principal (kaelion.art)
 * Navegación, Procesos de 5 Fases (Manifiesto), Asistente de Cotización WhatsApp
 * y Widget Flotante de Atención.
 */

import { initPortfolioAndGallery } from './gallery.js';
import { initActiveProjects } from './github-projects.js';

const WA_NUMBER = '524641093886';

const SERVICE_PROCESSES = {
  flyers: {
    label: 'Proceso de Trabajo — Diseño Gráfico de Flyers ($360 MXN)',
    steps: [
      {
        num: 'Fase 01',
        title: 'Contacto Oficial',
        text: 'Te comunicas por WhatsApp Business para solicitar asesoría, resolver dudas o iniciar la contratación del servicio.'
      },
      {
        num: 'Fase 02',
        title: 'Compra y Garantía',
        text: 'Realizas el pago vía Mercado Pago (hasta 3 MSI) o PayPal. Tu pago permanece retenido hasta 3 días como garantía íntegra.'
      },
      {
        num: 'Fase 03',
        title: 'Briefing y Materiales',
        text: 'Confirmas tu compra por WhatsApp y envías descripción, medidas, uso, fotografías, logotipos, paleta y referencias.'
      },
      {
        num: 'Fase 04',
        title: 'Propuesta Inicial (Máx. 3 días)',
        text: 'Entregamos la propuesta en alta resolución (PNG y JPG). Puedes solicitar todos los ajustes necesarios en una sola ocasión.'
      },
      {
        num: 'Fase 05',
        title: 'Entrega Final (Máx. 3 días hábiles)',
        text: 'Recibes la versión definitiva en PNG, JPG y archivos editables (PDF, PSD, AI) vía correo electrónico y/o WhatsApp.'
      }
    ]
  },
  logotipos: {
    label: 'Proceso de Trabajo — Diseño Original de Logotipos ($700 MXN)',
    steps: [
      {
        num: 'Fase 01',
        title: 'Asesoría Previa',
        text: 'Recibes atención directa por nuestros canales oficiales con todos los detalles técnicos y comerciales antes de tu compra.'
      },
      {
        num: 'Fase 02',
        title: 'Compra y Confirmación',
        text: 'Adquieres el servicio mediante Mercado Pago (hasta 3 MSI) o PayPal internacional y envías tu comprobante por WhatsApp.'
      },
      {
        num: 'Fase 03',
        title: 'Cuestionario Estratégico',
        text: 'Completas un cuestionario para definir logotipo, imagotipo, isologo o isotipo, esencia de marca y referencias visuales.'
      },
      {
        num: 'Fase 04',
        title: 'Bocetaje y Muestra (Máx. 4 días hábiles)',
        text: 'Dibujo tradicional, retícula Fibonacci/áurea, digitalización isométrica en Adobe Suite y optimización con IA.'
      },
      {
        num: 'Fase 05',
        title: 'Ajustes y Entrega Vectorial (Máx. 3 días hábiles)',
        text: 'Aplicamos tus observaciones a detalle y entregamos los archivos definitivos editables: PNG, JPG, PDF, PSD, AI y SVG.'
      }
    ]
  },
  web: {
    label: 'Proceso de Trabajo — Página Web / Landing Page ($1,850 MXN)',
    steps: [
      {
        num: 'Fase 01',
        title: 'Contacto y Alcance',
        text: 'Asesoría inicial por WhatsApp Business para definir objetivos, secciones, llamadas a la acción y nombre de dominio.'
      },
      {
        num: 'Fase 02',
        title: 'Compra Protegida',
        text: 'Pago mediante enlace oficial de Mercado Pago (hasta 3 MSI) o PayPal con garantía de retención de 3 días en la plataforma.'
      },
      {
        num: 'Fase 03',
        title: 'Recopilación de Activos',
        text: 'Envías tu comprobante y completas el formulario de estructura con imágenes, logotipos, colores, videos, enlaces y textos.'
      },
      {
        num: 'Fase 04',
        title: 'Desarrollo y Revisión (Máx. 8 días hábiles)',
        text: 'Publicamos la propuesta inicial en tu dominio seleccionado. Incluye 2 rondas de ajustes (hasta 3 propuestas en total).'
      },
      {
        num: 'Fase 05',
        title: 'Entrega Total de Activos',
        text: 'Entregamos el repositorio completo editable, titularidad del dominio .com por 1 año, hosting y todos los recursos gráficos.'
      }
    ]
  }
};

function initNavigation() {
  const toggleBtn = document.getElementById('nav-toggle');
  const drawer = document.getElementById('mobile-drawer');
  const navLinks = document.querySelectorAll('.primary-nav a, .mobile-drawer a[href^="#"]');

  toggleBtn?.addEventListener('click', () => {
    const isOpen = drawer?.classList.toggle('is-open');
    toggleBtn.setAttribute('aria-expanded', String(Boolean(isOpen)));
  });

  drawer?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      drawer.classList.remove('is-open');
      toggleBtn?.setAttribute('aria-expanded', 'false');
    });
  });

  // Resaltar sección activa al desplazarse
  const sections = [...document.querySelectorAll('main section[id]')];
  const desktopLinks = [...document.querySelectorAll('.primary-nav a[href^="#"]')];

  if ('IntersectionObserver' in window && sections.length && desktopLinks.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          desktopLinks.forEach((a) => {
            a.classList.toggle('is-active', a.getAttribute('href') === `#${id}`);
          });
        }
      });
    }, { rootMargin: '-38% 0px -52% 0px' });

    sections.forEach((sec) => observer.observe(sec));
  }

  navLinks.forEach((a) => {
    a.addEventListener('click', () => {
      const targetId = a.getAttribute('href');
      if (targetId && targetId.startsWith('#')) {
        const el = document.querySelector(targetId);
        if (el) el.focus({ preventScroll: true });
      }
    });
  });
}

function initProcessTabs() {
  const container = document.getElementById('process-steps-container');
  const heading = document.getElementById('process-heading');
  const tabs = document.querySelectorAll('[data-process-tab]');
  if (!container || !tabs.length) return;

  function renderProcess(key) {
    const data = SERVICE_PROCESSES[key] || SERVICE_PROCESSES.flyers;
    if (heading) heading.textContent = data.label;
    container.innerHTML = data.steps.map((step) => `
      <div class="process-step">
        <span class="process-step__num">${step.num}</span>
        <h4 class="process-step__title">${step.title}</h4>
        <p class="process-step__text">${step.text}</p>
      </div>
    `).join('');
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.processTab;
      tabs.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      renderProcess(key);
    });
  });

  renderProcess('flyers');
}

function initWhatsAppConcierge() {
  // Widget flotante
  const waToggle = document.getElementById('wa-fab-toggle');
  const waPanel = document.getElementById('wa-panel');
  const waClose = document.getElementById('wa-panel-close');
  const waQuickBtns = document.querySelectorAll('[data-wa-message]');

  function setPanelOpen(open) {
    if (!waPanel || !waToggle) return;
    waPanel.classList.toggle('is-open', open);
    waToggle.setAttribute('aria-expanded', String(open));
  }

  waToggle?.addEventListener('click', () => {
    const next = !waPanel?.classList.contains('is-open');
    setPanelOpen(next);
  });

  waClose?.addEventListener('click', () => setPanelOpen(false));

  waQuickBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const msg = btn.dataset.waMessage || 'Hola KAELION Digital Art, me gustaría recibir información sobre sus servicios.';
      window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
    });
  });

  // Formulario de cotización directa a WhatsApp
  const form = document.getElementById('whatsapp-quote-form');
  const feedback = document.getElementById('quote-form-feedback');
  const copySummaryBtn = document.getElementById('copy-quote-btn');

  function composeQuoteMessage() {
    const name = document.getElementById('quote-name')?.value.trim() || '';
    const service = document.getElementById('quote-service')?.value || 'Cotización General';
    const business = document.getElementById('quote-business')?.value.trim() || '';
    const details = document.getElementById('quote-details')?.value.trim() || '';

    const lines = [
      'Hola KAELION Digital Art, les contacto desde kaelion.art:',
      name ? `• Nombre: ${name}` : null,
      business ? `• Marca / Negocio: ${business}` : null,
      `• Servicio de interés: ${service}`,
      details ? `• Detalles del proyecto: ${details}` : null
    ].filter(Boolean);

    return { name, message: lines.join('\n') };
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const { name, message } = composeQuoteMessage();
    if (!name) {
      if (feedback) feedback.textContent = 'Por favor escribe tu nombre para personalizar la atención por WhatsApp.';
      document.getElementById('quote-name')?.focus();
      return;
    }

    const url = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    if (feedback) {
      feedback.textContent = 'Abriendo WhatsApp Business (+52 464 109 3886) con tu solicitud prellenada.';
    }
  });

  copySummaryBtn?.addEventListener('click', async () => {
    const { message } = composeQuoteMessage();
    try {
      await navigator.clipboard.writeText(message);
      if (feedback) feedback.textContent = 'Resumen copiado al portapapeles. Puedes enviarlo también a info@kaelion.art.';
    } catch {
      if (feedback) feedback.textContent = 'Puedes enviarnos tu consulta directamente a info@kaelion.art o +52 464 109 3886.';
    }
  });
}

function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  items.forEach((el) => observer.observe(el));
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initProcessTabs();
  initWhatsAppConcierge();
  initScrollReveal();
  initPortfolioAndGallery();
  initActiveProjects();
});
