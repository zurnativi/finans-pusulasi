/* freshness.js — Arka plan veri işlerinin güncelliği (v8.1). Saf, testli. İş akışı her çalışmada status/<iş>.json yazar (tools/publish.py);
 * burada beklenen son zamanlanmış çalışma hesaplanır ve gerçek son başarılı çalışma ile kıyaslanır. GitHub zamanlanmış çalışmaları gecikebilir (genelde dakikalar,
 * yoğun saatlerde yarım saat+); bu yüzden "geç" ve "durmuş" eşikleri gevşektir ve açıkça "tahmini" diye yazılır. Hiçbir zaman uydurma saat göstermez. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fresh = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MIN = 60000, H = 3600000, D = 86400000;
  // Zamanlama (UTC) — .github/workflows ile birebir aynı olmalı (testte dosyadan doğrulanır)
  var SCHEDULE = {
    news: { label: 'Haber akışı ve takvim', every: '≈ 20 dakikada bir, 7/24', grace: 45 * MIN, slots: function (day) { var o = []; for (var h = 0; h < 24; h++) [7, 27, 47].forEach(function (m) { o.push(day + h * H + m * MIN); }); return o; } },
    crypto: { label: 'Kripto analizleri', every: 'saat başı, 7/24', grace: 90 * MIN, slots: function (day) { var o = []; for (var h = 0; h < 24; h++) o.push(day + h * H + 22 * MIN); return o; } },
    intraday: { label: 'Seans içi fiyat, KAP ve analiz', every: 'iş günü 11:10–17:10 TSİ saat başı', grace: 120 * MIN, slots: function (day, dow) { var o = []; if (dow >= 1 && dow <= 5) for (var h = 8; h <= 14; h++) o.push(day + h * H + 10 * MIN); else o.push(day + 9 * H); return o; } },
    daily: { label: 'Günlük tam derleme', every: 'iş günü 10:30 ve 18:40 TSİ', grace: 180 * MIN, slots: function (day, dow) { return dow >= 1 && dow <= 5 ? [day + 7 * H + 30 * MIN, day + 15 * H + 40 * MIN] : []; } }
  };
  function lastExpected(job, nowMs) {
    var S = SCHEDULE[job]; if (!S) return null; var d0 = Math.floor(nowMs / D) * D, best = null;
    for (var k = 0; k <= 8; k++) {
      var day = d0 - k * D, dow = new Date(day).getUTCDay(), sl = S.slots(day, dow);
      for (var i = 0; i < sl.length; i++) if (sl[i] <= nowMs && (best == null || sl[i] > best)) best = sl[i];
      if (best != null && k >= 1) break;
    }
    return best;
  }
  function ageText(ms) {
    if (ms == null || !isFinite(ms)) return '—'; var m = Math.round(ms / MIN);
    if (m < 1) return 'şimdi'; if (m < 90) return m + ' dk önce'; var h = Math.round(ms / H); if (h < 48) return h + ' sa önce'; return Math.round(ms / D) + ' gün önce';
  }
  function t(s) { var x = s ? Date.parse(s) : NaN; return isFinite(x) ? x : null; }
  /* statuses: { news:{generatedAt, ok}, intraday:..., daily:..., crypto:... } (eksik olabilir). Döner: { jobs:[...], worst, banner } */
  function evaluate(statuses, nowMs) {
    statuses = statuses || {}; var jobs = [], rank = { ok: 0, late: 1, stale: 2, missing: 1 }, worst = 'ok';
    Object.keys(SCHEDULE).forEach(function (id) {
      var S = SCHEDULE[id], st = statuses[id], at = st && st.ok !== false ? t(st.generatedAt) : null;
      if (id === 'intraday' && statuses.daily && statuses.daily.ok !== false) { var dt = t(statuses.daily.generatedAt); if (dt != null && (at == null || dt > at)) at = dt; } // günlük derleme saatlik veriyi de tazeler
      var exp = lastExpected(id, nowMs), row = { id: id, label: S.label, every: S.every, lastAt: at != null ? new Date(at).toISOString() : null, age: at != null ? nowMs - at : null, expectedAt: exp != null ? new Date(exp).toISOString() : null, failed: !!(st && st.ok === false), run: st && st.run || null };
      if (at == null) { row.state = 'missing'; row.text = st && st.ok === false ? 'Son çalışma başarısız' : 'Henüz çalışmadı / bilgi yok'; }
      else {
        var delay = exp != null ? nowMs - Math.max(exp, 0) : 0, behind = exp != null && at < exp - 5 * MIN;
        row.state = !behind || delay <= S.grace ? 'ok' : delay > 4 * S.grace ? 'stale' : 'late';
        row.text = row.state === 'ok' ? 'Güncel' : row.state === 'late' ? 'Gecikmeli (beklenen çalışma henüz gelmedi)' : 'Durmuş görünüyor';
      }
      if (rank[row.state] > rank[worst]) worst = row.state; jobs.push(row);
    });
    var stale = jobs.filter(function (j) { return j.state === 'stale'; }), late = jobs.filter(function (j) { return j.state === 'late'; });
    var banner = stale.length ? { level: 'warn', text: 'Arka plan güncellemesi durmuş görünüyor (' + stale.map(function (j) { return j.label + ' — son: ' + ageText(j.age); }).join('; ') + '). Gösterilen veri eski olabilir; GitHub → Actions sekmesinden iş akışını kontrol et.' } : null;
    return { jobs: jobs, worst: worst, banner: banner, lateCount: late.length };
  }
  /* Kaynak başına durum (news/sources.json): son çekme + en yeni haber */
  function sources(src, nowMs) {
    if (!src || !src.sources) return [];
    return Object.keys(src.sources).map(function (name) {
      var s = src.sources[name], f = t(s.fetchedAt || src.generatedAt), l = t(s.lastAt), st = s.ok === false ? 'fail' : (f != null && nowMs - f > 3 * H ? 'stale' : 'ok');
      return { name: name, ok: s.ok !== false, n: s.n, state: st, fetchedAt: f != null ? new Date(f).toISOString() : null, lastAt: l != null ? new Date(l).toISOString() : null, fetchedAgo: f != null ? nowMs - f : null, lastAgo: l != null ? nowMs - l : null, kind: s.kind, err: s.err || null };
    }).sort(function (a, b) { return (a.state === 'ok') - (b.state === 'ok') || (a.name < b.name ? -1 : 1); });
  }
  return { SCHEDULE: SCHEDULE, lastExpected: lastExpected, evaluate: evaluate, sources: sources, ageText: ageText };
});
