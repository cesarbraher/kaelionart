const CACHE_PREFIX = 'kaelion-public-';
const CACHE_NAME = CACHE_PREFIX + 'v2';
const scope = self.registration.scope;
const PRIVATE_PATH_RE = /^\/(?:api|portal|admin)(?:\/|$)/;

const pages = new Map([
  ['./', './'],
  ['index.html', './'],
  ['en/', 'en/'],
  ['en/index.html', 'en/'],
].map(([path, canonical]) => [new URL(path, scope).pathname, new URL(canonical, scope).href]));

const assets = new Set([
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/gallery.js',
  'js/github-projects.js',
  'js/register-pwa.js',
  'data/portfolio.json',
  'data/active-projects.json',
  'assets/brand/emblema.png',
  'assets/brand/logo-claro.png',
  'assets/brand/logo-oscuro.png',
  'assets/brand/icon-192.png',
  'assets/brand/icon-512.png',
  'assets/gallery/hero-atelier.jpg',
].map((path) => new URL(path, scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll([...new Set(pages.values()), ...assets])
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) =>
    Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
  ));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('Range') || request.headers.has('Authorization')) return;

  const url = new URL(request.url);
  if (url.origin !== new URL(scope).origin || url.search) return;
  if (PRIVATE_PATH_RE.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    const fallback = pages.get(url.pathname);
    if (!fallback) return;

    event.respondWith(fetch(request).catch(async () => (await caches.match(fallback, {
      cacheName: CACHE_NAME,
    })) || Response.error()));
    return;
  }

  if (assets.has(url.href)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(url.href, {
      cacheName: CACHE_NAME,
    })) || Response.error()));
  }
});
