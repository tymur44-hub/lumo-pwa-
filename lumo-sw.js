// Служба уведомлений Lumo: показывает push и открывает нужный чат по нажатию
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { title: 'Lumo', body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'Lumo';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Новое сообщение',
    tag: d.tag || undefined,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    renotify: !!d.tag,
    requireInteraction: !!d.call,
    data: { chat: d.chat || null, call: !!d.call },
  }));
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
