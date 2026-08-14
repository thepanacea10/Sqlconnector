const CACHE_PREFIX = 'teryaq-';
const CACHE_NAME = 'teryaq-app-shell-v4-20260814';
const APP_SHELL = ['/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        message: 'لا يوجد اتصال بالخادم',
        offline: true
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  }
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isStaticAsset(request) {
  return ['script', 'style', 'font', 'image'].includes(request.destination);
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return await cache.match(request) || await cache.match('/') || Response.error();
  }
}

async function staticCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(staticCacheFirst(request));
  }
});
