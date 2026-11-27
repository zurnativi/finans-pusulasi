/* perf-ui.js — v8.9.0: Portföy oluşturucu ve Kayıtlı portföylerim için "Geçmiş performans", "Gelecek tahmini", "Stres testi" ve
 * "Hedef hesaplayıcı" bölümleri. Hesaplar perf.js'te (testli); Monte Carlo Web Worker'da (perf-worker.js) çalışır, yoksa arka planda tek seferde.
 * Veri: portföydeki varlıkların gerçek günlük TL fiyatları (dolar bazlılar günün kuruyla), kıyaslar: BIST 100, Katılım Tüm, USD/TL, gram altın
 * (market-data dalı, Yahoo/TradingView), TÜFE (TÜİK verisi — TCMB tablosu; günlük iş tazeler, yoksa paketlenmiş kopya), tarihî kriz dönemleri (refdata/stres.json).
 * Hiçbir sayı uydurulmaz: veri yetmeyen yer "veri yetersiz" yazar. */
(function () {
  'use strict';
  window.PerfUI = function (X, o) {
    var P = window.Perf, MD = window.MData, M = window.Money, esc = X.esc, tlK = X.tl;
    var ST = {}, IN = {}, BM = null, BMat = 0, worker = null, wq = {}, wseq = 0;
    var SEED = 20261127, PATHS = 5000, MONTHS = 120, BLOCK = 10;
    var PER = [['1A', 1], ['3A', 3], ['6A', 6], ['1Y', 12], ['3Y', 36], ['Maks', 0]];
    var HZ = [[1, '1 ay'], [3, '3 ay'], [6, '6 ay'], [12, '1 yıl'], [36, '3 yıl'], [60, '5 yıl']];
    var MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    function num(x) { return typeof x === 'number' && isFinite(x); }
    function ver() { var s = document.querySelector('script[src*="js/perf.js"]'); var m = s && /\?v=([^&]+)/.exec(s.getAttribute('src')); return m ? m[1] : ''; }
    function bare(k) { return M.format(Math.round(k), { noDecimals: true }).replace(/\s*(₺|TL)\s*$/, ''); }
    function fT(x) { return num(x) ? tlK(Math.round(x * 100)) : '—'; }
    function fS(x) { return num(x) ? M.formatShort(Math.round(x * 100)) : '—'; }
    function pc(x, d) { return num(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + '%' + Math.abs(x * 100).toFixed(d == null ? 1 : d).replace('.', ',') : '—'; }
    function pr(x) { return num(x) ? '%' + Math.round(x * 100) : '—'; }
    function cls(x) { return !num(x) ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : ''; }
    function dTR(d) { return d ? String(d).slice(0, 10).split('-').reverse().join('.') : '—'; }
    function ymTR(ym) { return MON[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
    function f2(x) { return num(x) ? x.toFixed(2).replace('.', ',') : '—'; }
    function CH() { return window.Charts; }
    function inp(id, P0) {
      if (!IN[id]) {
        var g = (X.state().goals || []).filter(function (x) { return x && x.target > 0; })[0], gy = 5;
        if (g && /^\d{4}-\d{2}$/.test(g.targetYm || '')) { var now = new Date(), y = +g.targetYm.slice(0, 4) - now.getFullYear() + (+g.targetYm.slice(5, 7) - 1 - now.getMonth()) / 12; gy = Math.max(1, Math.min(10, Math.round(y))); }
        IN[id] = { amt: P0 && P0.amountK ? P0.amountK / 100 : 10000, c: 1000, reb: 'month', per: 0, asm: 'gecmis', hz: 36, gT: g ? g.target / 100 : 100000, gCur: g ? 'TRY' : 'USD', gY: gy, gName: g ? g.name : null, shock: 0.2 };
      }
      return IN[id];
    }

    /* ---------- Veri: kıyaslar, TÜFE, stres referansı (oturum içinde 30 dk saklanır) ---------- */
    function softLoad(key) { return MD.load(key).catch(function () { return null; }); }
    function loadBM() {
      if (BM && Date.now() - BMat < 30 * 60000) return BM;
      var v = ver(), q = v ? '?v=' + v : '', raw = MD.URL.mdIndex.replace(/index\.json$/, '');
      BMat = Date.now();
      BM = Promise.all([softLoad('idx:XU100'), softLoad('idx:XKTUM'), softLoad('metal:XAU'), softLoad('fx:USD'), softLoad('us:SPY'),
        MD.fetchJson(raw + 'macro/TUFE.json', { timeout: 15000 }).then(function (j) { if (!j || !Array.isArray(j.months) || j.months.length < 24) throw new Error('boş'); return j; })
          .catch(function () { return MD.fetchJson('refdata/tufe.json' + q, { timeout: 15000 }).catch(function () { return null; }); }),
        MD.fetchJson('refdata/stres.json' + q, { timeout: 15000 }).catch(function () { return null; })]).then(function (r) {
        return { xu100: r[0], xktum: r[1], gold: r[2], usd: r[3], spy: r[4], cpi: r[5], stres: r[6] };
      });
      BM.catch(function () { BM = null; });
      return BM;
    }
    function bars(s) { return s && s.bars ? s.bars.filter(function (b) { return num(b.c) && b.c > 0; }).map(function (b) { return { d: b.d, c: b.c }; }) : null; }
    function onDates(dates, list) { // tarihe hizalı değerler (önceki kapanış, en çok 7 gün); başta veri yoksa null
      var out = new Array(dates.length), j = -1; if (!list || !list.length) return null;
      for (var i = 0; i < dates.length; i++) { while (j + 1 < list.length && list[j + 1].d <= dates[i]) j++; out[i] = j >= 0 && P.dayNum(dates[i]) - P.dayNum(list[j].d) <= 7 ? list[j].c : null; }
      return out;
    }
    function retsAligned(a, b) { // iki serinin ortak günlerinde günlük getiriler
      var m = {}; b.forEach(function (x) { m[x.d] = x.c; }); var ra = [], rb = [], pa = null, pb = null;
      a.forEach(function (x) { var y = m[x.d]; if (!num(y)) return; if (pa != null) { ra.push(x.c / pa - 1); rb.push(y / pb - 1); } pa = x.c; pb = y; });
      return { a: ra.slice(-756), b: rb.slice(-756) };
    }
    function stressMap(it, B) {
      var c = it.cls, name = (it.name || '') + ' ' + (it.fundType || '');
      if (c === 'gold') return { type: /XAG/.test(it.key) ? 'silver' : 'gold', beta: 1, why: 'ons fiyatı × USD/TL' };
      if (c === 'fx') return { type: 'usd', beta: 1, why: /EUR/.test(it.key) ? 'USD/TL ile yaklaşık (euro)' : 'USD/TL' };
      if (c === 'etf' || c === 'usstock') { var bU = it.usd && bars(B.spy) ? P.beta.apply(null, (function (x) { return [x.a, x.b]; })(retsAligned(it.usd, bars(B.spy)))) : null; return { type: 'spy', beta: num(bU) ? Math.max(0, Math.min(2.5, bU)) : 1, why: 'S&P 500 betası ' + (num(bU) ? f2(bU) : '1 (hesaplanamadı)') + ' × USD/TL' }; }
      if (c === 'fund' && window.Lab && window.Lab.isGoldName(name)) return { type: 'gold', beta: 1, why: 'altın fonu → gram altın' };
      if (c === 'bist' || c === 'fund') { var x = bars(B.xu100) ? retsAligned(it.tl, bars(B.xu100)) : null, b = x ? P.beta(x.a, x.b) : null; return { type: 'xu100', beta: num(b) ? Math.max(0, Math.min(2.5, b)) : (c === 'fund' && it.tier === 'safe' ? 0 : 1), why: 'BIST 100 betası ' + (num(b) ? f2(b) : 'hesaplanamadı') }; }
      return { type: 'none', why: 'bu varlık türü için kriz verisi yok' };
    }

    /* ---------- Hesap (geçmiş + stres + Monte Carlo girdileri) ---------- */
    function sig(pf) { return pf ? pf.at + '|' + pf.items.map(function (x) { return x.key + ':' + x.w; }).join(',') : ''; }
    function compute(pf, B) {
      var R = { at: Date.now() }, items = pf.items.filter(function (x) { return x.tl && x.tl.length >= 60; });
      R.cov = pf.items.map(function (x) { return { name: x.name, w: x.w, n: x.tl ? x.tl.length : 0, from: x.tl && x.tl.length ? x.tl[0].d : null, to: x.tl && x.tl.length ? x.tl[x.tl.length - 1].d : null, ok: !!(x.tl && x.tl.length >= 60) }; });
      var wAll = pf.items.reduce(function (s, x) { return s + x.w; }, 0), wOk = items.reduce(function (s, x) { return s + x.w; }, 0);
      R.wCov = wAll > 0 ? wOk / wAll : 0; R.cashBp = pf.cashBp || 0;
      if (!items.length || R.wCov < 0.5) { R.error = 'Veri yetersiz: fiyat geçmişi olan varlıkların payı %' + Math.round(R.wCov * 100) + ' (en az %50 gerekir).'; return R; }
      var al = P.align(items.map(function (x) { return x.tl; }));
      if (al.error || al.dates.length < 60) { R.error = 'Veri yetersiz: ortak tarihli fiyat geçmişi ' + (al.dates ? al.dates.length : 0) + ' gün (en az 60 gün gerekir).'; return R; }
      var w = items.map(function (x) { return x.w; });
      R.dates = al.dates; R.nav = { month: P.navOf(al.dates, al.px, w, 'month'), quarter: P.navOf(al.dates, al.px, w, 'quarter'), none: P.navOf(al.dates, al.px, w, 'none') };
      R.limiter = items.reduce(function (m, x) { return !m || x.tl[0].d > m.from ? { name: x.name, from: x.tl[0].d } : m; }, null);
      R.bm = { xu100: onDates(al.dates, bars(B.xu100)), xktum: onDates(al.dates, bars(B.xktum)), usd: onDates(al.dates, bars(B.usd) || pf.usdBars), gold: onDates(al.dates, bars(B.gold)) };
      R.C = B.cpi ? P.cpiPrep(B.cpi.months) : null; R.cpiSrc = B.cpi ? { src: B.cpi.source, at: B.cpi.fetchedAt, last: R.C && R.C.last, bundled: !!B.cpi.bundled, stale: !!B.cpi.stale } : null;
      if (R.C) { R.cpi = al.dates.map(function (d) { var l = P.cpiLevel(R.C, d); return l ? l.v : null; }); var fx = P.cpiFactor(R.C, al.dates[0], al.dates[al.dates.length - 1]); R.cpiEst = fx && fx.est; }
      var yrs = (P.dayNum(al.dates[al.dates.length - 1]) - P.dayNum(al.dates[0])) / 365.25, cf = R.C ? P.cpiFactor(R.C, al.dates[0], al.dates[al.dates.length - 1]) : null;
      R.hurdle = cf && yrs > 0 ? Math.pow(cf.f, 1 / yrs) - 1 : 0;
      R.st = {}; ['month', 'quarter', 'none'].forEach(function (k) { R.st[k] = P.stats(al.dates, R.nav[k], { hurdle: R.hurdle }); });
      // Monte Carlo girdileri: aylık dengelenen portföyün günlük getirisi + aynı günün USD/TL getirisi (birlikte örneklenir → korelasyon korunur)
      var nv = R.nav.month, u = R.bm.usd, rp = [], rx = [], okx = !!u;
      for (var i = 1; i < nv.length; i++) { rp.push(nv[i] / nv[i - 1] - 1); if (okx) { if (num(u[i]) && num(u[i - 1])) rx.push(u[i] / u[i - 1] - 1); else okx = false; } }
      R.rp = rp; R.rx = okx ? rx : null; R.usdNow = u && num(u[u.length - 1]) ? u[u.length - 1] : null;
      if (pf.usdNow) R.usdNow = pf.usdNow;
      // Stres: gerçek kriz dönemleri × beta; ayrıca portföyün kendi geçmişindeki en kötü dönemler
      R.smap = items.map(function (x) { return { name: x.name, w: x.w, map: stressMap(x, B) }; });
      R.stres = B.stres && Array.isArray(B.stres.windows) ? B.stres.windows.map(function (wn) { return { w: wn, res: P.stress(R.smap, wn.f) }; }) : null; R.stresSrc = B.stres ? B.stres.source : null;
      R.worst = [[21, '1 ay'], [63, '3 ay'], [126, '6 ay'], [252, '1 yıl']].map(function (x) { return { label: x[1], w: P.worstWindow(al.dates, nv, x[0]), b: P.bestWindow(al.dates, nv, x[0]) }; });
      return R;
    }
    function ensure(id, pf, P0) {
      var S = ST[id], s = sig(pf); inp(id, P0);
      if (!pf) return null;
      if (S && S.sig === s) return S;
      S = ST[id] = { sig: s, busy: true, R: null, mc: {}, err: null };
      loadBM().then(function (B) {
        if (ST[id] !== S) return;
        try { S.R = compute(pf, B); } catch (e) { console.error(e); S.err = 'Hesaplanamadı: ' + (e && e.message || e); }
        S.busy = false; X.render();
        if (S.R && !S.R.error) runMC(id, S, 'gecmis');
      }, function (e) { S.busy = false; S.err = 'Kıyas verileri alınamadı: ' + (e && e.message || e); X.render(); });
      return S;
    }

    /* ---------- Monte Carlo: Web Worker (arayüz donmaz); yoksa tek seferde arka planda ---------- */
    function getWorker() {
      if (worker === false) return null; if (worker) return worker;
      try {
        worker = new Worker('js/perf-worker.js' + (ver() ? '?v=' + ver() : ''));
        worker.onmessage = function (e) { var d = e.data, cb = wq[d.id]; delete wq[d.id]; if (cb) cb(d); };
        worker.onerror = function (e) { console.warn('perf worker', e && e.message); var q = wq; wq = {}; worker = false; Object.keys(q).forEach(function (k) { q[k]({ error: 'worker', retry: true }); }); if (e && e.preventDefault) e.preventDefault(); };
      } catch (e) { worker = false; }
      return worker || null;
    }
    function runMC(id, S, asm) {
      var R = S.R; if (!R || R.error || S.mc[asm]) return;
      var drift = asm === 'temkinli' ? (R.C ? R.C.y12 : null) : null; if (asm === 'temkinli' && drift == null) { S.mc[asm] = { error: 'TÜFE verisi yok; temkinli varsayım hesaplanamaz.' }; return; }
      var t0 = Date.now(); S.mc[asm] = { busy: true };
      var msg = { rp: new Float64Array(R.rp), rx: R.rx ? new Float64Array(R.rx) : null, months: MONTHS, paths: PATHS, seed: SEED, block: BLOCK, drift: drift };
      function done(d) {
        if (ST[id] !== S) return;
        if (d.retry) { S.mc[asm] = null; return runMC(id, S, asm); }
        S.mc[asm] = d.error ? { error: d.error } : d;
        if (!d.error) { d.calcMs = d.ms; d.ms = Date.now() - t0; summary(id, S); }
        X.render();
        if (asm === 'gecmis') setTimeout(function () { runMC(id, S, 'temkinli'); }, 50);
      }
      var wk = getWorker();
      if (wk) { var k = 'm' + (++wseq); msg.id = k; wq[k] = done; wk.postMessage(msg); }
      else setTimeout(function () { var t = Date.now(), r = P.monteCarlo(msg); r.ms = Date.now() - t; done(r); }, 30);
    }
    // Karşılaştırma için kalıcı özet (tutardan bağımsız oranlar)
    function summary(id, S) {
      var R = S.R, mc = S.mc.gecmis; if (!R || R.error || !mc || mc.error || mc.busy) return;
      var st = R.st.month, p1 = P.periodRet(R.dates, R.nav.month, 12), s12 = P.summaryAt(mc, 12, 1, 0, R.C ? R.C.y12 : null), s36 = P.summaryAt(mc, 36, 1, 0, R.C ? R.C.y12 : null);
      var sum = { at: new Date().toISOString(), from: st.from, to: st.to, r1y: p1 ? p1.r : null, rMax: st.total, cagr: st.annualized ? st.cagr : null, mdd: st.mdd, vol: st.vol, sharpe: st.sharpe,
        mc12: { p5: s12.p5 - 1, p50: s12.p50 - 1, p95: s12.p95 - 1, pLoss: s12.pLoss }, mc36: { p50: s36.p50 - 1, pLoss: s36.pLoss } };
      S.sum = sum; if (o.onSummary) o.onSummary(id, sum);
    }

    /* ---------- Çizim yardımcıları ---------- */
    function seg(label, id, field, opts, cur) { return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (x) { return '<button type="button" data-act="perf-set" data-id="' + esc(id) + '" data-f="' + field + '" data-v="' + esc(String(x[0])) + '" aria-pressed="' + (String(cur) === String(x[0])) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>'; }
    function field(id, f, label, val, hint) { return '<label class="pf-in"><span>' + esc(label) + '</span><input inputmode="decimal" autocomplete="off" data-perf="' + f + '" data-id="' + esc(id) + '" value="' + esc(bare(val * 100)) + '">' + (hint ? '<small class="muted">' + esc(hint) + '</small>' : '') + '</label>'; }
    function kpi(label, value, sub, c) { return '<div class="kpi card"><div class="label">' + label + '</div><div class="value ' + (c || '') + '">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>'; }
    function rAt(arr, i, j) { return arr && num(arr[i]) && num(arr[j]) ? arr[j] / arr[i] - 1 : null; }
    function warnBox() { return '<div class="notice warn pf-warn"><b>⚠ Önemli:</b> Geçmiş getiriler geleceğin garantisi değildir. Gelecek tahminleri geçmiş fiyat hareketlerinden üretilen <b>istatistiksel olasılıklardır, söz değildir</b>. Vergi, komisyon, kur makası ve temettüler dahil değildir. Yatırım tavsiyesi değildir.</div>'; }

    function pastHtml(id, S, P0) {
      var R = S.R, I = inp(id, P0), st = R.st[I.reb], nv = R.nav[I.reb], d = R.dates, n = d.length, amt = I.amt, h = '';
      var tot = st.total, real = R.cpi && num(R.cpi[0]) && num(R.cpi[n - 1]) ? (1 + tot) / (R.cpi[n - 1] / R.cpi[0]) - 1 : null, dd = st.dd, bw = P.bestWorstMonth(P.monthly(d, nv));
      h += '<div class="kpis grid lab-kpis">' + kpi(fT(amt) + ' → ', fT(amt * (1 + tot)), dTR(st.from) + ' – ' + dTR(st.to) + ' (' + Math.round(st.days / 30.4) + ' ay)', cls(tot)) +
        kpi('Toplam getiri', pc(tot), 'yıllık ' + (st.annualized ? pc(st.cagr) : pc(st.cagr) + ' <small>(1 yıldan kısa — yanıltıcı olabilir)</small>'), cls(tot)) +
        kpi('Reel getiri (TÜFE\'ye göre)', real == null ? '—' : pc(real), real == null ? 'TÜFE verisi yok' : 'enflasyondan arındırılmış' + (R.cpiEst ? ' · son ay TÜFE tahmini' : ''), cls(real)) +
        kpi('En büyük düşüş', dd ? pc(dd.mdd) : '—', dd ? dTR(dd.peak) + ' → ' + dTR(dd.trough) + ' · ' + (dd.recovered ? dd.recDays + ' günde toparlandı' : 'henüz toparlanmadı') : '', 'neg') +
        kpi('Yıllık oynaklık', num(st.vol) ? '%' + (st.vol * 100).toFixed(1).replace('.', ',') : '—', 'günlük getirilerin standart sapması × √252') +
        kpi('Sharpe / Sortino', f2(st.sharpe) + ' / ' + f2(st.sortino), 'eşik: TÜFE ' + pc(R.hurdle) + '/yıl (faiz kullanılmaz)') +
        kpi('En iyi / en kötü ay', bw ? pc(bw.best.r) + ' / ' + pc(bw.worst.r) : '—', bw ? ymTR(bw.best.ym) + ' / ' + ymTR(bw.worst.ym) + ' · ' + bw.pos + '/' + bw.n + ' ay artı' : 'tam ay yok') + '</div>';
      // Dönem tablosu
      h += '<h3>Dönem getirileri ve kıyaslar</h3><div class="tscroll"><table class="atable stack pf-per"><thead><tr><th>Dönem</th><th>Portföy</th><th>' + esc(fT(amt)) + ' →</th><th>BIST 100</th><th>Katılım Tüm</th><th>Dolar (USD/TL)</th><th>Gram altın</th><th>TÜFE</th><th>Reel getiri</th></tr></thead><tbody>';
      PER.forEach(function (p) {
        var x = P.periodIdx(d, p[1]);
        if (!x) { h += '<tr><td><b>' + p[0] + '</b></td><td colspan="8" class="muted">Veri yetersiz (ortak geçmiş ' + Math.round((P.dayNum(d[n - 1]) - P.dayNum(d[0])) / 30.4) + ' ay)</td></tr>'; return; }
        var i = x.i, r = nv[n - 1] / nv[i] - 1, yr = (P.dayNum(d[n - 1]) - P.dayNum(d[i])) / 365.25, inf = rAt(R.cpi, i, n - 1), rl = inf != null ? (1 + r) / (1 + inf) - 1 : null;
        h += '<tr><td><span><b>' + p[0] + '</b> <small class="muted">' + dTR(d[i]) + '</small></span></td><td class="' + cls(r) + '"><span><b>' + pc(r) + '</b>' + (yr >= 1.5 ? ' <small class="muted">yıllık ' + pc(Math.pow(1 + r, 1 / yr) - 1) + '</small>' : '') + '</span></td><td>' + fT(amt * (1 + r)) + '</td>' +
          ['xu100', 'xktum', 'usd', 'gold'].map(function (k) { var b = rAt(R.bm[k], i, n - 1); return '<td class="' + cls(b) + '">' + (b == null ? '<span class="muted">veri yok</span>' : pc(b)) + '</td>'; }).join('') +
          '<td>' + (inf == null ? '<span class="muted">veri yok</span>' : pc(inf)) + '</td><td class="' + cls(rl) + '">' + (rl == null ? '—' : pc(rl)) + '</td></tr>';
      });
      h += '</tbody></table></div><p class="hint">Kıyaslar aynı tarihlerdeki kapanışlardır. Reel getiri = (1 + portföy) ÷ (1 + TÜFE) − 1. ' + (R.cpiSrc ? 'TÜFE: ' + esc(R.cpiSrc.src) + ', ' + esc(ymTR(R.cpiSrc.last)) + '\'e kadar açıklanan' + (R.cpiEst ? '; sonraki günler son 12 ayın ortalama aylık oranıyla tahmin edilir' : '') + '.' : 'TÜFE verisi alınamadı; reel getiri gösterilmez.') + '</p>';
      // Değer grafiği
      var per = I.per, px = P.periodIdx(d, per) || { i: 0 }, i0 = px.i;
      h += '<div class="pf-chead"><h3>' + esc(fT(amt)) + ' ne olurdu?</h3>' + seg('Dönem', id, 'per', PER.filter(function (p) { return P.periodIdx(d, p[1]); }).map(function (p) { return [p[1], p[0]]; }), per) + '</div>' + valueChart(id, R, nv, i0, amt);
      h += '<div class="grid two"><div><h3>Düşüş grafiği (zirveden uzaklık)</h3>' + ddChart(id, R, nv) + '</div><div><h3>Dengeleme mi, al-tut mu?</h3>' + rebTable(R, amt, I.reb) + '</div></div>';
      h += '<h3>Aylık getiri ısı haritası</h3>' + heat(P.monthly(d, nv));
      h += dcaHtml(id, R, nv, I);
      h += '<details class="fold fold-sm"><summary><b>Veri kapsamı</b> <span class="hint">' + R.cov.filter(function (c) { return c.ok; }).length + '/' + R.cov.length + ' varlık · payın %' + Math.round(R.wCov * 100) + '\'i</span></summary><ul class="ev small">' +
        R.cov.map(function (c) { return '<li><b>' + esc(String(c.name).split(' — ')[0]) + '</b> (pay %' + (c.w / 100).toFixed(1).replace('.', ',') + '): ' + (c.ok ? c.n + ' gün, ' + dTR(c.from) + ' – ' + dTR(c.to) : '<span class="neg">Veri yetersiz (' + c.n + ' gün) — hesaba katılmadı, kalan paylar orantılı büyütüldü</span>') + '</li>'; }).join('') +
        (R.cashBp ? '<li>Nakit payı (%' + (R.cashBp / 100).toFixed(0) + ') için getiri verisi yok; hesap varlıkların hedef ağırlıklarıyla yapıldı.</li>' : '') +
        '<li>Ortak dönem en kısa geçmişe sahip varlıkla sınırlıdır' + (R.limiter ? ' (' + esc(String(R.limiter.name).split(' — ')[0]) + ': ' + dTR(R.limiter.from) + ')' : '') + '. Tatiller önceki kapanışla doldurulur (en çok 7 gün).</li>' +
        '<li>Hesap, portföyün <b>bugünkü hedef ağırlıklarıyla</b> yapılır (bekleyen emirler alınmış sayılır); hisse fiyatları bölünme/bedelsize göre düzeltilmiştir, nakit temettüler dahil değildir; fon fiyatları tüm getiriyi içerir.</li></ul></details>';
      return h;
    }
    function valueChart(id, R, nv, i0, amt) {
      var C = CH(); if (!C) return ''; var d = R.dates.slice(i0), base = nv[i0];
      var lines = [['Portföy', nv, 'brand', 3], ['BIST 100', R.bm.xu100], ['Katılım Tüm', R.bm.xktum], ['Dolar', R.bm.usd], ['Gram altın', R.bm.gold], ['TÜFE (enflasyon)', R.cpi]];
      lines = lines.filter(function (l) { return l[1] && num(l[1][i0]); });
      return C.custom('pf-val-' + id + '-' + i0, 260, 'Tutarın değeri: portföy ve kıyaslar, ' + dTR(d[0]) + ' – ' + dTR(d[d.length - 1]), function (t) {
        return C.anim({ color: t.pal, grid: { left: 8, right: 12, top: 30, bottom: 6, containLabel: true }, legend: { top: 0, type: 'scroll', textStyle: { color: t.muted } },
          tooltip: C.tooltip(t, { trigger: 'axis', valueFormatter: function (v) { return fT(v); } }),
          xAxis: { type: 'category', data: d.map(dTR), axisLabel: { color: t.muted } }, yAxis: { type: 'value', scale: true, axisLabel: { color: t.muted, formatter: function (v) { return fS(v); } }, splitLine: { lineStyle: { color: t.line } } },
          series: lines.map(function (l, k) { var b0 = l[1][i0]; return { type: 'line', name: l[0], symbol: 'none', smooth: 0.1, lineStyle: { width: l[3] || 1.6, type: l[0].indexOf('TÜFE') === 0 ? 'dashed' : 'solid', color: l[2] ? t[l[2]] : undefined }, itemStyle: l[2] ? { color: t[l[2]] } : undefined, z: l[3] ? 5 : 2,
            data: l[1].slice(i0).map(function (v) { return num(v) ? Math.round(amt * v / b0) : null; }) }; }) });
      });
    }
    function ddChart(id, R, nv) {
      var C = CH(); if (!C) return ''; var pk = -Infinity, dd = nv.map(function (v) { pk = Math.max(pk, v); return Math.round((v / pk - 1) * 1000) / 10; });
      return C.custom('pf-dd-' + id, 180, 'Zirveden düşüş yüzdesi', function (t) {
        return C.anim({ grid: { left: 8, right: 12, top: 10, bottom: 6, containLabel: true }, tooltip: C.tooltip(t, { trigger: 'axis', valueFormatter: function (v) { return '%' + String(v).replace('.', ','); } }),
          xAxis: { type: 'category', data: R.dates.map(dTR), axisLabel: { color: t.muted } }, yAxis: { type: 'value', max: 0, axisLabel: { color: t.muted, formatter: '%{value}' }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'line', symbol: 'none', data: dd, lineStyle: { width: 1.5, color: t.risky }, itemStyle: { color: t.risky }, areaStyle: { color: t.risky, opacity: 0.18 } }] });
      });
    }
    function rebTable(R, amt, cur) {
      var L = { month: 'Aylık dengeleme', quarter: 'Çeyreklik dengeleme', none: 'Al-tut (dengeleme yok)' };
      return '<div class="tscroll"><table class="atable stack"><thead><tr><th>Yöntem</th><th>Son değer</th><th>Getiri</th><th>Oynaklık</th><th>En büyük düşüş</th></tr></thead><tbody>' + ['month', 'quarter', 'none'].map(function (k) {
        var s = R.st[k]; return '<tr' + (k === cur ? ' class="pf-cur"' : '') + '><td><span>' + L[k] + (k === cur ? ' <small class="muted">(seçili)</small>' : '') + '</span></td><td>' + fT(amt * (1 + s.total)) + '</td><td class="' + cls(s.total) + '">' + pc(s.total) + '</td><td>' + (num(s.vol) ? '%' + (s.vol * 100).toFixed(1).replace('.', ',') : '—') + '</td><td class="neg">' + pc(s.mdd) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">Dengeleme: dönem başında paylar hedef ağırlığa geri çekilir (vergi/komisyon hariç). Al-tut: ilk gün alınır, hiç dokunulmaz.</p>';
    }
    function heat(ms) {
      var by = {}; ms.forEach(function (x) { var y = x.ym.slice(0, 4); (by[y] = by[y] || {})[+x.ym.slice(5, 7)] = x; });
      var ys = Object.keys(by).sort(), h = '<div class="tscroll"><table class="pf-heat"><thead><tr><th>Yıl</th>' + MON.map(function (m) { return '<th>' + m + '</th>'; }).join('') + '<th>Yıl</th></tr></thead><tbody>';
      ys.forEach(function (y) {
        var yr = 1; h += '<tr><th>' + y + '</th>';
        for (var m = 1; m <= 12; m++) { var x = by[y][m]; if (!x) { h += '<td class="e"></td>'; continue; } yr *= 1 + x.r; var a = Math.min(1, Math.abs(x.r) / 0.12); h += '<td style="--a:' + a.toFixed(2) + '" class="' + (x.r >= 0 ? 'p' : 'n') + (x.partialStart || x.partialEnd ? ' part' : '') + '" title="' + esc(ymTR(x.ym) + ': ' + pc(x.r) + (x.partialStart || x.partialEnd ? ' (eksik ay)' : '')) + '">' + (x.r * 100).toFixed(1).replace('.', ',') + '</td>'; }
        h += '<td class="' + (yr - 1 >= 0 ? 'pos' : 'neg') + '"><b>' + pc(yr - 1) + '</b></td></tr>';
      });
      return h + '</tbody></table></div><p class="hint">Hücreler aylık % getiri (yeşil artı, kırmızı eksi; koyuluk büyüklük). İtalik = ay tam değil (verinin ilk/son ayı). "Yıl" sütunu o yılın eldeki aylarının bileşik getirisidir.</p>';
    }
    function dcaHtml(id, R, nv, I) {
      var d = R.dates, r = P.dca(d, nv, I.amt, I.c); if (!r) return '';
      function on(arr) { if (!arr || !num(arr[0])) return null; for (var i = 0; i < arr.length; i++) if (!num(arr[i])) return null; return P.dca(d, arr, I.amt, I.c); }
      var u = on(R.bm.usd), g = on(R.bm.gold), cp = on(R.cpi), x1 = on(R.bm.xu100);
      var h = '<h3>Düzenli yatırım (her ay ' + fT(I.c) + ')</h3><p class="hint">' + dTR(d[0]) + ' tarihinde ' + fT(I.amt) + ' ile başlayıp her takvim ayının ilk işlem gününde ' + fT(I.c) + ' eklenseydi (' + r.n + ' yatırım):</p>';
      h += '<div class="kpis grid lab-kpis">' + kpi('Toplam yatırılan', fT(r.invested)) + kpi('Bugünkü değer', fT(r.value), '', cls(r.gain)) + kpi('Kazanç', (r.gain >= 0 ? '+' : '−') + fT(Math.abs(r.gain)), pc(r.ret), cls(r.gain)) + kpi('Paranın ağırlıklı yıllık getirisi (XIRR)', pc(r.irr), 'her yatırımın tarihini hesaba katar') + '</div>';
      h += '<div class="tscroll"><table class="atable stack"><thead><tr><th>Aynı takvimle</th><th>Bugünkü değer</th><th>Fark (portföy −)</th><th>XIRR</th></tr></thead><tbody>' +
        [['Bu portföy', r], ['BIST 100', x1], ['Dolar (USD/TL)', u], ['Gram altın', g], ['Enflasyona endeksli (TÜFE kadar artan)', cp]].map(function (x) { var v = x[1]; return '<tr><td>' + x[0] + '</td><td>' + (v ? fT(v.value) : '<span class="muted">veri yok</span>') + '</td><td class="' + (v ? cls(r.value - v.value) : '') + '">' + (v && x[1] !== r ? (r.value - v.value >= 0 ? '+' : '−') + fT(Math.abs(r.value - v.value)) : '—') + '</td><td>' + (v ? pc(v.irr) : '—') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      var C = CH(); if (C) h += C.custom('pf-dca-' + id + '-' + I.amt + '-' + I.c, 200, 'Düzenli yatırım: yatırılan ve değer', function (t) {
        return C.anim({ grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true }, legend: { top: 0, textStyle: { color: t.muted } }, tooltip: C.tooltip(t, { trigger: 'axis', valueFormatter: function (v) { return fT(v); } }),
          xAxis: { type: 'category', data: r.series.map(function (x) { return dTR(x.d); }), axisLabel: { color: t.muted } }, yAxis: { type: 'value', axisLabel: { color: t.muted, formatter: function (v) { return fS(v); } }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'line', name: 'Değer', symbol: 'none', data: r.series.map(function (x) { return Math.round(x.val); }), lineStyle: { width: 2.5, color: t.brand }, itemStyle: { color: t.brand }, areaStyle: { opacity: 0.1 } },
            { type: 'line', name: 'Yatırılan', symbol: 'none', step: 'end', data: r.series.map(function (x) { return Math.round(x.inv); }), lineStyle: { type: 'dashed', color: t.muted }, itemStyle: { color: t.muted } }] });
      });
      return h;
    }

    function futureHtml(id, S, P0) {
      var R = S.R, I = inp(id, P0), mc = S.mc[I.asm], infl = R.C ? R.C.y12 : null, h = '';
      h += seg('Getiri varsayımı', id, 'asm', [['gecmis', 'Geçmiş veriyle'], ['temkinli', 'Temkinli (getiri = enflasyon)']], I.asm);
      h += '<p class="hint">' + (I.asm === 'gecmis' ? 'Son ' + R.rp.length + ' işlem gününün gerçek günlük getirileri (portföy ve aynı günün USD/TL değişimi birlikte) bloklar hâlinde rastgele yeniden dizilir: geçmişteki ortalama getiri, oynaklık, sert günler ve korelasyonlar korunur.' : 'Aynı geçmiş günler kullanılır ama ortalama getiri yıllık TÜFE kadar (' + pc(infl) + ', son 12 ay) olacak şekilde kaydırılır; oynaklık ve kriz günleri aynen kalır. Geçmişteki yüksek getirinin sürmeyeceği varsayımıdır.') + '</p>';
      if (!mc || mc.busy) return h + '<p class="loading-line"><span class="spinner"></span> ' + PATHS.toLocaleString('tr-TR') + ' senaryo hesaplanıyor (arka planda, sayfa donmaz)…</p>';
      if (mc.error) return h + '<div class="notice warn">' + esc(mc.error) + '</div>';
      var rows = HZ.map(function (z) { return { z: z, s: P.summaryAt(mc, z[0], I.amt, I.c, infl) }; });
      h += '<div class="tscroll"><table class="atable stack pf-mc"><thead><tr><th>Vade</th><th>Yatırılan</th><th>Kötü (%5)</th><th>%25</th><th>Medyan</th><th>%75</th><th>İyi (%95)</th><th>Zarar olasılığı</th><th>Enflasyonu yenme</th><th>Doları yenme</th></tr></thead><tbody>' +
        rows.map(function (x) { var s = x.s; return '<tr><td><b>' + x.z[1] + '</b></td><td>' + fT(s.invested) + '</td><td class="neg">' + fT(s.p5) + '</td><td>' + fT(s.p25) + '</td><td><span><b>' + fT(s.p50) + '</b> <small class="' + cls(s.p50 / s.invested - 1) + '">' + pc(s.p50 / s.invested - 1) + '</small></span></td><td>' + fT(s.p75) + '</td><td class="pos">' + fT(s.p95) + '</td><td class="' + (s.pLoss > 0.3 ? 'neg' : '') + '"><b>' + pr(s.pLoss) + '</b></td><td>' + pr(s.pBeatInfl) + '</td><td>' + pr(s.pBeatUsd) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      var y1 = rows[3].s;
      h += '<p><b>1 yıl sonra:</b> ' + fT(y1.invested) + ' yatırımın değeri %90 olasılıkla <b>' + fT(y1.p5) + ' – ' + fT(y1.p95) + '</b> aralığında, ortası ' + fT(y1.p50) + '. Zarar etme olasılığı <b>' + pr(y1.pLoss) + '</b>' + (y1.pBeatInfl != null ? ', enflasyonun üstünde kalma olasılığı ' + pr(y1.pBeatInfl) : '') + (y1.pBeatUsd != null ? ', dolar tutmaktan iyi olma olasılığı ' + pr(y1.pBeatUsd) : '') + '.</p>';
      var other = S.mc[I.asm === 'gecmis' ? 'temkinli' : 'gecmis'];
      if (other && !other.busy && !other.error) { var o1 = P.summaryAt(other, 12, I.amt, I.c, infl), o5 = P.summaryAt(other, 60, I.amt, I.c, infl); h += '<p class="hint">Karşılaştırma — ' + (I.asm === 'gecmis' ? 'temkinli' : 'geçmiş veriyle') + ' varsayımda medyan: 1 yıl ' + fT(o1.p50) + ', 5 yıl ' + fT(o5.p50) + '.</p>'; }
      h += '<div class="pf-chead"><h3>Olasılık yelpazesi</h3>' + seg('Vade', id, 'hz', [[12, '1 yıl'], [36, '3 yıl'], [60, '5 yıl'], [120, '10 yıl']], I.hz) + '</div>' + fanChart(id, mc, I);
      h += '<details class="fold fold-sm"><summary><b>Varsayımlar ve yöntem</b></summary><ul class="ev small"><li>' + PATHS.toLocaleString('tr-TR') + ' senaryo, durağan blok bootstrap (ortalama blok ' + BLOCK + ' işlem günü), ay = 21 işlem günü, sabit tohum (aynı veriyle aynı sonuç). Hesap ' + (mc.ms != null ? mc.ms + ' ms' : '—') + ' sürdü' + (mc.calcMs != null ? ' (simülasyon ' + mc.calcMs + ' ms)' : '') + '.</li>' +
        '<li>Kaynak: aylık dengelenen portföyün son ' + R.rp.length + ' günlük getirisi (' + dTR(R.dates[0]) + ' – ' + dTR(R.dates[R.dates.length - 1]) + '). 3 yıllık geçmişten 5–10 yıllık tahmin yapmak belirsizliği artırır; uzun vadeler kabaca yön gösterir.</li>' +
        '<li>Aylık katkı her ay sonunda eklenir; yatırılan = başlangıç + aylık × ay. "Enflasyonu yenme": değer, yatırılan her tutarın yıllık ' + pc(infl) + ' (son 12 ay TÜFE) ile büyümüş hâlinden fazla. "Doları yenme": aynı tutarlar aynı tarihlerde dolara yatırılsaydı (kur yolu senaryoyla birlikte örneklenir).</li>' +
        '<li>Kötü (%5) = 20 senaryodan 1\'i bundan kötü; iyi (%95) = 20\'de 1\'i bundan iyi. Gerçek sonuç bu aralığın dışında kalabilir (ör. geçmişte görülmemiş bir kriz).</li></ul></details>';
      return h;
    }
    function fanChart(id, mc, I) {
      var C = CH(); if (!C) return ''; var M0 = Math.min(I.hz, mc.months), step = M0 > 60 ? 2 : 1, fz = P.fan(mc, I.amt, I.c, step).filter(function (x) { return x.m <= M0; });
      var lab = ['Bugün'].concat(fz.map(function (x) { return x.m % 12 === 0 ? (x.m / 12) + '. yıl' : x.m + '. ay'; })), inv = [I.amt].concat(fz.map(function (x) { return I.amt + I.c * x.m; }));
      function col(k) { return [I.amt].concat(fz.map(function (x) { return x[k]; })); }
      var p5 = col('p5'), p25 = col('p25'), p50 = col('p50'), p75 = col('p75'), p95 = col('p95');
      return C.custom('pf-fan-' + id + '-' + I.asm + '-' + M0 + '-' + I.amt + '-' + I.c, 260, 'Olasılık yelpazesi: medyan ve %5–%95 aralığı', function (t) {
        var band = { type: 'line', symbol: 'none', lineStyle: { opacity: 0 }, emphasis: { disabled: true } };
        return C.anim({ grid: { left: 8, right: 12, top: 28, bottom: 6, containLabel: true }, legend: { top: 0, data: ['Medyan', 'Yatırılan', '%25–%75', '%5–%95'], textStyle: { color: t.muted } },
          tooltip: C.tooltip(t, { trigger: 'axis', formatter: function (ps) { var i = ps[0].dataIndex; return '<b>' + esc(lab[i]) + '</b><br>İyi (%95): ' + fT(p95[i]) + '<br>%75: ' + fT(p75[i]) + '<br><b>Medyan: ' + fT(p50[i]) + '</b><br>%25: ' + fT(p25[i]) + '<br>Kötü (%5): ' + fT(p5[i]) + '<br>Yatırılan: ' + fT(inv[i]); } }),
          xAxis: { type: 'category', boundaryGap: false, data: lab, axisLabel: { color: t.muted } }, yAxis: { type: 'value', axisLabel: { color: t.muted, formatter: function (v) { return fS(v); } }, splitLine: { lineStyle: { color: t.line } } },
          series: [Object.assign({ name: 'alt5', stack: 'o', data: p5 }, band), Object.assign({ name: '%5–%95', stack: 'o', data: p95.map(function (v, i) { return v - p5[i]; }), areaStyle: { color: t.brand, opacity: 0.12 }, itemStyle: { color: t.brand } }, band),
            Object.assign({ name: 'alt25', stack: 'i', data: p25 }, band), Object.assign({ name: '%25–%75', stack: 'i', data: p75.map(function (v, i) { return v - p25[i]; }), areaStyle: { color: t.brand, opacity: 0.28 }, itemStyle: { color: t.brand } }, band),
            { type: 'line', name: 'Medyan', symbol: 'none', data: p50, lineStyle: { width: 2.5, color: t.brand }, itemStyle: { color: t.brand } },
            { type: 'line', name: 'Yatırılan', symbol: 'none', data: inv, lineStyle: { type: 'dashed', color: t.muted }, itemStyle: { color: t.muted } }] });
      });
    }
    function stressHtml(id, S, P0) {
      var R = S.R, I = inp(id, P0), amt = I.amt, h = '';
      h += '<h3>Bu portföyün kendi geçmişindeki en kötü dönemler</h3><div class="tscroll"><table class="atable stack"><thead><tr><th>Süre</th><th>En kötü</th><th>' + esc(fT(amt)) + ' için</th><th>Tarih</th><th>En iyi</th></tr></thead><tbody>' +
        R.worst.map(function (x) { return '<tr><td>' + x.label + '</td>' + (x.w ? '<td class="' + cls(x.w.r) + '"><b>' + pc(x.w.r) + '</b></td><td class="' + cls(x.w.r) + '">' + (x.w.r < 0 ? '−' + fT(-amt * x.w.r) : '+' + fT(amt * x.w.r)) + '</td><td>' + dTR(x.w.from) + ' – ' + dTR(x.w.to) + '</td><td class="' + cls(x.b.r) + '">' + pc(x.b.r) + '</td>' : '<td colspan="4" class="muted">Veri yetersiz</td>') + '</tr>'; }).join('') + '</tbody></table></div>';
      if (R.stres) {
        h += '<h3>Tarihî kriz senaryoları (bugünkü portföy o dönemi yaşasaydı)</h3><div class="tscroll"><table class="atable stack"><thead><tr><th>Senaryo</th><th>Piyasada olan</th><th>Portföy (TL)</th><th>' + esc(fT(amt)) + ' için</th><th>Dolar bazında</th><th>Kapsam</th></tr></thead><tbody>' +
          R.stres.map(function (x) { var f = x.w.f, r = x.res; return '<tr><td><span><b>' + esc(x.w.label) + '</b><br><small class="muted">' + dTR(x.w.from) + ' – ' + dTR(x.w.to) + '</small></span></td><td><small>BIST 100 ' + pc(f.XU100) + ' · USD/TL ' + pc(f.USDTRY) + ' · altın (ons) ' + pc(f.XAUUSD) + ' · S&amp;P 500 ' + pc(f.SPY) + '</small></td>' +
            '<td class="' + cls(r.r) + '"><b>' + pc(r.r) + '</b></td><td class="' + cls(r.r) + '">' + (num(r.r) ? (r.r < 0 ? '−' : '+') + fT(Math.abs(amt * r.r)) : '—') + '</td><td class="' + cls(r.usd) + '">' + pc(r.usd) + '</td><td><span>' + pr(r.coverage) + (r.missing.length ? '<br><small class="muted">hesaplanamayan: ' + esc(r.missing.map(function (n) { return String(n).split(' — ')[0]; }).join(', ')) + '</small>' : '') + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
        h += '<details class="fold fold-sm"><summary><b>Varlıklar krizlere nasıl bağlandı?</b></summary><ul class="ev small">' + R.smap.map(function (x) { return '<li><b>' + esc(String(x.name).split(' — ')[0]) + '</b>: ' + esc(x.map.why) + '</li>'; }).join('') + '<li>Faktör hareketleri gerçek günlük kapanışlardır (' + esc(R.stresSrc || '') + '). Beta: varlığın son 3 yıldaki günlük getirilerinin faktöre duyarlılığı (0–2,5 ile sınırlı). Dönemler olayın bilinen başlangıç–dip tarihleridir; dönem içindeki toparlanmalar dahil değildir.</li></ul></details>';
      } else h += '<p class="hint">Tarihî kriz verisi alınamadı.</p>';
      // TL değer kaybı şoku
      var sh = I.shock, items = R.smap, tw = 0, rr = 0; items.forEach(function (x) { var t = x.map.type, r = t === 'usd' || t === 'gold' || t === 'silver' || t === 'spy' ? sh : t === 'none' ? null : 0; if (r != null) { rr += x.w * r; tw += x.w; } });
      var rT = tw ? rr / tw : null, rU = rT != null ? (1 + rT) / (1 + sh) - 1 : null;
      h += '<div class="pf-chead"><h3>Ani TL değer kaybı şoku</h3>' + seg('Şok', id, 'shock', [[0.1, '%10'], [0.2, '%20'], [0.3, '%30'], [0.5, '%50']], sh) + '</div>' +
        '<p>Dolar/TL bir anda %' + Math.round(sh * 100) + ' yükselirse: portföy TL bazında <b class="' + cls(rT) + '">' + pc(rT) + '</b> (' + (num(rT) ? fT(amt * (1 + rT)) : '—') + '), dolar bazında <b class="' + cls(rU) + '">' + pc(rU) + '</b>.</p><p class="hint">Varsayım: dolar bazlı varlıklar (döviz, altın, ABD hisse/ETF) kur kadar artar, TL varlıklar ilk anda değişmez. Gerçekte BIST hisseleri zamanla kura kısmen uyum sağlayabilir.</p>';
      return h;
    }
    function goalHtml(id, S, P0) {
      var R = S.R, I = inp(id, P0), mc = S.mc[I.asm], h = '';
      h += '<div class="pf-ins">' + field(id, 'gT', 'Hedef tutar', I.gT) + '<label class="pf-in"><span>Para birimi</span><select data-perf="gCur" data-id="' + esc(id) + '"><option value="USD"' + (I.gCur === 'USD' ? ' selected' : '') + '>Dolar ($)</option><option value="TRY"' + (I.gCur === 'TRY' ? ' selected' : '') + '>TL (₺)</option></select></label>' +
        '<label class="pf-in"><span>Süre</span><select data-perf="gY" data-id="' + esc(id) + '">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (y) { return '<option value="' + y + '"' + (I.gY === y ? ' selected' : '') + '>' + y + ' yıl</option>'; }).join('') + '</select></label></div>';
      h += '<p class="hint">Başlangıç ' + fT(I.amt) + ', her ay ' + fT(I.c) + ' (yukarıdaki alanlardan) · varsayım: ' + (I.asm === 'gecmis' ? 'geçmiş veriyle' : 'temkinli') + (I.gName ? ' · hedeflerinden: ' + esc(I.gName) : '') + '</p>';
      if (!mc || mc.busy) return h + '<p class="loading-line"><span class="spinner"></span> Senaryolar hesaplanıyor…</p>';
      if (mc.error) return h + '<div class="notice warn">' + esc(mc.error) + '</div>';
      var m = I.gY * 12, usd = R.usdNow;
      if (I.gCur === 'USD' && (!mc.X || !num(usd))) return h + '<div class="notice warn">Dolar hedefi için USD/TL geçmişi gerekli ama alınamadı. TL hedefi seçebilirsin.</div>';
      var p = P.goalProb(mc, m, I.amt, I.c, I.gT, I.gCur, usd), s = P.summaryAt(mc, m, I.amt, I.c, null);
      var vU = null; if (mc.X && num(usd)) { var a = [], M0 = mc.months; for (var k = 0; k < mc.paths; k++) { var j = k * M0 + m - 1; a.push((I.amt * mc.A[j] + I.c * mc.B[j]) / (usd * mc.X[j])); } vU = P.quantile(a, 0.5); }
      var tgt = I.gCur === 'USD' ? '$' + bare(I.gT * 100) : fT(I.gT);
      h += '<div class="kpis grid lab-kpis">' + kpi('Hedefe ulaşma olasılığı', pr(p), tgt + ' · ' + I.gY + ' yıl', p >= 0.75 ? 'pos' : p < 0.4 ? 'neg' : '') + kpi('Medyan değer (' + I.gY + ' yıl)', fT(s.p50), vU != null ? '≈ $' + bare(vU * 100) + ' (senaryodaki kurla)' : '') + kpi('Toplam yatırılan', fT(s.invested)) + '</div>';
      h += '<div class="tscroll"><table class="atable stack"><thead><tr><th>Bu olasılıkla ulaşmak için</th><th>Gereken aylık yatırım</th><th>Şu ankine göre</th></tr></thead><tbody>' + [0.5, 0.75, 0.9].map(function (q) {
        var c = P.requiredContrib(mc, m, I.amt, I.gT, I.gCur, usd, q); return '<tr><td>%' + Math.round(q * 100) + '</td><td><span><b>' + fT(c) + '</b> / ay</span></td><td class="' + (num(c) && c > I.c ? 'neg' : 'pos') + '">' + (num(c) ? (c > I.c ? '+' + fT(c - I.c) + ' daha' : 'yeterli') : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">Dolar hedefinde her senaryonun kendi kur yolu kullanılır (TL değer kaybı hedefi büyütür). Gereken tutar = senaryoların seçilen yüzdesinde hedefe yeten en düşük aylık yatırım (başlangıç tutarı sabit). Olasılıklar geçmiş verinin istatistiğidir, garanti değildir.</p>';
      return h;
    }

    /* ---------- Ana bölüm ---------- */
    function section(id, P0, pf, opt) {
      opt = opt || {}; var S = ensure(id, pf, P0), I = inp(id, P0);
      var head = '<div class="pf-ins">' + field(id, 'amt', 'Tutar (TL)', I.amt, P0 && P0.amountK ? 'portföy tutarı' : 'örnek tutar') + field(id, 'c', 'Aylık ek yatırım (TL)', I.c, '0 = yalnız başlangıç') +
        '<label class="pf-in"><span>Dengeleme</span><select data-perf="reb" data-id="' + esc(id) + '"><option value="month"' + (I.reb === 'month' ? ' selected' : '') + '>Aylık</option><option value="quarter"' + (I.reb === 'quarter' ? ' selected' : '') + '>Çeyreklik</option><option value="none"' + (I.reb === 'none' ? ' selected' : '') + '>Al-tut</option></select></label></div>';
      var h = '<section class="card pf-sec" id="pf-past-' + esc(id) + '"><h2>Geçmiş performans: bu portföy ne kazandırırdı?</h2>' + warnBox() + head;
      if (!pf) return h + '<p class="hint">' + (opt.loading ? '<span class="spinner"></span> Fiyat geçmişi alınıyor…' : 'Fiyat geçmişi henüz yok; "Güncelle ve yeniden analiz et" ile alınır.') + '</p></section>';
      if (!S || S.busy) return h + '<p class="loading-line"><span class="spinner"></span> Fiyat geçmişi, kıyaslar (BIST 100, Katılım, dolar, altın) ve TÜFE alınıyor…</p></section>';
      if (S.err) return h + '<div class="notice danger">' + esc(S.err) + '</div></section>';
      if (S.R.error) return h + '<div class="notice warn">' + esc(S.R.error) + '</div></section>';
      h += pastHtml(id, S, P0) + '</section>';
      h += '<section class="card pf-sec"><h2>Gelecek tahmini: ne kazandırabilir?</h2>' + warnBox() + futureHtml(id, S, P0) + '</section>';
      h += '<section class="card pf-sec pf-stress"><h2>Stres testi: kriz senaryoları</h2>' + stressHtml(id, S, P0) + '</section><section class="card pf-sec pf-goal"><h2>Hedef hesaplayıcı</h2>' + goalHtml(id, S, P0) + '</section>';
      return h;
    }
    function onChange(el) {
      var f = el.dataset && el.dataset.perf, id = el.dataset && el.dataset.id; if (!f || !id) return false;
      var I = IN[id]; if (!I) return true;
      if (f === 'amt' || f === 'c' || f === 'gT') { var k = M.parse(el.value); if (k == null || k < 0 || (f !== 'c' && k <= 0)) { X.toast('Geçerli bir tutar yaz (ör. 10.000).'); X.render(); return true; } I[f] = Math.min(k / 100, 1e12); }
      else if (f === 'gY') I.gY = Math.max(1, Math.min(10, parseInt(el.value, 10) || 5));
      else if (f === 'reb') I.reb = ['month', 'quarter', 'none'].indexOf(el.value) >= 0 ? el.value : 'month';
      else if (f === 'gCur') I.gCur = el.value === 'TRY' ? 'TRY' : 'USD';
      X.render(); return true;
    }
    function actions(t) {
      return { 'perf-set': function () {
        var id = t.dataset.id, f = t.dataset.f, v = t.dataset.v, I = IN[id]; if (!I) return;
        if (f === 'per' || f === 'hz') I[f] = parseInt(v, 10) || 0; else if (f === 'shock') I.shock = parseFloat(v) || 0.2; else if (f === 'asm') { I.asm = v === 'temkinli' ? 'temkinli' : 'gecmis'; var S = ST[id]; if (S && S.R && !S.mc[I.asm]) runMC(id, S, I.asm); }
        X.render();
      } };
    }
    return { section: section, onChange: onChange, actions: actions, state: function (id) { return ST[id]; }, inputs: function (id) { return IN[id]; } };
  };
})();
