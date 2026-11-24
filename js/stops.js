/* stops.js — Zarar durdur (stop) seviyeleri: kurallar, öneri, değerlendirme, uyarı tekrarını önleme ve geçmiş (v8.5). SAF (testli); tarayıcı ve Node aynı kod.
 * ÖNEMLİ: Uygulama emir İLETEMEZ. Midas'ın herkese açık emir API'si yok; otomatik satış ancak Midas'ta aynı seviyeye stop emri girilirse Midas tarafından yapılır.
 * Uygulama seviyeyi izler; yaklaşınca (%3, ayarlanabilir), çok yaklaşınca (%1) ve kırılınca (kritik) bildirir. Tetikleme yalnızca kaynağı/saati bilinen gerçek fiyatla olur.
 * Varlık üzerinde: a.stop = { v, mode:'price'|'close', price, trail:null|{kind:'pct',pct}|{kind:'atr',mult,atr}, approachPct, nearPct, setAt, setPrice, reason, source:'user'|'app', midas }
 * Durum ve geçmiş: state.analysis.stopState { assetId: { sig, level, ep, at, price } } ve state.analysis.stopLog [ { id, assetId, name, level, price, stop, at, src, origin } ] */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Stops = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LEVELS = { ok: 0, approach: 1, near: 2, hit: 3 };
  var LEVEL_TR = { ok: 'Uzakta', approach: 'Yaklaşıyor', near: 'Çok yakın', hit: 'Stop kırıldı', below_intraday: 'Seans içinde altında (kapanış bekleniyor)' };
  var MAX_LOG = 200, HYST = 0.75; // seviye düşüşü için % pay (titreşimde tekrar bildirim olmasın)
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function r4(x) { return num(x) ? Math.round(x * 10000) / 10000 : null; }
  function fmt(x, d) { return num(x) ? x.toFixed(d == null ? 2 : d).replace('.', ',') : '—'; }
  function fmtP(x) { if (!num(x)) return '—'; var d = Math.abs(x) >= 1 ? 2 : 4, s = x.toFixed(d).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1]; }
  function pct(x, d) { return num(x) ? (x * 100).toFixed(d == null ? 1 : d).replace('.', ',') : '—'; }
  function iso(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) ? x.slice(0, 30) : null; }

  /* ---------- Doğrulama / temizleme ---------- */
  function clean(st) {
    if (!st || typeof st !== 'object' || !num(st.price) || st.price <= 0) return null;
    var o = { v: 1, mode: st.mode === 'close' ? 'close' : 'price', price: r4(st.price), trail: null, approachPct: num(st.approachPct) && st.approachPct >= 0.2 && st.approachPct <= 20 ? st.approachPct : 3,
      nearPct: num(st.nearPct) && st.nearPct >= 0.1 && st.nearPct <= 10 ? st.nearPct : 1, setAt: iso(st.setAt) || null, setPrice: num(st.setPrice) && st.setPrice > 0 ? r4(st.setPrice) : null,
      reason: typeof st.reason === 'string' ? st.reason.slice(0, 1000) : '', source: st.source === 'app' ? 'app' : 'user', midas: st.midas === true, active: st.active !== false };
    if (o.nearPct >= o.approachPct) o.nearPct = Math.max(0.1, Math.round(o.approachPct / 3 * 10) / 10);
    var t = st.trail;
    if (t && t.kind === 'pct' && num(t.pct) && t.pct >= 0.5 && t.pct <= 50) o.trail = { kind: 'pct', pct: t.pct };
    else if (t && t.kind === 'atr' && num(t.mult) && t.mult >= 0.5 && t.mult <= 10 && num(t.atr) && t.atr > 0) o.trail = { kind: 'atr', mult: t.mult, atr: r4(t.atr) };
    return o;
  }
  function make(o, nowIso) {
    if (!o || !num(o.price) || o.price <= 0) throw new Error('Stop fiyatı geçersiz');
    if (num(o.refPrice) && o.refPrice > 0 && o.price >= o.refPrice) throw new Error('Stop seviyesi güncel fiyatın (' + fmtP(o.refPrice) + ') altında olmalı');
    var s = clean(Object.assign({}, o, { setAt: nowIso || new Date().toISOString(), setPrice: o.refPrice }));
    if (!s) throw new Error('Stop bilgisi geçersiz');
    return s;
  }
  function sig(st) { return [st.mode, st.price, st.trail ? st.trail.kind + (st.trail.pct || st.trail.mult) : '-', st.setAt || ''].join('|'); }

  /* ---------- İz süren stop: kurulduğundan beri görülen en yüksek kapanış/fiyat ---------- */
  function highSince(bars, setAt, live) {
    var d0 = setAt ? String(setAt).slice(0, 10) : null, h = null;
    (bars || []).forEach(function (b) { if (!b || !num(b.c) || (d0 && b.d < d0)) return; if (h == null || b.c > h) h = b.c; });
    if (live && num(live) && (h == null || live > h)) h = live;
    return h;
  }
  /* Etkin stop seviyesi: sabit seviye, iz süren ise max(sabit, en yüksek − mesafe). Stop asla aşağı inmez. */
  function effective(st, high) {
    if (!st) return null; var lv = st.price, how = 'Sabit seviye';
    if (st.trail && num(high)) {
      var tl = st.trail.kind === 'pct' ? high * (1 - st.trail.pct / 100) : high - st.trail.mult * st.trail.atr;
      if (tl > lv) { lv = tl; how = 'İz süren: en yüksek ' + fmtP(high) + (st.trail.kind === 'pct' ? ' − %' + fmt(st.trail.pct, 1) : ' − ' + fmt(st.trail.mult, 1) + '×ATR'); }
    }
    return { level: r4(lv), how: how };
  }

  /* ---------- Değerlendirme ----------
   * q: { price, at, source, lastClose, lastCloseDate, sessionOpen (bool), today (yerel gün), high } — gerçek fiyat yoksa değerlendirme yapılmaz.
   * Dönüş: { level: ok|approach|near|hit|below_intraday|null, eff, distPct, text } */
  function evaluate(st, q) {
    if (!st || st.active === false) return { level: null, text: 'Stop yok' };
    if (!q || !num(q.price) || q.price <= 0) return { level: null, text: 'Güncel fiyat yok — stop kontrol edilemedi' };
    var e = effective(st, q.high), lv = e.level, p = q.price, dist = (p - lv) / p;
    var level;
    if (st.mode === 'close') {
      var closeKnown = num(q.lastClose) && q.lastCloseDate && (q.lastCloseDate < q.today || !q.sessionOpen);
      if (closeKnown && q.lastClose <= lv && (!st.setAt || q.lastCloseDate >= String(st.setAt).slice(0, 10))) level = 'hit';
      else if (p <= lv) level = 'below_intraday';
      else level = dist * 100 <= st.nearPct ? 'near' : dist * 100 <= st.approachPct ? 'approach' : 'ok';
    } else level = p <= lv ? 'hit' : dist * 100 <= st.nearPct ? 'near' : dist * 100 <= st.approachPct ? 'approach' : 'ok';
    return { level: level, eff: e, distPct: dist, price: p, at: q.at || null, source: q.source || null, text: LEVEL_TR[level] + ' — stop ' + fmtP(lv) + ', fiyat ' + fmtP(p) + ' (uzaklık %' + pct(dist) + ')' };
  }
  function rank(level) { return level === 'below_intraday' ? 2 : (LEVELS[level] || 0); }
  /* Tekrar önleme: yalnızca seviye YÜKSELİNCE olay üretilir. Fiyat eşik + HYST kadar uzaklaşınca seviye düşer (yeniden kurulur). Stop değişirse (sig) sıfırlanır.
   * prev: { sig, level, ep, at } → { state, event|null } */
  function step(prev, st, ev, nowIso) {
    var s = sig(st), cur = prev && prev.sig === s ? Object.assign({}, prev) : { sig: s, level: 'ok', ep: prev && prev.sig === s ? prev.ep : 0, at: null };
    if (!ev || ev.level == null) return { state: cur, event: null };
    var newR = rank(ev.level), oldR = rank(cur.level), event = null;
    if (cur.level === 'hit') { // kırıldıktan sonra kullanıcı stopu değiştirene ya da fiyat belirgin şekilde geri dönene kadar sessiz
      if (ev.level === 'ok' && ev.distPct * 100 > st.approachPct + HYST) { cur.level = 'ok'; cur.ep++; }
      return { state: cur, event: null };
    }
    if (newR > oldR) { cur.level = ev.level; cur.at = nowIso; event = { level: ev.level, price: ev.price, stop: ev.eff.level, distPct: ev.distPct, at: nowIso, src: ev.source || null, ep: cur.ep }; }
    else if (newR < oldR) {
      var need = oldR >= 2 ? st.nearPct + HYST : st.approachPct + HYST;
      if (ev.distPct * 100 > need) { cur.level = ev.level; if (newR === 0) cur.ep++; }
    }
    return { state: cur, event: event };
  }
  function eventId(assetId, st, e) { return 'stop:' + assetId + ':' + hash(sig(st)) + ':' + e.ep + ':' + e.level; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  /* Bildirim adayı (notify.js biçimi). Satış emri dili yok; kırılınca açık talimat: "Midas'ta sat" (kullanıcının kendi kuralı). */
  function notifCand(a, st, e, opts) {
    opts = opts || {}; var name = a.name || a.symbol || 'Varlık', sym = a.symbol || name, gold = a.cls === 'gold', fund = a.cls === 'katilim_fund' || a.cls === 'sukuk';
    var where = gold ? 'Fiziki altını sattığın yerde (kuyumcu/banka) sat' : fund ? 'Fon satış talimatını ver (fonlarda stop emri yoktur)' : 'Midas\'ta sat';
    var base = { cat: 'stop', state: false, href: '#raporlar/stop', assets: [name], at: Date.parse(e.at) || Date.now(), sources: [{ label: e.src || 'Fiyat kaynağı', at: e.at }] };
    var lvTxt = fmtP(e.stop), pTxt = fmtP(e.price), d = pct(e.distPct);
    if (e.level === 'hit') return Object.assign(base, { id: eventId(a.id, st, e), sev: 'critical', title: 'STOP KIRILDI: ' + sym + ' ' + pTxt + ' (stop ' + lvTxt + ') — ' + where,
      body: (st.mode === 'close' ? 'Günlük kapanış stop seviyesinin altında. ' : 'Fiyat stop seviyesine indi/altına geçti. ') + where + '. ' + (st.midas ? 'Midas\'ta stop emri girdiğini işaretlemiştin: emrin gerçekleşip gerçekleşmediğini Midas\'tan kontrol et.' : 'Uygulama emir iletemez; Midas\'ta stop emri yoksa satış otomatik olmaz.') + ' Kendi koyduğun kuraldır (' + (st.reason ? 'gerekçen: ' + st.reason.slice(0, 160) : 'gerekçe yazılmamış') + ').',
      why: ['Senin koyduğun zarar durdur seviyesi: ' + lvTxt + (st.mode === 'close' ? ' (kapanış bazlı)' : ' (fiyat bazlı)'), 'Tetikleyen fiyat: ' + pTxt + ' · ' + (e.src || 'kaynak bilinmiyor')] });
    if (e.level === 'near' || e.level === 'below_intraday') return Object.assign(base, { id: eventId(a.id, st, e), sev: 'high', title: (e.level === 'below_intraday' ? 'Stop altında işlem görüyor: ' : 'Stopa çok yakın (%' + d + '): ') + sym + ' ' + pTxt + ' · stop ' + lvTxt,
      body: e.level === 'below_intraday' ? 'Kapanış bazlı stop: seans içinde seviyenin altında. Kapanış da altında olursa stop kırılmış sayılır. Planını şimdiden hazırla.' : 'Fiyat stop seviyesine %' + st.nearPct + ' mesafenin içine girdi. Midas\'ta stop emrin yoksa ve kuralın geçerliyse hazırlıklı ol.',
      why: ['Çok yakın eşiği: %' + st.nearPct], sources: base.sources });
    return Object.assign(base, { id: eventId(a.id, st, e), sev: 'high', title: 'Stopa yaklaşıyor (%' + d + '): ' + sym + ' ' + pTxt + ' · stop ' + lvTxt, body: 'Fiyat stop seviyene %' + st.approachPct + ' mesafeden daha yakın. Gerekirse planını gözden geçir; satış kararı vermeden önce güncel analizi aç.', why: ['Yaklaşma eşiği: %' + st.approachPct] });
  }
  function logEntry(a, st, e, origin) { return { id: eventId(a.id, st, e), assetId: a.id, name: String(a.name || a.symbol || '').slice(0, 80), level: e.level, price: e.price, stop: e.stop, at: e.at, src: e.src ? String(e.src).slice(0, 80) : null, origin: origin === 'bg' ? 'bg' : 'app' }; }
  function addLog(log, entry) { log = Array.isArray(log) ? log : []; if (log.some(function (x) { return x.id === entry.id; })) return log; log = [entry].concat(log); return log.slice(0, MAX_LOG); }
  function cleanLog(log) { return (Array.isArray(log) ? log : []).filter(function (x) { return x && typeof x.id === 'string' && typeof x.assetId === 'string' && LEVEL_TR[x.level] && num(x.price) && num(x.stop) && iso(x.at); }).slice(0, MAX_LOG).map(function (x) { return { id: x.id.slice(0, 120), assetId: x.assetId.slice(0, 64), name: String(x.name || '').slice(0, 80), level: x.level, price: x.price, stop: x.stop, at: iso(x.at), src: x.src ? String(x.src).slice(0, 80) : null, origin: x.origin === 'bg' ? 'bg' : 'app' }; }); }
  function cleanStateMap(m) { var o = {}; if (!m || typeof m !== 'object') return o; Object.keys(m).slice(0, 200).forEach(function (k) { var v = m[k]; if (v && typeof v.sig === 'string' && (LEVELS[v.level] != null || v.level === 'below_intraday')) o[k.slice(0, 64)] = { sig: v.sig.slice(0, 200), level: v.level, ep: Number.isInteger(v.ep) ? v.ep : 0, at: iso(v.at) }; }); return o; }

  /* ---------- Öneri: yapı (destek bölgesi) ve oynaklık (ATR) ----------
   * snap: snapshot.compact çıktısı (price, structure.zones, ind.atr, plans, closeOnly). Kullanıcı karar verir; öneri kaydedilmez. */
  function rtick(v) { var d = v >= 1 ? 2 : v >= 0.01 ? 4 : 6, k = Math.pow(10, d); return Math.round(v * k) / k; } // fiyat adımına uygun yuvarlama (Midas'a girilebilir)
  function suggest(snap, opts) {
    opts = opts || {}; if (!snap || !num(snap.price) || snap.price <= 0) return { ok: false, why: 'Güncel analiz/fiyat yok; öneri üretilemedi.' };
    if (snap.ind && num(snap.ind.atrPct) && snap.ind.atrPct < 0.003 && snap.kind === 'fund') return { ok: false, why: 'Çok düşük oynaklıklı fon (günlük ortalama hareket %' + pct(snap.ind.atrPct, 2) + '): kira sertifikası/para piyasası türü fonlarda fiyat stopu anlamlı değil; risk takibi için fonun türüne ve getirisine bak.' };
    var p = snap.price, atr = snap.ind && num(snap.ind.atr) && snap.ind.atr > 0 ? snap.ind.atr : null, closeOnly = !!snap.closeOnly, cands = [];
    var zones = (snap.structure && snap.structure.zones || []).filter(function (z) { return z.side === 'destek' && num(z.lo) && z.hi < p; }).sort(function (a, b) { return b.hi - a.hi; });
    var pad = atr ? 0.5 * atr : p * 0.01;
    zones.slice(0, 2).forEach(function (z) {
      var lv = z.lo - pad, d = (p - lv) / p;
      if (d > 0.008 && d < 0.2) cands.push({ price: rtick(lv), method: 'structure', label: 'Destek altı', why: 'En yakın destek bölgesi ' + fmtP(z.lo) + '–' + fmtP(z.hi) + (z.touches ? ' (' + z.touches + ' kez test edildi)' : '') + ' altına ' + (atr ? '0,5×ATR (' + fmtP(pad) + ')' : '%1') + ' pay bırakıldı. Bölge kırılırsa yükseliş yapısı bozulur.', distPct: d, atrMult: atr ? (p - lv) / atr : null });
    });
    var pl = snap.plans && snap.plans.conservative;
    if (pl && num(pl.stop) && pl.stop < p && (p - pl.stop) / p < 0.25 && !cands.some(function (c) { return Math.abs(c.price - pl.stop) / p < 0.003; })) cands.push({ price: rtick(pl.stop), method: 'plan', label: 'Analiz planı', why: 'Portföy Analizi temkinli planındaki zarar-kes seviyesi (' + (pl.how || 'plan') + ').', distPct: (p - pl.stop) / p, atrMult: atr ? (p - pl.stop) / atr : null });
    if (atr) { var m = closeOnly ? 3 : 2.5, lv2 = p - m * atr; if (lv2 > 0) cands.push({ price: rtick(lv2), method: 'atr', label: fmt(m, 1) + '×ATR', why: 'Oynaklığa göre: fiyat − ' + fmt(m, 1) + '×ATR(14) = ' + fmtP(p) + ' − ' + fmtP(m * atr) + '. Günlük normal dalgalanmada tetiklenmemesi için.', distPct: (p - lv2) / p, atrMult: m }); }
    if (!cands.length) return { ok: false, why: 'Fiyatın altında güvenilir destek ve ATR bulunamadı; seviyeyi kendin belirle.' };
    // tercih: 1,5–4 ATR aralığındaki yapı seviyesi; yoksa ATR; yoksa ilk
    var pick = cands.filter(function (c) { return c.method === 'structure' && (!c.atrMult || (c.atrMult >= 1.5 && c.atrMult <= 4)); })[0] || cands.filter(function (c) { return c.method === 'atr'; })[0] || cands[0];
    var mode = closeOnly ? 'close' : 'price';
    var text = 'Önerilen stop ' + fmtP(pick.price) + ' (' + pick.label + ', fiyata %' + pct(pick.distPct) + (pick.atrMult ? ' ≈ ' + fmt(pick.atrMult, 1) + ' ATR' : '') + ' uzak). ' + pick.why +
      (closeOnly ? ' Bu varlıkta günde bir fiyat olduğu için kapanış bazlı kural önerilir.' : '') + ' Bu bir öneridir; seviyeyi sen belirlersin. Kaynak: ' + (snap.source && snap.source.label || 'analiz anlık görüntüsü') + ', ' + (snap.lastDate || '') + '.';
    return { ok: true, price: pick.price, mode: mode, method: pick.method, text: text, cands: cands, atr: atr, trailAtr: atr ? { kind: 'atr', mult: closeOnly ? 3 : 2.5, atr: r4(atr) } : null, at: snap.at || null };
  }
  /* Midas talimat metni (uygulama içinde gösterilir) */
  function midasNote(a, st) {
    if (!st) return '';
    if (a && a.cls === 'gold') return 'Fiziki altında borsa stop emri yoktur: bu seviye uyarı olarak çalışır, satışı sen yaparsın.';
    if (a && (a.cls === 'katilim_fund' || a.cls === 'sukuk')) return 'Fonlarda stop emri yoktur ve fiyat günde bir açıklanır: bu seviye kapanış bazlı uyarı olarak çalışır, satış talimatını sen verirsin.';
    return 'Otomatik satış Midas\'ta stop emriyle yapılır: uygulama emir iletemez (Midas\'ın herkese açık emir API\'si yok). Aynı seviyeyi (' + fmtP(st.price) + ') Midas\'ta stop/koşullu emir olarak gir; girdikten sonra "Midas\'a girdim" kutusunu işaretle.';
  }
  return { LEVELS: LEVELS, LEVEL_TR: LEVEL_TR, MAX_LOG: MAX_LOG, clean: clean, make: make, sig: sig, highSince: highSince, effective: effective, evaluate: evaluate, rank: rank, step: step,
    eventId: eventId, notifCand: notifCand, logEntry: logEntry, addLog: addLog, cleanLog: cleanLog, cleanStateMap: cleanStateMap, suggest: suggest, midasNote: midasNote, fmtP: fmtP, pct: pct };
});
