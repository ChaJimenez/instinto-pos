// INSTINTO POS — Service Worker v4
// Cachea el app shell completo para funcionar sin conexión
const CACHE = 'instinto-pos-v6';
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

  // Llamadas a la API: red primero, fallback JSON vacío (no cachear)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline' }),
          { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Navegación (HTML): cache primero (responde inmediato) + actualiza en background.
  // NOTA: un deploy nuevo tarda 1 recarga en llegar — primera carga sirve cache viejo,
  // segunda ya tiene el HTML actualizado. Comportamiento esperado, no bug.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request).then(resp => {
            if (resp.ok) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => cached || caches.match('/index.html'));
          return cached || networkFetch;
        })
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
