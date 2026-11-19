/* ta.js — Teknik gösterge kütüphanesi (saf fonksiyonlar, tarayıcı + Node). Fiyat hesabı ondalık sayıdır (para değil; kuruş kuralı burada geçerli değil).
 * Tanımlar sektör standardı TA-Lib ile aynıdır (tohumlama dahil); tests/run-tests-v7.js her göstergeyi TA-Lib 0.8.3 ve bağımsız Python
 * uygulamalarından üretilmiş referans değerlerle (tests/fixtures/ta-reference.json) karşılaştırır.
 * Kural: tanımsız noktalar null döner (ısınma dönemi). Girdide null/NaN varsa, ilgili pencere null sayılır — hiçbir değer uydurulmaz. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function nulls(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = null; return a; }
  function last(a) { for (var i = a.length - 1; i >= 0; i--) if (num(a[i])) return a[i]; return null; }
  function lastIdx(a) { for (var i = a.length - 1; i >= 0; i--) if (num(a[i])) return i; return -1; }

  /* ---------- Hareketli ortalamalar ---------- */
  function sma(x, n) {
    var out = nulls(x.length), s = 0, cnt = 0;
    for (var i = 0; i < x.length; i++) {
      if (!num(x[i])) { s = 0; cnt = 0; continue; } // boşluk: pencere sıfırlanır
      s += x[i]; cnt++;
      if (cnt > n) { s -= x[i - n]; cnt = n; }
      if (cnt === n) out[i] = s / n;
    }
    return out;
  }
  // EMA (TA-Lib): k = 2/(n+1), ilk değer ilk n değerin basit ortalaması
  function ema(x, n, kOverride) {
    var out = nulls(x.length), k = kOverride || 2 / (n + 1), start = firstRun(x, n);
    if (start < 0) return out;
    var s = 0; for (var i = start; i < start + n; i++) s += x[i];
    var prev = s / n; out[start + n - 1] = prev;
    for (i = start + n; i < x.length; i++) { if (!num(x[i])) break; prev = (x[i] - prev) * k + prev; out[i] = prev; }
    return out;
  }
  // Wilder (RMA): k = 1/n, SMA tohumlu
  function rma(x, n) { return ema(x, n, 1 / n); }
  function wma(x, n) {
    var out = nulls(x.length), den = n * (n + 1) / 2;
    for (var i = n - 1; i < x.length; i++) { var s = 0, ok = true; for (var j = 0; j < n; j++) { var v = x[i - j]; if (!num(v)) { ok = false; break; } s += v * (n - j); } if (ok) out[i] = s / den; }
    return out;
  }
  function firstRun(x, n) { var run = 0; for (var i = 0; i < x.length; i++) { if (num(x[i])) { run++; if (run === n) return i - n + 1; } else run = 0; } return -1; }
  // Kayan pencere en büyük/küçük ve standart sapma
  function rollMax(x, n) { var o = nulls(x.length); for (var i = n - 1; i < x.length; i++) { var m = -Infinity, ok = true; for (var j = i - n + 1; j <= i; j++) { if (!num(x[j])) { ok = false; break; } if (x[j] > m) m = x[j]; } if (ok) o[i] = m; } return o; }
  function rollMin(x, n) { var o = nulls(x.length); for (var i = n - 1; i < x.length; i++) { var m = Infinity, ok = true; for (var j = i - n + 1; j <= i; j++) { if (!num(x[j])) { ok = false; break; } if (x[j] < m) m = x[j]; } if (ok) o[i] = m; } return o; }
  function stdev(x, n, ddof) { // ddof 0 = anakütle (TA-Lib BBANDS/STDDEV)
    var o = nulls(x.length), m = sma(x, n);
    for (var i = n - 1; i < x.length; i++) { if (!num(m[i])) continue; var s = 0; for (var j = i - n + 1; j <= i; j++) s += (x[j] - m[i]) * (x[j] - m[i]); o[i] = Math.sqrt(s / (n - (ddof || 0))); }
    return o;
  }

  /* ---------- Momentum ---------- */
  // RSI (Wilder, TA-Lib tohumlama): ilk ortalama kazanç/kayıp = ilk n değişimin ortalaması, ilk RSI n. indekste
  function rsi(c, n) {
    n = n || 14; var out = nulls(c.length); if (c.length <= n) return out;
    var g = 0, l = 0;
    for (var i = 1; i <= n; i++) { if (!num(c[i]) || !num(c[i - 1])) return out; var d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
    for (i = n + 1; i < c.length; i++) {
      if (!num(c[i]) || !num(c[i - 1])) break;
      var dd = c[i] - c[i - 1];
      g = (g * (n - 1) + (dd > 0 ? dd : 0)) / n; l = (l * (n - 1) + (dd < 0 ? -dd : 0)) / n;
      out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  // MACD (TA-Lib uyumlu): yavaş EMA ilk 'slow' değerle, hızlı EMA aynı güne biten son 'fast' değerle SMA-tohumlanır (ikisi de slow−1. indekste başlar);
  // sinyal = MACD çizgisinin EMA'sı; üç çıktı da TA-Lib gibi (slow−1)+(sig−1). indeksten itibaren verilir.
  function macd(c, fast, slow, sig) {
    fast = fast || 12; slow = slow || 26; sig = sig || 9;
    var off = Math.max(0, slow - fast), ef0 = ema(c.slice(off), fast), ef = nulls(off).concat(ef0), es = ema(c, slow);
    var line = c.map(function (_, i) { return num(ef[i]) && num(es[i]) ? ef[i] - es[i] : null; });
    var signal = ema(line, sig), hist = line.map(function (v, i) { return num(v) && num(signal[i]) ? v - signal[i] : null; });
    var start = slow - 1 + sig - 1;
    for (var i = 0; i < Math.min(start, c.length); i++) line[i] = null;
    return { macd: line, signal: signal, hist: hist };
  }
  // Stokastik (TA-Lib STOCH: yavaş %K = SMA(ham %K, kS), %D = SMA(%K, dS))
  function stochRaw(h, l, c, n) {
    var hh = rollMax(h, n), ll = rollMin(l, n);
    return c.map(function (v, i) { if (!num(hh[i]) || !num(ll[i]) || !num(v)) return null; var r = hh[i] - ll[i]; return r === 0 ? 0 : 100 * (v - ll[i]) / r; });
  }
  function stoch(h, l, c, n, kS, dS) { var raw = stochRaw(h, l, c, n || 14), k = sma(raw, kS || 3); return { raw: raw, k: k, d: sma(k, dS || 3) }; }
  // Stokastik RSI (TradingView tanımı): RSI(r) → stok(s) → %K = SMA(3), %D = SMA(%K, 3)
  function stochRsi(c, r, s, kS, dS) {
    var x = rsi(c, r || 14), raw = stochRaw(x, x, x, s || 14), k = sma(raw, kS || 3);
    return { rsi: x, raw: raw, k: k, d: sma(k, dS || 3) };
  }
  function roc(c, n) { return c.map(function (v, i) { return i >= n && num(v) && num(c[i - n]) && c[i - n] !== 0 ? 100 * (v - c[i - n]) / c[i - n] : null; }); }
  function willr(h, l, c, n) { var hh = rollMax(h, n), ll = rollMin(l, n); return c.map(function (v, i) { if (!num(hh[i]) || !num(ll[i])) return null; var r = hh[i] - ll[i]; return r === 0 ? 0 : -100 * (hh[i] - v) / r; }); }
  function cci(h, l, c, n) {
    n = n || 20; var tp = c.map(function (v, i) { return (h[i] + l[i] + v) / 3; }), m = sma(tp, n), o = nulls(c.length);
    for (var i = n - 1; i < c.length; i++) { if (!num(m[i])) continue; var md = 0; for (var j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]); md /= n; o[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md); }
    return o;
  }
  function mfi(h, l, c, v, n) {
    n = n || 14; var tp = c.map(function (x, i) { return (h[i] + l[i] + x) / 3; }), o = nulls(c.length);
    for (var i = n; i < c.length; i++) {
      var pos = 0, neg = 0, ok = true;
      for (var j = i - n + 1; j <= i; j++) { if (!num(v[j]) || !num(tp[j]) || !num(tp[j - 1])) { ok = false; break; } var f = tp[j] * v[j]; if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; }
      if (ok) o[i] = pos + neg === 0 ? 50 : neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    }
    return o;
  }

  /* ---------- Volatilite ---------- */
  function trueRange(h, l, c) { return h.map(function (v, i) { if (i === 0 || !num(c[i - 1])) return null; return Math.max(v - l[i], Math.abs(v - c[i - 1]), Math.abs(l[i] - c[i - 1])); }); }
  // ATR (TA-Lib): ilk ATR = TR[1..n] ortalaması (indeks n), sonra Wilder
  function atr(h, l, c, n) { n = n || 14; return rma(trueRange(h, l, c), n); }
  function bollinger(c, n, k) { n = n || 20; k = k || 2; var m = sma(c, n), sd = stdev(c, n, 0); return { mid: m, upper: m.map(function (v, i) { return num(v) ? v + k * sd[i] : null; }), lower: m.map(function (v, i) { return num(v) ? v - k * sd[i] : null; }), width: m.map(function (v, i) { return num(v) && v !== 0 ? 2 * k * sd[i] / v : null; }) }; }
  function keltner(h, l, c, n, mult) { var m = ema(c, n || 20), a = atr(h, l, c, n || 20); mult = mult || 2; return { mid: m, upper: m.map(function (v, i) { return num(v) && num(a[i]) ? v + mult * a[i] : null; }), lower: m.map(function (v, i) { return num(v) && num(a[i]) ? v - mult * a[i] : null; }) }; }

  /* ---------- Trend ---------- */
  // ADX / +DI / −DI (Wilder). Wilder toplamları SMA-tohumlu RMA ile; uzun serilerde TA-Lib ile aynı değere yakınsar (testte kuyruk karşılaştırması).
  function adx(h, l, c, n) {
    n = n || 14; var len = c.length, pdm = nulls(len), mdm = nulls(len);
    for (var i = 1; i < len; i++) { var up = h[i] - h[i - 1], dn = l[i - 1] - l[i]; pdm[i] = up > dn && up > 0 ? up : 0; mdm[i] = dn > up && dn > 0 ? dn : 0; }
    var tr = trueRange(h, l, c), str = wilderSum(tr, n), sp = wilderSum(pdm, n), sm = wilderSum(mdm, n);
    var pdi = nulls(len), mdi = nulls(len), dx = nulls(len);
    for (i = 0; i < len; i++) if (num(str[i]) && str[i] > 0) { pdi[i] = 100 * sp[i] / str[i]; mdi[i] = 100 * sm[i] / str[i]; var s = pdi[i] + mdi[i]; dx[i] = s === 0 ? 0 : 100 * Math.abs(pdi[i] - mdi[i]) / s; }
    return { adx: rma(dx, n), pdi: pdi, mdi: mdi, dx: dx };
  }
  // TA-Lib Wilder toplamı: ilk değer = ilk (n−1) değerin toplamı, sonra önceki − önceki/n + yeni (ilk çıktı n. indekste)
  function wilderSum(x, n) {
    var out = nulls(x.length), s = 0, i;
    if (x.length <= n) return out;
    for (i = 1; i < n; i++) { if (!num(x[i])) return out; s += x[i]; }
    for (i = n; i < x.length; i++) { if (!num(x[i])) break; s = s - s / n + x[i]; out[i] = s; }
    return out;
  }
  // Ichimoku (9, 26, 52). Öncü A/B, ileri kaydırılmış dizilerdir: senkouA[i] = i−25 anındaki (tenkan+kijun)/2 (içinde bulunulan gün 1 sayılır → 26 periyot;
  // TradingView 'offset = displacement − 1' ve pandas_ta ile aynı). Gecikmeli çizgi (chikou) 25 gün geriye. Geleceğe uzanan bulut futureA/futureB dizilerinde.
  function ichimoku(h, l, c, t, k, b, shift) {
    t = t || 9; k = k || 26; b = b || 52; shift = shift == null ? 25 : shift;
    var mid = function (n) { var hh = rollMax(h, n), ll = rollMin(l, n); return hh.map(function (v, i) { return num(v) && num(ll[i]) ? (v + ll[i]) / 2 : null; }); };
    var tenkan = mid(t), kijun = mid(k), bb = mid(b), len = c.length;
    var aRaw = tenkan.map(function (v, i) { return num(v) && num(kijun[i]) ? (v + kijun[i]) / 2 : null; });
    var A = nulls(len), B = nulls(len), chikou = nulls(len), futA = [], futB = [];
    for (var i = 0; i < len; i++) { if (i - shift >= 0) { A[i] = aRaw[i - shift]; B[i] = bb[i - shift]; } if (i + shift < len) chikou[i] = c[i + shift]; }
    for (i = len - shift; i < len; i++) { futA.push(i >= 0 ? aRaw[i] : null); futB.push(i >= 0 ? bb[i] : null); }
    return { tenkan: tenkan, kijun: kijun, senkouA: A, senkouB: B, chikou: chikou, futureA: futA, futureB: futB, shift: shift };
  }
  // Supertrend (ATR n, çarpan m) — TradingView algoritması; ATR Wilder (SMA tohumlu). dir: 1 yükseliş, −1 düşüş
  function supertrend(h, l, c, n, m) {
    n = n || 10; m = m || 3; var a = atr(h, l, c, n), len = c.length, st = nulls(len), dir = nulls(len), fu = nulls(len), fl = nulls(len);
    for (var i = 0; i < len; i++) {
      if (!num(a[i])) continue;
      var hl2 = (h[i] + l[i]) / 2, bu = hl2 + m * a[i], bl = hl2 - m * a[i];
      var pu = fu[i - 1], pl = fl[i - 1], pc = c[i - 1];
      fu[i] = num(pu) && !(bu < pu || pc > pu) ? pu : bu;
      fl[i] = num(pl) && !(bl > pl || pc < pl) ? pl : bl;
      var pd = dir[i - 1];
      if (!num(pd)) dir[i] = 1; // ilk değer: TradingView ile aynı başlangıç (yükseliş varsayımı)
      else if (pd === -1) dir[i] = c[i] > pu ? 1 : -1; // önceki düşüşte: üst bandı aşarsa yükselişe döner
      else dir[i] = c[i] < pl ? -1 : 1;
      st[i] = dir[i] === 1 ? fl[i] : fu[i];
    }
    return { line: st, dir: dir, upper: fu, lower: fl };
  }

  /* ---------- Hacim ---------- */
  function obv(c, v) { // TA-Lib: obv[0] = hacim[0]
    var o = nulls(c.length); if (!c.length || !num(v[0])) return o; o[0] = v[0];
    for (var i = 1; i < c.length; i++) { if (!num(v[i]) || !num(o[i - 1])) break; o[i] = o[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0); }
    return o;
  }
  // Çapalı VWAP: belirli indeksten itibaren tipik fiyatın hacim ağırlıklı ortalaması
  function vwapAnchored(h, l, c, v, from) {
    var o = nulls(c.length), pv = 0, vv = 0;
    for (var i = Math.max(0, from); i < c.length; i++) { if (!num(v[i]) || v[i] <= 0) { o[i] = vv ? pv / vv : null; continue; } var tp = (h[i] + l[i] + c[i]) / 3; pv += tp * v[i]; vv += v[i]; o[i] = pv / vv; }
    return o;
  }
  function vwapRolling(h, l, c, v, n) {
    var o = nulls(c.length);
    for (var i = n - 1; i < c.length; i++) { var pv = 0, vv = 0, ok = true; for (var j = i - n + 1; j <= i; j++) { if (!num(v[j])) { ok = false; break; } pv += (h[j] + l[j] + c[j]) / 3 * v[j]; vv += v[j]; } if (ok && vv > 0) o[i] = pv / vv; }
    return o;
  }
  // Hacim profili: son n mumda hacmin fiyat dilimlerine dağılımı (her mumun hacmi düşük-yüksek aralığına eşit yayılır). POC + %70 değer alanı.
  function volumeProfile(h, l, v, n, bins) {
    var len = h.length, from = Math.max(0, len - (n || 120)), lo = Infinity, hi = -Infinity, i, b;
    bins = bins || 24;
    for (i = from; i < len; i++) { if (!num(v[i]) || v[i] <= 0) continue; if (l[i] < lo) lo = l[i]; if (h[i] > hi) hi = h[i]; }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
    var step = (hi - lo) / bins, vol = []; for (b = 0; b < bins; b++) vol.push(0);
    for (i = from; i < len; i++) {
      if (!num(v[i]) || v[i] <= 0) continue;
      var b0 = Math.min(bins - 1, Math.floor((l[i] - lo) / step)), b1 = Math.min(bins - 1, Math.floor((h[i] - lo) / step)), share = v[i] / (b1 - b0 + 1);
      for (b = b0; b <= b1; b++) vol[b] += share;
    }
    var total = vol.reduce(function (s, x) { return s + x; }, 0), poc = 0;
    for (b = 1; b < bins; b++) if (vol[b] > vol[poc]) poc = b;
    var inVA = [poc], acc = vol[poc], lo2 = poc, hi2 = poc;
    while (acc < 0.7 * total && (lo2 > 0 || hi2 < bins - 1)) {
      var dn = lo2 > 0 ? vol[lo2 - 1] : -1, up = hi2 < bins - 1 ? vol[hi2 + 1] : -1;
      if (up >= dn) { hi2++; acc += vol[hi2]; } else { lo2--; acc += vol[lo2]; }
    }
    return { lo: lo, hi: hi, step: step, bins: vol.map(function (x, k) { return { from: lo + k * step, to: lo + (k + 1) * step, vol: x }; }), poc: lo + (poc + 0.5) * step, vaLow: lo + lo2 * step, vaHigh: lo + (hi2 + 1) * step, total: total };
  }

  /* ---------- İstatistik (getiri, risk) ---------- */
  function returns(c) { var r = []; for (var i = 1; i < c.length; i++) if (num(c[i]) && num(c[i - 1]) && c[i - 1] > 0) r.push(c[i] / c[i - 1] - 1); return r; }
  function logReturns(c) { var r = []; for (var i = 1; i < c.length; i++) if (num(c[i]) && num(c[i - 1]) && c[i - 1] > 0 && c[i] > 0) r.push(Math.log(c[i] / c[i - 1])); return r; }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function sd(a, ddof) { if (a.length < 2) return null; var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - (ddof == null ? 1 : ddof))); }
  function annVol(c, periodsPerYear) { var r = logReturns(c); var s = sd(r); return s == null ? null : s * Math.sqrt(periodsPerYear || 252); }
  function maxDrawdown(c) {
    var peak = -Infinity, mdd = 0, pi = -1, from = -1, to = -1, curPeakI = -1;
    for (var i = 0; i < c.length; i++) { if (!num(c[i])) continue; if (c[i] > peak) { peak = c[i]; curPeakI = i; } var dd = c[i] / peak - 1; if (dd < mdd) { mdd = dd; from = curPeakI; to = i; } }
    var cur = 0; var lp = lastIdx(c); if (lp >= 0) { var pk = -Infinity; for (i = 0; i <= lp; i++) if (num(c[i]) && c[i] > pk) pk = c[i]; cur = c[lp] / pk - 1; }
    return { mdd: mdd, from: from, to: to, current: cur };
  }
  // Sharpe/Sortino (yıllık): ortalama (getiri − rf/periyot) / sapma × √periyot. rf yıllık oran (ör. 0 veya kullanıcı girdisi)
  function sharpe(c, rfAnnual, ppy) { ppy = ppy || 252; var r = returns(c); if (r.length < 20) return null; var rf = Math.pow(1 + (rfAnnual || 0), 1 / ppy) - 1, ex = r.map(function (x) { return x - rf; }), s = sd(ex); return s ? mean(ex) / s * Math.sqrt(ppy) : null; }
  function sortino(c, rfAnnual, ppy) { ppy = ppy || 252; var r = returns(c); if (r.length < 20) return null; var rf = Math.pow(1 + (rfAnnual || 0), 1 / ppy) - 1, ex = r.map(function (x) { return x - rf; }); var dn = ex.map(function (x) { return x < 0 ? x * x : 0; }); var dd = Math.sqrt(mean(dn)); return dd ? mean(ex) / dd * Math.sqrt(ppy) : null; }
  function cagr(c, days) { var i0 = -1, i1 = lastIdx(c); for (var i = 0; i < c.length; i++) if (num(c[i]) && c[i] > 0) { i0 = i; break; } if (i0 < 0 || i1 <= i0 || !days) return null; return Math.pow(c[i1] / c[i0], 365 / days) - 1; }
  function correlation(a, b) {
    var n = Math.min(a.length, b.length); if (n < 3) return null; var ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n)), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
  }
  function beta(a, b) { var n = Math.min(a.length, b.length); if (n < 20) return null; var mb = mean(b.slice(0, n)), ma = mean(a.slice(0, n)), cov = 0, vb = 0; for (var i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); vb += (b[i] - mb) * (b[i] - mb); } return vb ? cov / vb : null; }
  // Doğrusal regresyon (en küçük kareler): y = a + b·x
  function linreg(xs, ys) { var n = xs.length; if (n < 2) return null; var mx = mean(xs), my = mean(ys), sxy = 0, sxx = 0, syy = 0; for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); } if (!sxx) return null; var b = sxy / sxx; return { slope: b, intercept: my - b * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1 }; }

  return { num: num, nulls: nulls, last: last, lastIdx: lastIdx, sma: sma, ema: ema, rma: rma, wma: wma, rollMax: rollMax, rollMin: rollMin, stdev: stdev, rsi: rsi, macd: macd, stoch: stoch, stochRaw: stochRaw, stochRsi: stochRsi,
    roc: roc, willr: willr, cci: cci, mfi: mfi, trueRange: trueRange, atr: atr, bollinger: bollinger, keltner: keltner, adx: adx, wilderSum: wilderSum, ichimoku: ichimoku, supertrend: supertrend,
    obv: obv, vwapAnchored: vwapAnchored, vwapRolling: vwapRolling, volumeProfile: volumeProfile, returns: returns, logReturns: logReturns, mean: mean, sd: sd, annVol: annVol, maxDrawdown: maxDrawdown,
    sharpe: sharpe, sortino: sortino, cagr: cagr, correlation: correlation, beta: beta, linreg: linreg };
});
