/* migrate.js — tek seferlik yerleşik düzenlemeler. Uygulama HER cihazda açılınca (arka plan izleme kurulu olmasa da) çalışır;
 * numara bu cihazda daha önce uygulanmadıysa şifreli düzenlemeyi market-data dalından alır, açar ve bir kez uygular.
 * v8.7.2: midas-only-2026-11-25 (varlıkları temizle + Midas; bütçe durur, Geri al'lı).
 * v8.7.3: sifirdan-midas-2026-11-25 — kullanıcının açık isteğiyle TAM SIFIRLAMA: bütçe dahil tüm finansal veri, değişiklik geçmişi, anlık görüntüler ve eski yedek
 *   kayıtları silinir; yalnız Midas geçmişi yüklenir. Uygulama ayarları (görünüm, bildirim ayarları), kilit ve arka plan izleme yapılandırması durur.
 *   Görünmez tek güvenlik kopyası (şifreli sır deposunda) 24 saat sonra kendiliğinden silinir. v8.7.2'yi uygulamış cihazlarda da çalışır.
 * v8.7.4: sifirdan-midas-v2-2026-11-25 — aynı tam sıfırlama, düzeltilmiş Midas tarihleriyle (zarar durdur/limit satışlarının ve fon alımlarının gerçekleşme
 *   günü, DRVN yılı). v8.7.3'ü uygulamış cihazlarda da çalışır. Gizli güvenlik kopyası zaten varsa (ilk sıfırlamadan, 24 saat dolmadıysa) üzerine yazılmaz:
 *   asıl sıfırlama öncesi hâl korunur.
 * Gizlilik notu: düzenleme dosyası şifreli (AES-256-GCM) ama anahtar bu dosyada — kodu okuyan biri açabilir; amaç parola sormadan her cihazda çalışmak.
 * İçerik yalnız sembol, adet, fiyat, tarih. Dosya market-data dalında (tek commit'lik, geçmişi tutulmayan dal); iş bitince silinir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./inbox.js'));
  else root.Migrate = factory(root.Inbox);
})(typeof self !== 'undefined' ? self : this, function (IB) {
  'use strict';
  var KEY2 = 'eukDC4P-i9bPdsggjZ99cWf8wV7b9CeJX7IWgQOwjDw';
  var ITEMS = [{ id: 'sifirdan-midas-v2-2026-11-25', path: 'bg/tek-seferlik-2.enc.json', key: KEY2, editId: 'midas-sifirdan-v2-2026-11-25', reset: true, supersedes: ['sifirdan-midas-2026-11-25', 'midas-only-2026-11-25'] }];
  var LS = 'finans-pusulasi:tek-seferlik:', RAW = 'https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/';
  var SAFETY = 'sifirlama-oncesi-kopya', SAFETY_MS = 24 * 3600000;
  var OLD_LS = /^finans-pusulasi:(v\d+-oncesi-yedek|okunamayan-kayit-\d+)$/;
  var locks = {};

  /* Saf: yeni durumu üretir (girdi değişmez).
   * reset=false: örnek/boş veride boş durumdan başlar, gerçek veride düzenleme olduğu gibi uygulanır (bütçe durur).
   * reset=true: her zaman boş durumdan başlar; yalnız uygulama ayarları (settings, notifSettings) taşınır. */
  function prepare(state, edit, S, ym, uid, reset) {
    var example = !state || !!state.isExample, base, lines;
    if (reset || example) {
      base = S.emptyState(ym); base.isExample = false;
      if (state && state.settings && typeof state.settings === 'object') { if (reset && !example) base.settings = JSON.parse(JSON.stringify(state.settings)); else if (state.settings.view) base.settings.view = state.settings.view; }
      if (reset && !example && state && state.notifSettings) base.notifSettings = JSON.parse(JSON.stringify(state.notifSettings));
    } else base = JSON.parse(JSON.stringify(state));
    lines = IB.apply(base, edit, uid || S.uid);
    if (reset) lines = ['Tüm veriler silindi (bütçe, varlıklar, alım-satımlar, geçmiş)'].concat(lines.filter(function (l) { return !/^Tüm varlıklar temizlendi/.test(l); }));
    else if (example) lines.unshift('Örnek veri kaldırıldı');
    return { state: base, lines: lines, fromExample: example };
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  function isDone(id) { return !!lsGet(LS + id); }
  function locked(id) { return !!locks[id]; }
  function ym() { return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7); }

  function start(X) {
    var W = typeof window !== 'undefined' ? window : {}, BG = W.BgWatch, S = W.Sample, Store = W.Store, busy = {};
    if (!BG || !S || !IB) return;
    function inboxDone(id) { return Store && Store.getSecret ? Store.getSecret('bgwatch-inbox').then(function (r) { return !!(r && Array.isArray(r.applied) && r.applied.some(function (a) { return a && a.id === id && a.ok; })); }, function () { return false; }) : Promise.resolve(false); }
    function record(rec) {
      var api = W.BgUI && W.BgUI.instance;
      if (api && api.recordExternal) return api.recordExternal(rec);
      if (!Store || !Store.getSecret) return Promise.resolve();
      return Store.getSecret('bgwatch-inbox').catch(function () { return null; }).then(function (r) { var l = IB.record(r && r.applied, rec); return Store.setSecret('bgwatch-inbox', { applied: l }); }).catch(function () { });
    }
    /* Görünmez güvenlik kopyası: 24 saat sonra silinir (her açılışta ve sayfa açık kaldıkça denetlenir). */
    function safetyCleanup() {
      if (!Store || !Store.getSecret) return Promise.resolve();
      return Store.getSecret(SAFETY).then(function (c) {
        if (!c) return; var age = Date.now() - Date.parse(c.at || 0);
        if (!(age < SAFETY_MS)) return Store.setSecret(SAFETY, null);
        setTimeout(safetyCleanup, Math.min(SAFETY_MS - age + 1000, 6 * 3600000));
      }).catch(function () { });
    }
    function wipeLeftovers() { // anlık görüntüler, eski sürüm yedekleri, arka plan sonuç önbelleği
      var jobs = [];
      if (Store && Store.listSnapshots) jobs.push(Store.listSnapshots().then(function (l) { return Promise.all(l.map(function (r) { return Store.deleteSnapshot(r.id); })); }).catch(function () { }));
      try { Object.keys(localStorage).forEach(function (k) { if (OLD_LS.test(k)) localStorage.removeItem(k); }); } catch (e) { /* */ }
      if (Store && Store.setSecret) jobs.push(Store.setSecret('bgwatch-res', null).catch(function () { }));
      return Promise.all(jobs);
    }
    function runItem(item) {
      if (busy[item.id] || isDone(item.id) || !X.state()) return Promise.resolve(null);
      if (item.reset && !X.resetAll) return Promise.resolve(null);
      busy[item.id] = true;
      return inboxDone(item.id).then(function (d) {
        if (d) { lsSet(LS + item.id, JSON.stringify({ at: new Date().toISOString(), via: 'inbox' })); return null; }
        return fetch(RAW + item.path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (env) { return BG.open(BG.unb64u(item.key), env); })
          .then(function (edit) {
            if (!edit || edit.id !== (item.editId || item.id)) throw new Error('numara uyuşmuyor');
            var errs = IB.errors(edit); if (errs.length) throw new Error(errs[0]);
            if (isDone(item.id)) return null;
            var title = String(edit.title || 'Tek seferlik düzenleme').slice(0, 120), pv, tmp = function () { return 'p' + Math.random().toString(36).slice(2); };
            try { pv = prepare(X.state(), edit, S, ym(), tmp, item.reset); } catch (e) { X.toast(title + ' uygulanamadı: ' + e.message); return null; }
            locks[item.id] = true; (item.supersedes || []).forEach(function (s) { locks[s] = true; });
            var before = X.state(), at = new Date().toISOString();
            var pre = item.reset ? (Store && Store.setSecret ? Store.getSecret(SAFETY).catch(function () { return null; }).then(function (old) { if (old && old.state && Date.now() - Date.parse(old.at || 0) < SAFETY_MS) return null; return Store.setSecret(SAFETY, { at: at, reason: item.id, state: JSON.parse(JSON.stringify(before)) }); }).catch(function () { return null; }) : Promise.resolve())
              : Promise.resolve(X.snapshot ? X.snapshot('Tek seferlik düzenleme öncesi: ' + title) : null).catch(function () { return null; });
            return pre.then(function () {
              var r = prepare(X.state(), edit, S, ym(), X.uid || S.uid, item.reset), ok;
              if (item.reset) ok = X.resetAll(r.state, '✓ Sıfırdan yüklendi — ' + r.lines.join(' · ') + '.');
              else ok = X.mutate(function (s) { Object.keys(s).forEach(function (k) { delete s[k]; }); Object.assign(s, r.state); }, '✓ ' + title + ' uygulandı — ' + pv.lines.join(' · ') + '. Önce otomatik kopya alındı.');
              if (!ok) return null;
              lsSet(LS + item.id, JSON.stringify({ at: at, via: 'site' }));
              (item.supersedes || []).forEach(function (s) { lsSet(LS + s, JSON.stringify({ at: at, via: item.id })); });
              return (item.reset ? wipeLeftovers() : Promise.resolve()).then(function () {
                return record({ id: item.id, at: at, ok: true, lines: r.lines.concat(['(yerleşik tek seferlik düzenleme)']), ver: IB.APP_VERSION });
              }).then(function () { if (item.reset) safetyCleanup(); return true; });
            }).then(function (x) { locks[item.id] = false; (item.supersedes || []).forEach(function (s) { locks[s] = false; }); return x; },
              function (e) { locks[item.id] = false; (item.supersedes || []).forEach(function (s) { locks[s] = false; }); throw e; });
          });
      }).catch(function (e) { console.warn('tek seferlik düzenleme bekliyor:', e && e.message); return null; }).then(function (x) { busy[item.id] = false; return x; });
    }
    function runAll() { return ITEMS.reduce(function (p, it) { return p.then(function () { return runItem(it); }); }, Promise.resolve()); }
    safetyCleanup();
    setTimeout(runAll, 1200);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden) runAll(); });
    return { runAll: runAll };
  }
  return { ITEMS: ITEMS, LS: LS, RAW: RAW, SAFETY: SAFETY, SAFETY_MS: SAFETY_MS, prepare: prepare, isDone: isDone, locked: locked, start: start };
});
