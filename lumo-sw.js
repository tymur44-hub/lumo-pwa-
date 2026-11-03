// Служба уведомлений Lumo: показывает push и открывает нужный чат по нажатию

// Расшифровка текста уведомления на устройстве: ключ лежит в этом же браузере (IndexedDB), сервер текст не видит
const te = new TextEncoder(), td = new TextDecoder();
const ub64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function idbGet(k) {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('lumo-e2e', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onerror = () => res(null);
      r.onsuccess = () => {
        try { const q = r.result.transaction('k').objectStore('k').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }
        catch (_) { res(null); }
      };
    } catch (_) { res(null); }
  });
}
async function decryptPush(d) {
  const loc = await idbGet('key_' + d.u);
  if (!loc || !d.p || !d.e) return null;
  const pubB = ub64(loc.pub);
  const ec = { name: 'ECDH', namedCurve: 'P-256' };
  const priv = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(pubB.slice(1, 33)), y: b64u(pubB.slice(33, 65)), d: b64u(ub64(loc.d)) }, ec, false, ['deriveBits']);
  const peer = await crypto.subtle.importKey('raw', ub64(d.p), ec, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256);
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(String(d.chat).toLowerCase()), info: te.encode('lumo-e2e-v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const raw = ub64(d.e.slice(5));
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
}

// Офлайн-кэш: оболочка сайта и сам код мессенджера (app13), чтобы чаты открывались без интернета
const SHELL_CACHE = 'lumo-shell-v1';
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => {})))));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function isAppScript(url) {
  return url.pathname === '/functions/v1/lumo' && (url.hostname === 'api.lumomess.ru' || url.hostname.endsWith('.supabase.co'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  const shell = url.origin === self.location.origin;
  const appScript = isAppScript(url);
  if (!shell && !appScript) return; // данные (REST/RPC/медиа) всегда идут в сеть — их кэширует IndexedDB в самом приложении
  // код мессенджера грузится с "?t=..." для обхода кэша браузера — ключ в кэше SW без этого параметра
  const cacheKey = appScript ? url.origin + url.pathname : req;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(cacheKey, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      throw err;
    }
  })());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { title: 'Lumo', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    let body = d.body || 'Новое сообщение';
    if (d.e) { try { const t = await decryptPush(d); if (t) body = t.slice(0, 220); } catch (_) { /* остаётся заглушка */ } }
    await self.registration.showNotification(d.title || 'Lumo', {
      body,
      tag: d.tag || undefined,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      renotify: !!d.tag,
      requireInteraction: !!d.call,
      data: { chat: d.chat || null, call: !!d.call },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chat = event.notification.data && event.notification.data.chat;
  const url = self.registration.scope + (chat ? '?c=' + encodeURIComponent(chat) : '');
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { await c.focus(); if (chat) c.postMessage({ type: 'open-chat', chat }); return; } catch (_) { /* открываем новое окно */ }
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
