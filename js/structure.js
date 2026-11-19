/* structure.js — Grafik yapısı: tepe/dip (pivot), ATR zikzak, destek/direnç bölgeleri, trend çizgileri ve kanal, Fibonacci,
 * formasyonlar (ikili tepe/dip, OBO/TOBO, üçgenler, bayrak) ve uyumsuzluklar. Saf ve deterministik (aynı veri → aynı sonuç).
 * Tüm eşikler ATR (ortalama gerçek aralık) cinsindendir; böylece kural yüzdeye değil, varlığın kendi oynaklığına göre ölçeklenir.
 * Hiçbir seviye sabit yüzdeyle uydurulmaz: her seviye geçmiş fiyat noktalarına dayanır ve hangi noktalardan çıktığı döndürülür. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ta.js'));
  else root.Structure = factory(root.TA);
})(typeof self !== 'undefined' ? self : this, function (TA) {
  'use strict';
  var num = TA.num;
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* Pivot: solunda 'left' mum boyunca kesin, sağında 'right' mum boyunca eşit-veya-büyük olmayan en yüksek (dip için tersi). Sağdaki mumlar oluşmadan pivot onaylanmaz. */
  function pivots(h, l, left, right) {
    left = left || 5; right = right == null ? left : right; var out = [];
    for (var i = left; i < h.length - right; i++) {
      var isH = num(h[i]), isL = num(l[i]), j;
      for (j = i - left; j < i && (isH || isL); j++) { if (!(h[i] > h[j])) isH = false; if (!(l[i] < l[j])) isL = false; }
      for (j = i + 1; j <= i + right && (isH || isL); j++) { if (h[j] > h[i]) isH = false; if (l[j] < l[i]) isL = false; }
      if (isH) out.push({ i: i, type: 'H', p: h[i] });
      if (isL) out.push({ i: i, type: 'L', p: l[i] });
    }
    return out;
  }

  /* ATR zikzak: fiyat son uç noktadan mult×ATR kadar geri dönünce o uç nokta onaylı salınım (swing) olur.
   * Dönen dizi dönüşümlü H/L'dir; son eleman 'tentative' (henüz onaylanmamış güncel uç) olabilir. */
  function zigzag(h, l, atr, mult) {
    mult = mult || 2.5; var sw = [], dir = 0, hiI = -1, loI = -1, i, start = -1;
    for (i = 0; i < h.length; i++) if (num(atr[i])) { start = i; break; }
    if (start < 0) return sw;
    hiI = loI = start;
    for (i = start + 1; i < h.length; i++) {
      var th = mult * (num(atr[i]) ? atr[i] : atr[i - 1]);
      if (dir >= 0) {
        if (h[i] >= h[hiI]) hiI = i;
        if (dir === 0 && l[i] <= l[loI]) loI = i;
        if (dir === 0 && h[hiI] - l[loI] >= th) { // ilk yön: hangisi önce oluştuysa
          if (loI < hiI) { sw.push({ i: loI, type: 'L', p: l[loI] }); dir = 1; } else { sw.push({ i: hiI, type: 'H', p: h[hiI] }); dir = -1; loI = i; for (var k = hiI; k <= i; k++) if (l[k] <= l[loI]) loI = k; continue; }
        }
        if (dir === 1 && h[hiI] - l[i] >= th) { sw.push({ i: hiI, type: 'H', p: h[hiI] }); dir = -1; loI = i; }
      } else {
        if (l[i] <= l[loI]) loI = i;
        if (l[loI] + th <= h[i]) { sw.push({ i: loI, type: 'L', p: l[loI] }); dir = 1; hiI = i; }
      }
    }
    if (dir === 1) sw.push({ i: hiI, type: 'H', p: h[hiI], tentative: true });
    else if (dir === -1) sw.push({ i: loI, type: 'L', p: l[loI], tentative: true });
    return sw;
  }

  /* Destek/direnç bölgeleri: son 'look' mumdaki pivot ve zikzak noktaları fiyata göre sıralanır; aralarındaki fark tol×ATR'den küçükse aynı bölgeye
   * katılır (bölge genişliği en fazla tol×ATR; pencereli kümeleme). Güç = dokunuş sayısı + yakınlık ağırlığı. En az 2 dokunuşlu bölgeler (veya 52 haftalık uç) döner. */
  function zones(h, l, c, atr, opts) {
    opts = opts || {}; var len = c.length, look = opts.look || 260, from = Math.max(0, len - look), a = TA.last(atr), last = TA.last(c);
    if (!num(a) || !num(last)) return [];
    var tol = (opts.tol || 1.0) * a, pts = [];
    pivots(h, l, 3, 3).concat(zigzag(h, l, atr, 2).filter(function (s) { return !s.tentative; })).forEach(function (p) { if (p.i >= from) pts.push(p); });
    var seen = {}; pts = pts.filter(function (p) { var k = p.i + p.type; if (seen[k]) return false; seen[k] = 1; return true; });
    // 52 haftalık en yüksek / en düşük her zaman aday
    var hi52 = -Infinity, lo52 = Infinity, hiI = -1, loI = -1, f52 = Math.max(0, len - 252);
    for (var i = f52; i < len; i++) { if (h[i] > hi52) { hi52 = h[i]; hiI = i; } if (l[i] < lo52) { lo52 = l[i]; loI = i; } }
    pts.sort(function (x, y) { return x.p - y.p; });
    var cl = [];
    // Pencereli kümeleme: bölgenin genişliği en fazla tol (zincirleme ile geniş, anlamsız bölgeler oluşmaz)
    pts.forEach(function (p) { var g = cl[cl.length - 1]; if (g && p.p - g.lo <= tol) { g.pts.push(p); g.hi = p.p; } else cl.push({ lo: p.p, hi: p.p, pts: [p] }); });
    var out = cl.map(function (g) {
      var w = 0, sw = 0, rec = 0;
      g.pts.forEach(function (p) { var r = (p.i - from) / Math.max(1, len - from); var wt = 1 + r; w += wt; sw += wt * p.p; rec = Math.max(rec, r); });
      var mid = sw / w, lo = g.lo, hi = g.hi, minW = 0.25 * a;
      if (hi - lo < minW) { lo = mid - minW / 2; hi = mid + minW / 2; }
      var touches = g.pts.length, ext = g.pts.some(function (p) { return p.i === hiI || p.i === loI; });
      return { lo: lo, hi: hi, mid: mid, touches: touches, strength: Math.round((touches + w - touches) * 10) / 10, recency: rec, highs: g.pts.filter(function (p) { return p.type === 'H'; }).length,
        lows: g.pts.filter(function (p) { return p.type === 'L'; }).length, lastI: Math.max.apply(null, g.pts.map(function (p) { return p.i; })), points: g.pts.map(function (p) { return p.i; }), extreme: ext,
        role: hi < last ? 'support' : lo > last ? 'resistance' : 'inside' };
    }).filter(function (z) { return z.touches >= 2 || z.extreme; });
    return out.sort(function (x, y) { return x.mid - y.mid; });
  }
  function nearest(zs, price, role) {
    var best = null;
    zs.forEach(function (z) {
      if (role === 'support' && z.hi < price && (!best || z.hi > best.hi)) best = z;
      if (role === 'resistance' && z.lo > price && (!best || z.lo < best.lo)) best = z;
    });
    return best;
  }

  /* Trend çizgileri: iki pivot (en az 10 mum arayla) üzerinden geçen doğrular denenir. Geçerli çizgi: ilk pivottan son muma kadar hiçbir kapanış
   * çizginin 0,3×ATR'den fazla yanlış tarafında değildir. Puan = dokunuş (0,35×ATR yakınındaki pivotlar)×2 + uzunluk + yakınlık. En iyi destek (diplerden)
   * ve en iyi direnç (tepelerden) döner; 'value' son mumdaki çizgi değeridir. */
  function trendlines(h, l, c, atr, opts) {
    opts = opts || {}; var len = c.length, a = TA.last(atr), look = opts.look || 250, from = Math.max(0, len - look);
    if (!num(a) || len < 30) return { support: null, resistance: null };
    var pv = pivots(h, l, opts.left || 4, opts.right || 3).filter(function (p) { return p.i >= from; });
    function best(type) {
      var ps = pv.filter(function (p) { return p.type === type; }), top = null;
      for (var x = 0; x < ps.length; x++) for (var y = x + 1; y < ps.length; y++) {
        var A = ps[x], B = ps[y]; if (B.i - A.i < 10) continue;
        var slope = (B.p - A.p) / (B.i - A.i), ok = true, k;
        for (k = A.i; k < len; k++) { var v = A.p + slope * (k - A.i); if (type === 'L' ? c[k] < v - 0.3 * a : c[k] > v + 0.3 * a) { ok = false; break; } }
        if (!ok) continue;
        var touch = ps.filter(function (p) { return p.i >= A.i && Math.abs(p.p - (A.p + slope * (p.i - A.i))) <= 0.35 * a; });
        var valNow = A.p + slope * (len - 1 - A.i);
        if (!(valNow > 0)) continue;
        var dist = Math.abs(c[len - 1] - valNow) / a;
        var score = touch.length * 2 + (len - A.i) / 60 + (B.i - from) / Math.max(1, look) - Math.min(3, dist / 4);
        if (!top || score > top.score) top = { type: type === 'L' ? 'support' : 'resistance', a: { i: A.i, p: A.p }, b: { i: B.i, p: B.p }, slope: slope, touches: touch.length, touchIdx: touch.map(function (p) { return p.i; }), value: valNow, score: Math.round(score * 100) / 100, distAtr: dist };
      }
      return top;
    }
    var sup = best('L'), res = best('H');
    // Kanal: destek çizgisine paralel, aradaki en yüksek tepeden geçen çizgi (dokunuş ≥ 2 ise geçerli)
    function channel(line, type) {
      if (!line) return null; var off = type === 'support' ? -Infinity : Infinity, idx = -1, k;
      for (k = line.a.i; k < len; k++) { var base = line.a.p + line.slope * (k - line.a.i), d = (type === 'support' ? h[k] : l[k]) - base; if (type === 'support' ? d > off : d < off) { off = d; idx = k; } }
      var t = pv.filter(function (p) { return p.type === (type === 'support' ? 'H' : 'L') && p.i >= line.a.i && Math.abs((p.p - (line.a.p + line.slope * (p.i - line.a.i))) - off) <= 0.5 * a; }).length;
      return { offset: off, anchorI: idx, touches: t, valid: t >= 2, value: line.value + off };
    }
    return { support: sup, resistance: res, channelFromSupport: channel(sup, 'support'), channelFromResistance: channel(res, 'resistance') };
  }
  function lineAt(line, i) { return line.a.p + line.slope * (i - line.a.i); }

  /* Fibonacci: son tamamlanmış ve en az 3×ATR büyüklüğündeki zikzak salınımı (A→B). Düzeltmeler B'den geriye, uzantılar A'dan (A + k·(B−A)). */
  var FIB_R = [0.236, 0.382, 0.5, 0.618, 0.786], FIB_E = [1.272, 1.618, 2.0];
  function fibonacci(sw, atrLast) {
    var conf = sw.filter(function (s) { return !s.tentative; });
    for (var k = conf.length - 1; k >= 1; k--) {
      var A = conf[k - 1], B = conf[k], size = Math.abs(B.p - A.p);
      if (num(atrLast) && size >= 3 * atrLast) {
        var up = B.p > A.p, d = B.p - A.p;
        return { from: A, to: B, up: up, size: size,
          retr: FIB_R.map(function (r) { return { r: r, p: B.p - r * d }; }),
          ext: FIB_E.map(function (e) { return { r: e, p: A.p + e * d }; }) };
      }
    }
    return null;
  }

  function avgVol(v, i, w) { var s = 0, n = 0; for (var k = Math.max(0, i - w); k <= Math.min(v.length - 1, i + w); k++) if (num(v[k])) { s += v[k]; n++; } return n ? s / n : null; }
  /* Formasyonlar (zikzak salınımları üzerinde). Her formasyon: tür, yön, durum (oluşuyor / onaylandı), boyun çizgisi, ölçülen hareket hedefi, güven (0-100) ve gerekçeler. */
  function patterns(bars, sw, atr, rsiArr) {
    var h = bars.h, l = bars.l, c = bars.c, v = bars.v || [], len = c.length, a = TA.last(atr), lc = c[len - 1], out = [];
    if (!num(a) || sw.length < 3) return out;
    var tolEq = function (p) { return Math.max(0.6 * a, 0.015 * p); };
    var S = sw.slice(-7);
    function conf(base, why, extra) { return { conf: clamp(Math.round(base), 5, 90), why: why, x: extra }; }
    // İkili tepe / ikili dip (son üç salınım)
    var t = S.slice(-3);
    if (t.length === 3) {
      var dbl = function (bull) {
        var P1 = t[0], N = t[1], P2 = t[2]; if (P1.type !== (bull ? 'L' : 'H') || P2.type !== P1.type) return;
        var eq = Math.abs(P1.p - P2.p), lvl = (P1.p + P2.p) / 2, depth = Math.abs(N.p - lvl), sep = P2.i - P1.i;
        if (eq > tolEq(lvl) || depth < 2 * a || sep < 8 || sep > 150) return;
        var confirmed = bull ? lc > N.p : lc < N.p, why = [], sc = 45;
        why.push('İki ' + (bull ? 'dip' : 'tepe') + ' arası fark ' + (eq / a).toFixed(2) + ' ATR, derinlik ' + (depth / a).toFixed(1) + ' ATR, ' + sep + ' mum arayla');
        if (confirmed) { sc += 20; why.push('Boyun çizgisi (' + N.p.toPrecision(6) + ') kapanışla ' + (bull ? 'yukarı' : 'aşağı') + ' kırıldı'); } else why.push('Boyun çizgisi henüz kırılmadı — onay bekleniyor');
        var v1 = avgVol(v, P1.i, 2), v2 = avgVol(v, P2.i, 2); if (num(v1) && num(v2) && v2 < v1) { sc += 10; why.push('İkinci ' + (bull ? 'dipte' : 'tepede') + ' hacim daha düşük (zayıflayan baskı)'); }
        if (rsiArr && num(rsiArr[P1.i]) && num(rsiArr[P2.i]) && (bull ? rsiArr[P2.i] > rsiArr[P1.i] + 2 : rsiArr[P2.i] < rsiArr[P1.i] - 2)) { sc += 10; why.push('RSI uyumsuzluğu destekliyor'); }
        if (eq <= 0.3 * a) sc += 5;
        if (!confirmed) sc = Math.min(sc, 55);
        var target = bull ? N.p + depth : N.p - depth;
        out.push({ type: bull ? 'double_bottom' : 'double_top', name: bull ? 'İkili dip' : 'İkili tepe', dir: bull ? 1 : -1, status: confirmed ? 'onaylandı' : 'oluşuyor', neckline: N.p, target: target,
          points: [P1, N, P2], conf: conf(sc).conf, why: why, invalidation: bull ? Math.min(P1.p, P2.p) - 0.5 * a : Math.max(P1.p, P2.p) + 0.5 * a });
      };
      dbl(true); dbl(false);
    }
    // Omuz-baş-omuz (OBO) / ters OBO (son beş salınım)
    var f = S.slice(-5);
    if (f.length === 5) {
      var hs = function (inv) {
        var LS = f[0], N1 = f[1], H = f[2], N2 = f[3], RS = f[4], tp = inv ? 'L' : 'H';
        if (LS.type !== tp || H.type !== tp || RS.type !== tp) return;
        var headOk = inv ? H.p < Math.min(LS.p, RS.p) - 0.5 * a : H.p > Math.max(LS.p, RS.p) + 0.5 * a; if (!headOk) return;
        var sh = Math.abs(LS.p - RS.p); if (sh > Math.max(1.2 * a, 0.03 * H.p)) return;
        var slope = (N2.p - N1.p) / (N2.i - N1.i), neckAt = function (i) { return N1.p + slope * (i - N1.i); }, neckNow = neckAt(len - 1);
        var height = Math.abs(H.p - neckAt(H.i)); if (height < 2 * a) return;
        var confirmed = inv ? lc > neckNow : lc < neckNow, sc = 45, why = ['Baş, omuzlardan ' + (Math.abs(H.p - (inv ? Math.min(LS.p, RS.p) : Math.max(LS.p, RS.p))) / a).toFixed(1) + ' ATR ' + (inv ? 'aşağıda' : 'yukarıda') + '; omuz farkı ' + (sh / a).toFixed(2) + ' ATR'];
        if (confirmed) { sc += 25; why.push('Boyun çizgisi kırıldı'); } else why.push('Boyun çizgisi kırılmadı — onay yok');
        var vL = avgVol(v, LS.i, 2), vR = avgVol(v, RS.i, 2); if (num(vL) && num(vR) && vR < vL) { sc += 10; why.push('Sağ omuzda hacim daha düşük'); }
        if (!confirmed) sc = Math.min(sc, 55);
        out.push({ type: inv ? 'inv_head_shoulders' : 'head_shoulders', name: inv ? 'Ters omuz-baş-omuz (TOBO)' : 'Omuz-baş-omuz (OBO)', dir: inv ? 1 : -1, status: confirmed ? 'onaylandı' : 'oluşuyor',
          neckline: neckNow, neckSlope: slope, neckA: { i: N1.i, p: N1.p }, neckB: { i: N2.i, p: N2.p }, target: inv ? neckNow + height : neckNow - height, points: f.slice(), conf: clamp(sc, 5, 90), why: why,
          invalidation: inv ? RS.p - 0.5 * a : RS.p + 0.5 * a });
      };
      hs(false); hs(true);
    }
    // Üçgenler: son 5-6 salınımdaki tepelere ve diplere ayrı doğru (en küçük kareler)
    var tri = S.slice(-6), hi = tri.filter(function (s) { return s.type === 'H'; }), lo = tri.filter(function (s) { return s.type === 'L'; });
    if (hi.length >= 2 && lo.length >= 2) {
      var rh = TA.linreg(hi.map(function (s) { return s.i; }), hi.map(function (s) { return s.p; })), rl = TA.linreg(lo.map(function (s) { return s.i; }), lo.map(function (s) { return s.p; }));
      if (rh && rl) {
        var i0 = tri[0].i, span = len - 1 - i0, flat = function (sl) { return Math.abs(sl) * Math.max(20, span) < 0.6 * a; };
        var up0 = rh.intercept + rh.slope * i0, lo0 = rl.intercept + rl.slope * i0, upN = rh.intercept + rh.slope * (len - 1), loN = rl.intercept + rl.slope * (len - 1);
        var w0 = up0 - lo0, wN = upN - loN, kind = null;
        if (w0 > 2 * a && wN > 0 && wN < 0.8 * w0 && span >= 15) {
          if (flat(rh.slope) && rl.slope > 0) kind = ['asc_triangle', 'Yükselen üçgen', 1];
          else if (flat(rl.slope) && rh.slope < 0) kind = ['desc_triangle', 'Alçalan üçgen', -1];
          else if (rh.slope < 0 && rl.slope > 0) kind = ['sym_triangle', 'Simetrik üçgen', 0];
        }
        if (kind) {
          var brk = lc > upN + 0.2 * a ? 1 : lc < loN - 0.2 * a ? -1 : 0, sc2 = 40 + Math.min(15, (hi.length + lo.length - 4) * 5), why2 = ['Tepeler eğimi ' + (rh.slope / a * 20).toFixed(2) + ', dipler eğimi ' + (rl.slope / a * 20).toFixed(2) + ' (ATR/20 mum); daralma ' + Math.round((1 - wN / w0) * 100) + '%'];
          if (brk) { sc2 += 20; why2.push(brk > 0 ? 'Üst kenar kapanışla kırıldı' : 'Alt kenar kapanışla kırıldı'); } else why2.push('Fiyat üçgenin içinde — kırılım yönü bekleniyor');
          if (kind[2] && brk && brk !== kind[2]) { sc2 -= 15; why2.push('Kırılım, formasyonun olağan yönünün tersine'); }
          out.push({ type: kind[0], name: kind[1], dir: brk || kind[2], status: brk ? 'onaylandı' : 'oluşuyor', upper: { a: { i: i0, p: up0 }, b: { i: len - 1, p: upN } }, lower: { a: { i: i0, p: lo0 }, b: { i: len - 1, p: loN } },
            target: brk > 0 ? upN + w0 : brk < 0 ? loN - w0 : null, targetUp: upN + w0, targetDown: loN - w0, conf: clamp(sc2, 5, 85), why: why2, points: tri.slice(), invalidation: brk > 0 ? loN : brk < 0 ? upN : null });
        }
      }
    }
    // Bayrak: güçlü direk (≤15 mumda ≥4 ATR) + 5-25 mumluk, direğin yarısından az geri çekilen ters eğimli dinlenme
    var lastConf = sw.filter(function (s) { return !s.tentative; });
    for (var q = lastConf.length - 1; q >= Math.max(1, lastConf.length - 2); q--) {
      var P0 = lastConf[q - 1], P1 = lastConf[q]; if (!P0 || !P1) continue;
      var pole = P1.p - P0.p, bars_ = P1.i - P0.i, rest = len - 1 - P1.i; if (Math.abs(pole) < 4 * a || bars_ > 15 || rest < 5 || rest > 25) continue;
      var bull = pole > 0, mx = -Infinity, mn = Infinity, xs = [], ys = [];
      for (var k2 = P1.i + 1; k2 < len; k2++) { if (h[k2] > mx) mx = h[k2]; if (l[k2] < mn) mn = l[k2]; xs.push(k2); ys.push(c[k2]); }
      var retr = bull ? (P1.p - mn) / pole : (mx - P1.p) / -pole; var lr = TA.linreg(xs, ys);
      if (!lr || retr > 0.5 || retr < 0 || (bull ? lr.slope > 0.05 * a : lr.slope < -0.05 * a)) continue;
      var brk2 = bull ? lc > Math.max(mx, P1.p) : lc < Math.min(mn, P1.p), lvl2 = bull ? Math.max(mx, P1.p) : Math.min(mn, P1.p);
      out.push({ type: bull ? 'bull_flag' : 'bear_flag', name: bull ? 'Boğa bayrağı' : 'Ayı bayrağı', dir: bull ? 1 : -1, status: brk2 ? 'onaylandı' : 'oluşuyor', neckline: lvl2,
        target: bull ? lvl2 + pole : lvl2 + pole, conf: clamp(40 + (brk2 ? 20 : 0) + (retr < 0.382 ? 10 : 0), 5, 80),
        why: ['Direk ' + (Math.abs(pole) / a).toFixed(1) + ' ATR, ' + bars_ + ' mumda; dinlenme ' + rest + ' mum, geri çekilme %' + Math.round(retr * 100), brk2 ? 'Dinlenme bölgesi kırıldı' : 'Kırılım bekleniyor'],
        points: [P0, P1], invalidation: bull ? mn - 0.3 * a : mx + 0.3 * a });
      break;
    }
    return out;
  }

  /* Uyumsuzluk: son iki onaylı dipte fiyat daha düşük dip, RSI daha yüksek dip → pozitif (yükseliş) uyumsuzluk; tepeler için tersi.
   * Yalnızca ikinci nokta son 'fresh' mum içindeyse 'güncel' sayılır. */
  function divergences(h, l, osc, opts) {
    opts = opts || {}; var len = h.length, fresh = opts.fresh || 15, out = [], pv = pivots(h, l, 3, 3);
    ['L', 'H'].forEach(function (tp) {
      var ps = pv.filter(function (p) { return p.type === tp && num(osc[p.i]); });
      if (ps.length < 2) return;
      var B = ps[ps.length - 1], A = ps[ps.length - 2]; if (B.i - A.i > 60 || B.i - A.i < 5) return;
      if (tp === 'L' && B.p < A.p && osc[B.i] > osc[A.i] + 2 && osc[B.i] < 50) out.push({ type: 'bull', name: 'Pozitif uyumsuzluk', a: A, b: B, oa: osc[A.i], ob: osc[B.i], fresh: len - 1 - B.i <= fresh, age: len - 1 - B.i });
      if (tp === 'H' && B.p > A.p && osc[B.i] < osc[A.i] - 2 && osc[A.i] > 50) out.push({ type: 'bear', name: 'Negatif uyumsuzluk', a: A, b: B, oa: osc[A.i], ob: osc[B.i], fresh: len - 1 - B.i <= fresh, age: len - 1 - B.i });
    });
    return out;
  }

  return { pivots: pivots, zigzag: zigzag, zones: zones, nearest: nearest, trendlines: trendlines, lineAt: lineAt, fibonacci: fibonacci, patterns: patterns, divergences: divergences, FIB_R: FIB_R, FIB_E: FIB_E };
});
