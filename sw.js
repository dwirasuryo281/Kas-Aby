/* KAS ABY · Service worker
 * Naikkan VERSION setiap kali file aplikasi diubah, supaya HP mengambil versi baru. */
const VERSION = 'kas-aby-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // API Google Apps Script: selalu langsung ke jaringan, jangan disimpan
  if (req.method !== 'GET' || url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Halaman: coba jaringan dulu, kalau offline pakai simpanan
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put('./index.html', c)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }

  // File statis, font, Chart.js: pakai simpanan, perbarui di belakang
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
