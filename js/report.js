/* report.js — Seans raporları (v8.5): açılış öncesi / seans ortası / kapanış sonrası, banka araştırma raporu düzeninde. SAF çekirdek + ortak veri toplama.
 * Aynı kod tarayıcıda (uygulama "Raporlar" sayfası) ve GitHub Actions'ta (tools/session_report.js) çalışır.
 * İlke: yalnızca gerçek veri; her rakamın kaynağı ve saati yazılır; veri yoksa "boşluk" olarak listelenir, tahmin/uydurma yapılmaz.
 * Satış dili: emir yok. Elde tutulan varlıkta en ağır ifade "satışı/azaltmayı gözden geçir (taze analizle)"; tek istisna kullanıcının kendi stop kuralıdır.
 * Helal: yatırım önerileri yalnız helal varlıklar için; helal olmayan piyasa verisi (endeks, VIX, faiz) yalnızca piyasayı okumak için kullanılır. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sessions.js'), require('./stops.js'));
  else root.Report = factory(root.Sessions, root.Stops);
})(typeof self !== 'undefined' ? self : this, function (SS, ST) {
  'use strict';
  var VERSION = 1;
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function r(x, d) { if (!num(x)) return null; var m = Math.pow(10, d == null ? 4 : d); return Math.round(x * m) / m; }
  function last(a) { for (var i = (a || []).length - 1; i >= 0; i--) if (num(a[i])) return a[i]; return null; }
  function fmtP(x) { return ST.fmtP(x); }
  function pc(x, d) { return num(x) ? (x >= 0 ? '+%' : '−%') + Math.abs(x * 100).toFixed(d == null ? 2 : d).replace('.', ',') : '—'; }
  function f1(x) { return num(x) ? x.toFixed(1).replace('.', ',') : '—'; }

  /* ---------- 1) Bir varlığın verisi: seri + analiz + ek göstergeler (MACD, SMA20, son 90 gün) ---------- */
  function gatherAsset(env, key, opts) {
    opts = opts || {}; var MD = env.MD, AN = env.AN, SN = env.SN;
    return MD.load(key, {}).then(function (series) {
      return SN.contextFor(MD, key, series, opts.halal ? { halal: opts.halal } : undefined).then(function (ctx) {
        var c2 = Object.assign({}, ctx, { holding: !!opts.holding });
        var A = AN.analyze(series, c2); A.series = series; A.ctx = ctx;
        var snap = SN.compact(A, { at: new Date(env.now || Date.now()).toISOString() });
        if (A.stance && A.stance.hold) snap.stance.hold = { code: A.stance.hold.code, label: A.stance.hold.label, why: (A.stance.hold.why || []).slice(0, 4), trail: num(A.stance.hold.trail) ? r(A.stance.hold.trail) : null };
        var bars = (series.bars || []).filter(function (b) { return b && num(b.c); }), tail = bars.slice(-90), I = A.ind || {};
        var mac = I.macd ? { line: r(last(I.macd.macd), 4), signal: r(last(I.macd.signal), 4), hist: r(last(I.macd.hist), 4), cross: crossOf(I.macd.hist) } : null;
        return { key: key, ok: true, snap: snap, name: series.name || key, kind: series.kind, currency: series.currency || 'TRY', closeOnly: !!series.closeOnly,
          bars: tail.map(function (b) { return { d: b.d, c: r(b.c, 6), h: num(b.h) ? r(b.h, 6) : null, l: num(b.l) ? r(b.l, 6) : null, v: num(b.v) ? b.v : null }; }),
          y1: yearRange(bars), macd: mac, sma20: r(last(I.sma20 || []), 4), live: series.live ? { price: series.live.price, at: series.live.at, source: series.live.source } : null, liveError: series.liveError || null,
          hist: series.histSource || null, sector: series.sector || null };
      });
    }).catch(function (e) { return { key: key, ok: false, error: String(e && e.message || e).slice(0, 160) }; });
  }
  function crossOf(h) { if (!h) return null; var n = h.length; for (var k = n - 1; k >= Math.max(1, n - 5); k--) { if (num(h[k]) && num(h[k - 1])) { if (h[k - 1] <= 0 && h[k] > 0) return { dir: 'up', ago: n - 1 - k }; if (h[k - 1] >= 0 && h[k] < 0) return { dir: 'down', ago: n - 1 - k }; } } return null; }
  function yearRange(bars) { var b = bars.slice(-252), hi = null, lo = null; b.forEach(function (x) { var h = num(x.h) ? x.h : x.c, l = num(x.l) ? x.l : x.c; if (hi == null || h > hi) hi = h; if (lo == null || l < lo) lo = l; }); return { hi: r(hi, 6), lo: r(lo, 6), n: b.length }; }

  /* ---------- 2) Fiyat ve değişim (canlı fiyat yoksa son kapanış; hangisi olduğu yazılır) ---------- */
  function priceOf(g, market, nowMs) {
    var bars = g.bars || [], n = bars.length; if (!n) return null;
    var lb = bars[n - 1], today = SS.localYmd(market === 'crypto' ? 'bist' : market, nowMs), live = g.live && num(g.live.price) && g.live.price > 0 ? g.live : null;
    var liveDay = live && live.at ? SS.localYmd(market === 'crypto' ? 'bist' : market, Date.parse(live.at)) : null, cur, prev, kind, asOf, curDay;
    if (live && liveDay && liveDay > lb.d) { cur = live.price; prev = lb.c; kind = 'canlı'; asOf = live.at; curDay = liveDay; }
    else if (live && liveDay === lb.d) { cur = live.price; prev = n > 1 ? bars[n - 2].c : null; kind = 'canlı'; asOf = live.at; curDay = lb.d; }
    else { cur = lb.c; prev = n > 1 ? bars[n - 2].c : null; kind = 'kapanış'; asOf = (g.hist && g.hist.at) || lb.d; curDay = lb.d; }
    var w = n > 5 ? bars[n - 6].c : null, m = n > 21 ? bars[n - 22].c : null;
    var vols = bars.slice(-21, -1).map(function (b) { return b.v; }).filter(num), vAvg = vols.length >= 10 ? vols.reduce(function (a, b) { return a + b; }, 0) / vols.length : null;
    return { price: r(cur, 6), prev: r(prev, 6), chg: num(prev) && prev > 0 ? r(cur / prev - 1, 6) : null, w1: num(w) && w > 0 ? r(lb.c / w - 1, 6) : null, m1: num(m) && m > 0 ? r(lb.c / m - 1, 6) : null,
      kind: kind, asOf: asOf, day: curDay, today: today, isToday: curDay === today, volRatio: vAvg && num(lb.v) && lb.d === curDay ? r(lb.v / vAvg, 2) : null,
      fromHi: g.y1 && num(g.y1.hi) ? r(cur / g.y1.hi - 1, 4) : null, fromLo: g.y1 && num(g.y1.lo) ? r(cur / g.y1.lo - 1, 4) : null, src: kind === 'canlı' ? (live.source || 'canlı kaynak') : ((g.hist && g.hist.label) || 'günlük seri') };
  }

  /* ---------- 3) Teknik okuma (mevcut analiz modüllerinin çıktısından; yorum kural tabanlı) ---------- */
  function technicals(g, P) {
    var s = g.snap || {}, ind = s.ind || {}, p = P ? P.price : s.price, out = { lines: [], trend: null, rsi: ind.rsi, adx: ind.adx, atrPct: ind.atrPct, macd: g.macd, mas: [] };
    if (!num(p)) return out;
    var s50 = ind.sma50, s200 = ind.sma200;
    if (num(s50) && num(s200)) out.trend = p > s50 && s50 > s200 ? { code: 'up', label: 'Yükseliş trendi', why: 'Fiyat > 50 gün ort. > 200 gün ort.' } : p < s50 && s50 < s200 ? { code: 'down', label: 'Düşüş trendi', why: 'Fiyat < 50 gün ort. < 200 gün ort.' } : p > s200 ? { code: 'side_up', label: 'Uzun vade yukarı, kısa vade kararsız', why: 'Fiyat 200 gün ort. üstünde, 50 gün ort. ile kesişme bölgesinde' } : { code: 'side_down', label: 'Uzun vade aşağı, kısa vadede tepki', why: 'Fiyat 200 gün ort. altında' };
    else if (num(s50)) out.trend = p > s50 ? { code: 'side_up', label: 'Kısa-orta vade yukarı', why: 'Fiyat 50 gün ort. üstünde (200 gün için veri yetersiz)' } : { code: 'side_down', label: 'Kısa-orta vade aşağı', why: 'Fiyat 50 gün ort. altında (200 gün için veri yetersiz)' };
    if (out.trend) out.lines.push('Trend: ' + out.trend.label + ' (' + out.trend.why + ')' + (num(ind.adx) ? ' · ADX ' + f1(ind.adx) + (ind.adx >= 25 ? ' (trend güçlü)' : ind.adx < 18 ? ' (trend zayıf/yatay)' : '') : ''));
    if (num(ind.rsi)) out.lines.push('RSI(14) ' + f1(ind.rsi) + ': ' + (ind.rsi >= 70 ? 'aşırı alım bölgesi — geri çekilme riski' : ind.rsi <= 30 ? 'aşırı satım bölgesi — tepki olasılığı, ama trend aşağıysa düşüş sürebilir' : ind.rsi >= 50 ? 'momentum pozitif tarafta' : 'momentum negatif tarafta'));
    if (g.macd && num(g.macd.line) && num(g.macd.signal)) out.lines.push('MACD ' + (g.macd.line > g.macd.signal ? 'sinyal çizgisinin üstünde (momentum güçleniyor)' : 'sinyal çizgisinin altında (momentum zayıflıyor)') + (g.macd.cross ? ' · ' + (g.macd.cross.ago === 0 ? 'bugün' : g.macd.cross.ago + ' gün önce') + ' ' + (g.macd.cross.dir === 'up' ? 'yukarı' : 'aşağı') + ' kesişim' : ''));
    [['20', g.sma20], ['50', s50], ['200', s200]].forEach(function (m) { if (num(m[1])) out.mas.push({ n: m[0], v: m[1], d: r(p / m[1] - 1, 4) }); });
    if (out.mas.length) out.lines.push('Ortalamalar: ' + out.mas.map(function (m) { return m.n + 'g ' + fmtP(m.v) + ' (' + pc(m.d, 1) + ')'; }).join(' · '));
    if (num(ind.atrPct)) out.lines.push('Günlük ortalama hareket (ATR): %' + (ind.atrPct * 100).toFixed(2).replace('.', ','));
    var dv = (s.structure && s.structure.divergences || []).filter(function (d) { return d.fresh; });
    if (dv.length) out.lines.push('Güncel uyumsuzluk: ' + dv.map(function (d) { return d.type === 'bear' ? 'negatif (düşüş uyarısı)' : 'pozitif (tepki işareti)'; }).join(', '));
    var pt = (s.structure && s.structure.patterns || []).filter(function (x) { return x.name; });
    if (pt.length) out.lines.push('Formasyon: ' + pt.slice(0, 2).map(function (x) { return x.name + (x.status ? ' (' + x.status + ')' : ''); }).join(', '));
    return out;
  }
  function levels(g, P) {
    var s = g.snap || {}, p = P ? P.price : s.price, zs = (s.structure && s.structure.zones) || [];
    var sup = zs.filter(function (z) { return z.hi < p; }).sort(function (a, b) { return b.hi - a.hi; }).slice(0, 2), res = zs.filter(function (z) { return z.lo > p; }).sort(function (a, b) { return a.lo - b.lo; }).slice(0, 2);
    var inZone = zs.filter(function (z) { return z.lo <= p && p <= z.hi; })[0] || null;
    var pl = s.plans && s.plans.conservative;
    return { support: sup.map(function (z) { return { lo: z.lo, hi: z.hi, touches: z.touches, d: num(p) ? r(z.hi / p - 1, 4) : null }; }), resistance: res.map(function (z) { return { lo: z.lo, hi: z.hi, touches: z.touches, d: num(p) ? r(z.lo / p - 1, 4) : null }; }),
      inZone: inZone ? { lo: inZone.lo, hi: inZone.hi, side: inZone.side } : null, plan: pl ? { how: pl.how, ok: pl.ok, verdict: pl.verdict, entryLo: pl.entryLo, entryHi: pl.entryHi, stop: pl.stop, targets: (pl.targets || []).slice(0, 2), rr: pl.rr } : null,
      planNotes: (s.plans && s.plans.notes) || [] };
  }

  /* ---------- 4) Analize dayalı değerlendirme metni (gerekçeli; satış emri yok) ---------- */
  function assessment(g, h, halal) {
    var s = g.snap || {}, st = s.stance || {}, hold = st.hold, lines = [], kind = 'info';
    if (s.blocked) return { kind: 'gap', title: 'Analiz yapılamadı', lines: (s.blockReasons || ['Veri yetersiz']).slice(0, 3) };
    var halalOk = halal === 'uygun' || (s.halal && s.halal.status === 'uygun');
    lines.push('Genel görünüm: ' + (st.label || '—') + (num(s.total) ? ' (skor ' + s.total + '/100, güven: ' + (s.confLabel || '—') + ')' : ''));
    (st.why || []).slice(0, 3).forEach(function (w) { lines.push('• ' + w); });
    if (h && hold) {
      if (hold.code === 'trim') { kind = 'review'; lines.push('Elindeki pozisyon için: ' + hold.label + '. Bu bir emir değildir — karar öncesi Portföy Analizi\'nde bu varlığın TAZE tam analizini aç.'); }
      else if (hold.code === 'raise') { kind = 'positive'; lines.push('Elindeki pozisyon için: ' + hold.label + (num(hold.trail) ? ' (analizin önerdiği iz süren stop ' + fmtP(hold.trail) + ')' : '') + '.'); }
      else lines.push('Elindeki pozisyon için: ' + hold.label + '.');
      (hold.why || []).slice(0, 3).forEach(function (w) { lines.push('• ' + w); });
    }
    if (!halalOk) { lines.push('Helal uygunluğu doğrulanmadı: yeni alım önerilmez.'); if (kind === 'positive') kind = 'info'; }
    return { kind: kind, title: kind === 'review' ? 'Gözden geçir (analizden sonra)' : kind === 'positive' ? 'Olumlu' : 'Bilgi', lines: lines };
  }
  function halalNote(g, h) {
    var lab = h && h.halalLabel, s = g.snap || {};
    if (h && h.halal) return { status: h.halal, text: (lab || h.halal) + (h.halalNote ? ' — ' + h.halalNote : '') + (s.halal && s.halal.reason ? ' · Veri kaynağı etiketi: ' + s.halal.reason : '') };
    return s.halal ? { status: s.halal.status, text: s.halal.label + ' — ' + s.halal.reason } : { status: 'bilinmiyor', text: 'Helal etiketi yok — kendin doğrula' };
  }

  /* ---------- 5) Haber, KAP, takvim, senaryo eşleme ---------- */
  var GROUP_OF_CLS = { katilim_stock: 'tr_equity', katilim_fund: 'tr_equity', halal_etf: 'us_equity', gold: 'gold', crypto: 'crypto', cash: 'tr_income', sukuk: 'tr_income', other: 'tr_equity' };
  function groupOfKey(key, cls) { if (cls && GROUP_OF_CLS[cls]) return GROUP_OF_CLS[cls]; var p = String(key).split(':')[0]; return p === 'us' || p === 'td' ? 'us_equity' : p === 'metal' ? 'gold' : p === 'cg' ? 'crypto' : p === 'tefas' ? 'tr_income' : 'tr_equity'; }
  var REGION_OF_GROUP = { tr_equity: ['TR'], tr_income: ['TR'], us_equity: ['US'], gold: ['US', 'TR'], crypto: ['US'] };
  function eventsFor(calendar, group, fromMs, toMs) {
    var regs = REGION_OF_GROUP[group] || ['TR', 'US'];
    return ((calendar && calendar.events) || []).filter(function (e) { var t = Date.parse(e.at || (e.date + 'T12:00:00Z')); return t >= fromMs && t <= toMs && (e.impact === 'high' || (e.impact === 'medium' && regs.indexOf(e.country) >= 0)) && (regs.indexOf(e.country) >= 0 || e.impact === 'high'); })
      .sort(function (a, b) { return Date.parse(a.at || a.date) - Date.parse(b.at || b.date); }).slice(0, 8)
      .map(function (e) { return { title: e.title, at: e.at || null, date: e.date, time: e.time || null, country: e.country, impact: e.impact, forecast: e.forecast != null ? e.forecast : null, previous: e.previous != null ? e.previous : null, actual: e.actual != null ? e.actual : null, src: e.source && e.source.name || null, url: e.source && e.source.url || null }; });
  }
  function scenariosFor(scen, group) {
    return ((scen && scen.events) || []).filter(function (e) { return (e.scenarios || []).some(function (s) { return (s.effects || []).some(function (x) { return x.group === group; }); }); }).slice(0, 3).map(function (e) {
      return { title: e.title, label: e.label, date: e.date, time: e.time, daysLeft: e.daysLeft, impact: e.impact, probsNote: e.probsNote || null, source: e.probs && e.probs.source || null,
        scenarios: (e.scenarios || []).map(function (s) { var ef = (s.effects || []).filter(function (x) { return x.group === group; })[0]; return { label: s.label, prob: num(s.prob) ? s.prob : null, dir: ef ? ef.dir : 'none' }; }) };
    });
  }
  function newsFor(news, key, sym, name, since) {
    return (news || []).filter(function (n) { return (n.matches || []).some(function (m) { return m.h && (m.h.key === key) && m.kind === 'direct'; }) && Date.parse(n.a || 0) >= since; }).slice(0, 5)
      .map(function (n) { return { t: n.t, u: n.u, s: n.s || (n.srcs && n.srcs[0] && n.srcs[0].s) || null, a: n.a, kap: !!n.kap, level: n.imp && n.imp.level || null }; });
  }
  function techScenarios(P, L, stop, cur) {
    if (!P || !num(P.price)) return [];
    var out = [], R1 = L.resistance[0], S1 = L.support[0];
    if (R1) out.push({ label: 'Yukarı', cond: fmtP(R1.lo) + ' üzerinde kalıcılık (günlük kapanış)', then: L.resistance[1] ? 'sıradaki direnç ' + fmtP(L.resistance[1].lo) + '–' + fmtP(L.resistance[1].hi) : 'üstte belirgin direnç yok', prob: null });
    if (S1) out.push({ label: 'Aşağı', cond: fmtP(S1.lo) + ' altında kapanış', then: (L.support[1] ? 'sıradaki destek ' + fmtP(L.support[1].lo) + '–' + fmtP(L.support[1].hi) : 'altta belirgin destek yok') + (stop && num(stop.eff) ? '; stopun ' + fmtP(stop.eff) : ''), prob: null });
    if (R1 && S1) out.push({ label: 'Yatay', cond: fmtP(S1.hi) + ' – ' + fmtP(R1.lo) + ' bandında kalırsa', then: 'bant içi dalgalanma; kırılım yönü beklenir', prob: null });
    return out;
  }

  /* ---------- 6) Seans (slot) anlatımı: açılış öncesi = beklenti/seviye, ortası = ne oldu/neden, sonrası = özet/yarın planı ---------- */
  function narrative(slot, a, ctx) {
    var P = a.px, L = a.levels, lines = [], cur = a.currency === 'USD' ? '$' : '';
    if (!P) return ['Fiyat verisi yok — bu varlık için anlatım üretilemedi.'];
    var nm = a.sym || a.name;
    if (slot === 'pre') {
      lines.push('Önceki kapanış ' + fmtP(P.kind === 'kapanış' ? P.price : P.prev) + (num(P.chg) && P.kind === 'kapanış' ? ' (' + pc(P.chg) + ')' : '') + '.');
      if (P.kind === 'canlı' && P.isToday) lines.push('Seans öncesi/erken fiyat: ' + fmtP(P.price) + ' (' + pc(P.chg) + ', ' + P.src + ').');
      if (L.support[0] || L.resistance[0]) lines.push('Bugün izlenecek: ' + [L.support[0] ? 'destek ' + fmtP(L.support[0].lo) + '–' + fmtP(L.support[0].hi) : null, L.resistance[0] ? 'direnç ' + fmtP(L.resistance[0].lo) + '–' + fmtP(L.resistance[0].hi) : null].filter(Boolean).join(' · ') + '.');
      if (a.stop && a.stop.level) lines.push('Stopun ' + fmtP(a.stop.eff) + ' (uzaklık ' + pc(a.stop.distPct, 1) + ').');
      if (a.events.length) lines.push('Bugünkü olaylar: ' + a.events.filter(function (e) { return e.date === ctx.today; }).slice(0, 3).map(function (e) { return (e.time ? e.time + ' ' : '') + e.title; }).join('; ') + '.');
      if (a.kap.length) lines.push('Son KAP: ' + a.kap[0].t);
    } else if (slot === 'mid') {
      if (P.isToday && num(P.chg)) {
        lines.push('Seans içinde ' + pc(P.chg) + ' (' + fmtP(P.price) + ', ' + P.src + ', ' + (P.asOf ? SS.fmtTsi(Date.parse(P.asOf)) + ' TSİ' : '') + ').');
        var why = [];
        if (ctx.indexChg != null && num(P.chg)) { var same = (P.chg >= 0) === (ctx.indexChg >= 0); why.push(ctx.indexLabel + ' ' + pc(ctx.indexChg) + (ctx.indexAt ? ' (' + SS.fmtTsi(Date.parse(ctx.indexAt)) + ' TSİ verisi)' : '') + (same ? ' — piyasayla aynı yönde' : ' — piyasadan ayrışıyor')); }
        if (a.news.length) why.push('ilgili haber: “' + a.news[0].t.slice(0, 90) + '”');
        if (a.kap.length) why.push('KAP: “' + a.kap[0].t.slice(0, 90) + '”');
        lines.push(why.length ? 'Olası etkenler (kanıt): ' + why.join('; ') + '.' : 'Harekete eşlik eden haber/KAP bulunamadı; piyasa geneli ve teknik seviyelerle birlikte değerlendir.');
      } else lines.push(a.closeOnly ? 'Bu varlığın fiyatı günde bir kez açıklanır; seans içi değişim yok. Son fiyat ' + fmtP(P.price) + ' (' + P.day + ').' : 'Bugün için canlı fiyat alınamadı; son fiyat ' + fmtP(P.price) + ' (' + P.day + ', ' + P.src + ').');
      if (L.inZone) lines.push('Fiyat şu an ' + L.inZone.side + ' bölgesinde (' + fmtP(L.inZone.lo) + '–' + fmtP(L.inZone.hi) + ').');
    } else {
      lines.push((P.isToday ? 'Günü ' : 'Son işlem günü (' + P.day + ') ') + pc(P.chg) + ' ile ' + fmtP(P.price) + ' seviyesinde tamamladı' + (num(P.w1) ? '; haftalık ' + pc(P.w1, 1) : '') + (num(P.m1) ? ', aylık ' + pc(P.m1, 1) : '') + '.' + (num(P.volRatio) && P.isToday ? ' Hacim 20 günlük ortalamanın ' + f1(P.volRatio) + ' katı' + (P.volRatio >= 1.5 ? ' (ilgi yüksek).' : P.volRatio < 0.7 ? ' (ilgi düşük).' : '.') : ''));
      var plan = [];
      if (L.resistance[0]) plan.push(fmtP(L.resistance[0].lo) + ' üzerinde kapanış → olumlu senaryo güçlenir');
      if (L.support[0]) plan.push(fmtP(L.support[0].lo) + ' altında kapanış → zayıflama' + (a.stop && a.stop.level ? '; stop ' + fmtP(a.stop.eff) : ''));
      if (plan.length) lines.push('Yarın için plan: ' + plan.join(' · ') + '.');
      var tm = a.events.filter(function (e) { return e.date > ctx.today; }).slice(0, 2);
      if (tm.length) lines.push('Yaklaşan: ' + tm.map(function (e) { return e.date.slice(8, 10) + '.' + e.date.slice(5, 7) + (e.time ? ' ' + e.time : '') + ' ' + e.title; }).join('; ') + '.');
    }
    return lines;
  }

  /* ---------- 7) Rapor kurma (SAF) ----------
   * inp: { slot (Sessions slot nesnesi), nowMs, holdings:[{key, assetId, name, sym, cls, valueTL, units, avgCost, costTL, halal, halalLabel, halalNote, stop, stopEval, notes:[{date,side,note}] }],
   *        assets: { key: gatherAsset sonucu }, news:[News.process çıktısı], calendar, scenarios, probs, macro, alerts, personal:bool, gaps:[] } */
  var OVERVIEW = { bist: ['XU100', 'USDTRY', 'XAUUSD', 'BRENT', 'VIX', 'US10Y'], us: ['SPX', 'VIX', 'US10Y', 'DXY', 'XAUUSD'], crypto: ['BTCUSD', 'VIX', 'DXY'] };
  function build(inp) {
    var sl = inp.slot, now = inp.nowMs, market = sl.market, today = sl.ymd, gaps = (inp.gaps || []).slice();
    var macro = ((inp.macro && inp.macro.items) || []), mk = {}; macro.forEach(function (m) { mk[m.k] = m; });
    var overview = OVERVIEW[market].map(function (k) { var m = mk[k]; return m ? { k: k, label: m.label, last: m.last, chg1d: m.chg1d, chg5d: m.chg5d, asOf: m.asOf, src: m.src, spark: (m.spark || []).slice(-30) } : null; }).filter(Boolean);
    OVERVIEW[market].forEach(function (k) { if (!mk[k]) gaps.push('Piyasa göstergesi alınamadı: ' + k); });
    var idx = market === 'bist' ? mk.XU100 : market === 'us' ? mk.SPX : mk.BTCUSD, ctx = { today: today, indexChg: idx ? idx.chg1d : null, indexLabel: idx ? idx.label : '', indexAt: idx ? idx.asOf : null };
    var total = (inp.holdings || []).reduce(function (t, h) { return t + (h.valueTL > 0 ? h.valueTL : 0); }, 0);
    var since = now - (sl.slot === 'pre' ? 36 : 24) * 3600000;
    var assets = (inp.holdings || []).map(function (h) {
      var g = inp.assets[h.key] || { ok: false, error: 'veri yok' }, grp = groupOfKey(h.key, h.cls);
      var a = { key: h.key, assetId: h.assetId || null, name: h.name, sym: h.sym || null, cls: h.cls || null, group: grp, currency: g.currency || 'TRY', closeOnly: !!g.closeOnly, valueTL: h.valueTL, units: h.units, avgCost: h.avgCost, costTL: h.costTL, plTL: h.plTL, share: total > 0 && h.valueTL > 0 ? r(h.valueTL / total, 4) : null, ok: !!g.ok };
      if (!g.ok) { a.error = g.error; gaps.push(h.name + ': piyasa verisi alınamadı (' + (g.error || 'bilinmeyen hata') + ')'); a.events = []; a.news = []; a.kap = []; a.halal = halalNote({}, h); a.notes = (h.notes || []).slice(0, 4); return a; }
      a.px = priceOf(g, market, now); a.tech = technicals(g, a.px); a.levels = levels(g, a.px); a.assess = assessment(g, true, h.halal); a.halal = halalNote(g, h);
      a.spark = (g.bars || []).slice(-60).map(function (b) { return [b.d, b.c]; }); a.y1 = g.y1; a.src = { hist: g.hist, live: g.live, liveError: g.liveError, analysisAt: g.snap && g.snap.at };
      if (a.px && !a.px.isToday && sl.slot !== 'pre' && !g.closeOnly) gaps.push(h.name + ': bugünün fiyatı yok — son fiyat ' + a.px.day + ' tarihli');
      if (g.liveError && !g.closeOnly) a.liveNote = 'Canlı fiyat alınamadı: ' + String(g.liveError).slice(0, 80);
      a.events = eventsFor(inp.calendar, grp, now - 6 * 3600000, now + 3 * 86400000); a.scen = scenariosFor(inp.scenarios, grp);
      var allNews = newsFor(inp.news, h.key, h.sym, h.name, since); a.news = allNews.filter(function (n) { return !n.kap; }); a.kap = allNews.filter(function (n) { return n.kap; });
      if (h.stop) { var ev = h.stopEval || null; a.stop = { price: h.stop.price, mode: h.stop.mode, trail: h.stop.trail, eff: ev && ev.eff ? ev.eff.level : h.stop.price, how: ev && ev.eff ? ev.eff.how : 'Sabit seviye', level: ev ? ev.level : null, distPct: ev ? ev.distPct : null, text: ev ? ev.text : 'Fiyat yok — kontrol edilemedi', midas: !!h.stop.midas, note: ST.midasNote({ cls: h.cls }, h.stop), reason: h.stop.reason || '' }; }
      else { var sg = ST.suggest(g.snap); a.stopSuggest = sg.ok ? { price: sg.price, mode: sg.mode, text: sg.text } : { none: true, text: sg.why }; }
      a.techScen = techScenarios(a.px, a.levels, a.stop, a.currency);
      a.notes = (h.notes || []).slice(0, 4);
      a.story = narrative(sl.slot, a, ctx);
      return a;
    });
    // Özet sayfası
    var moved = assets.filter(function (a) { return a.px && num(a.px.chg) && (a.px.isToday || sl.slot === 'pre'); });
    var dayTL = 0, covTL = 0; moved.forEach(function (a) { if (a.valueTL > 0) { dayTL += a.valueTL - a.valueTL / (1 + a.px.chg); covTL += a.valueTL; } });
    var sorted = moved.slice().sort(function (x, y) { return y.px.chg - x.px.chg; });
    var stopsNear = assets.filter(function (a) { return a.stop && a.stop.level && a.stop.level !== 'ok'; }).map(function (a) { return { name: a.sym || a.name, level: a.stop.level, label: ST.LEVEL_TR[a.stop.level], eff: a.stop.eff, distPct: a.stop.distPct }; });
    var keyLevels = assets.filter(function (a) { return a.px && (a.levels.support[0] || a.levels.resistance[0]); }).map(function (a) { return { name: a.sym || a.name, price: a.px.price, sup: a.levels.support[0] ? a.levels.support[0].hi : null, supD: a.levels.support[0] ? a.levels.support[0].d : null, res: a.levels.resistance[0] ? a.levels.resistance[0].lo : null, resD: a.levels.resistance[0] ? a.levels.resistance[0].d : null, stop: a.stop ? a.stop.eff : null }; })
      .sort(function (x, y) { return Math.min(Math.abs(x.supD || 1), Math.abs(x.resD || 1)) - Math.min(Math.abs(y.supD || 1), Math.abs(y.resD || 1)); }).slice(0, 8);
    var evToday = eventsFor(inp.calendar, market === 'us' ? 'us_equity' : market === 'crypto' ? 'crypto' : 'tr_equity', now - 3 * 3600000, now + 30 * 3600000);
    var lights = riskLights({ assets: assets, stopsNear: stopsNear, macro: mk, evToday: evToday, total: total, alerts: inp.alerts, now: now, gaps: gaps, market: market });
    if (!inp.personal) lights = lights.filter(function (l) { return l.k !== 'stop' && l.k !== 'conc' && l.k !== 'halal'; });
    var summary = { dayTL: total > 0 ? Math.round(dayTL) : null, dayPct: covTL > 0 ? r(dayTL / (covTL - dayTL), 6) : null, coverage: total > 0 ? r(covTL / total, 4) : null, totalTL: total || null,
      winners: sorted.filter(function (a) { return a.px.chg > 0; }).slice(0, 3).map(mini), losers: sorted.filter(function (a) { return a.px.chg < 0; }).reverse().slice(0, 3).map(mini),
      keyLevels: keyLevels, stopsNear: stopsNear, events: evToday.slice(0, 6), lights: lights,
      alloc: assets.filter(function (a) { return a.valueTL > 0; }).map(function (a) { return { name: a.sym || a.name, v: a.valueTL }; }).sort(function (x, y) { return y.v - x.v; }),
      moves: moved.map(function (a) { return { name: a.sym || a.name, chg: a.px.chg }; }).sort(function (x, y) { return y.chg - x.chg; }) };
    summary.headline = headline(sl, summary, overview, inp.personal);
    var rep = { v: VERSION, id: sl.id, market: market, marketLabel: SS.MARKETS[market].label, slot: sl.slot, slotLabel: sl.label, focus: sl.focus, ymd: today, slotAt: new Date(sl.atMs).toISOString(), generatedAt: new Date(now).toISOString(),
      half: !!sl.half, dayNote: sl.note || null, personal: !!inp.personal, overview: overview, summary: summary, assets: assets, gaps: uniq(gaps).slice(0, 40), origin: inp.origin || 'app',
      sources: sourcesOf(inp, assets), disclaimer: 'Bu rapor yatırım tavsiyesi değildir; kural tabanlı analiz çıktısıdır. Satış önerisi verilmez: "gözden geçir" ifadeleri taze tam analizden sonra senin kararındır. Stop seviyeleri senin kurallarındır; uygulama emir iletemez.' };
    rep.push = pushText(rep);
    return rep;
  }
  function mini(a) { return { name: a.sym || a.name, chg: a.px.chg, price: a.px.price }; }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }
  function riskLights(o) {
    var L = [];
    var hit = o.stopsNear.filter(function (s) { return s.level === 'hit'; }), near = o.stopsNear.filter(function (s) { return s.level === 'near' || s.level === 'below_intraday'; });
    L.push({ k: 'stop', label: 'Stop yakınlığı', c: hit.length ? 'red' : near.length ? 'amber' : o.stopsNear.length ? 'amber' : 'green', text: hit.length ? hit.map(function (s) { return s.name; }).join(', ') + ': stop kırıldı' : near.length ? near.map(function (s) { return s.name; }).join(', ') + ': stopa çok yakın' : o.stopsNear.length ? o.stopsNear.length + ' varlık stopa yaklaşıyor' : (o.assets.some(function (a) { return a.stop; }) ? 'Stoplar uzakta' : 'Stop tanımlı değil') });
    var big = o.assets.filter(function (a) { return a.share != null; }).sort(function (x, y) { return y.share - x.share; })[0];
    if (big) L.push({ k: 'conc', label: 'Yoğunlaşma', c: big.share > 0.5 ? 'red' : big.share > 0.25 ? 'amber' : 'green', text: 'En büyük kalem ' + (big.sym || big.name) + ' %' + (big.share * 100).toFixed(0) + ' (bu raporun varlıkları içinde)' });
    var vix = o.macro.VIX; if (vix) L.push({ k: 'vol', label: 'Küresel risk (VIX)', c: vix.last >= 30 ? 'red' : vix.last >= 20 ? 'amber' : 'green', text: 'VIX ' + f1(vix.last) + ' (' + pc(vix.chg1d, 1) + ') · ' + (vix.last >= 30 ? 'yüksek korku' : vix.last >= 20 ? 'temkinli' : 'sakin') });
    var hi = o.evToday.filter(function (e) { return e.impact === 'high'; }); L.push({ k: 'event', label: 'Olay riski (24 sa)', c: hi.length >= 2 ? 'red' : hi.length ? 'amber' : 'green', text: hi.length ? hi.slice(0, 2).map(function (e) { return e.title; }).join('; ') : 'Yüksek etkili olay yok' });
    var shock = ((o.alerts && o.alerts.items) || []).filter(function (a) { return a.cat === 'market' && o.now - Date.parse(a.at) < 24 * 3600000; }); L.push({ k: 'shock', label: 'Piyasa şoku (24 sa)', c: shock.some(function (a) { return a.sev === 'critical'; }) ? 'red' : shock.length ? 'amber' : 'green', text: shock.length ? shock.slice(0, 2).map(function (a) { return a.title; }).join('; ') : 'Olağandışı hareket uyarısı yok' });
    var nh = o.assets.filter(function (a) { return a.halal && a.halal.status && a.halal.status !== 'uygun'; }); L.push({ k: 'halal', label: 'Helal uygunluk', c: nh.some(function (a) { return a.halal.status === 'uygun_degil'; }) ? 'red' : nh.length ? 'amber' : 'green', text: nh.length ? nh.map(function (a) { return a.sym || a.name; }).slice(0, 4).join(', ') + ': ' + (nh.some(function (a) { return a.halal.status === 'uygun_degil'; }) ? 'uygun değil/şüpheli etiketli' : 'doğrulanmamış') : 'Tümü uygun etiketli' });
    var g = o.gaps.length; L.push({ k: 'data', label: 'Veri tamlığı', c: g >= 4 ? 'red' : g ? 'amber' : 'green', text: g ? g + ' veri boşluğu (rapor sonunda listeli)' : 'Eksik veri yok' });
    return L;
  }
  function headline(sl, s, ov, personal) {
    var a = SS.MARKETS[sl.market].short + ' ' + sl.label.toLowerCase() + ' raporu';
    var b = [];
    if (personal && num(s.dayPct)) b.push('Portföy (bu grup) ' + pc(s.dayPct));
    if (s.winners[0]) b.push('en iyi ' + s.winners[0].name + ' ' + pc(s.winners[0].chg, 1));
    if (s.losers[0]) b.push('en zayıf ' + s.losers[0].name + ' ' + pc(s.losers[0].chg, 1));
    if (!b.length && ov[0]) b.push(ov[0].label + ' ' + pc(ov[0].chg1d));
    var red = s.lights.filter(function (l) { return l.c === 'red'; }).map(function (l) { return l.label; });
    return { title: a, line1: b.join(' · ') || 'Fiyat değişimi verisi yok', line2: (s.stopsNear.length ? 'Stop: ' + s.stopsNear.map(function (x) { return x.name + ' ' + x.label.toLowerCase(); }).join(', ') + ' · ' : '') + (red.length ? 'Kırmızı: ' + red.join(', ') : 'Kırmızı risk ışığı yok') + (s.events[0] ? ' · Olay: ' + s.events[0].title.slice(0, 50) : '') };
  }
  function pushText(rep) { var h = rep.summary.headline; return { title: '📊 ' + h.title + ' hazır', message: h.line1 + '\n' + h.line2 }; }
  function sourcesOf(inp, assets) {
    var s = [];
    function add(label, at, url) { if (label && !s.some(function (x) { return x.label === label; })) s.push({ label: label, at: at || null, url: url || null }); }
    assets.forEach(function (a) { if (a.src && a.src.hist) add(a.src.hist.label, a.src.hist.at); if (a.src && a.src.live) add(a.src.live.source || 'Canlı fiyat', a.src.live.at); });
    if (inp.macro) add('Piyasa göstergeleri — hub/macro.json (Yahoo Finance, resmî olmayan)', inp.macro.generatedAt);
    if (inp.calendar) add('Ekonomik takvim — hub/calendar.json (ForexFactory + kurallar)', inp.calendar.generatedAt);
    if (inp.scenarios) add('Senaryolar — hub/scenarios.json (olasılık yalnız gerçek kaynak varsa)', inp.scenarios.generatedAt);
    if (inp.feedAt) add('Haber akışı — news/feed.json (RSS, Midas\'ın Kulakları dahil)', inp.feedAt);
    if (assets.some(function (a) { return a.kap && a.kap.length; })) add('KAP bildirimleri — kap.org.tr', null, 'https://www.kap.org.tr');
    return s.slice(0, 20);
  }
  /* Herkese açık (kişisel veri içermeyen) piyasa raporu: yalnız göstergeler, takvim, senaryo ve genel haber başlıkları */
  function buildPublic(inp) {
    var rep = build(Object.assign({}, inp, { holdings: [], assets: {}, personal: false }));
    rep.publicNews = ((inp.feed && inp.feed.items) || []).filter(function (n) { return Date.parse(n.a || 0) > inp.nowMs - 12 * 3600000 && (n.r === (rep.market === 'us' ? 'en' : 'tr') || rep.market === 'crypto'); }).slice(0, 8).map(function (n) { return { t: n.t, u: n.u, s: n.s, a: n.a }; });
    delete rep.summary.alloc; rep.assets = [];
    return rep;
  }

  /* ---------- 8) Uygulama ve sunucu için ortak "kişisel" girdi üretimi (BgWatch.calcOf / holdingsOf ile aynı değerleme) ---------- */
  function holdingsFor(BG, PF, state, todayYmd, market) {
    var c = BG.calcOf(state, todayYmd, todayYmd.slice(0, 7)), hold = BG.holdingsOf(c), out = [];
    var trades = state.trades || [];
    hold.forEach(function (h) {
      if (!h.asset || !/^(bist|tefas|cg|metal|fx|idx|us|td):/.test(h.key)) return;
      if (SS.marketOfKey(h.key) !== market) return;
      var a = h.asset, p = c.pos.filter(function (x) { return x.asset && x.asset.id === a.id; })[0] || {}, lg = null; try { lg = PF.ledger(trades.filter(function (t) { return t.assetId === a.id; })); } catch (e) { lg = null; }
      var notes = trades.filter(function (t) { return t.assetId === a.id && t.note && (t.side === 'buy' || t.side === 'sell'); }).sort(function (x, y) { return x.date < y.date ? 1 : -1; }).slice(0, 4).map(function (t) { return { date: t.date, side: t.side, note: String(t.note).slice(0, 400) }; });
      out.push({ key: h.key, assetId: a.id, name: h.name, sym: a.symbol || null, cls: a.cls, valueTL: h.value, units: lg ? lg.units : null, costTL: lg && num(lg.costTL) ? lg.costTL : null, halal: h.halal, halalLabel: (PF.HALAL && PF.HALAL[h.halal] && PF.HALAL[h.halal].label) || h.halal, halalNote: a.halal && a.halal.note || '', stop: a.stop ? ST.clean(a.stop) : null, notes: notes });
    });
    return out;
  }
  function marketsHeld(BG, state, todayYmd) { var c = BG.calcOf(state, todayYmd, todayYmd.slice(0, 7)), m = {}; BG.holdingsOf(c).forEach(function (h) { if (h.asset && /^(bist|tefas|cg|metal|fx|idx|us|td):/.test(h.key)) m[SS.marketOfKey(h.key)] = 1; }); return m; }
  /* Stop değerlendirmesi için girdi: canlı/son fiyat + kapanış + iz süren stop için en yüksek */
  function stopQuote(g, market, nowMs, st) {
    if (!g || !g.ok) return null; var P = priceOf(g, market, nowMs); if (!P) return null; var bars = g.bars || [], lb = bars[bars.length - 1];
    return { price: P.price, at: P.asOf, source: P.src, lastClose: lb ? lb.c : null, lastCloseDate: lb ? lb.d : null, sessionOpen: SS.marketState(market, nowMs).open, today: P.today, high: st && st.trail ? ST.highSince(bars, st.setAt, P.kind === 'canlı' ? P.price : null) : null };
  }
  /* Tam akış: holdings → varlık verisi → stop değerlendirme → rapor */
  function generate(env, o) {
    var sl = o.slot, now = o.nowMs, hold = o.holdings || [], assets = {}, keys = uniq(hold.map(function (h) { return h.key; }));
    var jobs = keys.map(function (k) { var h = hold.filter(function (x) { return x.key === k; })[0]; return gatherAsset(env, k, { holding: true, halal: h && h.halal && h.halal !== 'bilinmiyor' ? { status: h.halal, label: h.halalLabel, reason: 'Kullanıcının etiketi' } : null }).then(function (g) { assets[k] = g; }); });
    return Promise.all(jobs).then(function () {
      hold.forEach(function (h) { if (h.stop) { var q = stopQuote(assets[h.key], sl.market, now, h.stop); h.stopEval = ST.evaluate(h.stop, q); } });
      var news = o.news || [];
      return build({ slot: sl, nowMs: now, holdings: hold, assets: assets, news: news, calendar: o.calendar, scenarios: o.scenarios, probs: o.probs, macro: o.macro, alerts: o.alerts, personal: o.personal !== false, gaps: o.gaps || [], feedAt: o.feedAt, origin: o.origin });
    });
  }
  /* İşlem notu için kısa analiz gerekçesi (uygulama önerisi; kaynak ve saatle) */
  function noteFromAnalysis(g, side) {
    var s = g.snap || {}, P = priceOf(g, SS.marketOfKey(g.key), Date.now()), T = technicals(g, P), L = levels(g, P), parts = [];
    parts.push('Uygulama analizi ' + (s.lastDate || '') + ': ' + ((s.stance && s.stance.label) || '—') + (num(s.total) ? ' (skor ' + s.total + ')' : ''));
    if (T.trend) parts.push(T.trend.label); if (num(T.rsi)) parts.push('RSI ' + f1(T.rsi));
    if (L.support[0]) parts.push('destek ' + fmtP(L.support[0].lo) + '–' + fmtP(L.support[0].hi)); if (L.resistance[0]) parts.push('direnç ' + fmtP(L.resistance[0].lo) + '–' + fmtP(L.resistance[0].hi));
    if (side === 'sell' && s.stance && s.stance.hold) parts.push('elde tutma: ' + s.stance.hold.label);
    if (side !== 'sell' && L.plan) parts.push('plan: ' + L.plan.verdict);
    var sg = ST.suggest(s); if (side !== 'sell' && sg.ok) parts.push('önerilen stop ' + fmtP(sg.price));
    if (s.halal && s.halal.status !== 'uygun') parts.push('helal doğrulanmadı');
    return parts.join('; ') + '.';
  }
  return { VERSION: VERSION, noteFromAnalysis: noteFromAnalysis, gatherAsset: gatherAsset, priceOf: priceOf, technicals: technicals, levels: levels, assessment: assessment, narrative: narrative, build: build, buildPublic: buildPublic,
    holdingsFor: holdingsFor, marketsHeld: marketsHeld, stopQuote: stopQuote, generate: generate, eventsFor: eventsFor, scenariosFor: scenariosFor, riskLights: riskLights, groupOfKey: groupOfKey, pushText: pushText, pc: pc };
});
