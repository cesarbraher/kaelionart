/**
 * KAELION Digital Art — Módulo de Proyectos Activos & Sincronización GitHub
 * Permite mostrar proyectos en curso y conectar repositorios de cualquier cuenta de GitHub
 * desde data/active-projects.json o desde el panel de sincronización en vivo.
 */

const KAELION_WA_NUMBER = '524641093886';
const OVERRIDE_STORAGE_KEY = 'kaelion_github_sync_override_v1';
const CACHE_STORAGE_KEY = 'kaelion_github_repos_cache_v1';

const FALLBACK_ACTIVE_DATA = {
  meta: {
    description: 'Configuración de Proyectos Activos de KAELION Digital Art.',
    lastUpdated: '2026-11-25'
  },
  github: {
    enabled: true,
    githubAccounts: [],
    featuredRepos: [],
    excludeRepos: ['kaelionart'],
    includeForks: false,
    maxRepos: 6,
    cacheTtlMinutes: 15,
    overrides: {}
  },
  activeProjects: [
    {
      id: 'kaelion-web-core',
      name: 'kaelion-studio-platform',
      title: 'Plataforma Editorial KAELION v2',
      client: 'Proyecto Interno · I+D',
      category: 'Desarrollo Web',
      status: 'En producción',
      progress: 92,
      summary: 'Sistema modular para portafolios creativos de alto rendimiento, integración directa con WhatsApp Business y sincronización de repositorios GitHub en tiempo real.',
      stack: ['HTML5', 'CSS Editorial', 'JavaScript', 'GitHub API'],
      updatedLabel: 'Actualizado esta semana',
      repoUrl: 'https://github.com/cesarbraher/kaelionart',
      demoUrl: 'https://kaelion.art',
      source: 'studio'
    },
    {
      id: 'identidad-geometrica-ai',
      name: 'kaelion-grid-lab',
      title: 'Laboratorio de Retícula Áurea + IA',
      client: 'Metodología Híbrida',
      category: 'Identidad Visual',
      status: 'En desarrollo',
      progress: 74,
      summary: 'Flujo asistido para validación de proporciones Fibonacci, construcción isométrica de isotipos y verificación cromática de contraste antes de entrega vectorial.',
      stack: ['SVG', 'Geometría Áurea', 'Adobe Suite', 'IA Generativa'],
      updatedLabel: 'Sprint activo',
      repoUrl: '',
      demoUrl: '',
      source: 'studio'
    },
    {
      id: 'catalogo-audiovisual-reel',
      name: 'reel-motion-pipeline',
      title: 'Pipeline Audiovisual & Motion',
      client: 'Producción Comercial',
      category: 'Audiovisual',
      status: 'Beta',
      progress: 65,
      summary: 'Sistema de plantillas dinámicas y etalonaje cinematográfico para videos promocionales, cápsulas verticales y lanzamientos de marca en tiempo récord.',
      stack: ['Motion Graphics', 'Color Grading', 'Audio Master', 'WebM'],
      updatedLabel: 'En pruebas internas',
      repoUrl: '',
      demoUrl: '',
      source: 'studio'
    }
  ]
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRelativeDateEs(isoString) {
  if (!isoString) return 'Actividad reciente';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Actividad reciente';
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays <= 0) return 'Actualizado hoy';
  if (diffDays === 1) return 'Actualizado ayer';
  if (diffDays < 7) return `Actualizado hace ${diffDays} días`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Actualizado hace ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
  }
  return `Actualizado ${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function mapGitHubRepo(repo, override = {}) {
  const daysSincePush = Math.floor((Date.now() - new Date(repo.pushed_at).getTime()) / 86400000);
  const inferredStatus = daysSincePush <= 14 ? 'En desarrollo' : daysSincePush <= 60 ? 'Beta' : 'En producción';
  const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 3) : [];
  const stack = [repo.language, ...topics].filter(Boolean);

  return {
    id: `gh-${repo.id}`,
    name: repo.full_name,
    title: override.title || repo.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    client: override.client || `GitHub · @${repo.owner?.login || 'repositorio'}`,
    category: override.category || (repo.language ? `Código · ${repo.language}` : 'Desarrollo Digital'),
    status: override.status || inferredStatus,
    progress: typeof override.progress === 'number'
      ? override.progress
      : (inferredStatus === 'En producción' ? 95 : inferredStatus === 'Beta' ? 78 : 64),
    summary: override.summary || repo.description || 'Repositorio activo sincronizado automáticamente desde GitHub para seguimiento de avances en kaelion.art.',
    stack: stack.length ? stack : ['GitHub', 'Proyecto Activo'],
    updatedLabel: formatRelativeDateEs(repo.pushed_at),
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count || 0,
    repoUrl: repo.html_url,
    demoUrl: override.demoUrl || repo.homepage || '',
    source: 'github'
  };
}

export async function initActiveProjects() {
  const grid = document.getElementById('projects-grid');
  const statusEl = document.getElementById('github-sync-status');
  const statusDot = document.getElementById('github-sync-dot');
  const filterButtons = document.querySelectorAll('[data-project-filter]');
  const openSyncBtn = document.getElementById('open-github-sync-btn');
  const refreshBtn = document.getElementById('refresh-github-sync-btn');

  // Elementos del modal de configuración GitHub
  const syncModal = document.getElementById('github-sync-modal');
  const closeSyncBtns = document.querySelectorAll('[data-close-sync-modal]');
  const accountsInput = document.getElementById('gh-accounts-input');
  const reposInput = document.getElementById('gh-repos-input');
  const maxReposInput = document.getElementById('gh-max-input');
  const applySyncBtn = document.getElementById('apply-github-sync-btn');
  const resetSyncBtn = document.getElementById('reset-github-sync-btn');
  const copyJsonBtn = document.getElementById('copy-projects-json-btn');
  const downloadJsonBtn = document.getElementById('download-projects-json-btn');
  const jsonOutputEl = document.getElementById('gh-json-output');
  const syncFeedbackEl = document.getElementById('gh-sync-feedback');

  if (!grid) return;

  let baseConfig = structuredClone(FALLBACK_ACTIVE_DATA);
  try {
    const res = await fetch('data/active-projects.json', { cache: 'no-cache' });
    if (res.ok) {
      baseConfig = await res.json();
    }
  } catch {
    // Usa configuración de respaldo si se abre sin servidor
  }

  let currentProjects = [...(baseConfig.activeProjects || [])];
  let currentFilter = 'all';

  function getEffectiveGitHubConfig() {
    const baseGh = baseConfig.github || {};
    try {
      const savedRaw = localStorage.getItem(OVERRIDE_STORAGE_KEY);
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        return {
          ...baseGh,
          githubAccounts: Array.isArray(saved.githubAccounts) ? saved.githubAccounts : (baseGh.githubAccounts || []),
          featuredRepos: Array.isArray(saved.featuredRepos) ? saved.featuredRepos : (baseGh.featuredRepos || []),
          maxRepos: Number(saved.maxRepos || baseGh.maxRepos || 6),
          isLocalOverride: true
        };
      }
    } catch {
      // Ignora error de storage
    }
    return { ...baseGh, isLocalOverride: false };
  }

  function updateStatus(message, isLive = false) {
    if (statusEl) statusEl.textContent = message;
    if (statusDot) {
      statusDot.classList.toggle('sync-status__dot--live', isLive);
    }
  }

  function buildExportConfig(ghCfg, projects) {
    return {
      meta: {
        description: baseConfig.meta?.description || 'Configuración de Proyectos Activos de KAELION Digital Art.',
        lastUpdated: new Date().toISOString().slice(0, 10)
      },
      github: {
        enabled: true,
        githubAccounts: ghCfg.githubAccounts || [],
        featuredRepos: ghCfg.featuredRepos || [],
        excludeRepos: ghCfg.excludeRepos || ['kaelionart'],
        includeForks: Boolean(ghCfg.includeForks),
        maxRepos: Number(ghCfg.maxRepos || 6),
        cacheTtlMinutes: Number(ghCfg.cacheTtlMinutes || 15),
        overrides: ghCfg.overrides || {}
      },
      activeProjects: projects
    };
  }

  function renderJsonPreview() {
    if (!jsonOutputEl) return;
    const ghCfg = getEffectiveGitHubConfig();
    const exportObj = buildExportConfig(ghCfg, currentProjects);
    jsonOutputEl.textContent = JSON.stringify(exportObj, null, 2);
  }

  function renderProjects() {
    const filtered = currentFilter === 'all'
      ? currentProjects
      : currentProjects.filter((p) => p.status.toLowerCase() === currentFilter.toLowerCase());

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="project-card" style="grid-column: 1 / -1; text-align: center; padding: 2.5rem;">
          <p style="margin: 0; color: var(--ash-muted);">No hay proyectos en la categoría seleccionada por el momento.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map((project) => {
      const isProd = project.status.toLowerCase().includes('producción');
      const waText = encodeURIComponent(`Hola KAELION Digital Art, me interesa conocer más sobre el proyecto activo "${project.title}" o cotizar un desarrollo similar.`);
      const waLink = `https://wa.me/${KAELION_WA_NUMBER}?text=${waText}`;
      const stackTags = (project.stack || []).slice(0, 4)
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join('');

      return `
        <article class="project-card">
          <div>
            <div class="project-card__header">
              <span class="project-source">
                <img src="assets/brand/emblema.png" alt="" aria-hidden="true" width="18" height="18" />
                <span>${project.source === 'github' ? 'GitHub Live' : escapeHtml(project.client || 'Estudio KAELION')}</span>
              </span>
              <span class="project-status ${isProd ? 'project-status--prod' : ''}">${escapeHtml(project.status)}</span>
            </div>
            <h3 class="project-card__title">${escapeHtml(project.title)}</h3>
            <div class="project-card__slug">${escapeHtml(project.name)}</div>
            <p class="project-card__desc">${escapeHtml(project.summary)}</p>
          </div>

          <div>
            <div class="tag-row" style="margin-bottom: 1.1rem;">
              ${stackTags}
            </div>

            <div class="progress-wrap" style="margin-bottom: 1.1rem;">
              <div class="progress-meta">
                <span>${escapeHtml(project.category || 'Desarrollo Activo')}</span>
                <span>${Math.min(100, Math.max(0, Number(project.progress || 75)))}%</span>
              </div>
              <div class="progress-track" aria-hidden="true">
                <div class="progress-bar" style="width: ${Math.min(100, Math.max(0, Number(project.progress || 75)))}%"></div>
              </div>
            </div>

            <div class="project-card__footer">
              <span>${escapeHtml(project.updatedLabel || 'Activo')}</span>
              <div class="project-links">
                ${project.demoUrl ? `<a href="${escapeHtml(project.demoUrl)}" target="_blank" rel="noopener noreferrer">Demo</a>` : ''}
                ${project.repoUrl ? `<a href="${escapeHtml(project.repoUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ''}
                <a href="${waLink}" target="_blank" rel="noopener noreferrer">Consultar</a>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  async function fetchGitHubProjects(forceRefresh = false) {
    const ghCfg = getEffectiveGitHubConfig();
    const accounts = (ghCfg.githubAccounts || []).filter(Boolean);
    const featuredRepos = (ghCfg.featuredRepos || []).filter(Boolean);

    if (!ghCfg.enabled || (accounts.length === 0 && featuredRepos.length === 0)) {
      currentProjects = [...(baseConfig.activeProjects || FALLBACK_ACTIVE_DATA.activeProjects)];
      updateStatus('Listo para vincular tu cuenta de GitHub · Mostrando proyectos activos del estudio', false);
      renderProjects();
      renderJsonPreview();
      return;
    }

    const cacheKeySignature = JSON.stringify({ accounts, featuredRepos, max: ghCfg.maxRepos });
    const ttlMs = Number(ghCfg.cacheTtlMinutes || 15) * 60 * 1000;

    if (!forceRefresh) {
      try {
        const cachedRaw = localStorage.getItem(CACHE_STORAGE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached.signature === cacheKeySignature && Date.now() - cached.timestamp < ttlMs && Array.isArray(cached.projects) && cached.projects.length) {
            currentProjects = cached.projects;
            const originLabel = accounts.length ? accounts.map((a) => `@${a}`).join(', ') : `${featuredRepos.length} repositorios`;
            updateStatus(`Sincronizado en vivo con GitHub (${originLabel})${ghCfg.isLocalOverride ? ' · Vista previa local' : ''}`, true);
            renderProjects();
            renderJsonPreview();
            return;
          }
        }
      } catch {
        // Continúa con fetch
      }
    }

    updateStatus('Consultando repositorios en GitHub...', false);

    try {
      const headers = { 'Accept': 'application/vnd.github+json' };
      const exclude = new Set((ghCfg.excludeRepos || []).map((r) => r.toLowerCase()));
      const overrides = ghCfg.overrides || {};
      const collected = new Map();

      for (const fullName of featuredRepos) {
        const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers });
        if (!res.ok) throw new Error(`No se encontró el repositorio "${fullName}" (HTTP ${res.status})`);
        const repo = await res.json();
        collected.set(repo.full_name.toLowerCase(), repo);
      }

      for (const account of accounts) {
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(account)}/repos?sort=pushed&direction=desc&per_page=30`, { headers });
        if (!res.ok) throw new Error(`No se pudo consultar la cuenta "@${account}" (HTTP ${res.status})`);
        const repos = await res.json();
        for (const repo of repos) {
          if (repo.archived) continue;
          if (!ghCfg.includeForks && repo.fork) continue;
          if (exclude.has(repo.name.toLowerCase()) || exclude.has(repo.full_name.toLowerCase())) continue;
          collected.set(repo.full_name.toLowerCase(), repo);
        }
      }

      const mapped = [...collected.values()]
        .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
        .slice(0, Number(ghCfg.maxRepos || 6))
        .map((repo) => mapGitHubRepo(repo, overrides[repo.full_name] || overrides[repo.name] || {}));

      if (!mapped.length) {
        throw new Error('La cuenta conectada no tiene repositorios públicos visibles con los filtros actuales.');
      }

      currentProjects = mapped;
      try {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify({
          signature: cacheKeySignature,
          timestamp: Date.now(),
          projects: mapped
        }));
      } catch {
        // Ignora error de cuota
      }

      const originLabel = accounts.length ? accounts.map((a) => `@${a}`).join(', ') : `${featuredRepos.length} repositorios`;
      updateStatus(`Sincronizado en vivo con GitHub (${originLabel})${ghCfg.isLocalOverride ? ' · Vista previa local' : ''}`, true);
      if (syncFeedbackEl) {
        syncFeedbackEl.textContent = `Se cargaron ${mapped.length} repositorios activos correctamente. Copia o descarga el JSON para publicarlos en kaelion.art.`;
      }
      renderProjects();
      renderJsonPreview();
    } catch (err) {
      currentProjects = [...(baseConfig.activeProjects || FALLBACK_ACTIVE_DATA.activeProjects)];
      updateStatus(`Respaldo local activo (${err.message})`, false);
      if (syncFeedbackEl) {
        syncFeedbackEl.textContent = `Aviso: ${err.message}`;
      }
      renderProjects();
      renderJsonPreview();
    }
  }

  // Filtros de estado
  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.projectFilter || 'all';
      filterButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      renderProjects();
    });
  });

  // Abrir / cerrar modal de sincronización GitHub
  function openSyncModal() {
    if (!syncModal) return;
    const ghCfg = getEffectiveGitHubConfig();
    if (accountsInput) accountsInput.value = (ghCfg.githubAccounts || []).join(', ');
    if (reposInput) reposInput.value = (ghCfg.featuredRepos || []).join(', ');
    if (maxReposInput) maxReposInput.value = String(ghCfg.maxRepos || 6);
    if (syncFeedbackEl) syncFeedbackEl.textContent = '';
    renderJsonPreview();
    syncModal.classList.add('is-open');
    syncModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeSyncModal() {
    if (!syncModal) return;
    syncModal.classList.remove('is-open');
    syncModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  openSyncBtn?.addEventListener('click', openSyncModal);
  refreshBtn?.addEventListener('click', () => fetchGitHubProjects(true));
  closeSyncBtns.forEach((btn) => btn.addEventListener('click', closeSyncModal));

  syncModal?.addEventListener('click', (e) => {
    if (e.target === syncModal) closeSyncModal();
  });

  applySyncBtn?.addEventListener('click', async () => {
    const accounts = (accountsInput?.value || '')
      .split(',')
      .map((s) => s.trim().replace(/^@/, ''))
      .filter(Boolean);
    const featuredRepos = (reposInput?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const maxRepos = Math.max(1, Math.min(12, Number(maxReposInput?.value || 6)));

    localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify({
      githubAccounts: accounts,
      featuredRepos,
      maxRepos
    }));

    await fetchGitHubProjects(true);
  });

  resetSyncBtn?.addEventListener('click', async () => {
    localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    localStorage.removeItem(CACHE_STORAGE_KEY);
    if (accountsInput) accountsInput.value = (baseConfig.github?.githubAccounts || []).join(', ');
    if (reposInput) reposInput.value = (baseConfig.github?.featuredRepos || []).join(', ');
    if (syncFeedbackEl) syncFeedbackEl.textContent = 'Configuración restaurada a data/active-projects.json.';
    await fetchGitHubProjects(true);
  });

  copyJsonBtn?.addEventListener('click', async () => {
    if (!jsonOutputEl) return;
    try {
      await navigator.clipboard.writeText(jsonOutputEl.textContent);
      if (syncFeedbackEl) syncFeedbackEl.textContent = 'JSON copiado. Pégalo en data/active-projects.json y haz push a GitHub.';
    } catch {
      if (syncFeedbackEl) syncFeedbackEl.textContent = 'Selecciona y copia el bloque JSON mostrado arriba.';
    }
  });

  downloadJsonBtn?.addEventListener('click', () => {
    if (!jsonOutputEl) return;
    const blob = new Blob([jsonOutputEl.textContent + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'active-projects.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && syncModal?.classList.contains('is-open')) {
      closeSyncModal();
    }
  });

  // Abrir automáticamente si la URL contiene ?sync=github
  if (new URLSearchParams(window.location.search).get('sync') === 'github') {
    openSyncModal();
  }

  await fetchGitHubProjects(false);
}
