#!/usr/bin/env node
/**
 * KAELION Digital Art — Sincronizador de Proyectos Activos desde GitHub
 *
 * Uso:
 *   node scripts/sync-github-projects.mjs <usuario-github> [usuario2 ...]
 *   node scripts/sync-github-projects.mjs --repos usuario/repo1,usuario/repo2
 *
 * Opcional: exporta GITHUB_TOKEN si deseas mayor cuota de API o repos con acceso autenticado.
 * Este script actualiza data/active-projects.json para que kaelion.art muestre los proyectos
 * instantáneamente incluso sin depender de llamadas en vivo del navegador.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '..', 'data', 'active-projects.json');

const args = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN || '';

const headers = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'kaelion-art-sync/1.0'
};
if (token) {
  headers['Authorization'] = `Bearer ${token}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} al consultar ${url}`);
  }
  return res.json();
}

function mapRepoToProject(repo, override = {}) {
  const daysSincePush = Math.floor((Date.now() - new Date(repo.pushed_at).getTime()) / 86400000);
  const autoStatus = daysSincePush <= 14 ? 'En desarrollo' : daysSincePush <= 60 ? 'Beta' : 'En producción';
  const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 4) : [];
  const stack = [repo.language, ...topics].filter(Boolean);

  return {
    id: `gh-${repo.id}`,
    name: repo.full_name,
    title: override.title || repo.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    client: override.client || `GitHub · @${repo.owner.login}`,
    category: override.category || (repo.language ? `Desarrollo · ${repo.language}` : 'Proyecto Digital'),
    status: override.status || autoStatus,
    progress: typeof override.progress === 'number' ? override.progress : (autoStatus === 'En producción' ? 95 : autoStatus === 'Beta' ? 78 : 62),
    summary: override.summary || repo.description || 'Proyecto digital activo en desarrollo continuo bajo la dirección de KAELION Digital Art.',
    stack: stack.length ? stack : ['GitHub', 'Web'],
    updatedLabel: `Actualizado ${new Date(repo.pushed_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}`,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count || 0,
    repoUrl: repo.html_url,
    demoUrl: override.demoUrl || repo.homepage || '',
    source: 'github'
  };
}

async function main() {
  const current = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  let accounts = [...(current.github?.githubAccounts || [])];
  let featuredRepos = [...(current.github?.featuredRepos || [])];

  if (args.length > 0) {
    const repoFlagIdx = args.indexOf('--repos');
    if (repoFlagIdx !== -1 && args[repoFlagIdx + 1]) {
      featuredRepos = args[repoFlagIdx + 1].split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      accounts = args.filter((a) => !a.startsWith('--'));
    }
  }

  if (accounts.length === 0 && featuredRepos.length === 0) {
    console.log('No hay cuentas ni repositorios configurados aún.');
    console.log('Ejemplo: node scripts/sync-github-projects.mjs nombre_de_cuenta_github');
    process.exit(0);
  }

  const exclude = new Set((current.github?.excludeRepos || []).map((r) => r.toLowerCase()));
  const includeForks = Boolean(current.github?.includeForks);
  const maxRepos = Number(current.github?.maxRepos || 6);
  const overrides = current.github?.overrides || {};
  const collected = new Map();

  for (const fullName of featuredRepos) {
    const repo = await fetchJson(`https://api.github.com/repos/${fullName}`);
    collected.set(repo.full_name.toLowerCase(), repo);
  }

  for (const account of accounts) {
    const repos = await fetchJson(`https://api.github.com/users/${encodeURIComponent(account)}/repos?sort=pushed&direction=desc&per_page=30`);
    for (const repo of repos) {
      if (repo.archived) continue;
      if (!includeForks && repo.fork) continue;
      if (exclude.has(repo.name.toLowerCase()) || exclude.has(repo.full_name.toLowerCase())) continue;
      collected.set(repo.full_name.toLowerCase(), repo);
    }
  }

  const sorted = [...collected.values()]
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, maxRepos)
    .map((repo) => mapRepoToProject(repo, overrides[repo.full_name] || overrides[repo.name] || {}));

  const nextData = {
    ...current,
    meta: {
      ...current.meta,
      lastUpdated: new Date().toISOString().slice(0, 10)
    },
    github: {
      ...current.github,
      githubAccounts: accounts,
      featuredRepos
    },
    activeProjects: sorted.length ? sorted : current.activeProjects
  };

  await fs.writeFile(DATA_PATH, `${JSON.stringify(nextData, null, 2)}\n`, 'utf8');
  console.log(`Sincronizados ${sorted.length} proyectos activos en data/active-projects.json`);
}

main().catch((err) => {
  console.error('Error sincronizando proyectos:', err.message);
  process.exit(1);
});
