// INSTINTO POS — Service Worker v5
// Cachea el app shell completo para funcionar sin conexión
const CACHE = 'instinto-pos-v7';
const SHELL = [
  '/',
  '/index.html',
  '/cocina.html',
  '/turnos.html',
  '/reportes.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network-first; convierte respuestas HTML de error a JSON válido (B26)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const ct = resp.headers.get('content-type') || '';
        // Vercel puede devolver HTML en errores 500 — convertir a JSON para no romper parseJSON
        if (!resp.ok && !ct.includes('application/json')) {
          return new Response(
            JSON.stringify({ error: 'server_error', status: resp.status }),
            { status: resp.status, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return resp;
      }).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline' }),
          { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Navegación (HTML): network-first con fallback a cache (B25)
  // Deploy nuevo llega en la primera recarga — ya no se necesitan 2 recargas
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() =>
          cache.match(e.request).then(cached => cached || caches.match('/index.html'))
        )
      )
    );
    return;
  }

  // Demás assets estáticos: cache primero, red como fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
