// 配管勾配計算 Pro Service Worker (v1.0.15)
// 目的: キャッシュバージョンを1.0.15に統一し、旧キャッシュを確実に一掃する。
const CACHE_NAME = 'pipe-slope-calculator-v1.0.15';
const ASSETS = [
  './',
  './index.html',
  './manifest.json?v=1.0.15',
  './icon-192.png?v=1.0.15',
  './icon-512.png?v=1.0.15',
  './favicon.ico?v=1.0.15',
  './apple-touch-icon.png?v=1.0.15',
  './vendor/supabase.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting(); // 待機せず即座に新しいService Workerへ切り替える
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // 旧キャッシュを全削除（現行バージョン以外はすべて消す）
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // 開いている全ページを即座に新SWの管理下へ
  );
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(()=>{});
        }
        return res;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
