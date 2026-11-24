/* sw.js — Finans Pusulası çevrimdışı uygulama kabuğu.
 * - Sürümlü önbellek: VERSION değişince eski önbellek silinir.
 * - Sayfa (navigasyon): önce ağ, ağ yoksa önbellekteki index.html (çevrimdışı açılır).
 * - Uygulamanın kendi dosyaları (?v= sürümlü): önce önbellek, yoksa ağdan alınıp önbelleğe eklenir.
 * - Başka sitelere giden istekler (fiyat kaynakları, yapay zekâ, GitHub) HİÇ önbelleğe alınmaz, dokunulmaz.
 * - Yeni sürüm kendiliğinden devreye girmez; sayfa "Yeni sürüm hazır" der, kullanıcı onaylayınca geçilir.
 * Kapsam: dosyanın bulunduğu klasör (GitHub Pages alt yolu /finans-pusulasi/ dahil) — tüm yollar göreli.
 */
var VERSION = '8.5.0';
var CACHE = 'fp-shell-' + VERSION;
var Q = '?v=' + VERSION;
var SHELL = ['./', 'index.html', 'css/style.css' + Q, 'vendor/echarts.min.js'].concat(
  ['money', 'calc', 'ledger', 'importparse', 'portfolio', 'prices', 'alerts', 'stops', 'sessions', 'sample', 'cryptobox', 'syncmerge', 'sync', 'lock', 'store', 'ai', 'chartdata', 'charts', 'ta', 'structure', 'mdata', 'analysis', 'snapshot', 'labellayout', 'tachart', 'portfolio-ui', 'analysis-ui', 'security-ui', 'personal', 'autoprice', 'history', 'newsrules', 'news', 'events', 'notify', 'mood', 'freshness', 'hubdata', 'bgwatch', 'bgwatch-ui', 'report', 'reports-ui', 'hub-ui', 'app']
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

/* ---------- v8.1: arka planda yenileme (EN İYİ ÇABA) ----------
 * Periodic Background Sync yalnızca Chrome/Edge (Android, uygulama ana ekrana yüklüyse, site "etkileşim" almışsa)
 * ve tarayıcının kendi seçtiği aralıkta çalışır; garanti YOKTUR. Güvenilir yol: iş akışından ntfy bildirimi.
 * Gizlilik: yalnızca izleme anahtarları (örn. bist:ASELS) bu cihazın SW önbelleğinde tutulur; hiçbir yere gönderilmez.
 * Bildirimler yalnızca zaten herkese açık market-data/hub/alerts.json içeriğinden üretilir. */
var BG = 'fp-bg';
function bgGet(name) { return caches.open(BG).then(function (c) { return c.match(name); }).then(function (r) { return r ? r.json() : null; }).catch(function () { return null; }); }
function bgPut(name, obj) { return caches.open(BG).then(function (c) { return c.put(name, new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } })); }); }
self.addEventListener('message', function (e) {
  var d = e.data;
  if (d && d.type === 'FP_WATCH' && Array.isArray(d.keys)) e.waitUntil(bgPut('watch', { keys: d.keys.slice(0, 60).map(String), base: String(d.base || ''), at: Date.now() }));
});
function bgRefresh() {
  return bgGet('watch').then(function (w) {
    if (!w || !/^https:\/\/raw\.githubusercontent\.com\//.test(w.base)) return null;
    var keys = w.keys || [];
    return Promise.all([fetch(w.base + 'hub/alerts.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }), bgGet('seen')]).then(function (a) {
      var j = a[0], seen = (a[1] && a[1].ids) || [], items = (j && j.items) || [], fresh = [];
      items.forEach(function (x) {
        if (!x || !x.id || seen.indexOf(x.id) >= 0) return;
        var mine = (x.assets || []).some(function (as) { return keys.some(function (k) { return k === as || k.split(':').pop() === String(as).split(':').pop(); }); });
        if ((x.sev === 'critical' && !(x.assets || []).length) || ((x.sev === 'critical' || x.sev === 'high') && mine)) fresh.push(x);
      });
      var isFirst = !(a[1] && a[1].ids);
      var ids = seen.concat(items.map(function (x) { return x && x.id; }).filter(Boolean)).slice(-300);
      return bgPut('seen', { ids: ids, at: Date.now() }).then(function () {
        if (isFirst) return null; // ilk çalışmada eski uyarılar için bildirim yağdırma
        return Promise.all(fresh.slice(0, 3).map(function (x) {
          return self.registration.showNotification((x.sev === 'critical' ? '🚨 ' : '⚠️ ') + x.title, { body: String(x.body || '').slice(0, 180) + '\n(Finans Pusulası — arka plan kontrolü, en iyi çaba)', tag: 'fp-' + x.id, data: { url: './#haberler' } });
        }));
      });
    });
  }).catch(function () { return null; });
}
self.addEventListener('periodicsync', function (e) { if (e.tag === 'fp-refresh') e.waitUntil(bgRefresh()); });
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) { for (var i = 0; i < cs.length; i++) { if ('focus' in cs[i]) return cs[i].focus(); } return self.clients.openWindow(u); }));
});
