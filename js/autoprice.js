/* autoprice.js — v8.4: Fiyatlar açılışta ve arada otomatik güncellenir; her varlık son bilinen/canlı piyasa fiyatıyla değerlenir.
 * İlkeler: hiçbir fiyat uydurulmaz. Her fiyat tarih + zaman damgası + kaynakla saklanır. Kaynak yanıt vermezse son bilinen fiyat kalır ve
 * "ESKİ" rozeti gösterilir. Çapraz kontrolü tutmayan veya yakın tarihli fiyattan çok sapan yeni fiyat OTOMATİK kaydedilmez, onaya bekler (Portföy → Fiyatlar).
 * Net varlık, Portföy Yönetimi ve döküm aynı değerlemeyi kullanır (Portfolio.valuationRows / summary). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio.js'), require('./ledger.js'), (function () { try { return require('./prices.js'); } catch (e) { return null; } })());
  else root.AutoPrice = factory(root.Portfolio, root.Ledger, root.Prices);
})(typeof self !== 'undefined' ? self : this, function (PF, L, PR) {
  'use strict';
  var LS_STATUS = 'finans-pusulasi:fiyat-durum', LS_TRY = 'finans-pusulasi:fiyat-deneme', MIN_GAP_MS = 10 * 60 * 1000, REPEAT_MS = 30 * 60 * 1000, RECENT_DAYS = 7;

  /* Güncellenecek fiyat anahtarları: alım-satımla izlenen varlıkların anahtarları + kullanılan döviz kurları + gram altın */
  function keysFor(state) {
    var keys = [];
    function add(k) { var ki = PF.keyInfo(k); if (ki && ki.kind !== 'manual' && keys.indexOf(k) < 0) keys.push(k); }
    (state.assets || []).forEach(function (a) { if (a.tracking === 'trades' && !PF.isClosed(state, a) && !PF.isIdle(state, a)) add(PF.assetKey(a)); });
    var cur = {}; (state.assets || []).concat(state.accounts || []).forEach(function (x) { if (x.currency && x.currency !== 'TRY') cur[x.currency] = true; });
    Object.keys(state.rates || {}).forEach(function (c) { cur[c] = true; });
    if (cur.USD || keys.some(function (k) { return /^td:/.test(k); })) add('fx:USD');
    if (cur.EUR) add('fx:EUR');
    if ((state.assets || []).some(function (a) { return a.cls === 'gold' || a.priceKey === 'metal:XAU'; })) add('metal:XAU');
    return keys;
  }
  function assetByKey(state, key) { return (state.assets || []).find(function (a) { return PF.assetKey(a) === key; }) || null; }

  /* Adayları değerlendirir: accept (otomatik kaydedilir) · held (onay bekler) · skip (zaten güncel/eski) */
  function select(state, candidates, today) {
    var out = { accept: [], held: [], skip: [] };
    candidates.forEach(function (c) {
      var a = assetByKey(state, c.key), kind = PF.kindFor(c.key, a), lp = PF.lastPoint(state, c.key), old = lp;
      if (!old && a) { var cp = PF.currentPrice(state, a); if (cp) old = { p: cp.p, d: cp.d, src: cp.src }; }
      var reasons = [], note = c.note || '';
      if (c.badCurrency) { out.held.push({ cand: c, reasons: ['Kaynağın para birimi ' + c.badCurrency + ', beklenen USD'] }); return; }
      var recent = old && L.daysBetween(old.d, today) <= RECENT_DAYS;
      var chk = PF.checkPrice(c.p, recent ? old : null, kind, c.d, today);
      if (!chk.valid) { out.held.push({ cand: c, reasons: chk.reasons }); return; }
      if (old && c.d < old.d) { out.skip.push({ cand: c, why: 'older' }); return; }
      if (old && old.d === c.d && old.p === c.p) { out.skip.push({ cand: c, why: 'same' }); return; }
      if (c.cross && c.cross.check && !c.cross.check.ok) reasons.push('İki kaynak arasında fark büyük (' + c.cross.label + ')');
      if (chk.needsConfirm) reasons = reasons.concat(chk.reasons);
      if (reasons.length) { out.held.push({ cand: c, reasons: reasons }); return; }
      if (old && !recent) note = (note ? note + ' ' : '') + 'Önceki fiyat ' + L.daysBetween(old.d, today) + ' gün eskiydi; sıçrama kontrolü uygulanmadı.';
      out.accept.push({ cand: c, note: note });
    });
    return out;
  }
  function applyAccepted(s, accepted) { accepted.forEach(function (x) { var c = x.cand; PF.setPrice(s, c.key, c.d, c.p, c.src, c.at); }); return accepted.length; }

  /* Değerleme özeti: kaç fiyat güncel, kaç tanesi eski/işlem fiyatı */
  function freshness(state, today) {
    var rows = PF.valuationRows(state, today).filter(function (r) { return r.valueTL > 0; }), o = { total: rows.length, fresh: 0, stale: 0, tradePrice: 0, none: 0, oldest: null };
    rows.forEach(function (r) {
      if (!r.price) { o.none++; return; }
      if (r.price.fromTrade) o.tradePrice++;
      if (r.stale.level === 'warn' || r.stale.level === 'old') { o.stale++; if (!o.oldest || r.price.d < o.oldest) o.oldest = r.price.d; }
      else if (!r.price.fromTrade) o.fresh++;
    });
    return o;
  }

  /* ---------- Tarayıcı: otomatik çalıştırıcı ve ekran parçaları ---------- */
  function create(X) {
    var busy = false, timer = null;
    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
    function status() { try { return JSON.parse(ls(LS_STATUS) || 'null'); } catch (e) { return null; } }
    function esc(s) { return X.esc(s); }
    function fmtAt(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (TSİ)'; }
    function priceTxt(p, cur) { var n = p / 1e6, s = n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }); return s + (cur === 'USD' ? ' $' : ' TL'); }
    function run(opts) {
      opts = opts || {};
      var st = X.state(); if (!st || st.isExample || busy) return Promise.resolve(false);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
      var last = +ls(LS_TRY) || 0; if (!opts.force && !opts.fresh && Date.now() - last < MIN_GAP_MS) return Promise.resolve(false);
      var keys = keysFor(st); if (!keys.length || !PR) return Promise.resolve(false);
      busy = true; lsSet(LS_TRY, String(Date.now())); if (opts.force) X.render();
      return PR.fetchAll(keys, { twelveKey: (window.Store && window.Store.apiKeys && window.Store.apiKeys().twelve) || '' }).then(function (res) {
        var today = X.today(), sel = select(X.state(), res.candidates, today), n = 0;
        if (sel.accept.length) X.mutate(function (s) { n = applyAccepted(s, sel.accept); }, null);
        var gotKeys = res.candidates.map(function (c) { return c.key; });
        lsSet(LS_STATUS, JSON.stringify({ at: new Date().toISOString(), applied: sel.accept.map(function (x) { return x.cand.key; }), held: sel.held.map(function (h) { return { key: h.cand.key, reasons: h.reasons }; }), missing: keys.filter(function (k) { return gotKeys.indexOf(k) < 0; }), errors: res.errors.slice(0, 12), sources: res.sources }));
        busy = false;
        if (n && X.afterApply) X.afterApply();
        if (opts.force || n) X.toast(n ? 'Fiyatlar güncellendi (' + n + ' fiyat).' : 'Fiyatlar zaten güncel.');
        X.render(); return n > 0;
      }, function (e) { busy = false; X.render(); if (opts.force) X.toast('Fiyatlar alınamadı: ' + e.message); return false; });
    }
    function start() {
      run({}); if (timer) clearInterval(timer);
      timer = setInterval(function () { run({}); }, REPEAT_MS);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') run({}); });
    }
    function badge(r) {
      if (!r.price) return '<span class="pill warn">fiyat yok</span>';
      var lv = r.stale.level;
      if (lv === 'warn' || lv === 'old') return '<span class="pill ' + (lv === 'old' ? 'err' : 'warn') + '">ESKİ · ' + r.stale.days + ' gün' + (r.price.fromTrade ? ' · son işlem fiyatı' : '') + '</span>';
      if (r.price.fromTrade) return '<span class="pill warn">son işlem fiyatı</span>';
      return '<span class="pill ok">güncel' + (r.stale.days ? ' · ' + r.stale.days + ' gün' : '') + '</span>';
    }
    /* Üst şerit: son otomatik güncelleme, eski fiyat sayısı, onay bekleyenler */
    function statusHtml() {
      var s = X.state(); if (!s || s.isExample) return '';
      var f = freshness(s, X.today()), st = status(); if (!f.total) return '';
      var lvl = f.stale || f.none || f.tradePrice ? 'warn' : 'ok';
      var h = '<div class="notice ' + lvl + ' price-status" role="status"><b>Fiyatlar:</b> ' + (st ? 'son otomatik güncelleme ' + esc(fmtAt(st.at)) : 'henüz otomatik güncelleme yapılmadı') + ' · ' + f.fresh + '/' + f.total + ' varlık güncel fiyatla';
      if (f.tradePrice) h += ' · ' + f.tradePrice + ' varlık son işlem fiyatıyla (canlı fiyat alınamadı)';
      if (f.stale) h += ' · ' + f.stale + ' fiyat ESKİ (en eski ' + esc(X.dateLabel(f.oldest)) + ')';
      if (st && st.held && st.held.length) h += '<div class="hint">Onay bekleyen ' + st.held.length + ' fiyat var (büyük sıçrama / kaynak farkı): Portföy → Fiyatlar\'dan incele.</div>';
      if (st && st.missing && st.missing.length) h += '<div class="hint">Alınamayan: ' + esc(st.missing.map(function (k) { return k.replace(/^[a-z]+:/, ''); }).join(', ') + ' — son bilinen fiyat kullanıldı.') + '</div>';
      return h + ' <button type="button" class="btn small" data-act="ap-refresh">Şimdi güncelle</button></div>';
    }
    /* En büyük yatırımlar: değer, fiyat, fiyat tarihi ve kaynağı, eskime rozeti */
    function tableHtml(limit) {
      var s = X.state(), rows = PF.valuationRows(s, X.today()).filter(function (r) { return r.valueTL > 0; }).sort(function (a, b) { return b.valueTL - a.valueTL; });
      if (!rows.length) return '';
      var shown = rows.slice(0, limit || 8), rest = rows.slice(limit || 8);
      var h = '<div class="tablewrap"><table class="valtable"><thead><tr><th>Yatırım</th><th class="r">Değer</th><th>Fiyat ve kaynağı</th><th>Durum</th></tr></thead><tbody>';
      shown.forEach(function (r) {
        var pr = r.price, fx = r.fx;
        h += '<tr><td>' + esc(r.name.replace(/ [—(].*$/, '')) + '</td><td class="r num">' + esc(X.tl(r.valueTL)) + '</td><td>' + (pr
          ? 'fiyat: <b>' + esc(priceTxt(pr.p, r.currency)) + '</b>, ' + esc(X.dateLabel(pr.d)) + ' tarihli, kaynak: ' + esc(pr.src || '—') + (pr.at ? ' <span class="hint">(alındı ' + esc(fmtAt(pr.at)) + ')</span>' : '') +
            (fx ? (fx.rate ? '<div class="hint">× USD/TL ' + esc((fx.rate / 100).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })) + (fx.date ? ', ' + esc(X.dateLabel(fx.date)) : '') + (fx.src ? ', ' + esc(fx.src) : '') + '</div>' : '<div class="hint neg">USD/TL kuru yok — maliyetle sayıldı</div>') : '')
          : 'fiyat yok') + '</td><td>' + badge(r) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (rest.length) h += '<p class="hint">+ ' + rest.length + ' küçük yatırım (toplam ' + esc(X.tl(rest.reduce(function (a, r) { return a + r.valueTL; }, 0))) + '); ayrıntı: Portföy → Fiyatlar.</p>';
      return h;
    }
    return { run: run, start: start, status: status, statusHtml: statusHtml, tableHtml: tableHtml };
  }
  return { keysFor: keysFor, select: select, applyAccepted: applyAccepted, freshness: freshness, create: create, RECENT_DAYS: RECENT_DAYS };
});
