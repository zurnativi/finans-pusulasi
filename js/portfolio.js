/* portfolio.js — Portföy yönetimi hesap motoru (saf fonksiyonlar, testli).
 * Para: tam sayı en küçük birim (kuruş / sent). Adet: tam sayı, 1 birim = 100.000.000 (1e8; kripto için 8 hane).
 * Birim fiyat: tam sayı, 1 para birimi = 1.000.000 (1e6; fon fiyatları için 6 hane). Çarpımlar BigInt ile yapılır, sonuç kuruşa yuvarlanır. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'), require('./calc.js'), require('./ledger.js'));
  else root.Portfolio = factory(root.Money, root.Calc, root.Ledger);
})(typeof self !== 'undefined' ? self : this, function (M, C, L) {
  'use strict';
  var QS = 100000000, PS = 1000000, E12 = 1000000000000n, OZ_G = 311034768n; // 1 ons = 31,1034768 gram
  var TIERS = ['safe', 'medium', 'risky'];

  /* ---------- Kesin aritmetik ---------- */
  function isInt(v) { return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER; }
  function divRound(p, q) { // BigInt bölme, yarım birimde sıfırdan uzağa yuvarlama
    if (q === 0n) throw new Error('Bölen sıfır olamaz');
    var neg = (p < 0n) !== (q < 0n); if (p < 0n) p = -p; if (q < 0n) q = -q;
    var d = p / q; if ((p % q) * 2n >= q) d += 1n; return neg ? -d : d;
  }
  function divFloor(p, q) { if (q <= 0n || p < 0n) throw new Error('divFloor yalnızca pozitif'); return p / q; }
  function toNum(b) { var n = Number(b); if (!Number.isSafeInteger(n)) throw new Error('Sayı güvenli sınırı aştı'); return n; }
  function mulDiv(a, b, c) { return toNum(divRound(BigInt(a) * BigInt(b), BigInt(c))); }
  function addInt(a, b) { var r = a + b; if (!Number.isSafeInteger(r)) throw new Error('Sayı güvenli sınırı aştı'); return r; }
  /* adet × birim fiyat → en küçük para birimi (kuruş/sent) */
  function valueMinor(qty, price) { return toNum(divRound(BigInt(qty) * BigInt(price), E12)); }
  /* tutar (kuruş) ÷ fiyat → adet; floor=true ise aşağı yuvarlar (tutarı aşmaz) */
  function qtyForAmount(amountMinor, price, floor) {
    if (price <= 0) throw new Error('Fiyat sıfırdan büyük olmalı');
    var p = BigInt(amountMinor) * E12, q = BigInt(price);
    return toNum(floor ? (amountMinor < 0 ? -divFloor(-p, q) : divFloor(p, q)) : divRound(p, q));
  }
  /* yabancı para tutarını TL kuruşa çevirir; fx: 1 birim = fx kuruş (state.rates biçimi) */
  function toTL(minor, cur, fx) { if (cur === 'TRY' || !cur) return minor; if (!isInt(fx) || fx <= 0) return null; return mulDiv(minor, fx, 100); }
  function priceToTL(price, cur, fx) { if (cur === 'TRY' || !cur) return price; if (!isInt(fx) || fx <= 0) return null; return mulDiv(price, fx, 100); }
  function fxKurusFromPrice(p) { return mulDiv(p, 1, 10000); } // 1e6 ölçekli TL fiyatı → kuruş
  function fxPriceFromKurus(k) { return k * 10000; }
  function changeBp(newV, oldV) { if (!oldV) return null; return mulDiv(newV - oldV, 10000, oldV); }

  /* Ondalık metni ölçekli tam sayıya çevirir (TR/EN biçim). digits: ondalık hane (adet 8, fiyat 6). Geçersizse null.
   * Kurallar: "1,5" = 1,5 · "1.234,5678" = 1234,5678 · "1,234.56" = 1234,56 · tek nokta + 3 hane ("1.234") = binlik (uygulamanın para kuralıyla aynı). */
  function parseScaled(input, digits) {
    var D = BigInt(10) ** BigInt(digits);
    if (typeof input === 'number') {
      if (!isFinite(input)) return null;
      input = input.toFixed(Math.min(20, digits + 2));
      return fromParts(input.replace(/^-/, '').split('.')[0], input.split('.')[1] || '', input.charAt(0) === '-');
    }
    if (input == null) return null;
    var s = String(input).trim().replace(/\s+/g, '').replace(/(TL|TRY|₺|USD|\$|EUR|€|adet|ad\.?|lot|gram|gr|g)$/i, '').replace(/^(TL|₺|\$|€)/i, '');
    if (!s) return null;
    var neg = false;
    if (/^[-−]/.test(s)) { neg = true; s = s.slice(1); } else if (/^\+/.test(s)) s = s.slice(1);
    s = s.replace(/'/g, '');
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.'), ip, fp = '';
    function thousandsOk(x, sep) { var p = x.split(sep); if (p.length === 1) return true; if (!/^\d{1,3}$/.test(p[0])) return false; for (var i = 1; i < p.length; i++) if (!/^\d{3}$/.test(p[i])) return false; return true; }
    if (lc >= 0 && ld >= 0) {
      var dec = lc > ld ? ',' : '.', th = dec === ',' ? '.' : ',', di = s.lastIndexOf(dec);
      ip = s.slice(0, di); fp = s.slice(di + 1);
      if (ip.indexOf(dec) >= 0 || !thousandsOk(ip, th)) return null; ip = ip.split(th).join('');
    } else if (lc >= 0) {
      var pc = s.split(',');
      if (pc.length > 2) { if (!thousandsOk(s, ',')) return null; ip = pc.join(''); } else { ip = pc[0] || '0'; fp = pc[1]; }
    } else if (ld >= 0) {
      var pd = s.split('.');
      if (pd.length > 2) { if (!thousandsOk(s, '.')) return null; ip = pd.join(''); }
      else if (pd[1].length === 3 && pd[0].length >= 1 && pd[0].length <= 3 && pd[0] !== '0') ip = pd.join('');
      else { ip = pd[0] || '0'; fp = pd[1]; }
    } else ip = s;
    return fromParts(ip, fp, neg);
    function fromParts(i, f, ng) {
      if (!/^\d*$/.test(i) || !/^\d*$/.test(f)) return null;
      var up = false;
      if (f.length > digits) { up = +f.charAt(digits) >= 5; f = f.slice(0, digits); }
      while (f.length < digits) f += '0';
      var v = BigInt(i || '0') * D + BigInt(f || '0') + (up ? 1n : 0n);
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      var n = Number(v); return ng && n ? -n : n;
    }
  }
  /* Ölçekli tam sayıyı TR biçiminde yazar; minDec..maxDec arası ondalık (sondaki sıfırlar atılır) */
  function formatScaled(v, digits, maxDec, minDec) {
    if (!isInt(v)) return '—';
    maxDec = maxDec == null ? digits : maxDec; minDec = minDec || 0;
    var neg = v < 0, a = BigInt(Math.abs(v)), D = BigInt(10) ** BigInt(digits);
    if (maxDec < digits) { var R = BigInt(10) ** BigInt(digits - maxDec); a = divRound(a, R) * R; }
    var ip = (a / D).toString(), fp = (a % D).toString().padStart(digits, '0').slice(0, maxDec);
    while (fp.length > minDec && fp.charAt(fp.length - 1) === '0') fp = fp.slice(0, -1);
    return (neg ? '−' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fp ? ',' + fp : '');
  }
  function fmtQty(q) { return formatScaled(q, 8, 8, 0); }
  function fmtPrice(p, cur) { var a = Math.abs(p); return formatScaled(p, 6, a >= 1000 * PS ? 2 : a >= PS ? 4 : 6, 2); }

  /* ---------- Sınıflar ve helal etiketi ---------- */
  var HALAL = {
    uygun: { label: 'Uygun', level: 'ok' },
    supheli: { label: 'Şüpheli', level: 'warn' },
    uygun_degil: { label: 'Uygun değil', level: 'danger' },
    bilinmiyor: { label: 'Bilinmiyor', level: 'info' }
  };
  function halalOf(x) { return (x && x.halal && HALAL[x.halal.status]) ? x.halal.status : 'bilinmiyor'; }
  var LOTS = { whole: 'Tam adet (hisse, ETF)', fraction: 'Küsuratlı (fon, altın, kripto)' };
  /* Fiyat anahtarı: hangi kaynaktan, hangi para biriminde */
  var PRICE_KINDS = {
    'metal:XAU': { label: 'Gram altın (TL)', cur: 'TRY', kind: 'metal' },
    'metal:XAG': { label: 'Gram gümüş (TL)', cur: 'TRY', kind: 'metal' },
    'fx:USD': { label: 'ABD doları (TL)', cur: 'TRY', kind: 'fx' },
    'fx:EUR': { label: 'Euro (TL)', cur: 'TRY', kind: 'fx' },
    'idx:XU100': { label: 'BIST 100 endeksi (puan)', cur: 'PT', kind: 'index' },
    'idx:KATLM': { label: 'Katılım 50 endeksi (KATLM, puan — elle/CSV)', cur: 'PT', kind: 'index' },
    'idx:XKTUM': { label: 'Katılım Tüm endeksi (XKTUM, puan)', cur: 'PT', kind: 'index' }
  };
  function keyInfo(key) {
    if (!key) return null;
    if (PRICE_KINDS[key]) return PRICE_KINDS[key];
    if (/^cg:[a-z0-9-]{1,60}$/.test(key)) return { label: 'Kripto: ' + key.slice(3) + ' (TL, CoinGecko)', cur: 'TRY', kind: 'crypto' };
    if (/^tefas:[A-Z0-9]{2,6}$/.test(key)) return { label: key.slice(6) + ' (TEFAS fonu, TL)', cur: 'TRY', kind: 'fund' };
    if (/^bist:[A-Z0-9]{2,8}$/.test(key)) return { label: key.slice(5) + ' (BIST hissesi, TL, 15 dk gecikmeli)', cur: 'TRY', kind: 'stock' };
    if (/^td:[A-Z0-9.:-]{1,20}$/.test(key)) return { label: key.slice(3) + ' (USD, Twelve Data)', cur: 'USD', kind: 'etf' };
    if (/^m:[A-Za-z0-9_-]{1,64}$/.test(key)) return { label: 'Elle girilen fiyat', cur: null, kind: 'manual' };
    return null;
  }
  function assetKey(a) { return a.priceKey || ('m:' + a.id); }
  function kindFor(key, asset) {
    var ki = keyInfo(key); if (ki && ki.kind !== 'manual') return ki.kind;
    var c = asset && asset.cls;
    return c === 'katilim_fund' || c === 'sukuk' ? 'fund' : c === 'halal_etf' ? 'etf' : c === 'katilim_stock' ? 'stock' : c === 'gold' ? 'metal' : c === 'crypto' ? 'crypto' : 'other';
  }

  /* ---------- Fiyat geçmişi ---------- */
  function points(state, key) { var h = state.prices && state.prices[key]; return h && Array.isArray(h.points) ? h.points : []; }
  function lastPoint(state, key) { var p = points(state, key); return p.length ? p[p.length - 1] : null; }
  function addPricePoint(prices, key, cur, pt) {
    if (!prices[key]) prices[key] = { cur: cur, points: [] };
    var arr = prices[key].points, i = arr.length;
    while (i > 0 && arr[i - 1].d > pt.d) i--;
    if (i > 0 && arr[i - 1].d === pt.d) arr[i - 1] = pt; else arr.splice(i, 0, pt);
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
    return prices;
  }
  function priceAt(pts, d) { // tarih ve öncesindeki son nokta
    var lo = 0, hi = pts.length - 1, best = null;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (pts[mid].d <= d) { best = pts[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best;
  }
  function mergePoints(a, b) { // b, aynı tarihte a'yı geçmez (a öncelikli)
    var map = {}; b.forEach(function (p) { map[p.d] = p; }); a.forEach(function (p) { map[p.d] = p; });
    return Object.keys(map).sort().map(function (d) { return map[d]; });
  }

  /* ---------- Fiyat kontrolü: sıçrama, eskime, çapraz kontrol ---------- */
  var JUMP_BP = { crypto: 2500, etf: 1500, stock: 1500, fund: 1000, fx: 800, metal: 800, index: 1200, other: 1500, manual: 1500 };
  var STALE_DAYS = { crypto: 2, fx: 3, metal: 3, index: 4, etf: 5, stock: 5, fund: 5, other: 31, manual: 31 };
  function checkPrice(newP, oldPt, kind, newDate, todayYmd) {
    var r = { valid: true, needsConfirm: false, jumpBp: null, reasons: [] };
    if (!isInt(newP) || newP <= 0) { r.valid = false; r.reasons.push('Fiyat sıfırdan büyük bir sayı olmalı'); return r; }
    if (newDate && todayYmd && newDate > todayYmd) { r.valid = false; r.reasons.push('Fiyat tarihi gelecekte olamaz'); return r; }
    if (oldPt && oldPt.p > 0) {
      r.jumpBp = changeBp(newP, oldPt.p);
      var lim = JUMP_BP[kind] || 1500;
      if (Math.abs(r.jumpBp) > lim) { r.needsConfirm = true; r.reasons.push('Önceki fiyata göre ' + (r.jumpBp > 0 ? '+' : '−') + '%' + (Math.abs(r.jumpBp) / 100).toFixed(1).replace('.', ',') + ' değişim (otomatik kabul sınırı %' + (lim / 100) + ')'); }
      if (newDate && newDate < oldPt.d) { r.needsConfirm = true; r.reasons.push('Yeni fiyat, kayıtlı fiyattan daha eski tarihli'); }
    }
    return r;
  }
  function staleness(pt, kind, todayYmd) {
    if (!pt) return { days: null, level: 'none' };
    var days = L.daysBetween(pt.d, todayYmd), lim = STALE_DAYS[kind] || 31;
    return { days: days, limit: lim, level: days < 0 ? 'future' : days > lim * 3 ? 'old' : days > lim ? 'warn' : 'ok' };
  }
  function crossCheck(a, b, tolBp) { if (!a || !b) return null; var d = Math.abs(changeBp(a, b)); return { diffBp: d, ok: d <= (tolBp || 150) }; }
  /* Ons/USD ve USD/TL'den gram altın TL (1e6 ölçek) */
  function gramFromOunce(usdPerOz, usdTry) { return toNum(divRound(BigInt(usdPerOz) * BigInt(usdTry) * 10000000n, BigInt(PS) * OZ_G)); }

  /* ---------- Alım-satım defteri: ağırlıklı ortalama maliyet ---------- */
  /* İşlem türleri: buy (alış), sell (satış), div (temettü: amount brüt, withholding stopaj), split (bedelsiz/bölünme: ratioBp, %100 = her 1 paya 1 yeni pay; eksi = birleşme), rights (bedelli: yeni pay adedi × bedelli fiyat). */
  var SIDES = { buy: 'Alış', sell: 'Satış', div: 'Temettü', split: 'Bedelsiz / bölünme', rights: 'Bedelli' };
  /* Aynı gün sırası: önce şirket işlemleri (gün başındaki adede göre), sonra alış, en son satış */
  var SIDE_ORDER = { div: 0, split: 1, rights: 2, buy: 3, sell: 4 };
  function sortTrades(list) {
    return list.map(function (t, i) { return [t, i]; }).sort(function (a, b) {
      if (a[0].date !== b[0].date) return a[0].date < b[0].date ? -1 : 1;
      var oa = SIDE_ORDER[a[0].side] == null ? 3 : SIDE_ORDER[a[0].side], ob = SIDE_ORDER[b[0].side] == null ? 3 : SIDE_ORDER[b[0].side];
      if (oa !== ob) return oa - ob;
      return a[1] - b[1];
    }).map(function (p) { return p[0]; });
  }
  function isBuyLike(t) { return t.side === 'buy' || t.side === 'rights'; }
  function hasMarketPrice(t) { return (t.side === 'buy' || t.side === 'sell') && t.price > 0; } // bedelli fiyatı piyasa fiyatı değildir
  function tradeGross(t) { if (t.side === 'div') return t.amount || 0; if (t.side === 'split') return 0; return valueMinor(t.qty, t.price); }
  /* Nakit etkisi (mutlak): alış/bedelli: ödenen (komisyon dahil) · satış: alınan · temettü: net (brüt − stopaj − masraf) · bedelsiz: 0 */
  function tradeCash(t) {
    var g = tradeGross(t), f = t.fee || 0;
    if (t.side === 'div') return M.sub(M.sub(g, t.withholding || 0), f);
    if (t.side === 'split') return 0;
    return isBuyLike(t) ? M.add(g, f) : M.sub(g, f);
  }
  /* Portföye giren (+) / çıkan (−) dış para akışı: alış +, satış −, temettü − (yatırımcıya ödenen), bedelsiz 0 */
  function tradeFlow(t) { var c = tradeCash(t); return isBuyLike(t) ? c : t.side === 'split' ? 0 : -c; }
  /* Bedelsiz/bölünme sonrası eklenen adet (aşağı yuvarlanır, 1e-8) */
  function splitAdded(units, ratioBp) { var p = BigInt(units) * BigInt(ratioBp); return toNum(p >= 0n ? p / 10000n : -((-p) / 10000n)); }
  function tradeTL(t, minor) { return t.currency === 'TRY' ? minor : mulDiv(minor, t.fxRate, 100); }
  /* Bir varlığın işlemlerini sırayla işler. Satışta maliyet, satılan adet oranında (kesin) düşülür; kalan maliyet hep tutarlıdır. */
  function ledger(trades) {
    var st = { units: 0, costNative: 0, costTL: 0, realizedNative: 0, realizedTL: 0, feesNative: 0, feesTL: 0, boughtTL: 0, soldTL: 0, buys: 0, sells: 0, errors: [], firstDate: null, rows: [],
      divNative: 0, divTL: 0, divGrossTL: 0, withholdingTL: 0, divs: 0, splits: 0, rights: 0 };
    sortTrades(trades).forEach(function (t) {
      var g = tradeGross(t), fee = t.fee || 0, feeTL = tradeTL(t, fee);
      if (!st.firstDate) st.firstDate = t.date;
      if (t.side === 'div') { // temettü: maliyet ve adet değişmez; net tutar gerçekleşen kâra eklenir
        var nn = tradeCash(t), nt = tradeTL(t, nn);
        if (st.units <= 0) st.errors.push(t.date + ' tarihli temettü: o tarihte eldeki adet yok');
        st.realizedNative = M.add(st.realizedNative, nn); st.realizedTL = M.add(st.realizedTL, nt);
        st.divNative = M.add(st.divNative, nn); st.divTL = M.add(st.divTL, nt); st.divGrossTL = M.add(st.divGrossTL, tradeTL(t, g)); st.withholdingTL = M.add(st.withholdingTL, tradeTL(t, t.withholding || 0)); st.divs++;
        st.feesNative = M.add(st.feesNative, fee); st.feesTL = M.add(st.feesTL, feeTL);
        st.rows.push({ trade: t, cashNative: nn, cashTL: nt, realizedTL: nt, realizedNative: nn, unitsAfter: st.units });
        return;
      }
      if (t.side === 'split') { // bedelsiz/bölünme: toplam maliyet aynı, adet artar → ortalama maliyet düşer
        if (st.units <= 0) { st.errors.push(t.date + ' tarihli bedelsiz/bölünme: o tarihte eldeki adet yok'); return; }
        var add = splitAdded(st.units, t.ratioBp);
        if (st.units + add <= 0) { st.errors.push(t.date + ' tarihli birleşme oranı adedi sıfırlıyor'); return; }
        st.units = addInt(st.units, add); st.splits++;
        st.rows.push({ trade: t, cashNative: 0, cashTL: 0, realizedTL: 0, realizedNative: 0, unitsAdded: add, unitsAfter: st.units });
        return;
      }
      if (isBuyLike(t)) {
        var cn = M.add(g, fee), ct = tradeTL(t, cn);
        st.units = addInt(st.units, t.qty); st.costNative = M.add(st.costNative, cn); st.costTL = M.add(st.costTL, ct);
        st.boughtTL = M.add(st.boughtTL, ct); if (t.side === 'rights') st.rights++; else st.buys++;
        st.rows.push({ trade: t, cashNative: cn, cashTL: ct, realizedTL: 0, realizedNative: 0, unitsAfter: st.units });
      } else {
        if (t.qty > st.units) { st.errors.push(t.date + ' tarihli satış (' + fmtQty(t.qty) + ' adet), o tarihte eldeki adetten (' + fmtQty(st.units) + ') fazla'); return; }
        var outN = mulDiv(st.costNative, t.qty, st.units), outT = mulDiv(st.costTL, t.qty, st.units);
        var pn = M.sub(g, fee), pt = tradeTL(t, pn);
        var rn = M.sub(pn, outN), rt = M.sub(pt, outT);
        st.realizedNative = M.add(st.realizedNative, rn); st.realizedTL = M.add(st.realizedTL, rt);
        st.units -= t.qty; st.costNative = M.sub(st.costNative, outN); st.costTL = M.sub(st.costTL, outT);
        st.soldTL = M.add(st.soldTL, pt); st.sells++;
        st.rows.push({ trade: t, cashNative: pn, cashTL: pt, realizedTL: rt, realizedNative: rn, costOutTL: outT, unitsAfter: st.units });
      }
      st.feesNative = M.add(st.feesNative, fee); st.feesTL = M.add(st.feesTL, feeTL);
    });
    st.avgPrice = st.units ? toNum(divRound(BigInt(st.costNative) * E12, BigInt(st.units))) : 0; // birim başına ortalama maliyet (1e6 ölçek)
    st.avgPriceTL = st.units ? toNum(divRound(BigInt(st.costTL) * E12, BigInt(st.units))) : 0;
    return st;
  }
  function tradesOf(state, assetId) { return (state.trades || []).filter(function (t) { return t.assetId === assetId; }); }
  function fxNow(state, cur) { if (cur === 'TRY' || !cur) return 100; var r = state.rates && state.rates[cur]; return r && isInt(r.rate) && r.rate > 0 ? r.rate : null; }

  /* Varlığın güncel fiyatı: fiyat geçmişindeki son nokta ile son işlem fiyatından daha yeni olanı (aynı gün: fiyat kaydı) */
  function currentPrice(state, a) {
    var key = assetKey(a), pt = lastPoint(state, key), tr = null;
    tradesOf(state, a.id).forEach(function (t) { if (hasMarketPrice(t) && (!tr || t.date > tr.d)) tr = { d: t.date, p: t.price, src: 'Son işlem fiyatı', fromTrade: true }; });
    var best = pt && (!tr || pt.d >= tr.d) ? pt : tr;
    return best ? { p: best.p, d: best.d, src: best.src || '', at: best.at || null, fromTrade: !!best.fromTrade, key: key } : null;
  }
  function position(state, a, todayYmd) {
    var lg = ledger(tradesOf(state, a.id)), cur = a.currency || 'TRY', fx = fxNow(state, cur), pr = currentPrice(state, a);
    var mvNative = pr ? valueMinor(lg.units, pr.p) : null, mvTL = mvNative == null ? null : toTL(mvNative, cur, fx);
    var kind = kindFor(assetKey(a), a);
    return { asset: a, ledger: lg, currency: cur, fx: fx, price: pr, mvNative: mvNative, mvTL: mvTL,
      unrealizedTL: mvTL == null ? null : M.sub(mvTL, lg.costTL), unrealizedNative: mvNative == null ? null : M.sub(mvNative, lg.costNative),
      totalPLTL: mvTL == null ? null : M.add(M.sub(mvTL, lg.costTL), lg.realizedTL),
      stale: staleness(pr, pr && pr.fromTrade ? 'manual' : kind, todayYmd), kind: kind };
  }
  /* Alım-satımla izlenen varlıkların TL değerini günceller (piyasa değeri; fiyat/kur yoksa kalan maliyet). Her kayıttan önce çağrılır. */
  function sync(state, todayYmd) {
    (state.assets || []).forEach(function (a) {
      if (a.tracking !== 'trades') { delete a.valueBasis; return; }
      var p = position(state, a, todayYmd || L.ymdOf(C.currentYm(), new Date().getDate()));
      if (p.ledger.errors.length) return; // doğrulama hatayı ayrıca bildirir
      if (p.mvTL != null) { a.value = Math.max(0, p.mvTL); a.valueBasis = 'market'; } else { a.value = Math.max(0, p.ledger.costTL); a.valueBasis = 'cost'; }
    });
    if (Array.isArray(state.goals) && state.goals.length) { var g = state.goals[0]; state.goal = { name: g.name, target: g.target, targetYm: g.targetYm }; }
    return state;
  }
  function summary(state, todayYmd) {
    var rows = (state.assets || []).filter(function (a) { return a.tracking === 'trades'; }).map(function (a) { return position(state, a, todayYmd); });
    var s = { rows: rows, costTL: 0, mvTL: 0, unrealizedTL: 0, realizedTL: 0, feesTL: 0, boughtTL: 0, divTL: 0, withholdingTL: 0, missing: [] };
    rows.forEach(function (r) {
      s.divTL = M.add(s.divTL, r.ledger.divTL); s.withholdingTL = M.add(s.withholdingTL, r.ledger.withholdingTL);
      s.costTL = M.add(s.costTL, r.ledger.costTL); s.realizedTL = M.add(s.realizedTL, r.ledger.realizedTL); s.feesTL = M.add(s.feesTL, r.ledger.feesTL); s.boughtTL = M.add(s.boughtTL, r.ledger.boughtTL);
      if (r.mvTL == null) { s.missing.push(r.asset.name); s.mvTL = M.add(s.mvTL, r.ledger.costTL); }
      else { s.mvTL = M.add(s.mvTL, r.mvTL); s.unrealizedTL = M.add(s.unrealizedTL, r.unrealizedTL); }
    });
    s.totalPLTL = M.add(s.unrealizedTL, s.realizedTL);
    s.totalPLBp = s.boughtTL ? M.ratioBp(s.totalPLTL, s.boughtTL) : 0;
    return s;
  }

  /* ---------- Getiri: zaman ağırlıklı (TWR) ve para ağırlıklı (XIRR) ---------- */
  function xirr(flows) {
    var fl = flows.filter(function (f) { return f.amount !== 0; });
    if (fl.length < 2 || !fl.some(function (f) { return f.amount > 0; }) || !fl.some(function (f) { return f.amount < 0; })) return null;
    var d0 = Math.min.apply(null, fl.map(function (f) { return L.dayIndex(f.date); }));
    var ts = fl.map(function (f) { return (L.dayIndex(f.date) - d0) / 365; });
    function npv(r) { var s = 0; for (var i = 0; i < fl.length; i++) s += fl[i].amount / Math.pow(1 + r, ts[i]); return s; }
    var lo = -0.9999, hi = 1, flo = npv(lo), fhi = npv(hi), n = 0;
    while (flo * fhi > 0 && hi < 1e6 && n++ < 60) { hi *= 2; fhi = npv(hi); }
    if (flo * fhi > 0) return null;
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2, fm = npv(mid);
      if (fm === 0 || (hi - lo) / 2 < 1e-12) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }
  /* points: tarih sırasıyla [{date, value (gün sonu, akışlar dahil), flow (o günkü net dış akış: + yatırılan, − çekilen)}] */
  function twr(pointsArr) {
    var f = 1, prev = null, periods = 0;
    pointsArr.forEach(function (p) {
      if (prev && prev.value > 0) { f *= (p.value - p.flow) / prev.value; periods++; }
      prev = p;
    });
    if (!pointsArr.length) return null;
    var days = L.daysBetween(pointsArr[0].date, pointsArr[pointsArr.length - 1].date);
    var r = f - 1;
    return { period: r, annualized: days >= 365 ? Math.pow(f, 365 / days) - 1 : null, days: days, periods: periods };
  }
  function monthEnds(fromYmd, toYmd) {
    var out = [], ym = fromYmd.slice(0, 7), end = toYmd.slice(0, 7);
    while (ym < end) { out.push(L.ymdOf(ym, 31)); ym = L.addMonthsYm(ym, 1); }
    return out;
  }
  function fxPoints(state, cur) {
    if (cur === 'TRY') return null;
    var base = points(state, 'fx:' + cur).slice(), extra = [];
    (state.trades || []).forEach(function (t) { if (t.currency === cur && t.fxRate) extra.push({ d: t.date, p: fxPriceFromKurus(t.fxRate) }); });
    var r = state.rates && state.rates[cur]; if (r && r.date && isInt(r.rate)) extra.push({ d: r.date, p: fxPriceFromKurus(r.rate) });
    return mergePoints(base, extra);
  }
  function assetPricePoints(state, a) {
    var tp = tradesOf(state, a.id).filter(hasMarketPrice).map(function (t) { return { d: t.date, p: t.price }; });
    return mergePoints(points(state, assetKey(a)), tp);
  }
  /* Portföyün (alım-satımla izlenen varlıklar) belirli tarihlerdeki TL değeri ve akışları */
  function valuationSeries(state, todayYmd) {
    var assets = (state.assets || []).filter(function (a) { return a.tracking === 'trades' && tradesOf(state, a.id).length; });
    if (!assets.length) return { points: [], flows: [] };
    var all = [], flowsByDate = {};
    assets.forEach(function (a) { sortTrades(tradesOf(state, a.id)).forEach(function (t) { all.push(t); }); });
    all.forEach(function (t) { var f = tradeFlow(t); if (!f) { if (flowsByDate[t.date] == null) flowsByDate[t.date] = 0; return; } flowsByDate[t.date] = M.add(flowsByDate[t.date] || 0, tradeTL(t, f)); });
    var first = Object.keys(flowsByDate).sort()[0];
    var dates = Object.keys(flowsByDate).concat(monthEnds(first, todayYmd)).concat([todayYmd]).filter(function (d) { return d >= first && d <= todayYmd; });
    dates = dates.filter(function (d, i) { return dates.indexOf(d) === i; }).sort();
    var cache = {};
    assets.forEach(function (a) { cache[a.id] = { pts: assetPricePoints(state, a), fx: fxPoints(state, a.currency || 'TRY'), rows: ledger(tradesOf(state, a.id)).rows, cur: a.currency || 'TRY' }; });
    var pts = dates.map(function (d) {
      var v = 0;
      assets.forEach(function (a) {
        var c = cache[a.id], u = 0;
        c.rows.forEach(function (r) { if (r.trade.date <= d) u = r.unitsAfter; }); // bedelsiz/bölünme dahil o günkü adet
        if (u <= 0) return;
        var pp = priceAt(c.pts, d); if (!pp) return;
        var vn = valueMinor(u, pp.p);
        if (c.cur !== 'TRY') { var fp = priceAt(c.fx, d); if (!fp) return; vn = mulDiv(vn, fxKurusFromPrice(fp.p), 100); }
        v = M.add(v, vn);
      });
      return { date: d, value: v, flow: flowsByDate[d] || 0 };
    });
    var flows = Object.keys(flowsByDate).sort().filter(function (d) { return flowsByDate[d] !== 0; }).map(function (d) { return { date: d, amount: flowsByDate[d] }; });
    // Brüt ayrım (etiketler için): alımlar, satışlar ve temettüler ayrı ayrı (aynı gün netleşmeden)
    var gross = { bought: 0, sold: 0, dividends: 0 };
    all.forEach(function (t) { var f = tradeFlow(t); if (!f) return; var v = tradeTL(t, f); if (v > 0) gross.bought = M.add(gross.bought, v); else if (t.side === 'div') gross.dividends = M.add(gross.dividends, -v); else gross.sold = M.add(gross.sold, -v); });
    return { points: pts, flows: flows, gross: gross };
  }

  /* ---------- Enflasyon (TÜFE aylık % değişim, bp) ---------- */
  function inflationFactor(cpi, d0, d1) {
    var map = {}; (cpi || []).forEach(function (c) { map[c.ym] = c.bp; });
    var ym = d0.slice(0, 7), end = d1.slice(0, 7), f = 1, missing = [], used = [], lastUsed = null;
    while (ym <= end) {
      var dim = L.daysInMonth(ym), startDay = ym === d0.slice(0, 7) ? +d0.slice(8) : 0, endDay = ym === end ? +d1.slice(8) : dim;
      var frac = Math.max(0, endDay - startDay) / dim;
      if (frac > 0) {
        if (map[ym] == null) missing.push(ym);
        else { f *= Math.pow(1 + map[ym] / 10000, frac); used.push(ym); lastUsed = ym; }
      }
      ym = L.addMonthsYm(ym, 1);
    }
    // Yalnızca son ay(lar) eksikse (TÜFE henüz açıklanmadı) eldeki aylarla hesaplanır ve belirtilir; aradaki boşlukta hesaplanmaz
    var gap = missing.some(function (m) { return lastUsed && m < lastUsed; }) || !used.length;
    return { factor: gap ? null : f, missing: missing, upTo: lastUsed, partial: !gap && missing.length > 0 };
  }
  function realReturn(nominal, factor) { return factor ? (1 + nominal) / factor - 1 : null; }

  /* ---------- Kıyas: aynı paraları aynı günlerde altına / dolara / BIST'e yatırsaydın ---------- */
  function simulateBenchmark(flows, pts, todayYmd, maxGapDays) {
    maxGapDays = maxGapDays == null ? 35 : maxGapDays; // aylık seriler (elle/CSV) için 35 gün; 7 günden eski fiyat kullanılırsa "yaklaşık" işaretlenir
    var units = 0, missing = [], clipped = false, maxUsedGap = 0;
    flows.forEach(function (f) {
      var p = priceAt(pts, f.date);
      if (!p || L.daysBetween(p.d, f.date) > maxGapDays) { missing.push(f.date); return; }
      maxUsedGap = Math.max(maxUsedGap, L.daysBetween(p.d, f.date));
      var q = qtyForAmount(f.amount, p.p, false);
      units += q; if (units < 0) { units = 0; clipped = true; }
    });
    var now = priceAt(pts, todayYmd);
    if (!now || L.daysBetween(now.d, todayYmd) > maxGapDays) missing.push(todayYmd); else maxUsedGap = Math.max(maxUsedGap, L.daysBetween(now.d, todayYmd));
    if (missing.length) return { ok: false, missing: missing };
    var finalV = valueMinor(units, now.p);
    var xf = flows.map(function (f) { return { date: f.date, amount: -f.amount }; }).concat([{ date: todayYmd, amount: finalV }]);
    return { ok: true, finalTL: finalV, xirr: xirr(xf), units: units, priceNow: now, clipped: clipped, approx: maxUsedGap > 7, maxGapDays: maxUsedGap };
  }
  /* Kıyaslar. Varsayılan helal kıyas: Katılım 50 (KATLM) — ücretsiz otomatik kaynağı yok, geçmişi elle/CSV ile girilir.
   * Katılım Tüm (XKTUM) TradingView'den otomatik gelir. BIST 100 faizli şirketleri de içerdiği için yalnızca bilgi amaçlıdır. */
  var BENCHMARKS = [
    { key: 'idx:KATLM', label: 'Katılım 50 endeksi (helal kıyas)', unit: 'endeks payı', halal: true, primary: true },
    { key: 'idx:XKTUM', label: 'Katılım Tüm endeksi', unit: 'endeks payı', halal: true },
    { key: 'metal:XAU', label: 'Gram altın', unit: 'gram', halal: true },
    { key: 'fx:USD', label: 'ABD doları', unit: 'USD' },
    { key: 'idx:XU100', label: 'BIST 100 (faizli şirketler dahil)', unit: 'endeks payı', detailOnly: true }
  ];
  function returnsReport(state, todayYmd) {
    var vs = valuationSeries(state, todayYmd);
    if (!vs.points.length) return { empty: true };
    var last = vs.points[vs.points.length - 1];
    var xf = vs.flows.map(function (f) { return { date: f.date, amount: -f.amount }; }).concat([{ date: todayYmd, amount: last.value }]);
    var invested = M.sum(vs.flows.filter(function (f) { return f.amount > 0; }).map(function (f) { return f.amount; }));
    var withdrawn = M.sum(vs.flows.filter(function (f) { return f.amount < 0; }).map(function (f) { return -f.amount; }));
    var t = twr(vs.points), xr = xirr(xf), first = vs.points[0].date;
    var inf = inflationFactor(state.cpi, first, todayYmd);
    var benches = BENCHMARKS.map(function (b) {
      var pts = b.key === 'fx:USD' ? fxPoints(state, 'USD') : points(state, b.key);
      var sim = simulateBenchmark(vs.flows, pts, todayYmd);
      return { key: b.key, label: b.label, sim: sim, halal: !!b.halal, primary: !!b.primary, detailOnly: !!b.detailOnly };
    });
    return { empty: false, series: vs.points, flows: vs.flows, first: first, valueNow: last.value, invested: invested, withdrawn: withdrawn, gross: vs.gross,
      gainTL: M.sub(M.add(last.value, withdrawn), invested), twr: t, xirr: xr, inflation: inf,
      realTwr: t && inf.factor ? realReturn(t.period, inf.factor) : null,
      realXirr: xr != null && inf.factor && t && t.days > 0 ? Math.pow(1 + realReturn(Math.pow(1 + xr, t.days / 365) - 1, inf.factor), 365 / t.days) - 1 : null,
      benchmarks: benches };
  }

  /* ---------- Hedefler: çoklu hedef, payı, süzülme yolu profili, projeksiyon ---------- */
  var GLIDES = {
    standard: { label: 'Dengeli', path: C.GLIDE },
    conservative: { label: 'Temkinli', path: [[0, 10000, 0, 0], [12, 9000, 1000, 0], [36, 7000, 2000, 1000], [60, 5500, 3000, 1500]] },
    aggressive: { label: 'Büyüme (uzun vade)', path: [[0, 10000, 0, 0], [12, 7000, 2500, 500], [36, 4500, 3000, 2500], [60, 3000, 3000, 4000]] }
  };
  function glideOf(g) { return (GLIDES[g && g.glide] || GLIDES.standard).path; }
  function legacyEquivalent(state) {
    var gs = state.goals || [];
    return gs.length === 1 && gs[0].shareBp === 10000 && (gs[0].glide || 'standard') === 'standard' && !(state.assets || []).some(function (a) { return a.goalId; });
  }
  /* an: Calc.analyze(effState) sonucu. Havuz = net varlık − acil fon (eski tek hedef hesabıyla aynı). */
  function goalsReport(state, an) {
    var gs = state.goals || [], pool = Math.max(0, M.sub(an.assets.netWorth, an.emergency.current));
    var assigned = {}; gs.forEach(function (g) { assigned[g.id] = 0; });
    (state.assets || []).forEach(function (a) { if (a.goalId && assigned[a.goalId] != null && !a.emergency) assigned[a.goalId] = M.add(assigned[a.goalId], a.value); });
    var assignedTotal = M.sum(gs.map(function (g) { return assigned[g.id]; }));
    var unassigned = Math.max(0, M.sub(pool, assignedTotal));
    var shares = gs.map(function (g) { return g.shareBp; }), rest = Math.max(0, 10000 - M.sum(shares));
    var poolParts = M.allocate(unassigned, shares.concat([rest])), contribParts = M.allocate(an.plan.surplus, shares.concat([rest])), emParts = M.allocate(an.emergency.shortfall, shares.concat([rest]));
    var investTotal = M.add(an.invest.safe, an.invest.medium, an.invest.risky);
    var mix = investTotal > 0 ? [an.invest.safe, an.invest.medium, an.invest.risky] : [1, 0, 0];
    var sc = state.settings.scenarios || C.DEFAULT_SCENARIOS;
    var out = gs.map(function (g, i) {
      var cur = M.add(assigned[g.id], poolParts[i]), monthsLeft = Math.max(0, C.monthsBetween(an.nowYm, g.targetYm)), glide = glideOf(g);
      var start = M.allocate(cur, mix), horizon = Math.max(monthsLeft, 12) + 24, proj = {};
      Object.keys(sc).forEach(function (k) {
        var series = C.project({ start: { safe: start[0], medium: start[1], risky: start[2] }, reserveStart: 0, monthlyContribution: contribParts[i], emergencyTopUp: emParts[i],
          emergencyShareBp: C.emergencyShareBp(state), blockRiskyUntilEmergency: C.riskyBlocked(state, an.emergency), months: horizon, monthsToGoal: monthsLeft, returnsBp: sc[k].returnsBp, inflationBp: state.settings.inflationBp, glide: glide });
        var at = series[Math.min(monthsLeft, series.length - 1)];
        proj[k] = { label: sc[k].label, returnsBp: sc[k].returnsBp, series: series, atGoal: at.invest, atGoalNominal: at.nominalInvest, capped: !!series.capped, reachMonth: C.firstMonthReaching(series, g.target) };
      });
      var remaining = Math.max(0, M.sub(g.target, cur));
      return { goal: g, assigned: assigned[g.id], fromPool: poolParts[i], current: cur, monthly: contribParts[i], monthsLeft: monthsLeft,
        targetAlloc: C.targetAllocation(monthsLeft, glide), glide: glide, remaining: remaining,
        progressBp: g.target ? Math.min(10000, M.ratioBp(cur, g.target)) : 0, neededMonthly: monthsLeft > 0 ? M.mulRatio(remaining, 1, monthsLeft) : remaining,
        projection: proj, onTrack: proj.base.reachMonth != null && proj.base.reachMonth <= monthsLeft };
    });
    // Portföy düzeyinde hedef dağılım: hedeflerin bugünkü payıyla ağırlıklı ortalama; hedefe ayrılmamış kısım uzun vadeli dengeli profil
    var w = out.map(function (r) { return r.current; }), unalloc = poolParts[gs.length];
    if (M.sum(w) + unalloc === 0) { w = out.map(function (r) { return r.goal.shareBp; }); unalloc = rest; }
    var acc = { safe: 0, medium: 0, risky: 0 }, W = M.sum(w) + unalloc, longRun = C.targetAllocation(600);
    if (W > 0) {
      TIERS.forEach(function (k) {
        var num = 0n; out.forEach(function (r, i) { num += BigInt(w[i]) * BigInt(r.targetAlloc[k]); }); num += BigInt(unalloc) * BigInt(longRun[k]);
        acc[k] = toNum(divRound(num, BigInt(W)));
      });
      acc.safe = 10000 - acc.medium - acc.risky;
    } else acc = C.targetAllocation(0);
    return { pool: pool, assignedTotal: assignedTotal, unassigned: unassigned, unallocated: poolParts[gs.length], unallocatedMonthly: contribParts[gs.length],
      shareTotalBp: M.sum(shares), goals: out, combinedTarget: acc };
  }
  /* Çoklu hedefte Özet'in hedef ve plan rakamlarını hedef raporuyla tutarlı hâle getirir. Tek hedef (eski düzen) için hiçbir şeyi değiştirmez. */
  function patchAnalysis(an, state, rep) {
    if (legacyEquivalent(state) || !rep.goals.length) return an;
    var t = rep.combinedTarget, p = rep.goals[0];
    an.targetAlloc = t;
    an.drift = { safe: an.currentAlloc.safe - t.safe, medium: an.currentAlloc.medium - t.medium, risky: an.currentAlloc.risky - t.risky };
    an.plan = C.monthlyPlan(state, an.budget, an.emergency, t);
    an.goal = { name: p.goal.name, target: p.goal.target, targetYm: p.goal.targetYm, monthsLeft: p.monthsLeft, current: p.current, remaining: p.remaining, progressBp: p.progressBp, neededMonthly: p.neededMonthly, multi: true, monthly: p.monthly };
    an.scenarios = p.projection;
    return an;
  }

  /* ---------- Pozisyonlar (dengeleme ve risk kuralları için) ----------
   * eff: Ledger.effectiveState (hesaplar dahil). Acil fon olarak ayrılan kısım hariç; acil fon fazlası "nakit fazlası" olarak sayılır. */
  function positions(state, eff, an, todayYmd) {
    var out = [], em = an.emergency, emBy = an.assets.emByRisk;
    var res = M.allocate(em.current, [emBy.safe, emBy.medium, emBy.risky]);
    eff.assets.forEach(function (a) {
      if (a.emergency) return;
      var isAcc = String(a.id).indexOf('acc:') === 0, src = isAcc ? (state.accounts || []).find(function (x) { return 'acc:' + x.id === a.id; }) : (state.assets || []).find(function (x) { return x.id === a.id; });
      var tier = a.risk || 'medium', hs = src ? halalOf(src) : 'bilinmiyor';
      if (isAcc && src && src.type === 'cash' && !(src.halal && src.halal.status)) hs = 'uygun'; // nakit (TL/döviz) bir yatırım ürünü değildir
      var row = { id: a.id, name: a.name, tier: tier, valueTL: a.value, isAccount: isAcc, asset: isAcc ? null : src, account: isAcc ? src : null, halal: hs,
        withinBp: !isAcc && src && isInt(src.withinTierBp) ? src.withinTierBp : null, priceTL: null, lot: 'fraction', currency: 'TRY', fx: 100 };
      if (!isAcc && src) {
        row.currency = src.currency || 'TRY'; row.fx = fxNow(state, row.currency); row.lot = src.lot || (src.cls === 'halal_etf' || src.cls === 'katilim_stock' ? 'whole' : 'fraction');
        var pr = currentPrice(state, src); if (pr && row.fx) { row.price = pr; row.priceTL = priceToTL(pr.p, row.currency, row.fx); }
      }
      out.push(row);
    });
    TIERS.forEach(function (k, i) {
      var ex = M.sub(emBy[k], res[i]);
      if (ex > 0) out.push({ id: 'em:' + k, name: 'Acil fon fazlası (' + C.RISK[k].toLowerCase() + ')', tier: k, valueTL: ex, isAccount: true, synthetic: true, halal: 'uygun', withinBp: null, priceTL: null, lot: 'fraction', currency: 'TRY', fx: 100 });
    });
    return out;
  }

  /* ---------- Dengeleme: önce yeni parayla, satış emri yok ("gözden geçir") ---------- */
  /* Dengeleme adedi için makul ondalık: tam lot (hisse/ETF) 0, fon payı 0, altın/gümüş (gram) 2, kripto 6, diğer 4 */
  function qtyDecimals(pos) {
    if (!pos || pos.lot === 'whole') return 0;
    var a = pos.asset, kind = a ? kindFor(assetKey(a), a) : 'other';
    return kind === 'stock' || kind === 'etf' ? 0 : kind === 'fund' ? 0 : kind === 'metal' ? 2 : kind === 'crypto' ? 6 : 4;
  }
  function roundQty(q, pos) { var step = Math.pow(10, 8 - qtyDecimals(pos)); return Math.floor(q / step) * step; }
  var GENERIC = { safe: 'Katılım hesabı / kira sertifikası (sukuk) fonu', medium: 'Altın veya altın katılım fonu', risky: 'Katılım hisse fonu veya helal ETF' };
  function rebalance(pos, target, newMoney, opts) {
    opts = opts || {};
    var tierBand = opts.tierBandBp == null ? 500 : opts.tierBandBp, assetBand = opts.assetBandBp == null ? 300 : opts.assetBandBp;
    var blocked = opts.blockRisky ? { risky: true } : {};
    var cur = M.sum(pos.map(function (p) { return p.valueTL; })), total = M.add(cur, Math.max(0, newMoney));
    var tierT = M.allocate(total, [target.safe, target.medium, target.risky]), rows = [], notes = [];
    TIERS.forEach(function (k, ti) {
      var inTier = pos.filter(function (p) { return p.tier === k; });
      var buyable = inTier.filter(function (p) { return !p.isAccount && p.asset && p.halal === 'uygun'; });
      var w;
      if (buyable.some(function (p) { return p.withinBp != null; })) w = buyable.map(function (p) { return p.withinBp || 0; });
      else if (M.sum(buyable.map(function (p) { return p.valueTL; })) > 0) w = buyable.map(function (p) { return p.valueTL; });
      else w = buyable.map(function () { return 1; });
      if (M.sum(w) === 0) { buyable = []; w = []; }
      // Hesaplar ve uygun olmayan/etiketsiz varlıklar mevcut değerlerinde sabit sayılır; kalan hedef, alınabilir varlıklara dağıtılır
      var fixed = inTier.filter(function (p) { return buyable.indexOf(p) < 0; });
      var fixedKeep = M.sum(fixed.filter(function (p) { return p.isAccount || p.halal === 'bilinmiyor'; }).map(function (p) { return p.valueTL; }));
      var forBuyable = Math.max(0, M.sub(tierT[ti], fixedKeep));
      var generic = null;
      if (!buyable.length && forBuyable > 0) { generic = { id: 'gen:' + k, name: GENERIC[k], tier: k, valueTL: 0, generic: true, halal: 'uygun', priceTL: null, lot: 'fraction', currency: 'TRY' }; buyable = [generic]; w = [1]; }
      var parts = M.allocate(forBuyable, w);
      buyable.forEach(function (p, i) { rows.push({ pos: p, target: parts[i], buyable: !blocked[k] }); });
      fixed.forEach(function (p) { rows.push({ pos: p, target: (p.isAccount || p.halal === 'bilinmiyor') ? p.valueTL : 0, buyable: false, keep: p.isAccount || p.halal === 'bilinmiyor' }); });
    });
    var deficits = rows.map(function (r) { return r.buyable ? Math.max(0, M.sub(r.target, r.pos.valueTL)) : 0; });
    var dsum = M.sum(deficits), money = Math.max(0, newMoney), buys;
    if (money === 0) buys = rows.map(function () { return 0; });
    else if (dsum >= money) buys = M.allocate(money, deficits);
    else {
      var left = M.sub(money, dsum), tw = rows.map(function (r) { return r.buyable ? r.target : 0; });
      var extra = M.sum(tw) > 0 ? M.allocate(left, tw) : rows.map(function () { return 0; });
      buys = deficits.map(function (d, i) { return M.add(d, extra[i]); });
      if (M.sum(tw) === 0) notes.push('Yeni para için uygun (helal etiketli) alınabilir varlık yok; ' + M.format(left, { noDecimals: true }) + ' nakitte kalır.');
    }
    var leftoverCash = 0;
    rows.forEach(function (r, i) {
      r.buyTL = buys[i];
      if (r.buyTL > 0 && r.pos.priceTL) {
        var q = roundQty(qtyForAmount(r.buyTL, r.pos.priceTL, true), r.pos);
        r.units = q; r.unitCostTL = valueMinor(q, r.pos.priceTL); r.cashLeft = M.sub(r.buyTL, r.unitCostTL);
        if (r.pos.currency !== 'TRY' && r.pos.price) r.buyNative = valueMinor(q, r.pos.price.p);
        leftoverCash = M.add(leftoverCash, r.cashLeft);
      }
      r.after = M.add(r.pos.valueTL, r.buyTL);
      r.excess = M.sub(r.after, r.target);
      var totalBp = total ? M.ratioBp(r.after, total) : 0, tgtBp = total ? M.ratioBp(r.target, total) : 0;
      r.afterBp = totalBp; r.targetBp = tgtBp; r.driftBp = totalBp - tgtBp;
      r.review = !r.keep && r.excess > 0 && (r.pos.halal === 'uygun_degil' || r.pos.halal === 'supheli' || r.driftBp > assetBand);
      if (r.review && r.pos.priceTL) { r.reviewUnits = roundQty(qtyForAmount(r.excess, r.pos.priceTL, true), r.pos); }
      r.reason = r.pos.halal === 'uygun_degil' ? 'Helal uygun değil' : r.pos.halal === 'supheli' ? 'Helal uygunluğu şüpheli' : r.review ? 'Hedef payının üstünde' : '';
    });
    var tiers = TIERS.map(function (k, ti) {
      var now = M.sum(pos.filter(function (p) { return p.tier === k; }).map(function (p) { return p.valueTL; }));
      var after = M.sum(rows.filter(function (r) { return r.pos.tier === k; }).map(function (r) { return r.after; }));
      var nowBp = cur ? M.ratioBp(now, cur) : 0, afterBp = total ? M.ratioBp(after, total) : 0;
      return { tier: k, now: now, nowBp: nowBp, targetBp: target[k], target: tierT[ti], after: after, afterBp: afterBp, driftBp: nowBp - target[k], afterDriftBp: afterBp - target[k] };
    });
    if (blocked.risky && rows.some(function (r) { return r.pos.tier === 'risky' && r.buyable === false && r.target > r.pos.valueTL; })) notes.push('Acil durum fonu tamamlanmadığı için riskli varlık alımı önerilmedi (risk kuralı).');
    var needs = tiers.some(function (t) { return Math.abs(t.driftBp) > tierBand; }) || rows.some(function (r) { return r.review; });
    return { current: cur, newMoney: money, total: total, tiers: tiers, rows: rows, buys: rows.filter(function (r) { return r.buyTL > 0; }), reviews: rows.filter(function (r) { return r.review; }),
      leftoverCash: leftoverCash, needsRebalance: needs, notes: notes, tierBandBp: tierBand, assetBandBp: assetBand };
  }

  /* ---------- Risk kuralları ---------- */
  var DEFAULT_RULES = { maxAssetBp: 3000, maxRiskyBp: 5000, emergencyFirst: true, minPositions: 3 };
  function riskReport(state, an, pos) {
    var R = Object.assign({}, DEFAULT_RULES, (state.settings && state.settings.riskRules) || {}), out = [];
    var total = M.sum(pos.map(function (p) { return p.valueTL; }));
    var em = an.emergency;
    if (R.emergencyFirst) out.push(em.shortfall > 0 ? { id: 'emergency', level: 'warn', title: 'Önce acil durum fonu', text: 'Acil fonda ' + M.format(em.shortfall, { noDecimals: true }) + ' eksik var. Tamamlanana kadar riskli varlık alımı önerilmez.' }
      : { id: 'emergency', level: 'ok', title: 'Önce acil durum fonu', text: 'Acil fon tamam (' + em.months + ' aylık gider).' });
    var big = pos.filter(function (p) { return total && M.ratioBp(p.valueTL, total) > R.maxAssetBp && !p.synthetic; }).map(function (p) { return { p: p, bp: M.ratioBp(p.valueTL, total) }; });
    out.push(big.length ? { id: 'maxAsset', level: big.some(function (b) { return b.bp > R.maxAssetBp * 3 / 2; }) ? 'danger' : 'warn', title: 'Tek varlık sınırı (%' + R.maxAssetBp / 100 + ')', text: big.map(function (b) { return b.p.name + ' %' + (b.bp / 100).toFixed(1).replace('.', ','); }).join(', ') + ' — tek bir varlık portföyün çok büyük kısmı.', items: big }
      : { id: 'maxAsset', level: 'ok', title: 'Tek varlık sınırı (%' + R.maxAssetBp / 100 + ')', text: 'Hiçbir varlık sınırı aşmıyor.' });
    var risky = M.sum(pos.filter(function (p) { return p.tier === 'risky'; }).map(function (p) { return p.valueTL; })), rbp = total ? M.ratioBp(risky, total) : 0;
    out.push({ id: 'maxRisky', level: rbp > R.maxRiskyBp ? 'warn' : 'ok', title: 'Riskli varlık sınırı (%' + R.maxRiskyBp / 100 + ')', text: 'Riskli varlıklar portföyün ' + M.withSuffix('%' + (rbp / 100).toFixed(1).replace('.', ',')) + '.' + (rbp > R.maxRiskyBp ? ' Sınırın üstünde.' : ''), valueBp: rbp });
    var hh = 0n; pos.forEach(function (p) { if (total) { var w = BigInt(M.ratioBp(p.valueTL, total)); hh += w * w; } });
    var effN = hh > 0n ? Number(100000000n * 100n / hh) / 100 : 0, top = pos.slice().sort(function (a, b) { return b.valueTL - a.valueTL; })[0];
    out.push({ id: 'concentration', level: total && effN < R.minPositions ? 'warn' : 'ok', title: 'Çeşitlendirme', text: total ? 'Paran yaklaşık ' + effN.toFixed(1).replace('.', ',') + ' varlığa yayılmış gibi' + (top ? '; en büyük: ' + top.name + ' %' + (M.ratioBp(top.valueTL, total) / 100).toFixed(1).replace('.', ',') : '') + (effN < R.minPositions ? '. Para birkaç varlıkta toplanmış.' : '.') : 'Portföy boş.', effN: effN });
    var bad = pos.filter(function (p) { return p.halal === 'uygun_degil'; }), sus = pos.filter(function (p) { return p.halal === 'supheli'; }), unk = pos.filter(function (p) { return p.halal === 'bilinmiyor' && !p.synthetic; });
    out.push(bad.length ? { id: 'halal', level: 'danger', title: 'Helal uygunluk', text: 'Uygun olmayan varlık: ' + bad.map(function (p) { return p.name; }).join(', ') + '. Önerilere girmez; elden çıkarmayı gözden geçir.' + (sus.length ? ' Şüpheli: ' + sus.map(function (p) { return p.name; }).join(', ') + '.' : '') }
      : sus.length ? { id: 'halal', level: 'warn', title: 'Helal uygunluk', text: 'Uygunluğu şüpheli: ' + sus.map(function (p) { return p.name; }).join(', ') + '. Önerilere girmez; bir uzmana danış.' }
      : unk.length ? { id: 'halal', level: 'info', title: 'Helal uygunluk', text: 'Uygunluğu belirtilmemiş: ' + unk.map(function (p) { return p.name; }).join(', ') + '. Kontrol edip etiketlemeden önerilere girmez.' }
      : { id: 'halal', level: 'ok', title: 'Helal uygunluk', text: 'Tüm varlıklar "uygun" olarak etiketli.' });
    return { rules: R, items: out, ok: out.filter(function (x) { return x.level === 'ok'; }).length, total: out.length, worst: out.some(function (x) { return x.level === 'danger'; }) ? 'danger' : out.some(function (x) { return x.level === 'warn'; }) ? 'warn' : 'ok' };
  }

  /* ---------- İçe aktarma: aracı kurum dökümü (alım-satım) ve fiyat listesi ---------- */
  function fold(s) { return String(s || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/\u0307/g, '').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').trim(); }
  var THDR = {
    date: ['tarih', 'islem tarihi', 'date', 'valor', 'gerceklesme tarihi', 'emir tarihi'],
    symbol: ['sembol', 'menkul', 'kiymet', 'hisse', 'fon kodu', 'fon', 'enstruman', 'varlik', 'kod', 'symbol', 'ticker', 'urun', 'menkul kiymet'],
    side: ['islem', 'islem turu', 'islem tipi', 'yon', 'tip', 'tur', 'alis/satis', 'a/s', 'side', 'type', 'buy/sell', 'emir tipi'],
    qty: ['adet', 'miktar', 'lot', 'nominal', 'pay', 'quantity', 'qty', 'units', 'gerceklesen adet', 'pay adedi'],
    price: ['fiyat', 'birim fiyat', 'gerceklesen fiyat', 'ortalama fiyat', 'price', 'islem fiyati', 'pay fiyati'],
    fee: ['komisyon', 'masraf', 'ucret', 'bsmv', 'fee', 'commission', 'islem ucreti'],
    total: ['tutar', 'toplam', 'net tutar', 'islem tutari', 'amount', 'total', 'brut tutar'],
    currency: ['para birimi', 'doviz', 'currency', 'pb', 'doviz cinsi']
  };
  function detectTradeColumns(rows) {
    var best = { headerRow: -1, score: 0 };
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var map = {}, score = 0;
      (rows[r] || []).forEach(function (cell, c) {
        var f = fold(cell); if (!f) return;
        Object.keys(THDR).forEach(function (k) {
          if (map[k] != null) return;
          var hit = THDR[k].some(function (h) { return f === h || (h.length > 3 && f.indexOf(h) === 0); });
          if (hit && !Object.keys(map).some(function (o) { return map[o] === c; })) { map[k] = c; score++; }
        });
      });
      if (score > best.score) best = { headerRow: r, score: score, map: map };
    }
    var m = best.map || {};
    return { headerRow: best.headerRow, date: m.date != null ? m.date : -1, symbol: m.symbol != null ? m.symbol : -1, side: m.side != null ? m.side : -1, qty: m.qty != null ? m.qty : -1,
      price: m.price != null ? m.price : -1, fee: m.fee != null ? m.fee : -1, total: m.total != null ? m.total : -1, currency: m.currency != null ? m.currency : -1 };
  }
  function normSide(v) {
    var f = fold(v);
    if (/^(alis|alim|al|buy|b|a|purchase|alis emri)\b/.test(f) || /\balis\b|\balim\b/.test(f)) return 'buy';
    if (/^(satis|satim|sat|sell|s|sale)\b/.test(f) || /\bsatis\b|\bsatim\b/.test(f)) return 'sell';
    return null;
  }
  function normCur(v) { var f = String(v || '').trim().toUpperCase().replace('₺', 'TRY').replace('$', 'USD').replace('€', 'EUR'); if (f === 'TL') f = 'TRY'; return /^(TRY|USD|EUR)$/.test(f) ? f : null; }
  function parseDateLoose(v, parseDate) { return parseDate ? parseDate(v) : null; }
  function tradeRowsFromTable(rows, map, parseDate) {
    var out = [];
    for (var r = map.headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || []; if (!row.some(function (c) { return String(c).trim() !== ''; })) continue;
      var get = function (k) { return map[k] >= 0 ? row[map[k]] : ''; };
      var rawSym = String(get('symbol') || '').trim(); if (/^(genel\s+)?toplam|^total/i.test(fold(rawSym))) continue;
      var item = { date: parseDateLoose(get('date'), parseDate), rawDate: String(get('date') || ''), symbol: rawSym, side: normSide(get('side')), rawSide: String(get('side') || ''),
        qty: parseScaled(get('qty'), 8), price: parseScaled(get('price'), 6), fee: map.fee >= 0 && String(get('fee')).trim() !== '' ? M.parse(get('fee')) : 0,
        written: map.total >= 0 && String(get('total')).trim() !== '' ? M.parse(get('total')) : null, currency: map.currency >= 0 ? normCur(get('currency')) : null };
      if (item.qty != null && item.qty < 0) { item.qty = -item.qty; if (!item.side) item.side = 'sell'; }
      if (item.fee != null && item.fee < 0) item.fee = -item.fee;
      if (item.written != null && item.written < 0) item.written = -item.written;
      if (!item.symbol && item.qty == null && item.price == null) continue;
      out.push(item);
    }
    return out;
  }
  /* PDF/OCR metni: "12.11.2026 ASELS ALIŞ 10 145,20 1.452,00" gibi satırlar */
  var NUM_RE = /[-−]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?/g;
  function parseTradeText(text, parseDate) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var l = line.replace(/\s+/g, ' ').trim(); if (!l) return;
      var dm = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(l); if (!dm) return;
      // \b Türkçe harflerde (Ş, İ) çalışmaz; ayırıcıyla sınırlanır
      var sm = /(^|[\s,;|/])(ALIŞ|ALIS|ALIM|SATIŞ|SATIS|SATIM|BUY|SELL|Alış|Alis|Satış|Satis|Alım|Satım|alış|alım|satış|satım)(?=$|[\s,;|/])/.exec(l); if (!sm) return;
      var side = normSide(sm[2]); if (!side) return;
      var rest = l.replace(dm[0], ' ').replace(sm[0], ' ');
      var cur = /\b(USD|EUR|TRY|TL)\b|[$€₺]/.exec(rest); var currency = cur ? normCur(cur[1] || cur[0]) : null;
      var symM = /(?:^|\s)([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ.]{1,11})(?=$|\s)/.exec(rest.replace(/\b(USD|EUR|TRY|TL|ADET|LOT)\b/g, ' '));
      var symbol = symM ? symM[1] : '';
      var nums = (rest.replace(symbol, ' ').match(NUM_RE) || []).map(function (x) { return x.replace('−', '-'); });
      if (nums.length < 2) return;
      var qty = parseScaled(nums[0], 8), price = parseScaled(nums[1], 6), written = nums.length >= 3 ? M.parse(nums[nums.length - 1]) : null, fee = 0;
      if (nums.length >= 4) fee = M.parse(nums[2]) || 0;
      // adet×fiyat ≈ tutar değilse, ilk iki sayı yer değiştirmiş olabilir
      if (qty && price && written != null) {
        var g1 = valueMinor(qty, price);
        if (Math.abs(g1 - written) > Math.max(100, Math.abs(fee) + 1)) {
          var q2 = parseScaled(nums[1], 8), p2 = parseScaled(nums[0], 6);
          if (q2 && p2 && Math.abs(valueMinor(q2, p2) - written) <= Math.max(100, Math.abs(fee) + 1)) { qty = q2; price = p2; }
        }
      }
      out.push({ date: parseDateLoose(dm[1], parseDate), rawDate: dm[1], symbol: symbol, side: side, rawSide: sm[2], qty: qty, price: price, fee: fee, written: written, currency: currency, fromText: true });
    });
    return out;
  }
  /* Yapıştırılan / OCR ile okunan fiyat listesi: "KTV 8,326309", "ASELS  345,50 %1,2", "13.11.2026 KTN 3,25" */
  var PRICE_SKIP = /^(TL|TRY|USD|EUR|FON|FONU|KOD|FIYAT|FİYAT|SON|TARIH|TARİH|HISSE|HİSSE|ADET|LOT|BIST|TEFAS|GUNLUK|GÜNLÜK|DEĞİŞİM|DEGISIM)$/;
  function parsePriceText(text, parseDate) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var l = line.replace(/\s+/g, ' ').trim(); if (!l) return;
      var dm = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(l), rest = dm ? l.replace(dm[0], ' ') : l;
      rest = rest.replace(/[%‰]\s?[-−+]?\d+(?:[.,]\d+)?|[-−+]?\d+(?:[.,]\d+)?%/g, ' '); // yüzde değişimleri at
      var cur = /(?:^|\s)(USD|EUR|TRY|TL)(?=$|\s)|[$€₺]/.exec(rest), currency = cur ? normCur(cur[1] || cur[0]) : null;
      var symbol = '', re = /(?:^|[\s;,|:])([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ]{1,11})(?=$|[\s;,|:])/g, m;
      while ((m = re.exec(rest))) { if (!PRICE_SKIP.test(m[1])) { symbol = m[1]; break; } }
      if (!symbol) return;
      var nums = rest.slice(rest.indexOf(symbol) + symbol.length).replace(/[₺$€]/g, ' ').match(/[-−]?\d[\d.,]*\d|\d/g) || [];
      if (!nums.length) return;
      var price = parseScaled(nums[0].replace('−', '-'), 6);
      out.push({ symbol: symbol, price: price != null && price > 0 ? price : null, date: dm ? parseDateLoose(dm[1], parseDate) : null, rawDate: dm ? dm[1] : '', currency: currency === 'TRY' ? 'TRY' : currency, fromText: true });
    });
    return out;
  }
  function rowsFromAiTrades(text, parseDate) {
    var m = /\{[\s\S]*\}/.exec(String(text || '')); if (!m) return { rows: [], docTotal: null };
    var obj; try { obj = JSON.parse(m[0]); } catch (e) { return { rows: [], docTotal: null }; }
    var rows = (obj.trades || obj.islemler || []).map(function (t) {
      return { date: parseDateLoose(t.date, parseDate), rawDate: String(t.date || ''), symbol: String(t.symbol || t.sembol || '').trim(), side: normSide(t.side || t.yon || ''), rawSide: String(t.side || ''),
        qty: parseScaled(t.qty != null ? t.qty : t.adet, 8), price: parseScaled(t.price != null ? t.price : t.fiyat, 6), fee: t.fee != null ? (M.parse(t.fee) || 0) : 0,
        written: t.total != null ? M.parse(t.total) : null, currency: normCur(t.currency) };
    });
    return { rows: rows, docTotal: obj.total != null ? Math.abs(M.parse(obj.total) || 0) || null : null };
  }
  function matchAsset(state, symbol) {
    var f = fold(symbol); if (!f) return null;
    return (state.assets || []).find(function (a) { return a.symbol && fold(a.symbol) === f; }) ||
      (state.assets || []).find(function (a) { return fold(a.name) === f || fold(a.name).split(/[\s()]+/).indexOf(f) >= 0; }) || null;
  }
  function tradeKey(t) { return [t.assetId || fold(t.symbol), t.date, t.side, t.qty, t.price].join('|'); }
  /* Kontrol tablosu satırını doğrular. r: {date, symbol, side, qty, price, fee, written, currency, fxRate, assetId|newAsset} */
  function validateTradeRow(r, todayYmd) {
    var e = [], w = [];
    if (!r.date) e.push('Tarih okunamadı'); else if (r.date > todayYmd) e.push('Tarih gelecekte');
    if (!r.assetId && !(r.symbol && r.symbol.trim())) e.push('Varlık seç');
    if (r.side !== 'buy' && r.side !== 'sell') e.push('Alış mı satış mı?');
    if (!isInt(r.qty) || r.qty <= 0) e.push('Adet hatalı');
    if (!isInt(r.price) || r.price <= 0) e.push('Fiyat hatalı');
    if (!isInt(r.fee) || r.fee < 0) e.push('Komisyon hatalı');
    if (!/^(TRY|USD|EUR)$/.test(r.currency || '')) e.push('Para birimi seç');
    else if (r.currency !== 'TRY' && (!isInt(r.fxRate) || r.fxRate <= 0)) e.push('İşlem günündeki kur (TL) gerekli');
    var calc = null;
    if (!e.length || (isInt(r.qty) && isInt(r.price) && r.qty > 0 && r.price > 0)) {
      var g = valueMinor(r.qty, r.price), fee = isInt(r.fee) ? r.fee : 0;
      calc = { gross: g, cash: r.side === 'sell' ? g - fee : g + fee };
      if (r.written != null) {
        var okW = [calc.gross, calc.cash].some(function (v) { return Math.abs(v - r.written) <= 1; });
        calc.writtenOk = okW;
        if (!okW) w.push('Adet × fiyat (' + M.format(calc.gross, { symbol: false }) + ') belgedeki tutarla (' + M.format(r.written, { symbol: false }) + ') tutmuyor');
      }
    }
    r.errors = e; r.warnings = w; r.calc = calc;
    return r;
  }
  function tradeTotals(rows) {
    var by = {}, count = 0;
    rows.forEach(function (r) {
      if (!r.include || !r.calc || r.errors.length) return;
      count++; var c = r.currency || 'TRY'; if (!by[c]) by[c] = { buys: 0, sells: 0, grossBuys: 0, grossSells: 0, fees: 0, count: 0 };
      if (r.side === 'buy') { by[c].buys = M.add(by[c].buys, r.calc.cash); by[c].grossBuys = M.add(by[c].grossBuys, r.calc.gross); }
      else { by[c].sells = M.add(by[c].sells, r.calc.cash); by[c].grossSells = M.add(by[c].grossSells, r.calc.gross); }
      by[c].fees = M.add(by[c].fees, r.fee || 0); by[c].count++;
    });
    Object.keys(by).forEach(function (c) { by[c].net = M.sub(by[c].sells, by[c].buys); by[c].grossNet = M.sub(by[c].grossSells, by[c].grossBuys); });
    return { byCurrency: by, count: count, currencies: Object.keys(by) };
  }
  /* Belgedeki toplamla karşılaştırma: alımların, satışların veya net tutarın — komisyon dahil ya da brüt (adet × fiyat) — biri kuruşu kuruşuna tutmalı */
  function tradeTotalsCheck(rows, docTotal) {
    var t = tradeTotals(rows), res = { totals: t, match: false, by: null, single: t.currencies.length === 1 ? t.currencies[0] : null };
    if (docTotal == null || !res.single) return res;
    var x = t.byCurrency[res.single];
    var cands = [['buys', x.buys], ['sells', x.sells], ['net', Math.abs(x.net)], ['grossBuys', x.grossBuys], ['grossSells', x.grossSells], ['grossNet', Math.abs(x.grossNet)]];
    for (var i = 0; i < cands.length; i++) if (cands[i][1] && cands[i][1] === docTotal) { res.match = true; res.by = cands[i][0]; res.computed = cands[i][1]; break; }
    if (!res.match) {
      // en yakın aday (fark gösterimi için): yalnız alım varsa alımlar, yalnız satış varsa satışlar, ikisi de varsa net
      var base = x.buys && x.sells ? [Math.abs(x.net), Math.abs(x.grossNet)] : x.buys ? [x.buys, x.grossBuys] : [x.sells, x.grossSells];
      res.computed = Math.abs(base[0] - docTotal) <= Math.abs(base[1] - docTotal) ? base[0] : base[1];
    }
    res.diff = M.sub(res.computed, docTotal);
    return res;
  }
  var PHDR = { symbol: ['sembol', 'kod', 'fon kodu', 'hisse', 'varlik', 'ad', 'isim', 'symbol', 'ticker', 'menkul', 'urun'], price: ['fiyat', 'son fiyat', 'kapanis', 'birim fiyat', 'price', 'close', 'deger'], date: ['tarih', 'date', 'fiyat tarihi'], currency: ['para birimi', 'doviz', 'currency'] };
  function detectPriceColumns(rows) {
    var best = { headerRow: -1, score: 0, map: {} };
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var map = {}, score = 0;
      (rows[r] || []).forEach(function (cell, c) { var f = fold(cell); if (!f) return; Object.keys(PHDR).forEach(function (k) { if (map[k] == null && PHDR[k].some(function (h) { return f === h || (h.length > 3 && f.indexOf(h) === 0); })) { map[k] = c; score++; } }); });
      if (score > best.score) best = { headerRow: r, score: score, map: map };
    }
    var m = best.map; return { headerRow: best.headerRow, symbol: m.symbol != null ? m.symbol : 0, price: m.price != null ? m.price : 1, date: m.date != null ? m.date : -1, currency: m.currency != null ? m.currency : -1 };
  }
  function priceRowsFromTable(rows, map, parseDate) {
    var out = [];
    for (var r = map.headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [], sym = String(row[map.symbol] || '').trim(); if (!sym) continue;
      out.push({ symbol: sym, price: parseScaled(row[map.price], 6), date: map.date >= 0 ? parseDateLoose(row[map.date], parseDate) : null, currency: map.currency >= 0 ? normCur(row[map.currency]) : null });
    }
    return out;
  }
  /* Bir varlık için aracı kurum dökümünden yeni varlık açılırken makul varsayılanlar (helal etiketi: bilinmiyor) */
  function newAssetFromSymbol(symbol, currency, uid) {
    return { id: uid(), name: symbol, symbol: symbol, cls: 'other', risk: currency === 'TRY' ? 'risky' : 'risky', emergency: false, value: 0, tracking: 'trades', currency: currency || 'TRY',
      lot: 'whole', priceKey: null, withinTierBp: null, goalId: null, halal: { status: 'bilinmiyor', note: '', source: '', date: null } };
  }

  return { QS: QS, PS: PS, TIERS: TIERS, HALAL: HALAL, LOTS: LOTS, PRICE_KINDS: PRICE_KINDS, GLIDES: GLIDES, BENCHMARKS: BENCHMARKS, DEFAULT_RULES: DEFAULT_RULES, JUMP_BP: JUMP_BP, STALE_DAYS: STALE_DAYS, GENERIC: GENERIC,
    isInt: isInt, mulDiv: mulDiv, valueMinor: valueMinor, qtyForAmount: qtyForAmount, toTL: toTL, priceToTL: priceToTL, fxKurusFromPrice: fxKurusFromPrice, fxPriceFromKurus: fxPriceFromKurus, changeBp: changeBp,
    qtyDecimals: qtyDecimals, roundQty: roundQty, parseScaled: parseScaled, formatScaled: formatScaled, fmtQty: fmtQty, fmtPrice: fmtPrice,
    halalOf: halalOf, keyInfo: keyInfo, assetKey: assetKey, kindFor: kindFor,
    points: points, lastPoint: lastPoint, addPricePoint: addPricePoint, priceAt: priceAt, mergePoints: mergePoints,
    checkPrice: checkPrice, staleness: staleness, crossCheck: crossCheck, gramFromOunce: gramFromOunce,
    SIDES: SIDES, isBuyLike: isBuyLike, hasMarketPrice: hasMarketPrice, tradeFlow: tradeFlow, splitAdded: splitAdded,
    sortTrades: sortTrades, tradeGross: tradeGross, tradeCash: tradeCash, tradeTL: tradeTL, ledger: ledger, tradesOf: tradesOf, fxNow: fxNow, currentPrice: currentPrice, position: position, sync: sync, summary: summary,
    xirr: xirr, twr: twr, valuationSeries: valuationSeries, fxPoints: fxPoints, inflationFactor: inflationFactor, realReturn: realReturn, simulateBenchmark: simulateBenchmark, returnsReport: returnsReport,
    glideOf: glideOf, legacyEquivalent: legacyEquivalent, goalsReport: goalsReport, patchAnalysis: patchAnalysis,
    positions: positions, rebalance: rebalance, riskReport: riskReport,
    detectTradeColumns: detectTradeColumns, tradeRowsFromTable: tradeRowsFromTable, parseTradeText: parseTradeText, parsePriceText: parsePriceText, rowsFromAiTrades: rowsFromAiTrades, normSide: normSide, normCur: normCur,
    matchAsset: matchAsset, tradeKey: tradeKey, validateTradeRow: validateTradeRow, tradeTotals: tradeTotals, tradeTotalsCheck: tradeTotalsCheck,
    detectPriceColumns: detectPriceColumns, priceRowsFromTable: priceRowsFromTable, newAssetFromSymbol: newAssetFromSymbol, fold: fold };
});
