/* sw.js — Finans Pusulası çevrimdışı uygulama kabuğu.
 * - Sürümlü önbellek: VERSION değişince eski önbellek silinir.
 * - Sayfa (navigasyon): önce ağ, ağ yoksa önbellekteki index.html (çevrimdışı açılır).
 * - Uygulamanın kendi dosyaları (?v= sürümlü): önce önbellek, yoksa ağdan alınıp önbelleğe eklenir.
 * - Başka sitelere giden istekler (fiyat kaynakları, yapay zekâ, GitHub) HİÇ önbelleğe alınmaz, dokunulmaz.
 * - Yeni sürüm kendiliğinden devreye girmez; sayfa "Yeni sürüm hazır" der, kullanıcı onaylayınca geçilir.
 * Kapsam: dosyanın bulunduğu klasör (GitHub Pages alt yolu /finans-pusulasi/ dahil) — tüm yollar göreli.
 */
var VERSION = '7.0.0';
var CACHE = 'fp-shell-' + VERSION;
var Q = '?v=' + VERSION;
var SHELL = ['./', 'index.html', 'css/style.css' + Q, 'vendor/echarts.min.js'].concat(
  ['money', 'calc', 'ledger', 'importparse', 'portfolio', 'prices', 'sample', 'cryptobox', 'syncmerge', 'sync', 'lock', 'store', 'ai', 'chartdata', 'charts', 'ta', 'structure', 'mdata', 'analysis', 'tachart', 'portfolio-ui', 'analysis-ui', 'security-ui', 'app']
    .map(function (n) { return 'js/' + n + '.js' + Q; }));

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('fp-shell-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION' && e.source) e.source.postMessage({ swVersion: VERSION });
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // dış kaynaklara dokunma
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () { return caches.match('index.html', { ignoreSearch: true }).then(function (r) { return r || caches.match('./'); }); }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // vendor (pdf, ocr, excel kütüphaneleri) ve sürümlü dosyalar ilk kullanımda önbelleğe alınır
        if (res.ok && (url.search.indexOf('v=') >= 0 || url.pathname.indexOf('/vendor/') >= 0)) c.put(req, res.clone());
        return res;
      });
    });
  }));
});
