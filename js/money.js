/* money.js — Tüm para hesapları TAM SAYI KURUŞ ile yapılır (1 TL = 100 kuruş).
 * Ondalıklı sayı (float) hatalarını önlemek için tutarlar asla TL cinsinden float olarak toplanmaz. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Money = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX = Number.MAX_SAFE_INTEGER;

  function assertKurus(k, label) {
    if (typeof k !== 'number' || !Number.isInteger(k) || Math.abs(k) > MAX) {
      throw new Error((label || 'Tutar') + ' geçersiz (tam sayı kuruş bekleniyordu): ' + k);
    }
    return k;
  }

  function add() {
    var t = 0;
    for (var i = 0; i < arguments.length; i++) t += assertKurus(arguments[i]);
    assertKurus(t, 'Toplam');
    return t;
  }
  function sum(arr) { return arr.reduce(function (a, b) { return add(a, b); }, 0); }
  function sub(a, b) { return assertKurus(assertKurus(a) - assertKurus(b)); }

  /* Kuruşu bir oranla çarpar; sonuç yarım kuruşta sıfırdan uzağa yuvarlanır (bankacı değil, ticari yuvarlama). */
  function roundHalfAwayFromZero(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }
  function mulRatio(k, num, den) {
    assertKurus(k);
    if (!den) throw new Error('Bölen sıfır olamaz');
    // BigInt ile kesin çarpma, sonra yuvarlama
    var K = BigInt(k), N = BigInt(num), D = BigInt(den);
    var neg = (K < 0n) !== (N < 0n) !== (D < 0n);
    if (K < 0n) K = -K; if (N < 0n) N = -N; if (D < 0n) D = -D;
    var p = K * N, q = p / D, r = p % D;
    if (r * 2n >= D) q += 1n;
    var out = Number(q);
    return assertKurus(neg ? -out : out);
  }
  /* Baz puan (bp, 10000 = %100) ile çarpma */
  function mulBp(k, bp) { return mulRatio(k, Math.round(bp), 10000); }
  /* Float oran ile çarpma (yalnızca bileşik getiri projeksiyonunda; sonuç kuruşa yuvarlanır) */
  function mulFloat(k, f) { assertKurus(k); return assertKurus(roundHalfAwayFromZero(k * f)); }

  /* Bir tutarı ağırlıklara göre kuruşu kuruşuna dağıtır (en büyük kalan yöntemi). Parçaların toplamı daima tutara eşittir. */
  function allocate(total, weights) {
    assertKurus(total);
    var wsum = weights.reduce(function (a, b) { return a + Math.max(0, b); }, 0);
    if (wsum <= 0) return weights.map(function () { return 0; });
    var sign = total < 0 ? -1 : 1, T = BigInt(Math.abs(total));
    var ws = weights.map(function (w) { return BigInt(Math.round(Math.max(0, w) * 1e6)); });
    var W = ws.reduce(function (a, b) { return a + b; }, 0n);
    if (W === 0n) return weights.map(function () { return 0; });
    var parts = [], rems = [], used = 0n;
    ws.forEach(function (wi, i) {
      var p = T * wi;
      parts[i] = p / W; rems.push({ i: i, r: p % W }); used += parts[i];
    });
    var left = T - used;
    rems.sort(function (a, b) { return a.r === b.r ? a.i - b.i : (b.r > a.r ? 1 : -1); });
    for (var j = 0; left > 0n; j++, left--) parts[rems[j % rems.length].i] += 1n;
    return parts.map(function (p) { return sign * Number(p); });
  }

  /* Kullanıcı girdisini (TR veya EN biçim) kuruşa çevirir. Geçersizse null döner.
   * Örnekler: "1.234,56" "1,234.56" "1234,5" "-1.234,56 TL" "(1.234,56)" "1.234,56-" "₺1.234" "1.234" (=1234 TL) */
  function parse(input) {
    if (typeof input === 'number') {
      if (!isFinite(input)) return null;
      return roundHalfAwayFromZero(Math.round(input * 1000) / 10); // 3 haneye kadar float gürültüsünü temizle
    }
    if (input == null) return null;
    var s = String(input).trim();
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/\s+/g, '').replace(/(TL|TRY|₺|USD|\$|EUR|€)/gi, '');
    if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); }
    else if (/^\+/.test(s)) s = s.slice(1);
    if (/[-−–]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (/(B|A)$/i.test(s) && /\d[BA]$/i.test(s)) { // bazı ekstrelerde "B" borç, "A" alacak
      if (/B$/i.test(s)) neg = !neg; s = s.slice(0, -1);
    }
    if (!/^[\d.,']+$/.test(s) || !/\d/.test(s)) return null;
    s = s.replace(/'/g, '');
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    var intPart, fracPart = '';
    if (lastComma >= 0 && lastDot >= 0) {
      var dec = lastComma > lastDot ? ',' : '.', thou = dec === ',' ? '.' : ',';
      var idx = s.lastIndexOf(dec);
      intPart = s.slice(0, idx); fracPart = s.slice(idx + 1);
      if (intPart.indexOf(dec) >= 0) return null;
      if (!validThousands(intPart, thou)) return null;
      intPart = intPart.split(thou).join('');
    } else if (lastComma >= 0 || lastDot >= 0) {
      var sep = lastComma >= 0 ? ',' : '.';
      var pieces = s.split(sep);
      if (pieces.length > 2) { // yalnızca binlik ayırıcı
        if (!validThousands(s, sep)) return null;
        intPart = pieces.join('');
      } else {
        var after = pieces[1];
        if (after.length === 3 && pieces[0].length >= 1 && pieces[0] !== '0') { intPart = pieces.join(''); } // "1.234" => 1234
        else { intPart = pieces[0] || '0'; fracPart = after; }
      }
    } else intPart = s;
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
    if (fracPart.length > 2) {
      // 2 haneden fazlası: yuvarla
      var third = parseInt(fracPart[2], 10);
      fracPart = fracPart.slice(0, 2);
      var k0 = BigInt(intPart || '0') * 100n + BigInt(fracPart);
      if (third >= 5) k0 += 1n;
      return finish(k0, neg);
    }
    while (fracPart.length < 2) fracPart += '0';
    return finish(BigInt(intPart || '0') * 100n + BigInt(fracPart), neg);
  }
  function finish(k, neg) {
    if (k > BigInt(MAX)) return null;
    var n = Number(k);
    return neg && n !== 0 ? -n : n;
  }
  function validThousands(s, sep) {
    var parts = s.split(sep);
    if (parts.length === 1) return true;
    if (!/^\d{1,3}$/.test(parts[0])) return false;
    for (var i = 1; i < parts.length; i++) if (!/^\d{3}$/.test(parts[i])) return false;
    return true;
  }

  /* Kuruşu "1.234,56" biçimine çevirir */
  function format(k, opts) {
    opts = opts || {};
    assertKurus(k);
    var neg = k < 0, a = Math.abs(k);
    var lira = Math.floor(a / 100), kr = a % 100;
    var ls = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var out = opts.noDecimals ? ls : ls + ',' + (kr < 10 ? '0' : '') + kr;
    if (opts.noDecimals && kr >= 50) { // gösterimde yuvarla
      out = String(lira + 1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    return (neg ? '−' : '') + out + (opts.symbol === false ? '' : ' TL');
  }
  function formatShort(k) {
    var a = Math.abs(k) / 100, neg = k < 0 ? '−' : '';
    if (a >= 1e9) return neg + (a / 1e9).toFixed(2).replace('.', ',') + ' milyar TL';
    if (a >= 1e6) return neg + (a / 1e6).toFixed(2).replace('.', ',') + ' milyon TL';
    if (a >= 1e4) return neg + Math.round(a / 1e3) + ' bin TL';
    return format(k, { noDecimals: true });
  }
  function fromTL(tl) { return mulRatio(Math.round(tl), 100, 1); }
  /* Yüzde gösterimi (bp -> "%12,5") */
  function formatBp(bp, digits) {
    var d = digits == null ? 1 : digits;
    return '%' + (bp / 100).toFixed(d).replace('.', ',');
  }
  function ratioBp(a, b) { if (!b) return 0; return mulRatio(10000, a, b); }

  return { parse: parse, format: format, formatShort: formatShort, formatBp: formatBp, add: add, sum: sum, sub: sub,
    mulRatio: mulRatio, mulBp: mulBp, mulFloat: mulFloat, allocate: allocate, assertKurus: assertKurus, fromTL: fromTL, ratioBp: ratioBp };
});
