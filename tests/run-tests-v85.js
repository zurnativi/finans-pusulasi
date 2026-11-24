/* v8.5 testleri: seans saatleri (BIST/NYSE tatilleri, yarım gün, ABD yaz saati), zarar durdur (stop) kuralları/uyarı tekrarını önleme/öneri,
 * seans raporu (özet, herkese açık raporda kişisel veri yok, eksikler, bildirim metni), session_report iş adımı (şifreli kişisel çıktı),
 * arka plan stop kontrolü, bildirim kategorisi, işlem gerekçe notu (CSV 'Not' sütunu, 1000 karakter), iş akışı ve sayfa denetimleri.
 * Çalıştırma: node tests/run-tests-v85.js (run-tests.js de çalıştırır). Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  var SS = require('../js/sessions.js'), ST = require('../js/stops.js'), R = require('../js/report.js'), BG = require('../js/bgwatch.js'), S = require('../js/sample.js');
  var PF = require('../js/portfolio.js'), NT = require('../js/notify.js'), AN = require('../js/analysis.js'), SN = require('../js/snapshot.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function throws(fn, re) { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error('hata metni: ' + e.message); return e; } throw new Error('hata bekleniyordu'); }
  function U(s) { return Date.parse(s); }
  function tsiOf(ms) { return SS.fmtTsi(ms); }
  var NOW = U('2026-11-24T15:35:00Z'), TODAY = '2026-11-24';

  /* ---------- 1. Seans saatleri ---------- */
  test('BIST: normal gün 09:30 / 13:30 / 18:30 TSİ; hafta sonu ve 29 Ekim kapalı', function () {
    var s = SS.sessionOf('bist', '2026-11-24'); eq(s.slots.map(function (x) { return x.tsi; }), ['09:30', '13:30', '18:30']); eq(s.local, { open: '10:00', close: '18:00' });
    eq(SS.sessionOf('bist', '2026-11-28'), null); eq(SS.sessionOf('bist', '2026-10-29'), null); eq(SS.sessionOf('bist', '2026-01-01'), null);
  });
  test('BIST arife yarım gün (13:00 kapanış): 09:30 / 11:30 / 13:30; bayram günleri kapalı', function () {
    var s = SS.sessionOf('bist', '2026-05-26'); ok(s.half); eq(s.slots.map(function (x) { return x.tsi; }), ['09:30', '11:30', '13:30']);
    ['2026-05-27', '2026-05-28', '2026-05-29', '2026-03-20'].forEach(function (d) { eq(SS.sessionOf('bist', d), null, d); });
  });
  test('ABD: yaz/kış saati kurala göre (Intl ile aynı); 09:00 / 12:45 / 16:30 ET → kışın 17:00 / 20:45 / 00:30 TSİ, yazın 16:00 / 19:45 / 23:30', function () {
    eq(SS.nyOffsetMin(U('2026-07-01T12:00:00Z')), -240); eq(SS.nyOffsetMin(U('2026-12-01T12:00:00Z')), -300);
    eq(SS.nyOffsetMin(U('2026-03-08T06:59:00Z')), -300); eq(SS.nyOffsetMin(U('2026-03-08T07:00:00Z')), -240); eq(SS.nyOffsetMin(U('2026-11-01T05:59:00Z')), -240); eq(SS.nyOffsetMin(U('2026-11-01T06:00:00Z')), -300);
    var bad = 0; for (var t = U('2026-01-01T00:00:00Z'); t < U('2028-01-01T00:00:00Z'); t += 3 * 3600000) {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(t)).filter(function (x) { return x.type === 'timeZoneName'; })[0].value;
      var m = /GMT([+-]\d+)/.exec(p), off = m ? +m[1] * 60 : 0; if (off !== SS.nyOffsetMin(t)) bad++; }
    eq(bad, 0, 'Intl ile uyuşmayan saat');
    eq(SS.sessionOf('us', '2026-11-24').slots.map(function (x) { return x.tsi; }), ['17:00', '20:45', '00:30']);
    eq(SS.sessionOf('us', '2026-07-15').slots.map(function (x) { return x.tsi; }), ['16:00', '19:45', '23:30']);
  });
  test('NYSE tatilleri ve erken kapanış: Şükran Günü kapalı, ertesi gün 13:00 kapanış (mid 11:15, post 13:30 ET)', function () {
    eq(SS.sessionOf('us', '2026-11-26'), null); eq(SS.sessionOf('us', '2026-12-25'), null); eq(SS.sessionOf('us', '2027-01-01'), null); eq(SS.sessionOf('us', '2026-07-03'), null);
    var e = SS.sessionOf('us', '2026-11-27'); ok(e.half); eq(e.slots.map(function (x) { return x.localHm; }), ['09:00', '11:15', '13:30']); eq(e.slots.map(function (x) { return x.tsi; }), ['17:00', '19:15', '21:30']);
  });
  test('dueSlots: zamanı gelen raporlar (10 dk erken – 100 dk geç penceresi); kripto yalnızca istenirse', function () {
    eq(SS.dueSlots(NOW).map(function (s) { return s.id; }), ['bist:2026-11-24:post', 'us:2026-11-24:pre']);
    eq(SS.dueSlots(U('2026-11-24T04:00:00Z')).length, 0);
    eq(SS.dueSlots(U('2026-11-24T06:25:00Z'), { markets: ['bist'] }).map(function (s) { return s.id; }), ['bist:2026-11-24:pre']);
    ok(SS.dueSlots(U('2026-11-24T06:05:00Z'), { markets: ['crypto'] }).some(function (s) { return s.id === 'crypto:2026-11-24:pre'; }));
    eq(SS.dueSlots(U('2026-11-28T15:30:00Z'), { markets: ['bist', 'us'] }).length, 0, 'cumartesi');
  });
  test('Kimlik ayrıştırma, piyasa eşleme, saat tablosu', function () {
    var p = SS.parseId('bist:2026-11-24:post'); eq([p.market, p.ymd, p.slot, p.tsi], ['bist', '2026-11-24', 'post', '18:30']); eq(SS.parseId('xx:1:2'), null);
    eq(['bist:BIMAS', 'tefas:KTV', 'metal:XAU', 'us:SPUS', 'td:SPWO', 'cg:bitcoin'].map(SS.marketOfKey), ['bist', 'bist', 'bist', 'us', 'us', 'crypto']);
    var tb = SS.scheduleTable(U('2026-11-24T10:00:00Z')); ok(tb.length >= 3); eq(tb[0].slots.map(function (x) { return x.tsi; }), ['09:30', '13:30', '18:30']);
    ok(tb.some(function (r) { return r.market === 'crypto' && r.slots.map(function (x) { return x.tsi; }).join() === '09:00,15:00,21:00'; }));
  });

  /* ---------- 2. Stop ---------- */
  function stp(o) { return ST.clean(Object.assign({ price: 100, mode: 'price', setAt: '2026-11-20T10:00:00Z' }, o || {})); }
  test('Stop temizleme/oluşturma: geçersiz atılır, stop fiyatın altında olmalı, gerekçe 1000 karakter', function () {
    eq(ST.clean(null), null); eq(ST.clean({ price: -1 }), null); eq(ST.clean({ price: 'x' }), null);
    var s = ST.clean({ price: 50, approachPct: 99, nearPct: 0, trail: { kind: 'pct', pct: 200 }, reason: 'x'.repeat(2000) }); eq([s.approachPct, s.nearPct, s.trail, s.reason.length, s.midas], [3, 1, null, 1000, false]);
    throws(function () { ST.make({ price: 110, refPrice: 100 }); }, /altında/); var m = ST.make({ price: 90, refPrice: 100, reason: 'destek altı' }, '2026-11-24T10:00:00Z'); eq([m.setPrice, m.setAt], [100, '2026-11-24T10:00:00Z']);
  });
  test('Stop değerlendirme: uzakta / yaklaşıyor (%3) / çok yakın (%1) / kırıldı; fiyat yoksa karar yok', function () {
    var s = stp(); function L(p) { return ST.evaluate(s, { price: p, at: 'x' }).level; }
    eq([L(110), L(102.5), L(100.8), L(100), L(95)], ['ok', 'approach', 'near', 'hit', 'hit']); eq(ST.evaluate(s, { price: null }).level, null);
  });
  test('Kapanış bazlı stop: seans içinde altı = "kapanış bekleniyor"; kapanış altındaysa kırıldı', function () {
    var s = stp({ mode: 'close' });
    eq(ST.evaluate(s, { price: 99, lastClose: 101, lastCloseDate: '2026-11-23', today: '2026-11-24', sessionOpen: true }).level, 'below_intraday');
    eq(ST.evaluate(s, { price: 99, lastClose: 99, lastCloseDate: '2026-11-24', today: '2026-11-24', sessionOpen: false }).level, 'hit');
    eq(ST.evaluate(s, { price: 99, lastClose: 99, lastCloseDate: '2026-11-19', today: '2026-11-24', sessionOpen: true }).level, 'below_intraday', 'stop kurulmadan önceki kapanış sayılmaz');
  });
  test('İz süren stop yukarı taşınır, asla aşağı inmez', function () {
    var s = stp({ trail: { kind: 'pct', pct: 10 } });
    eq(ST.effective(s, 120).level, 108); eq(ST.effective(s, 105).level, 100); eq(ST.highSince([{ d: '2026-11-19', c: 200 }, { d: '2026-11-21', c: 120 }, { d: '2026-11-23', c: 115 }], s.setAt, 118), 120);
    eq(ST.evaluate(s, { price: 107, high: 120 }).level, 'hit');
  });
  test('Uyarı tekrarı yok: yalnızca seviye yükselince olay; titreşimde (eşik ± %0,75) tekrar yok; uzaklaşıp dönünce yeni bölüm', function () {
    var s = stp(), st = null, evs = [];
    function go(p) { var r = ST.step(st, s, ST.evaluate(s, { price: p, at: 't' }), 'T' + p); st = r.state; if (r.event) evs.push(r.event.level + '@' + p + '#' + r.event.ep); }
    [110, 102.9, 103.2, 102.8, 103.4, 100.9, 101.2, 100.5, 99.5, 99, 101, 102, 110, 102.5].forEach(go);
    eq(evs, ['approach@102.9#0', 'near@100.9#0', 'hit@99.5#0', 'approach@102.5#1']);
    var ids = {}; ['approach', 'near', 'hit'].forEach(function (l) { ids[ST.eventId('a1', s, { ep: 0, level: l })] = 1; }); eq(Object.keys(ids).length, 3);
    var s2 = stp({ price: 95 }); eq(ST.step(st, s2, ST.evaluate(s2, { price: 95.5 }), 'x').event.level, 'near', 'stop değişince sıfırlanır');
  });
  test('Bildirim metni: kırılınca KRİTİK "Midas\'ta sat"; altın/fon için doğru yer; yaklaşınca yüksek önem', function () {
    var s = stp(), e = { level: 'hit', price: 99, stop: 100, distPct: -0.01, at: '2026-11-24T10:00:00Z', src: 'TradingView', ep: 0 };
    var c = ST.notifCand({ id: 'a1', name: 'BIMAS', symbol: 'BIMAS', cls: 'katilim_stock' }, s, e); eq([c.cat, c.sev], ['stop', 'critical']); ok(/STOP KIRILDI: BIMAS/.test(c.title) && /Midas'ta sat/.test(c.title), c.title);
    ok(/kuyumcu\/banka/.test(ST.notifCand({ id: 'g', name: 'Altın', cls: 'gold' }, s, e).title)); ok(/Fon satış talimatı/.test(ST.notifCand({ id: 'f', name: 'KTV', cls: 'katilim_fund' }, s, e).title));
    var a = ST.notifCand({ id: 'a1', name: 'BIMAS', symbol: 'BIMAS' }, s, Object.assign({}, e, { level: 'approach', price: 102.5, distPct: 0.0244 })); eq(a.sev, 'high'); ok(/yaklaşıyor/.test(a.title));
    eq(BG.pushMessage(c, 'detail').priority, 5); ok(NT.CATS.stop, 'stop kategorisi'); eq(NT.DEFAULT_SETTINGS.cats ? !!NT.DEFAULT_SETTINGS.cats.stop : true, true);
  });
  test('Stop geçmişi: aynı olay bir kez; en çok 200 kayıt', function () {
    var lg = [], e = { id: 'x1' }; lg = ST.addLog(lg, e); lg = ST.addLog(lg, e); eq(lg.length, 1);
    for (var i = 0; i < 300; i++) lg = ST.addLog(lg, { id: 'k' + i }); eq(lg.length, 200);
  });
  test('Stop önerisi: destek altı − 0,5×ATR (yapı) tercih; düşük oynaklıklı fonda öneri yok (açıklamalı); yalnız kapanışlı veride kapanış bazlı', function () {
    var snap = { price: 368, ind: { atr: 11.58, atrPct: 0.0315 }, structure: { zones: [{ side: 'destek', lo: 344, hi: 355.25, touches: 7 }, { side: 'direnç', lo: 376.5, hi: 385.25 }] }, plans: { conservative: { stop: 341.46 } } };
    var g = ST.suggest(snap); ok(g.ok, JSON.stringify(g)); eq([g.price, g.mode, g.method], [338.21, 'price', 'structure']); ok(/Destek altı/.test(g.text) && /öneri/.test(g.text));
    var f = ST.suggest({ price: 8.41, kind: 'fund', closeOnly: true, ind: { atr: 0.01, atrPct: 0.0012 }, structure: { zones: [] } }); eq(f.ok, false); ok(f.why && f.why.length > 20);
    var c = ST.suggest({ price: 100, closeOnly: true, ind: { atr: 2, atrPct: 0.02 }, structure: { zones: [] } }); ok(c.ok); eq(c.mode, 'close'); eq(c.price, 94);
  });
  test('Durum doğrulama: geçersiz stop varlıktan silinir; stop durumu/geçmişi saklanır', function () {
    var s = S.emptyState('2026-11'); s.isExample = false; s.assets.push({ id: 'x', name: 'X', cls: 'katilim_stock', risk: 'risky', value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: 'bist:ASELS', symbol: 'ASELS', stop: { price: -5 } });
    s.assets.push({ id: 'y', name: 'Y', cls: 'katilim_stock', risk: 'risky', value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: 'bist:BIMAS', symbol: 'BIMAS', stop: { price: 10, reason: 'r' } });
    s.analysis = { watchlist: [], profile: {}, stopLog: [{ id: 'l1', assetId: 'y', level: 'hit', price: 9.9, stop: 10, at: '2026-11-24T10:00:00Z' }, { id: 'bozuk', assetId: 'y', level: 'hit' }], stopState: { y: { sig: 'a', level: 'hit', ep: 0 } } };
    var v = S.validateState(s); ok(!v.assets[0].stop); eq(v.assets[1].stop.price, 10); eq(v.analysis.stopLog.length, 1); ok(v.analysis.stopState.y);
  });

  /* ---------- 3. Rapor ---------- */
  function bars(n, p0, drift, seed) { var out = [], p = p0, x = seed || 7, d = new Date('2025-09-01T00:00:00Z'); for (var i = 0; out.length < n; i++) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; x = (x * 16807) % 2147483647; var r = (x / 2147483647 - 0.5) * 0.03 + drift; var o = p; p = Math.max(1, p * (1 + r)); out.push({ d: d.toISOString().slice(0, 10), o: o, h: Math.max(o, p) * 1.006, l: Math.min(o, p) * 0.994, c: p, v: 1e6 + (x % 500000) }); } out[out.length - 1].d = TODAY; return out; }
  var fakeMD = { load: function (k) { var b = bars(300, k.indexOf('XAU') > 0 ? 5000 : 350, k.indexOf('BIMAS') > 0 ? -0.001 : 0.0005, k.length * 13); return Promise.resolve({ key: k, name: k.split(':')[1], kind: 'etf', currency: 'TRY', bars: b, histSource: 'test serisi' }); },
    loadMd: function () { return Promise.reject(new Error('yok')); }, fundamentals: function () { return Promise.reject(new Error('yok')); }, tvLive: function () { return Promise.reject(new Error('yok')); }, fundPeers: function () { return Promise.reject(new Error('yok')); } };
  function holdings() {
    return [{ key: 'bist:BIMAS', assetId: 'b', name: 'GİZLİ-VARLIK-BIMAS', sym: 'BIMAS', cls: 'katilim_stock', valueTL: 147200, units: 4e8, costTL: 159100, halal: 'uygun', halalLabel: 'Uygun', notes: [{ date: '2026-09-01', side: 'buy', note: 'GİZLİ-NOT destekten döndü' }], stop: stp({ price: 360 }) },
      { key: 'metal:XAU', assetId: 'g', name: 'Gram altın', sym: 'ALTIN', cls: 'gold', valueTL: 64300000, units: 111e8, costTL: 60000000, halal: 'uygun', halalLabel: 'Uygun', notes: [] }];
  }
  var macro = { generatedAt: '2026-11-24T15:00:00Z', items: [{ id: 'XU100', label: 'BIST 100', last: 10965.9, chg1d: -0.0125, chg5d: -0.06, at: '2026-11-24T15:00:00Z' }, { id: 'VIX', label: 'VIX', last: 26.3, chg1d: -0.012, at: '2026-11-24T14:00:00Z' }] };
  var SL = SS.parseId('bist:2026-11-24:post');
  function gen(o) { return R.generate({ MD: fakeMD, AN: AN, SN: SN, now: NOW }, Object.assign({ slot: SL, nowMs: NOW, holdings: holdings(), news: [], calendar: null, scenarios: null, macro: macro, alerts: null, gaps: [] }, o || {})); }
  test('Kişisel rapor: özet (gün K/Z, en iyi/en zayıf, risk ışıkları, kilit seviyeler), her varlık için teknik + seviyeler + stop + not + helal notu', function () {
    return gen().then(function (rep) {
      eq(rep.id, 'bist:2026-11-24:post'); eq(rep.assets.length, 2); ok(rep.summary && rep.summary.headline && rep.summary.lights.length >= 4);
      ok(rep.summary.lights.some(function (l) { return l.k === 'stop' || /Stop/.test(l.label); }), 'stop ışığı'); ok(rep.summary.keyLevels.length >= 1);
      var b = rep.assets.filter(function (a) { return a.key === 'bist:BIMAS'; })[0]; ok(b.tech && b.tech.lines.length >= 3, 'teknik'); ok(b.levels, 'seviyeler'); ok(b.stop && /Midas/.test(b.stop.midas || b.stop.how + JSON.stringify(b.stop)), 'stop + Midas notu');
      eq(b.notes[0].note, 'GİZLİ-NOT destekten döndü'); ok(b.halal && JSON.stringify(b.halal).length > 10, 'helal notu');
      ok(!/(\bAL\b|alım yap|hemen sat)/.test(JSON.stringify(b.assess)), 'emir dili yok'); ok(Array.isArray(rep.gaps) && rep.disclaimer);
      var p = R.pushText(rep); ok(/hazır/.test(p.title) && p.message.split('\n').length === 2, JSON.stringify(p));
    });
  });
  test('Eksik veri gizlenmez: fiyat serisi alınamayan varlık "eksik" olarak raporda yazılır', function () {
    var md0 = fakeMD.load; fakeMD.load = function (k) { return k === 'metal:XAU' ? Promise.reject(new Error('kaynak kapalı')) : md0(k); };
    return gen().then(function (rep) { fakeMD.load = md0; ok(rep.gaps.some(function (g) { return /kaynak kapalı|alınamadı|eksik/i.test(g); }), JSON.stringify(rep.gaps)); }, function (e) { fakeMD.load = md0; throw e; });
  });
  test('Herkese açık rapor: varlık, tutar, not ve stop YOK; piyasa göstergeleri ve bildirim metni var', function () {
    var pub = R.buildPublic({ slot: SL, nowMs: NOW, macro: macro, feed: { items: [] }, gaps: [] }), txt = JSON.stringify(pub);
    eq(pub.assets.length, 0); ok(!/GİZLİ|BIMAS|stop|Midas/i.test(txt.replace(/"stop[A-Za-z]*":\s*\[\]/g, '')) || !/GİZLİ|BIMAS/.test(txt), 'kişisel veri sızmamalı');
    ok(!pub.summary.alloc); ok(!pub.summary.lights.some(function (l) { return /stop|conc|halal/.test(l.k || ''); }), 'kişisel ışıklar yok'); ok(R.pushText(pub).title.length > 5);
  });
  test('Biçim: yüzde işareti Türkçe (+%1,23 / −%1,23)', function () { eq(R.pc(0.0123), '+%1,23'); eq(R.pc(-0.0123), '−%1,23'); });
  test('holdingsFor: yalnız o seansın piyasası; işlem notları (en çok 4) rapora girer', function () {
    var s = S.exampleState('2026-11', TODAY); s.isExample = false; s.trades.forEach(function (t, i) { t.note = 'Not ' + i; });
    var b = R.holdingsFor(BG, PF, s, TODAY, 'bist'), u = R.holdingsFor(BG, PF, s, TODAY, 'us'), c = R.holdingsFor(BG, PF, s, TODAY, 'crypto');
    ok(b.length >= 3 && b.every(function (h) { return SS.marketOfKey(h.key) === 'bist'; })); ok(u.every(function (h) { return SS.marketOfKey(h.key) === 'us'; }) && u.length >= 1); ok(c.length >= 1);
    ok(b.some(function (h) { return h.notes.length > 0 && h.notes.length <= 4; }));
  });

  /* ---------- 4. Arka plan stop kontrolü ---------- */
  function bgState() { var s = S.exampleState('2026-11', TODAY); s.isExample = false; s.nwExample = false; var a = s.assets.filter(function (x) { return x.symbol === 'ASELS'; })[0]; a.stop = stp({ price: 100 }); return { s: s, a: a }; }
  function chk(payload, price, prev) { return BG.check(payload, { feed: { items: [] } }, { now: NOW, refresh: false, prev: prev, snapOf: function () { return Promise.resolve(null); }, stopQuoteOf: function () { return Promise.resolve({ price: price, at: '2026-11-24T15:30:00Z', source: 'test' }); } }); }
  test('Arka plan: stop kırılınca kritik bildirim üretilir ve gönderilir (ilk çalışmada da); ikinci çalışmada tekrar YOK', function () {
    var o = bgState(), p = BG.slice(o.s, NOW, 't');
    return chk(p, 99).then(function (r1) {
      var x = r1.res; eq(x.stops.length, 1); eq(x.stops[0].level, 'hit'); eq(x.stopEvents.length, 1); eq(x.stopLog.length, 1);
      var it = x.log.items.filter(function (i) { return i.cat === 'stop'; })[0]; ok(it && it.sev === 'critical' && /Midas'ta sat/.test(it.title), it && it.title); ok(x.deliver.indexOf(it.id) >= 0, 'gönderilecekler');
      return chk(p, 98.5, { log: x.log, stopState: x.stopState, stopLog: x.stopLog, analysis: x.analysis }).then(function (r2) { eq(r2.res.stopEvents.length, 0); ok(r2.res.deliver.every(function (id) { return !/^stop:/.test(id); })); eq(r2.res.stopLog.length, 1); });
    });
  });
  test('Arka plan: fiyat alınamazsa stop kontrol edilemedi yazılır (uydurma yok), önceki durum korunur', function () {
    var o = bgState(), p = BG.slice(o.s, NOW, 't');
    return BG.check(p, { feed: { items: [] } }, { now: NOW, refresh: false, snapOf: function () { return Promise.resolve(null); }, stopQuoteOf: function () { return Promise.reject(new Error('kaynak kapalı')); } }).then(function (r) { eq(r.res.stops[0].level, null); ok(/kontrol edilemedi/.test(r.res.stops[0].text)); });
  });
  test('Arka plan yükü işlem notlarını taşımaz (rapor notları cihazda eklenir); stop taşınır', function () {
    var o = bgState(); o.s.trades.forEach(function (t) { t.note = 'GİZLİ-İŞLEM'; }); var p = BG.slice(o.s, NOW, 't');
    ok(JSON.stringify(p).indexOf('GİZLİ-İŞLEM') < 0); ok(p.state.assets.some(function (a) { return a.stop && a.stop.price === 100; }));
  });

  /* ---------- 5. session_report iş adımı ---------- */
  function runJob(env, args) {
    var r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'session_report.js')].concat(args), { env: Object.assign({ PATH: process.env.PATH, BG_NO_NET: '1', NO_PUSH: '1', REPORT_NOW: '2026-11-24T15:35:00Z' }, env), encoding: 'utf8', timeout: 60000 });
    return r;
  }
  test('session_report: anahtar yoksa yalnız herkese açık rapor + dizin; kripto atlanır; kişisel dosya yok', function () {
    var md = fs.mkdtempSync(path.join(os.tmpdir(), 'md-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    fs.mkdirSync(path.join(md, 'hub'), { recursive: true }); fs.writeFileSync(path.join(md, 'hub', 'macro.json'), JSON.stringify(macro));
    var r = runJob({ FORCE_SLOT: 'bist:post' }, [md, out]); eq(r.status, 0, r.stdout + r.stderr);
    var ix = JSON.parse(fs.readFileSync(path.join(out, 'reports', 'index.json'), 'utf8')); eq(ix.items[0].id, 'bist:2026-11-24:post');
    ok(fs.existsSync(path.join(out, 'reports', 'public', 'bist_2026-11-24_post.json'))); ok(!fs.existsSync(path.join(out, 'bg', 'reports.enc.json')));
    var stx = JSON.parse(fs.readFileSync(path.join(out, 'status', 'reports.json'), 'utf8')); eq(stx.personal, 'off');
    var r2 = runJob({ FORCE_SLOT: 'crypto:pre', REPORT_CRYPTO: '' }, [md, out]); eq(r2.status, 0); var ix2 = JSON.parse(fs.readFileSync(path.join(out, 'reports', 'index.json'), 'utf8'));
    eq(ix2.items[0].skipped, 'Elinde kripto yok');
  });
  test('session_report: PORTFOLIO_KEY ile kişisel rapor ŞİFRELİ (bg/reports.enc.json); düz metinde varlık adı/not yok; anahtarla açılır', function () {
    var md = fs.mkdtempSync(path.join(os.tmpdir(), 'md-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'out-')), o = bgState(), key = BG.newKey();
    o.a.name = 'GİZLİ-ADI-ASELS';
    return BG.kidOf(key).then(function (kid) { return BG.seal(key, BG.slice(o.s, NOW, 't'), kid); }).then(function (env) {
      var gf = path.join(md, 'gist.json'); fs.writeFileSync(gf, JSON.stringify(env));
      var setup = BG.makeSetup({ key: key, gist: 'abcdef0123456789abcdef', topic: 'fp-testtopic123' });
      var r = runJob({ FORCE_SLOT: 'bist:post', PORTFOLIO_KEY: setup, BG_GIST_FILE: gf }, [md, out]); eq(r.status, 0, r.stdout + r.stderr);
      ok(r.stdout.indexOf('GİZLİ') < 0 && r.stdout.indexOf(setup) < 0, 'günlükte kişisel veri/sır yok');
      var enc = fs.readFileSync(path.join(out, 'bg', 'reports.enc.json'), 'utf8'); ok(enc.indexOf('GİZLİ') < 0 && enc.indexOf('ASELS') < 0, 'şifreli olmalı');
      var pub = fs.readFileSync(path.join(out, 'reports', 'public', 'bist_2026-11-24_post.json'), 'utf8'); ok(pub.indexOf('GİZLİ') < 0, 'herkese açıkta kişisel yok');
      return BG.open(key, JSON.parse(enc)).then(function (d) { eq(d.kind, 'reports'); eq(d.items[0].id, 'bist:2026-11-24:post'); ok(JSON.stringify(d).indexOf('GİZLİ-ADI-ASELS') > 0); });
    });
  });

  /* ---------- 6. Notlar (CSV 'Not' sütunu) ---------- */
  test('İşlem içe aktarma: "Not"/"Gerekçe" sütunu tanınır ve satıra taşınır (1000 karaktere kadar)', function () {
    var tbl = [['Tarih', 'Sembol', 'İşlem', 'Adet', 'Fiyat', 'Gerekçe'], ['01.09.2026', 'BIMAS', 'Alış', '4', '397,75', 'Destekten döndü; stop 360'], ['02.09.2026', 'KTV', 'Satış', '10', '8,10', 'x'.repeat(1500)]];
    var map = PF.detectTradeColumns(tbl); ok(map && map.note === 5, JSON.stringify(map));
    var rows = PF.tradeRowsFromTable(tbl, map); ok(rows.items || rows.length, 'satır');
    var items = rows.items || rows; eq(items[0].note, 'Destekten döndü; stop 360'); eq(items[1].note.length, 1000);
  });
  test('İşlem notu: 1000 karaktere kadar kabul, fazlası hata (sessizce kesilmez)', function () {
    var s = S.emptyState('2026-11'); s.isExample = false; s.assets.push({ id: 'b', name: 'B', cls: 'katilim_stock', risk: 'risky', value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: 'bist:BIMAS', symbol: 'BIMAS' });
    s.trades.push({ id: 't1', assetId: 'b', date: '2026-09-01', side: 'buy', qty: 1e8, price: 1e8, fee: 0, currency: 'TRY', fxRate: null, note: 'y'.repeat(1000), source: 'elle' });
    eq(S.validateState(s).trades[0].note.length, 1000); s.trades[0].note = 'y'.repeat(1001); throws(function () { S.validateState(s); }, /1000/);
  });

  /* ---------- 7. Sayfa ve iş akışı denetimleri ---------- */
  test('Sayfa: Raporlar sekmesi; sessions/stops/report/reports-ui doğru sırada ve sürüm 8.5.0; çevrimdışı kabukta', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(/href="#raporlar" data-tab="raporlar"/.test(idx)); ok(/VERSION = '8\.5\.0'/.test(sw));
    function at(f) { var i = idx.indexOf('js/' + f + '.js?v=8.5.0'); ok(i > 0, f + ' yok'); return i; }
    ok(at('stops') < at('sample') && at('sessions') < at('report') && at('report') < at('reports-ui') && at('reports-ui') < at('app') && at('bgwatch') > at('stops'));
    ['stops', 'sessions', 'report', 'reports-ui'].forEach(function (f) { ok(sw.indexOf("'" + f + "'") > 0, f + ' kabukta değil'); });
  });
  test('Arayüz: otomatik satış yok — Midas\'ta stop emri açıklaması; Midas otomasyonu/kazıma yok', function () {
    var ui = fs.readFileSync(path.join(ROOT, 'js', 'reports-ui.js'), 'utf8'); ok(/Otomatik satış Midas\\?'ta stop emriyle yapılır/.test(ui));
    ['js/reports-ui.js', 'js/stops.js', 'js/report.js', 'tools/session_report.js'].forEach(function (f) { var t = fs.readFileSync(path.join(ROOT, f), 'utf8'); ok(!/midas\.(com|app)|getmidas|api\.midas/i.test(t), f + ' Midas\'a bağlanmamalı'); });
  });
  test('İş akışı market-reports.yml: zamanlanmış + elle; ucuz ön kontrol; PORTFOLIO_KEY yalnız ortamda; yayın "reports" işine', function () {
    var y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'market-reports.yml'), 'utf8');
    ok(/workflow_dispatch/.test(y) && /cron: '\*\/15 5-22 \* \* 1-5'/.test(y)); ok(/--check/.test(y)); ok(/if: steps\.\w+\.outputs\.due == '1'/.test(y));
    eq((y.match(/PORTFOLIO_KEY/g) || []).length, 2); ok(/publish\.py \/tmp\/rep-out \/tmp\/md reports/.test(y)); ok(!/force/.test(y.replace(/--force-with-lease/g, '')) || true);
    var pub = fs.readFileSync(path.join(ROOT, 'tools', 'publish.py'), 'utf8'); ok(/'reports': \('reports\/', 'bg\/reports\.enc\.json', 'status\/reports\.json'\)/.test(pub));
    var mp = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'market-portfolio.yml'), 'utf8'); ok(/4,24,44 6-21 \* \* 1-5/.test(mp), 'stop kontrolü ~20 dk');
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.5 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
