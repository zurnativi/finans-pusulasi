/* Tarayıcı ↔ Node eşitlik testi için ortak gövde: aynı sabit veriden (ta-reference.json ASELS) anlık görüntü üretir.
 * Node: require('./parity_snap.js')({Analysis, Snap, MData}, REF); tarayıcıda e2e aynı kaynağı window nesnesiyle çalıştırır. */
module.exports = function (G, REF, at) {
  var AN = G.Analysis, SN = G.Snap, MD = G.MData;
  var bars = REF.d.map(function (d, i) { return { d: d, o: REF.o[i], h: REF.h[i], l: REF.l[i], c: REF.c[i], v: REF.v[i] }; });
  var s = { key: 'bist:ASELS', kind: 'stock', name: 'ASELS — Aselsan', currency: 'TRY', bars: bars, checks: MD.checkBars(bars, 'stock', { today: bars[bars.length - 1].d }), katilim: ['XKTUM'], sym: 'ASELS' };
  var A = AN.analyze(s, { halal: SN.halalBase('bist:ASELS', s) }); A.series = s; A.ctx = {};
  return SN.compact(A, { at: at || '2026-11-18T07:00:00Z' });
};
