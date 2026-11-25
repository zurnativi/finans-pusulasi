/* migrate.js — v8.7.2: tek seferlik yerleşik düzenlemeler. Uygulama HER cihazda açılınca (arka plan izleme kurulu olmasa da) çalışır:
 * numara bu cihazda daha önce uygulanmadıysa şifreli düzenlemeyi market-data dalından alır, açar, önce otomatik kopya alır, sonra uygular ("Geri al"lı bildirim)
 * ve numarayı kaydeder; bir daha çalışmaz. Uzaktan düzenleme kutusu aynı numarayı uyguladıysa atlanır (ve tersi).
 * Gizlilik notu: düzenleme dosyası şifreli (AES-256-GCM) ama anahtar bu dosyada — yani kodu okuyan biri açabilir; amaç parola sormadan her cihazda çalışmak.
 * İçerik yalnız sembol, adet, fiyat, tarih (kişisel kimlik bilgisi yok). Dosya market-data dalında (tek commit'lik, geçmişi tutulmayan dal); iş bitince silinir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./inbox.js'));
  else root.Migrate = factory(root.Inbox);
})(typeof self !== 'undefined' ? self : this, function (IB) {
  'use strict';
  var ITEMS = [{ id: 'midas-only-2026-11-25', path: 'bg/tek-seferlik-1.enc.json', key: 'bnJ-OnUNWcPxDoilOH-ofeObFK-pARYtdJTVZ9Fqm0s' }];
  var LS = 'finans-pusulasi:tek-seferlik:', RAW = 'https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/';
  var locks = {};

  /* Saf: yeni durumu üretir (girdi değişmez). Örnek/boş veri varsa örnek bütçe de bırakılmaz: boş durum + düzenleme. */
  function prepare(state, edit, S, ym, uid) {
    var example = !state || !!state.isExample, base;
    if (example) { base = S.emptyState(ym); base.isExample = false; if (state && state.settings && state.settings.view) base.settings.view = state.settings.view; }
    else base = JSON.parse(JSON.stringify(state));
    var lines = IB.apply(base, edit, uid || S.uid);
    if (example) lines.unshift('Örnek veri kaldırıldı');
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
    function runItem(item) {
      if (busy[item.id] || isDone(item.id) || !X.state()) return Promise.resolve(null);
      busy[item.id] = true;
      return inboxDone(item.id).then(function (d) {
        if (d) { lsSet(LS + item.id, JSON.stringify({ at: new Date().toISOString(), via: 'inbox' })); return null; }
        return fetch(RAW + item.path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (env) { return BG.open(BG.unb64u(item.key), env); })
          .then(function (edit) {
            if (!edit || edit.id !== item.id) throw new Error('numara uyuşmuyor');
            var errs = IB.errors(edit); if (errs.length) throw new Error(errs[0]);
            if (isDone(item.id)) return null;
            var title = String(edit.title || 'Tek seferlik düzenleme').slice(0, 120), pv;
            try { pv = prepare(X.state(), edit, S, ym(), function () { return 'p' + Math.random().toString(36).slice(2); }); } catch (e) { X.toast(title + ' uygulanamadı: ' + e.message); return null; }
            locks[item.id] = true;
            return Promise.resolve(X.snapshot ? X.snapshot('Tek seferlik düzenleme öncesi: ' + title) : null).catch(function () { return null; }).then(function () {
              var lines = null;
              var ok = X.mutate(function (s) { var r = prepare(s, edit, S, ym(), X.uid || S.uid); lines = r.lines; Object.keys(s).forEach(function (k) { delete s[k]; }); Object.assign(s, r.state); },
                '✓ ' + title + ' uygulandı — ' + pv.lines.join(' · ') + '. Önce otomatik kopya alındı.');
              if (!ok) return null;
              var at = new Date().toISOString();
              lsSet(LS + item.id, JSON.stringify({ at: at, via: 'site' }));
              return record({ id: item.id, at: at, ok: true, lines: (lines || pv.lines).concat(['(yerleşik tek seferlik düzenleme)']), ver: IB.APP_VERSION }).then(function () { return true; });
            }).then(function (x) { locks[item.id] = false; return x; }, function (e) { locks[item.id] = false; throw e; });
          });
      }).catch(function (e) { console.warn('tek seferlik düzenleme bekliyor:', e && e.message); return null; }).then(function (x) { busy[item.id] = false; return x; });
    }
    function runAll() { return ITEMS.reduce(function (p, it) { return p.then(function () { return runItem(it); }); }, Promise.resolve()); }
    setTimeout(runAll, 1200);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden) runAll(); });
    return { runAll: runAll };
  }
  return { ITEMS: ITEMS, LS: LS, RAW: RAW, prepare: prepare, isDone: isDone, locked: locked, start: start };
});
