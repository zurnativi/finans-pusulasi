/* chartdata.js — Grafik verisi için saf yardımcılar (DOM yok, test edilebilir).
 * Net varlık geçmişi: [{ d: 'YYYY-MM-DD', v: kuruş (tam sayı) }] — her gün en fazla bir nokta.
 * Son 120 gün günlük tutulur; daha eskisi her ayın son noktasına indirgenir (depolama küçük kalır). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'));
  else root.ChartData = factory(root.Money);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  var KEEP_DAILY = 120, MAX_POINTS = 400;
  var RANGES = { '1A': 30, '3A': 91, '6A': 182, '1Y': 365, 'Tümü': null };
  function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
  function isK(v) { return typeof v === 'number' && Number.isSafeInteger(v); }
  function addDays(ymd, n) { var t = Date.parse(ymd + 'T00:00:00Z') + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  /* Geçersiz noktaları atar, tarihe göre sıralar, aynı gün için sonuncuyu tutar. */
  function normalize(list) {
    if (!Array.isArray(list)) return [];
    var by = {};
    list.forEach(function (p) { if (p && isYmd(p.d) && isK(p.v)) by[p.d] = p.v; });
    return Object.keys(by).sort().map(function (d) { return { d: d, v: by[d] }; });
  }
  function prune(list, today) {
    var cut = addDays(today, -KEEP_DAILY), lastOfMonth = {};
    list.forEach(function (p) { if (p.d < cut) lastOfMonth[p.d.slice(0, 7)] = p.d; });
    var out = list.filter(function (p) { return p.d >= cut || lastOfMonth[p.d.slice(0, 7)] === p.d; });
    return out.length > MAX_POINTS ? out.slice(out.length - MAX_POINTS) : out;
  }
  /* Bugünün değerini yazar (gelecek tarihli noktalar silinir). { list, changed } */
  function record(list, today, v) {
    if (!isYmd(today) || !isK(v)) return { list: normalize(list), changed: false };
    var n = normalize(list).filter(function (p) { return p.d <= today; });
    var last = n[n.length - 1];
    if (last && last.d === today && last.v === v) return { list: prune(n, today), changed: n.length !== (list || []).length };
    if (last && last.d === today) last.v = v; else n.push({ d: today, v: v });
    return { list: prune(n, today), changed: true };
  }
  /* Örnek veri için gerçekçi görünen geçmiş: bugünün değeriyle TAM olarak biter. Deterministik (her açılışta aynı). */
  function synthExample(v, today, months) {
    months = months || 18;
    var out = [], start = addDays(today, -Math.round(months * 30.44)), total = daysBetween(start, today), dailyFrom = addDays(today, -KEEP_DAILY);
    for (var i = 0; i <= total; i++) {
      var d = addDays(start, i), isMonthEnd = addDays(d, 1).slice(8) === '01';
      if (d < dailyFrom && !isMonthEnd) continue;
      if (d === today) break;
      var t = i / total, left = total - i;
      var f = 0.58 + 0.42 * t + 0.035 * Math.sin(i / 23) + 0.018 * Math.sin(i / 5.3) - 0.03 * Math.exp(-Math.pow((i - total * 0.62) / 18, 2));
      f = f * (1 - Math.exp(-left / 40)) + 1 * Math.exp(-left / 40) * (1 - 0.004 * Math.sin(i)); // son günlerde bugüne yumuşak yaklaşır
      out.push({ d: d, v: Math.round(v * f / 100) * 100 });
    }
    out.push({ d: today, v: v });
    return out;
  }
  /* Zaman aralığı: kesimden önceki son nokta da eklenir (çizgi soldan kesilmesin). */
  function inRange(list, range, today) {
    var days = RANGES[range];
    if (days == null) return list.slice();
    var cut = addDays(today, -days), out = [], prev = null;
    list.forEach(function (p) { if (p.d >= cut) out.push(p); else prev = p; });
    if (prev && (out.length < 2 || out[0].d > cut)) out.unshift(prev);
    return out;
  }
  /* İlk ve son nokta farkı: { abs (kuruş), bp (1/100 yüzde) } */
  function change(list) {
    if (!list || list.length < 2) return { abs: 0, bp: null };
    var a = list[0].v, b = list[list.length - 1].v;
    return { abs: M.sub(b, a), bp: a ? M.ratioBp(M.sub(b, a), Math.abs(a)) : null };
  }
  return { RANGES: RANGES, KEEP_DAILY: KEEP_DAILY, normalize: normalize, record: record, prune: prune, synthExample: synthExample, inRange: inRange, change: change, addDays: addDays, daysBetween: daysBetween };
});
