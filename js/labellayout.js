/* labellayout.js — Grafik sağ kenarındaki seviye etiketleri için çakışmasız yerleşim (1 boyutlu "küme birleştirme" yöntemi).
 * Girdi: [{ y: istenen piksel, pr: öncelik (büyük = önemli), ... }], alan [top, bottom], en az aralık gap (px).
 * Çıktı: aynı öğeler + yy (yerleştirilen piksel). Sığmayanlar önceliği en düşükten başlayarak atılır (dropped listesine).
 * Garanti: (1) hiçbir iki etiket arası < gap, (2) hepsi [top, bottom] içinde, (3) çakışma yoksa etiket yerinden oynamaz,
 * (4) kümeler istenen konumların ortalamasına ortalanır (kayma en aza indirilir). Saf fonksiyon — birim testli. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabelLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function layout(items, top, bottom, gap) {
    var inRange = [], dropped = [];
    (items || []).forEach(function (it) { if (typeof it.y === 'number' && isFinite(it.y) && it.y >= top - 0.5 && it.y <= bottom + 0.5) inRange.push(it); else dropped.push(it); });
    var cap = bottom - top < 0 ? 0 : Math.floor((bottom - top) / gap) + 1;
    // Kapasiteyi aşanlar: düşük öncelikli olanlar atılır (eşitlikte fiyata en uzak/sonda gelen)
    var byPr = inRange.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) { return (b.it.pr || 0) - (a.it.pr || 0) || a.i - b.i; });
    var keep = byPr.slice(0, cap).map(function (x) { return x.it; }); byPr.slice(cap).forEach(function (x) { dropped.push(x.it); });
    keep.sort(function (a, b) { return a.y - b.y || (b.pr || 0) - (a.pr || 0); });
    var clusters = [];
    function place(c) { var n = c.items.length, mean = c.items.reduce(function (s, x) { return s + x.y; }, 0) / n; c.start = Math.min(Math.max(mean - (n - 1) * gap / 2, top), bottom - (n - 1) * gap); c.end = c.start + (n - 1) * gap; }
    keep.forEach(function (it) {
      var c = { items: [it] }; place(c); clusters.push(c);
      while (clusters.length > 1) {
        var a = clusters[clusters.length - 2], b = clusters[clusters.length - 1];
        if (b.start - a.end >= gap - 1e-9) break;
        a.items = a.items.concat(b.items); clusters.pop(); place(a);
      }
    });
    var out = [];
    clusters.forEach(function (c) { c.items.forEach(function (it, k) { out.push(Object.assign({}, it, { yy: c.start + k * gap })); }); });
    return { placed: out, dropped: dropped };
  }
  return { layout: layout };
});
