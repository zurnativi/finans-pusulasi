/* perf.js — v8.9.0: Portföyün GEÇMİŞ performansı ve GELECEK tahmini. Saf fonksiyonlar (ağ yok, DOM yok) — tümü testli; Web Worker'da da çalışır.
 * Geçmiş: güncel ağırlıklarla geriye dönük test (aylık/çeyreklik dengeleme ya da al-tut), dönem getirileri (1A…Maks), yıllık getiri,
 *   en büyük düşüş + toparlanma süresi, oynaklık, Sharpe/Sortino (eşik = TÜFE; faiz kullanılmaz), en iyi/kötü ay, aylık getiri ısı haritası,
 *   düzenli aylık yatırım (DCA) ve paranın-ağırlıklı getiri (XIRR), TÜFE ile reel getiri.
 * Gelecek: Monte Carlo — günlük portföy getirisi ile aynı günün USD/TL değişimi BİRLİKTE (aynı gün) yeniden örneklenir (durağan blok bootstrap:
 *   oynaklık kümelenmesi ve varlıklar arası korelasyon korunur; normal dağılım varsayılmaz). Her yol için A (1 TL'nin büyümesi),
 *   B (ay sonu katkılarının büyümesi), X (kur oranı), BX (dolara yatırılan katkıların büyümesi) tutulur → herhangi bir başlangıç tutarı ve aylık
 *   katkı için yüzdelikler, olasılıklar ve hedef için gereken aylık tutar ANINDA ve kesin hesaplanır (değer = başlangıç × A + katkı × B, doğrusal).
 * Stres: tarihî kriz dönemlerindeki gerçek faktör hareketleri (BIST 100, USD/TL, altın, gümüş, S&P 500) × varlığın gözlenen betası.
 * Hiçbir sayı uydurulmaz: veri yetmeyen dönem/ölçü null döner ve arayüz "veri yetersiz" yazar. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Perf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function num(x) { return typeof x === 'number' && isFinite(x); }
  var TD = 252, TDM = 21; // yılda / ayda işlem günü
  function dayNum(s) { var x = s.split('-'); return Date.UTC(+x[0], +x[1] - 1, +x[2]) / 86400000; }
  function ymdOf(dn) { return new Date(dn * 86400000).toISOString().slice(0, 10); }
  function addMonths(d, m) { var x = d.split('-'), y = +x[0], mo = +x[1] - 1 + m, dd = +x[2]; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); return y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(Math.min(dd, last)).padStart(2, '0'); }
  function sortNum(a) { return Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }); }
  function quantSorted(s, q) { if (!s.length) return null; var p = (s.length - 1) * q, i = Math.floor(p), f = p - i; return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i]; }
  function quantile(arr, q) { return quantSorted(sortNum(arr), q); }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : null; }
  function std(a) { var m = mean(a), s = 0; if (a.length < 2) return null; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }

  /* ---------- Hizalama: ortak başlangıçtan itibaren tüm tarihlerin birleşimi, eksik gün önceki kapanışla (en çok 7 takvim günü) ---------- */
  function align(lists, opt) {
    opt = opt || {}; var maxGap = opt.maxGap || 7;
    var ok = lists.filter(function (l) { return l && l.length; });
    if (ok.length !== lists.length || !lists.length) return { error: 'Fiyat geçmişi olmayan varlık var', dates: [], px: [] };
    var start = lists.reduce(function (m, l) { return l[0].d > m ? l[0].d : m; }, '0000');
    var end = lists.reduce(function (m, l) { var e = l[l.length - 1].d; return e < m ? e : m; }, '9999');
    var set = {}; lists.forEach(function (l) { l.forEach(function (b) { if (b.d >= start && b.d <= end && num(b.c) && b.c > 0) set[b.d] = 1; }); });
    var dates = Object.keys(set).sort(), maps = lists.map(function (l) { var m = {}; l.forEach(function (b) { if (num(b.c) && b.c > 0) m[b.d] = b.c; }); return m; });
    var px = lists.map(function () { return []; }), keep = [], lastV = lists.map(function () { return null; }), lastD = lists.map(function () { return null; });
    dates.forEach(function (d) {
      var row = [], good = true;
      for (var i = 0; i < maps.length; i++) {
        var v = maps[i][d];
        if (num(v)) { lastV[i] = v; lastD[i] = d; row.push(v); }
        else if (lastV[i] != null && dayNum(d) - dayNum(lastD[i]) <= maxGap) row.push(lastV[i]);
        else { good = false; break; }
      }
      if (good) { keep.push(d); row.forEach(function (v, i) { px[i].push(v); }); }
    });
    return { dates: keep, px: px, start: start, end: end, lens: lists.map(function (l) { return { n: l.length, from: l[0].d, to: l[l.length - 1].d }; }) };
  }

  /* ---------- Portföy değer serisi (1 ile başlar). mode: 'month' | 'quarter' | 'none' (al-tut) ---------- */
  function navOf(dates, px, w, mode) {
    var ws = w.reduce(function (s, x) { return s + x; }, 0); if (!(ws > 0) || !dates.length) return [];
    var wt = w.map(function (x) { return x / ws; }), units = null, out = [], per = null;
    function period(d) { return mode === 'quarter' ? d.slice(0, 4) + 'Q' + Math.floor((+d.slice(5, 7) - 1) / 3) : mode === 'none' ? 'x' : d.slice(0, 7); }
    for (var t = 0; t < dates.length; t++) {
      var val = 1;
      if (units) { val = 0; for (var i = 0; i < px.length; i++) val += units[i] * px[i][t]; }
      var p = period(dates[t]);
      if (!units || p !== per) { units = wt.map(function (x, i) { return val * x / px[i][t]; }); per = p; }
      out.push(val);
    }
    return out;
  }
  function rets(vals) { var r = []; for (var i = 1; i < vals.length; i++) r.push(vals[i] / vals[i - 1] - 1); return r; }

  /* ---------- Düşüş ve toparlanma ---------- */
  function drawdown(dates, vals) {
    if (!vals || vals.length < 2) return null;
    var peak = vals[0], peakI = 0, mdd = 0, pI = 0, tI = 0;
    for (var i = 1; i < vals.length; i++) { if (vals[i] > peak) { peak = vals[i]; peakI = i; } var dd = vals[i] / peak - 1; if (dd < mdd) { mdd = dd; pI = peakI; tI = i; } }
    var recI = null; if (mdd < 0) for (var j = tI + 1; j < vals.length; j++) if (vals[j] >= vals[pI]) { recI = j; break; }
    var cur = vals[vals.length - 1] / Math.max.apply(null, vals) - 1;
    return { mdd: mdd, peak: dates[pI], trough: dates[tI], recovered: recI != null ? dates[recI] : null, recDays: recI != null ? dayNum(dates[recI]) - dayNum(dates[tI]) : null,
      fallDays: dayNum(dates[tI]) - dayNum(dates[pI]), underDays: recI != null ? dayNum(dates[recI]) - dayNum(dates[pI]) : dayNum(dates[dates.length - 1]) - dayNum(dates[pI]), current: cur };
  }

  /* ---------- TÜFE: aylık % değişimden endeks; tarih aralığı için enflasyon çarpanı ---------- */
  // months: [{ym:'2026-10', m: 2.58}] (yüzde). Açıklanmamış aylar son 12 ayın ortalama aylık oranıyla TAHMİN edilir ve işaretlenir (est).
  function cpiPrep(months) {
    var ms = (months || []).filter(function (x) { return x && /^\d{4}-\d{2}$/.test(x.ym) && num(x.m); }).sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });
    if (ms.length < 13) return null;
    var map = {}; ms.forEach(function (x) { map[x.ym] = x.m / 100; });
    var last12 = ms.slice(-12), g = last12.reduce(function (p, x) { return p * (1 + x.m / 100); }, 1);
    return { map: map, first: ms[0].ym, last: ms[ms.length - 1].ym, avgM: Math.pow(g, 1 / 12) - 1, y12: g - 1 };
  }
  function ymNext(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); }
  function cpiLevel(C, d) { // ilk aydan önceki ay sonu = 1; ay içinde gün oranında geometrik
    var ym = d.slice(0, 7); if (ym < C.first) return null;
    var lvl = 1, cur = C.first, est = false;
    while (cur < ym) { var r = C.map[cur]; if (r == null) { r = C.avgM; est = true; } lvl *= 1 + r; cur = ymNext(cur); }
    var rm = C.map[ym]; if (rm == null) { rm = C.avgM; est = true; }
    var y = +ym.slice(0, 4), mo = +ym.slice(5, 7), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), frac = (+d.slice(8, 10)) / dim;
    return { v: lvl * Math.pow(1 + rm, frac), est: est };
  }
  function cpiFactor(C, from, to) {
    if (!C) return null; var a = cpiLevel(C, from), b = cpiLevel(C, to); if (!a || !b) return null;
    return { f: b.v / a.v, est: a.est || b.est, through: C.last };
  }

  /* ---------- Özet istatistikler ---------- */
  function stats(dates, vals, opt) {
    opt = opt || {}; if (!vals || vals.length < 2) return null;
    var r = rets(vals), days = dayNum(dates[dates.length - 1]) - dayNum(dates[0]), yrs = days / 365.25, tot = vals[vals.length - 1] / vals[0] - 1;
    var cagr = yrs > 0 ? Math.pow(1 + tot, 1 / yrs) - 1 : null, sd = std(r); if (sd != null && sd < 1e-10) sd = 0; var vol = sd != null ? sd * Math.sqrt(TD) : null;
    var hY = num(opt.hurdle) ? opt.hurdle : 0, hD = Math.pow(1 + hY, 1 / TD) - 1;
    var ex = r.map(function (x) { return x - hD; }), mex = mean(ex), dn = 0; ex.forEach(function (x) { if (x < 0) dn += x * x; }); dn = Math.sqrt(dn / ex.length); if (dn < 1e-10) dn = 0;
    var dd = drawdown(dates, vals);
    return { from: dates[0], to: dates[dates.length - 1], days: days, n: vals.length, total: tot, cagr: cagr, annualized: yrs >= 1, vol: vol,
      sharpe: sd > 0 ? mex / sd * Math.sqrt(TD) : null, sortino: dn > 0 ? mex / dn * Math.sqrt(TD) : null, hurdle: hY, mdd: dd ? dd.mdd : null, dd: dd };
  }
  // Dönem getirisi: bitişten geriye 'months' ay (0 = maks). Başlangıç verinin ilk gününden 7 günden fazla önceyse null (veri yetersiz).
  function periodIdx(dates, months) {
    if (!dates.length) return null; var end = dates[dates.length - 1];
    if (!months) return { i: 0, from: dates[0], to: end };
    var target = addMonths(end, -months); if (dayNum(dates[0]) - dayNum(target) > 7) return null;
    var i = 0; while (i < dates.length - 1 && dates[i + 1] <= target) i++;
    if (dates[i] > target && i > 0) i--;
    return { i: i, from: dates[i], to: end, target: target };
  }
  function periodRet(dates, vals, months) { var p = periodIdx(dates, months); if (!p) return null; return { r: vals[vals.length - 1] / vals[p.i] - 1, from: p.from, to: p.to, i: p.i }; }
  // Takvim ayları: her ayın son kapanışı / önceki ayın son kapanışı − 1 (ilk ay, ilk günden). partial: ay tamamlanmamış.
  function monthly(dates, vals) {
    var out = [], prevV = vals[0], curM = dates[0].slice(0, 7), lastV = vals[0], firstOfSeries = true;
    for (var i = 0; i < dates.length; i++) {
      var m = dates[i].slice(0, 7);
      if (m !== curM) { out.push({ ym: curM, r: lastV / prevV - 1, partialStart: firstOfSeries }); firstOfSeries = false; prevV = lastV; curM = m; }
      lastV = vals[i];
    }
    out.push({ ym: curM, r: lastV / prevV - 1, partialStart: firstOfSeries, partialEnd: true });
    return out;
  }
  function bestWorstMonth(ms) { var full = ms.filter(function (x) { return !x.partialStart && !x.partialEnd; }); if (!full.length) return null; var b = full[0], w = full[0]; full.forEach(function (x) { if (x.r > b.r) b = x; if (x.r < w.r) w = x; }); return { best: b, worst: w, pos: full.filter(function (x) { return x.r > 0; }).length, n: full.length }; }
  function worstWindow(dates, vals, n) { if (vals.length <= n) return null; var w = null; for (var i = n; i < vals.length; i++) { var r = vals[i] / vals[i - n] - 1; if (!w || r < w.r) w = { r: r, from: dates[i - n], to: dates[i] }; } return w; }
  function bestWindow(dates, vals, n) { if (vals.length <= n) return null; var w = null; for (var i = n; i < vals.length; i++) { var r = vals[i] / vals[i - n] - 1; if (!w || r > w.r) w = { r: r, from: dates[i - n], to: dates[i] }; } return w; }

  /* ---------- Düzenli aylık yatırım (DCA) ---------- */
  // Başlangıçta 'init' TL, sonra her takvim ayının ilk işlem gününde 'monthly' TL yatırılır (portföy değer serisinden pay alınır).
  function dca(dates, vals, init, monthlyAmt, startIdx) {
    var s = startIdx || 0; if (vals.length - s < 2) return null;
    var units = 0, inv = 0, flows = [], series = [], curM = dates[s].slice(0, 7), t0 = dayNum(dates[s]);
    if (init > 0) { units += init / vals[s]; inv += init; flows.push({ t: 0, cf: -init }); }
    for (var i = s; i < dates.length; i++) {
      var m = dates[i].slice(0, 7);
      if (i > s && m !== curM && monthlyAmt > 0) { units += monthlyAmt / vals[i]; inv += monthlyAmt; flows.push({ t: (dayNum(dates[i]) - t0) / 365.25, cf: -monthlyAmt }); }
      curM = m; series.push({ d: dates[i], inv: inv, val: units * vals[i] });
    }
    var fin = units * vals[vals.length - 1]; flows.push({ t: (dayNum(dates[dates.length - 1]) - t0) / 365.25, cf: fin });
    return { invested: inv, value: fin, gain: fin - inv, ret: inv > 0 ? fin / inv - 1 : null, irr: xirr(flows), n: flows.length - 1, series: series };
  }
  // Para-ağırlıklı yıllık getiri: Σ cf / (1+r)^t = 0 (Newton + ikiye bölme yedeği)
  function xirr(flows) {
    if (!flows || flows.length < 2) return null; var hasPos = flows.some(function (f) { return f.cf > 0; }), hasNeg = flows.some(function (f) { return f.cf < 0; }); if (!hasPos || !hasNeg) return null;
    function npv(r) { var s = 0; flows.forEach(function (f) { s += f.cf / Math.pow(1 + r, f.t); }); return s; }
    var lo = -0.99, hi = 10, flo = npv(lo), fhi = npv(hi); if (flo * fhi > 0) return null;
    for (var k = 0; k < 200; k++) { var mid = (lo + hi) / 2, fm = npv(mid); if (Math.abs(fm) < 1e-9) return mid; if (fm * flo > 0) { lo = mid; flo = fm; } else { hi = mid; } }
    return (lo + hi) / 2;
  }
  // Aynı aylık takvimle başka bir seriye (USD, gram altın) veya TÜFE'ye endeksli yatırım: karşılaştırma için
  function dcaOnSeries(dates, seriesMap, init, monthlyAmt) { var v = []; for (var i = 0; i < dates.length; i++) { var x = seriesMap[dates[i]]; if (!num(x)) return null; v.push(x); } return dca(dates, v, init, monthlyAmt); }

  /* ---------- Rastgele sayı (tekrarlanabilir) ---------- */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- Monte Carlo (durağan blok bootstrap) ---------- */
  // o: { rp: günlük portföy getirileri, rx: aynı günlerin USD/TL getirileri (yoksa null), months, paths, seed, block (ortalama blok boyu, gün),
  //      drift: null (geçmiş aynen) | yıllık hedef getiri (ör. enflasyon; günlük getiriler ortalaması bu olacak şekilde kaydırılır, oynaklık/şekil korunur) }
  function monteCarlo(o) {
    var rp = o.rp, n = rp.length, M = o.months || 60, P = o.paths || 5000, B = o.block || 10, R = rng(o.seed == null ? 12345 : o.seed);
    if (n < 60) return { error: 'Monte Carlo için en az 60 günlük ortak geçmiş gerekir (' + n + ' gün var)' };
    var rx = o.rx && o.rx.length === n ? o.rx : null, adj = 0;
    if (num(o.drift)) { var lm = 0; for (var i = 0; i < n; i++) lm += Math.log(1 + rp[i]); lm /= n; adj = Math.log(1 + o.drift) / TD - lm; }
    var lp = new Float64Array(n), lx = new Float64Array(n);
    for (var j = 0; j < n; j++) { lp[j] = Math.log(1 + rp[j]) + adj; lx[j] = rx ? Math.log(1 + rx[j]) : 0; }
    var A = new Float32Array(P * M), Bk = new Float32Array(P * M), X = rx ? new Float32Array(P * M) : null, BX = rx ? new Float32Array(P * M) : null, pNew = 1 / B;
    for (var p = 0; p < P; p++) {
      var idx = Math.floor(R() * n), la = 0, lxa = 0, b = 0, bx = 0;
      for (var m = 0; m < M; m++) {
        var gm = 0, gx = 0;
        for (var d = 0; d < TDM; d++) {
          if (R() < pNew) idx = Math.floor(R() * n); else { idx++; if (idx >= n) idx = 0; }
          gm += lp[idx]; gx += lx[idx];
        }
        la += gm; lxa += gx; var em = Math.exp(gm), ex = Math.exp(gx);
        b = b * em + 1; bx = bx * ex + 1; // ay sonu katkısı: önceki katkılar bu ay büyür, yeni katkı eklenir
        var k = p * M + m; A[k] = Math.exp(la); Bk[k] = b; if (X) { X[k] = Math.exp(lxa); BX[k] = bx; }
      }
    }
    return { paths: P, months: M, A: A, B: Bk, X: X, BX: BX, n: n, block: B, drift: num(o.drift) ? o.drift : null, seed: o.seed == null ? 12345 : o.seed };
  }
  // m: ay (1..M). init: başlangıç TL, c: aylık katkı TL. infl: yıllık enflasyon varsayımı (olasılık için). usd0 gereksiz (oranlarla çalışılır).
  function valuesAt(mc, m, init, c) { var P = mc.paths, M = mc.months, out = new Float64Array(P); for (var p = 0; p < P; p++) { var k = p * M + m - 1; out[p] = init * mc.A[k] + c * mc.B[k]; } return out; }
  function invested(m, init, c) { return init + c * m; }
  function inflInvested(m, init, c, infl) { var g = Math.pow(1 + infl, 1 / 12), s = init * Math.pow(g, m); for (var k = 1; k <= m; k++) s += c * Math.pow(g, m - k); return s; }
  function summaryAt(mc, m, init, c, infl) {
    var v = valuesAt(mc, m, init, c), s = sortNum(v), inv = invested(m, init, c), P = mc.paths, loss = 0, beatI = 0, beatU = 0, hasU = !!mc.X, iv = num(infl) ? inflInvested(m, init, c, infl) : null;
    for (var p = 0; p < P; p++) {
      if (v[p] < inv) loss++;
      if (iv != null && v[p] > iv) beatI++;
      if (hasU) { var k = p * mc.months + m - 1; if (v[p] > init * mc.X[k] + c * mc.BX[k]) beatU++; }
    }
    return { m: m, invested: inv, p5: quantSorted(s, 0.05), p25: quantSorted(s, 0.25), p50: quantSorted(s, 0.5), p75: quantSorted(s, 0.75), p95: quantSorted(s, 0.95), mean: mean(v),
      pLoss: loss / P, pBeatInfl: iv != null ? beatI / P : null, inflInvested: iv, pBeatUsd: hasU ? beatU / P : null };
  }
  function fan(mc, init, c, step) { var out = [], st = step || 1; for (var m = st; m <= mc.months; m += st) { var s = sortNum(valuesAt(mc, m, init, c)); out.push({ m: m, p5: quantSorted(s, 0.05), p25: quantSorted(s, 0.25), p50: quantSorted(s, 0.5), p75: quantSorted(s, 0.75), p95: quantSorted(s, 0.95) }); } return out; }
  // Hedef: target (TL ya da USD; USD ise usdNow ile bugünün kuru, yol üzerindeki kur X ile) → olasılık
  function goalProb(mc, m, init, c, target, cur, usdNow) {
    if (cur === 'USD' && !mc.X) return null; var P = mc.paths, M = mc.months, hit = 0;
    for (var p = 0; p < P; p++) { var k = p * M + m - 1, v = init * mc.A[k] + c * mc.B[k], T = cur === 'USD' ? target * usdNow * mc.X[k] : target; if (v >= T) hit++; }
    return hit / P;
  }
  // Seçilen olasılıkla hedefe ulaşmak için gereken aylık tutar: her yol için gereken c_i = max(0, (T_i − init·A_i) / B_i) → c'nin 'prob' yüzdeliği
  function requiredContrib(mc, m, init, target, cur, usdNow, prob) {
    if (cur === 'USD' && !mc.X) return null; var P = mc.paths, M = mc.months, need = new Float64Array(P);
    for (var p = 0; p < P; p++) { var k = p * M + m - 1, T = cur === 'USD' ? target * usdNow * mc.X[k] : target; need[p] = Math.max(0, (T - init * mc.A[k]) / mc.B[k]); }
    return quantile(need, prob);
  }

  /* ---------- Beta ve stres ---------- */
  function beta(a, f) { // aynı uzunlukta günlük getiriler
    if (!a || !f || a.length !== f.length || a.length < 60) return null;
    var ma = mean(a), mf = mean(f), cov = 0, vf = 0; for (var i = 0; i < a.length; i++) { cov += (a[i] - ma) * (f[i] - mf); vf += (f[i] - mf) * (f[i] - mf); }
    return vf > 0 ? cov / vf : null;
  }
  // Bir varlığın stres eşlemesi: { type: 'xu100' | 'gold' | 'silver' | 'usd' | 'spy' | 'cash' | 'none', beta }
  // Senaryo faktörleri f: { XU100, USDTRY, XAUUSD, XAGUSD, SPY } (dönem getirileri). TL getirisi döner (null = hesaplanamaz).
  function shockOf(map, f) {
    if (!map || !f) return null; var b = num(map.beta) ? map.beta : 1;
    function g(k) { return num(f[k]) ? f[k] : null; }
    switch (map.type) {
      case 'cash': return 0;
      case 'xu100': return g('XU100') == null ? null : b * g('XU100');
      case 'usd': return g('USDTRY');
      case 'gold': return g('XAUUSD') == null || g('USDTRY') == null ? null : (1 + g('XAUUSD')) * (1 + g('USDTRY')) - 1;
      case 'silver': return g('XAGUSD') == null || g('USDTRY') == null ? null : (1 + g('XAGUSD')) * (1 + g('USDTRY')) - 1;
      case 'spy': return g('SPY') == null || g('USDTRY') == null ? null : (1 + b * g('SPY')) * (1 + g('USDTRY')) - 1;
      default: return null;
    }
  }
  function stress(items, f) { // items: [{w, map, name}] → portföy TL getirisi; hesaplanamayan varlık payı listelenir
    var tw = 0, r = 0, miss = [], per = [];
    items.forEach(function (it) { var s = shockOf(it.map, f); per.push({ name: it.name, r: s, w: it.w }); if (s == null) miss.push(it.name); else { r += it.w * s; tw += it.w; } });
    var all = items.reduce(function (s, x) { return s + x.w; }, 0);
    return { r: tw > 0 ? r / tw : null, coverage: all > 0 ? tw / all : 0, missing: miss, per: per, usd: num(f.USDTRY) && tw > 0 ? (1 + r / tw) / (1 + f.USDTRY) - 1 : null };
  }

  return { TD: TD, TDM: TDM, dayNum: dayNum, ymdOf: ymdOf, addMonths: addMonths, quantile: quantile, mean: mean, std: std, align: align, navOf: navOf, rets: rets, drawdown: drawdown,
    cpiPrep: cpiPrep, cpiLevel: cpiLevel, cpiFactor: cpiFactor, stats: stats, periodIdx: periodIdx, periodRet: periodRet, monthly: monthly, bestWorstMonth: bestWorstMonth, worstWindow: worstWindow, bestWindow: bestWindow,
    dca: dca, xirr: xirr, dcaOnSeries: dcaOnSeries, rng: rng, monteCarlo: monteCarlo, valuesAt: valuesAt, invested: invested, inflInvested: inflInvested, summaryAt: summaryAt, fan: fan,
    goalProb: goalProb, requiredContrib: requiredContrib, beta: beta, shockOf: shockOf, stress: stress };
});
