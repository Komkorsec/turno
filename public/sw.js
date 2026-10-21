// ─── Turno Service Worker ────────────────────────────────────────────────────
// Strategia:
//  • Navigazione (SPA) → network-first, fallback a /index.html (offline)
//  • Asset statici (JS/CSS/immagini) → cache-first, aggiornamento in background
//  • Chiamate Supabase → sempre network (mai cachate)

const CACHE = 'turno-v2'

// ── Install: prepopola la cache con index.html ──────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.add('/index.html'))
  )
})

// ── Activate: elimina cache vecchie e prende il controllo subito ─────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      ),
    ])
  )
})

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Passa le richieste non-GET senza intercettare
  if (request.method !== 'GET') return

  // Passa le chiamate API Supabase sempre alla rete
  if (url.hostname.includes('supabase.co')) return

  // Ignora protocolli non-http (es. chrome-extension://)
  if (!url.protocol.startsWith('http')) return

  // ── Navigazione (SPA) → network-first + fallback offline ──────────────────
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // ── Asset statici → cache-first + aggiornamento silenzioso ─────────────────
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
      return cached ?? networkFetch
    })
  )
})
