/* syncmerge.js — Cihazlar arası eşitleme için saf birleştirme mantığı (testli, ağ yok).
 * Her kayıt bir "birim"dir (ör. "transactions:<id>", "limits:Market", "settings"). Her kayıtta değişince
 * _sync.stamps[birim] = zaman (ms) yazılır; silinince _sync.tomb[birim] = zaman (silme izi) bırakılır.
 * Birleştirme: iki tarafta da değişmeyen aynen kalır; yalnız bir tarafta değişen o taraftan alınır;
 * iki tarafta da son eşitlemeden sonra farklı değişen kayıt ÇAKIŞMA olur: yenisi kazanır, diğeri kaybolmaz,
 * çakışma listesinde saklanır ve kullanıcıya gösterilir. Silme ile değiştirme çakışırsa kayıt korunur. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LISTS = ['incomes', 'expenses', 'assets', 'debts', 'transactions', 'accounts', 'transfers', 'recurring', 'installments', 'sinkingFunds', 'trades', 'goals'];
  var MAPS = ['rates', 'limits', 'prices'];
  var SKIP = { schema: 1, updatedAt: 1, _sync: 1, migratedFrom: 1, nwHistory: 1, cpi: 1, settings: 1 };
  var LABELS = { incomes: 'Gelir', expenses: 'Gider', assets: 'Varlık', debts: 'Borç', transactions: 'İşlem', accounts: 'Hesap', transfers: 'Transfer', recurring: 'Düzenli ödeme',
    installments: 'Taksit', sinkingFunds: 'Yıllık gider', trades: 'Alım-satım', goals: 'Hedef', rates: 'Kur', limits: 'Harcama sınırı', prices: 'Fiyat serisi', cpi: 'TÜFE', settings: 'Ayarlar', top: 'Genel bilgi' };
  var TOMB_KEEP_MS = 400 * 86400000;

  function stable(v) { // anahtar sırasından bağımsız JSON (karşılaştırma için)
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  /* Karşılaştırmaya giren kısım: türetilen alanlar (alım-satımla izlenen varlığın değeri) ve cihaza özel görünüm hariç */
  function cmpVal(coll, rec) {
    if (coll === 'assets' && rec && rec.tracking === 'trades') { var c = {}; Object.keys(rec).forEach(function (k) { if (k !== 'value' && k !== 'valueBasis') c[k] = rec[k]; }); return c; }
    if (coll === 'settings' && rec) { var s = {}; Object.keys(rec).forEach(function (k) { if (k !== 'view') s[k] = rec[k]; }); return s; }
    return rec;
  }
  function units(state) {
    var u = {};
    function put(coll, id, rec) { u[coll + ':' + id] = { coll: coll, id: id, rec: rec, cmp: stable(cmpVal(coll, rec)) }; }
    if (!state) return u;
    LISTS.forEach(function (c) { (state[c] || []).forEach(function (r, i) { put(c, r && r.id != null ? String(r.id) : '#' + i, r); }); });
    MAPS.forEach(function (c) { var m = state[c] || {}; Object.keys(m).forEach(function (k) { put(c, k, m[k]); }); });
    (state.cpi || []).forEach(function (r) { if (r && r.ym) put('cpi', r.ym, r); });
    if (state.settings) u.settings = { coll: 'settings', id: '', rec: state.settings, cmp: stable(cmpVal('settings', state.settings)) };
    Object.keys(state).forEach(function (k) { if (!SKIP[k] && LISTS.indexOf(k) < 0 && MAPS.indexOf(k) < 0) put('top', k, state[k]); });
    return u;
  }
  function meta(state) { var m = state && state._sync; return { stamps: (m && m.stamps) || {}, tomb: (m && m.tomb) || {} }; }

  /* Kayıttan sonra çağrılır: prev (önceki kayıtlı hâl) ile next arasındaki farkları zaman damgasıyla işaretler. */
  function stamp(prev, next, nowMs) {
    if (!next) return 0;
    if (!next._sync || typeof next._sync !== 'object') next._sync = { stamps: {}, tomb: {} };
    if (!next._sync.stamps) next._sync.stamps = {}; if (!next._sync.tomb) next._sync.tomb = {};
    if (!prev) return 0;
    var a = units(prev), b = units(next), st = next._sync.stamps, tb = next._sync.tomb, n = 0;
    Object.keys(b).forEach(function (k) { if (!a[k] || a[k].cmp !== b[k].cmp) { st[k] = nowMs; delete tb[k]; n++; } });
    Object.keys(a).forEach(function (k) { if (!b[k]) { tb[k] = nowMs; delete st[k]; n++; } });
    Object.keys(st).forEach(function (k) { if (!b[k]) delete st[k]; });
    Object.keys(tb).forEach(function (k) { if (nowMs - tb[k] > TOMB_KEEP_MS) delete tb[k]; });
    return n;
  }

  function labelOf(un) {
    var r = un.rec || {}, coll = un.coll, name = r.name || r.description || r.title || (coll === 'trades' ? (r.side || '') + ' ' + (r.date || '') : '') || (coll === 'top' || coll === 'rates' || coll === 'limits' || coll === 'prices' || coll === 'cpi' ? un.id : '');
    return (LABELS[coll] || coll) + (name ? ': ' + String(name).slice(0, 60) : '') + (r.date && coll !== 'trades' ? ' (' + r.date + ')' : '');
  }
  function mergePoints(lp, rp, preferRemote) {
    var by = {};
    (lp || []).forEach(function (p) { by[p.d] = p; });
    (rp || []).forEach(function (p) { if (!by[p.d] || preferRemote) by[p.d] = p; });
    return Object.keys(by).sort().map(function (d) { return by[d]; });
  }

  /* local, remote: tam durumlar. baseMs: bu cihazın son başarılı eşitleme zamanı (ms, ilk eşitlemede 0). nowMs: bu eşitlemenin zamanı.
   * Dönüş: { state, conflicts:[{key,label,kept:'local'|'remote',reason,local,remote}], changedLocal, needPush, stats } */
  function merge(local, remote, baseMs, nowMs) {
    baseMs = baseMs || 0;
    var LU = units(local), RU = units(remote), Lm = meta(local), Rm = meta(remote);
    var keys = {}; [LU, RU, Lm.tomb, Rm.tomb].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
    var out = {}, stamps = {}, tomb = {}, conflicts = [], stats = { fromRemote: 0, deletedByRemote: 0, conflicts: 0 };
    Object.keys(keys).forEach(function (k) {
      var l = LU[k], r = RU[k], ls = Lm.stamps[k] || 0, rs = Rm.stamps[k] || 0, lt = Lm.tomb[k] || 0, rt = Rm.tomb[k] || 0;
      if (l && r) {
        stamps[k] = Math.max(ls, rs);
        if (l.cmp === r.cmp) { out[k] = l; return; }
        if (l.coll === 'prices') { // fiyat serisi: noktalar birleşir (aynı günde yeni olan taraf)
          var rec = clone(l.rec); rec.points = mergePoints(l.rec && l.rec.points, r.rec && r.rec.points, rs > ls);
          out[k] = { coll: 'prices', id: l.id, rec: rec, cmp: stable(rec) }; return;
        }
        var lch = ls > baseMs, rch = rs > baseMs, win;
        if (lch && !rch) win = 'local';
        else if (rch && !lch) win = 'remote';
        else {
          win = rs > ls ? 'remote' : 'local';
          // kazanan sürüm yeni bir değişiklik sayılır: diğer cihazlar onu sessizce alır (kaybeden sürüm bu cihazın çakışma listesinde durur)
          if (nowMs) stamps[k] = Math.max(stamps[k], nowMs);
          conflicts.push({ key: k, label: labelOf(l), kept: win, reason: lch ? 'İki cihazda da değiştirildi' : 'İki cihazda farklı (eşitleme geçmişi yok)', local: clone(l.rec), remote: clone(r.rec) });
        }
        out[k] = win === 'local' ? l : r; if (win === 'remote') stats.fromRemote++;
        return;
      }
      if (l && !r) {
        if (rt) {
          if (ls > baseMs && rt > baseMs) { out[k] = l; stamps[k] = Math.max(ls, nowMs || 0); conflicts.push({ key: k, label: labelOf(l), kept: 'local', reason: 'Diğer cihazda silinmiş, bu cihazda değiştirilmiş — korundu', local: clone(l.rec), remote: null }); return; }
          if (ls > rt) { out[k] = l; stamps[k] = ls; return; }
          tomb[k] = Math.max(rt, lt); stats.deletedByRemote++; return;
        }
        out[k] = l; if (ls) stamps[k] = ls; return;
      }
      if (r && !l) {
        if (lt) {
          if (rs > baseMs && lt > baseMs) { out[k] = r; stamps[k] = Math.max(rs, nowMs || 0); stats.fromRemote++; conflicts.push({ key: k, label: labelOf(r), kept: 'remote', reason: 'Bu cihazda silinmiş, diğer cihazda değiştirilmiş — geri getirildi', local: null, remote: clone(r.rec) }); return; }
          if (rs > lt) { out[k] = r; stamps[k] = rs; stats.fromRemote++; return; }
          tomb[k] = Math.max(rt, lt); return;
        }
        out[k] = r; if (rs) stamps[k] = rs; stats.fromRemote++; return;
      }
      tomb[k] = Math.max(lt, rt);
    });
    stats.conflicts = conflicts.length;
    var st = rebuild(local, remote, out);
    st._sync = { stamps: stamps, tomb: tomb };
    var MU = units(st);
    var changedLocal = !sameUnits(MU, LU), needPush = !sameUnits(MU, RU) || stable(tomb) !== stable(Rm.tomb);
    return { state: st, conflicts: conflicts, changedLocal: changedLocal, needPush: needPush, stats: stats };
  }
  function sameUnits(a, b) { var ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false; return ka.every(function (k) { return b[k] && a[k].cmp === b[k].cmp; }); }
  function rebuild(local, remote, out) {
    var st = clone(local);
    LISTS.forEach(function (c) {
      var arr = [], seen = {};
      function take(list) { (list || []).forEach(function (r, i) { var k = c + ':' + (r && r.id != null ? String(r.id) : '#' + i); if (seen[k] || !out[k]) return; seen[k] = 1; arr.push(clone(out[k].rec)); }); }
      take(local[c]); take(remote[c]);
      if (local[c] || remote[c] || arr.length) st[c] = arr;
    });
    MAPS.forEach(function (c) {
      var m = {}; Object.keys(out).forEach(function (k) { var u = out[k]; if (u.coll === c) m[u.id] = clone(u.rec); });
      if (local[c] || remote[c]) st[c] = m;
    });
    var cpi = []; Object.keys(out).forEach(function (k) { if (out[k].coll === 'cpi') cpi.push(clone(out[k].rec)); });
    cpi.sort(function (a, b) { return a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0; });
    if (local.cpi || remote.cpi) st.cpi = cpi;
    if (out.settings) { var view = local.settings && local.settings.view; st.settings = clone(out.settings.rec); if (view) st.settings.view = view; }
    Object.keys(st).forEach(function (k) { if (!SKIP[k] && LISTS.indexOf(k) < 0 && MAPS.indexOf(k) < 0 && !out['top:' + k]) delete st[k]; });
    Object.keys(out).forEach(function (k) { if (out[k].coll === 'top') st[out[k].id] = clone(out[k].rec); });
    // Net varlık geçmişi: tarih bazında birleşim (aynı günde bu cihazın değeri)
    if (local.nwHistory || remote.nwHistory) { var by = {}; (remote.nwHistory || []).forEach(function (p) { by[p.d] = p; }); (local.nwHistory || []).forEach(function (p) { by[p.d] = p; }); st.nwHistory = Object.keys(by).sort().map(function (d) { return by[d]; }); }
    return st;
  }
  /* Çakışmada "diğer sürümü kullan": kaydı verilen değerle değiştirir (rec null ise siler) */
  function applyVersion(state, key, rec) {
    var i = key.indexOf(':'), coll = i < 0 ? key : key.slice(0, i), id = i < 0 ? '' : key.slice(i + 1);
    if (LISTS.indexOf(coll) >= 0) {
      var list = state[coll] || (state[coll] = []), idx = list.findIndex(function (r) { return r && String(r.id) === id; });
      if (rec == null) { if (idx >= 0) list.splice(idx, 1); } else if (idx >= 0) list[idx] = clone(rec); else list.push(clone(rec));
    } else if (MAPS.indexOf(coll) >= 0) { state[coll] = state[coll] || {}; if (rec == null) delete state[coll][id]; else state[coll][id] = clone(rec); }
    else if (coll === 'cpi') { state.cpi = (state.cpi || []).filter(function (r) { return r.ym !== id; }); if (rec) { state.cpi.push(clone(rec)); state.cpi.sort(function (a, b) { return a.ym < b.ym ? -1 : 1; }); } }
    else if (coll === 'settings') { if (rec) { var v = state.settings && state.settings.view; state.settings = clone(rec); if (v) state.settings.view = v; } }
    else if (coll === 'top') { if (rec == null) delete state[id]; else state[id] = clone(rec); }
    return state;
  }
  /* Bir durumun özet sayıları (kullanıcıya ve anlık görüntü listesine) */
  function counts(s) {
    s = s || {};
    return { islem: (s.transactions || []).length, varlik: (s.assets || []).length, alimSatim: (s.trades || []).length, hesap: (s.accounts || []).length, gelirGider: (s.incomes || []).length + (s.expenses || []).length };
  }
  return { LISTS: LISTS, MAPS: MAPS, LABELS: LABELS, stable: stable, units: units, stamp: stamp, merge: merge, applyVersion: applyVersion, mergePoints: mergePoints, counts: counts, labelOf: labelOf };
});
