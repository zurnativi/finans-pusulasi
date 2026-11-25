/* lab-ui.js — v8.8: Portföy oluşturucu (profesyonel) + Kayıtlı portföylerim (sanal portföy, detay raporu, takip).
 * Hesaplar lab.js / analysis.js'te (testli). Veri: sunucu analiz anlık görüntüleri (aynı analiz kodu), TEFAS katılım fon listesi,
 * seçilen her varlık için tarayıcıda canlı analiz (güncel fiyat + seviyeler). Sanal portföyler state.labPortfolios'ta durur:
 * gerçek varlıklara, alım-satımlara ve bütçeye KARIŞMAZ. */
(function () {
  'use strict';
  window.LabUI = function (X, U) {
    var L = window.Lab, AN = window.Analysis, MD = window.MData, SN = window.Snap, M = window.Money;
    var esc = X.esc, tl = X.tl;
    var FKEY = 'finans-pusulasi:lab-filtre';
    var job = null, form = { amount: '', name: '' }, det = {}, listBusy = false, cmpSel = {};
    function loadF() { try { return L.cleanFilters(JSON.parse(localStorage.getItem(FKEY) || 'null') || undefined); } catch (e) { return L.defaultFilters(); } }
    var F = loadF();
    function saveF() { try { localStorage.setItem(FKEY, JSON.stringify(F)); } catch (e) { /* kota */ } }
    function list() { var s = X.state(); return (s && Array.isArray(s.labPortfolios)) ? s.labPortfolios : []; }
    function byId(id) { return list().filter(function (p) { return p.id === id; })[0] || null; }
    function nowIso() { return new Date().toISOString(); }
    function ymdTR(iso) { var d = iso ? new Date(iso) : new Date(); var t = new Date(d.getTime() + 3 * 3600000); return t.toISOString().slice(0, 10); }
    function fp(x) { return AN.fmtP(x); }
    function num(x) { return typeof x === 'number' && isFinite(x); }
    function pc(x, d) { return x == null || !isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x * 100).toFixed(d == null ? 1 : d).replace('.', ','); }
    function pcS(x, d) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + '%' + Math.abs(x * 100).toFixed(d == null ? 1 : d).replace('.', ','); }
    function money(x, cur) { return x == null ? '—' : (cur === 'USD' ? '$' + fp(x) : fp(x) + ' ₺'); }
    function tlS(k) { return k == null ? '—' : (k > 0 ? '+' : k < 0 ? '−' : '') + tl(Math.abs(k)); }
    function cls(x) { return x == null ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : ''; }
    function short(n) { return String(n || '').split(' — ')[0]; }
    function when(iso) { return U.when(iso); }
    function pill(l, t) { return U.pill(l, t); }
    var ST_PILL = { now: ['ok', 'Şimdi alınabilir'], trail: ['ok', 'Kademeli alınabilir'], wait: ['info', 'Seviye bekleniyor'], broken: ['warn', 'Bekle (yapı bozuk)'], none: ['warn', 'Seviye yok'] };
    var STATUS_L = { held: 'Sanal alındı', pending: 'Bekleyen emir', cash: 'Nakitte', model: 'Model (tutar yok)' };

    /* ---------- Veri: aday evreni ---------- */
    function pool(fns, n) { // sınırlı eşzamanlılık
      var i = 0, out = new Array(fns.length);
      function next() { if (i >= fns.length) return Promise.resolve(); var k = i++; return fns[k]().then(function (r) { out[k] = r; }, function (e) { out[k] = { error: e && e.message || String(e) }; }).then(next); }
      var ws = []; for (var w = 0; w < Math.min(n, fns.length); w++) ws.push(next());
      return Promise.all(ws).then(function () { return out; });
    }
    function timeout(p, ms, what) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error(what + ': zaman aşımı')); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
    function liveSnap(key) { // tarayıcıda canlı analiz (aynı motor): güncel fiyat, skor, seviyeler + mumlar
      return timeout(MD.load(key, { twelveKey: U.twelveKey() }).then(function (series) {
        return SN.contextFor(MD, key, series, { halal: U.halalOverride(key) }).then(function (ctx) {
          var A = AN.analyze(series, ctx); A.series = series; A.ctx = ctx;
          return { snap: SN.compact(A, { at: nowIso() }), series: series };
        });
      }), 45000, key);
    }
    function srvBase() { return MD.URL.mdIndex.replace(/index\.json$/, ''); }
    function step(t) { if (job) { job.step = t; job.log.push(t); X.render(); } }
    function gather(f) {
      var R = L.resolveFilters(f), allow = R.allow, base = srvBase();
      step('Sunucu analizleri ve piyasa listesi alınıyor…');
      return Promise.all([
        MD.fetchJson(base + 'analysis/index.json', { timeout: 20000 }).catch(function () { return { items: [] }; }),
        MD.mdIndex().catch(function () { return {}; }),
        allow.fund ? MD.katilimFunds().catch(function () { return { items: [] }; }) : Promise.resolve({ items: [] }),
        allow.bist && !f.halal && MD.bistScreen ? MD.bistScreen('XU100').catch(function () { return { rows: [] }; }) : Promise.resolve({ rows: [] })
      ]).then(function (r) {
        var ix = r[0], mdi = r[1], funds = (r[2].items || []), scr = r[3].rows || [], sec = {}, kat = {};
        (mdi.bist || []).forEach(function (b) { sec[b.s] = b.sec || null; kat[b.s] = !!b.k; });
        // v8.8.2: ABD hisseleri — helal açıkken yalnız Şer'i listedekiler (SP Funds portföyleri), kapalıyken "uygun değil" olmayanlar; TradingView taramasıyla en iyi 5 aday canlı analiz edilir
        var usPool = allow.usstock ? (mdi.usInfo || []).filter(function (x) { return x.t === 'stock' && x.tv && x.h !== 'uygun_degil' && (!f.halal || x.h === 'uygun'); }) : [];
        usPool.forEach(function (x) { sec['us:' + x.s] = x.sec || null; });
        return (usPool.length && MD.usScreen ? MD.usScreen(usPool.map(function (x) { return x.tv; })).catch(function () { return { rows: [] }; }) : Promise.resolve({ rows: [] })).then(function (us) { return { ix: ix, mdi: mdi, funds: funds, scr: scr, sec: sec, kat: kat, usRows: us.rows || [], usPool: usPool.length }; });
      }).then(function (G0) {
        var ix = G0.ix, funds = G0.funds, scr = G0.scr, sec = G0.sec, kat = G0.kat;
        var srvItems = (ix.items || []).filter(function (it) { var c = L.classOfKey(it.key); return c && allow[c] && c !== 'fund'; });
        var genAt = ix.generatedAt;
        step('Sunucu anlık görüntüleri okunuyor (' + srvItems.length + ' varlık)…');
        var fetches = srvItems.map(function (it) { return function () { return MD.fetchJson(base + 'analysis/' + SN.fileOf(it.key) + '.json', { timeout: 15000 }); }; });
        // fonlar: TEFAS katılım listesinden grup başına en iyi (1 yıl getirisi, büyüklük ≥ 200 mn TL) — canlı analiz edilir
        var fundPick = [];
        if (allow.fund && funds.length) {
          var groups = { safe: [], medium: [], risky: [] };
          AN.pickFunds(funds, function () { return true; }, 400, 2e8).forEach(function (fd) { groups[L.fundTier(fd)].push(fd); });
          var gold = groups.medium.filter(function (fd) { return L.isGoldName(fd.name + ' ' + fd.type); });
          var other = groups.medium.filter(function (fd) { return gold.indexOf(fd) < 0; });
          fundPick = groups.safe.slice(0, 4).concat(gold.slice(0, 2), other.slice(0, 2), groups.risky.slice(0, 3));
        }
        var extraStocks = [];
        if (scr.length) extraStocks = scr.map(function (row) { return { row: row, sc: AN.stockPickScore(row) }; }).filter(function (x) { return x.sc.s >= 40 && !kat[x.row.name]; }).sort(function (a, b) { return b.sc.s - a.sc.s; }).slice(0, 5).map(function (x) { return x.row.name; });
        var usPick = G0.usRows.map(function (row) { return { row: row, sc: AN.stockPickScore(row) }; }).filter(function (x) { return x.sc.s >= 40 && x.row.name; }).sort(function (a, b) { return b.sc.s - a.sc.s; }).slice(0, 5).map(function (x) { return 'us:' + x.row.name; });
        return pool(fetches, 8).then(function (snaps) {
          var cands = [];
          snaps.forEach(function (s, i) { if (!s || s.error) return; cands.push(candOf(srvItems[i].key, s, { sector: sec[srvItems[i].key.slice(5)], src: 'sunucu' })); });
          var lives = fundPick.map(function (fd) { return { key: 'tefas:' + fd.code, fund: fd }; }).concat(extraStocks.map(function (s) { return { key: 'bist:' + s }; }), usPick.map(function (k) { return { key: k }; }));
          if (lives.length) step('Fonlar ve ek adaylar canlı analiz ediliyor (' + lives.length + ')…');
          return pool(lives.map(function (lv) { return function () { return liveSnap(lv.key); }; }), 4).then(function (rs) {
            rs.forEach(function (x, i) { if (!x || x.error || !x.snap) return; var lv = lives[i]; cands = cands.filter(function (c) { return c.key !== lv.key; }); cands.push(candOf(lv.key, x.snap, { sector: (lv.key.indexOf('us:') === 0 ? sec[lv.key] : sec[lv.key.slice(5)]) || null, fund: lv.fund, src: 'canlı', series: x.series })); });
            return { cands: cands, dataNote: 'Sunucu analizleri ' + (genAt ? when(genAt) : '—') + ' (' + srvItems.length + ' varlık)' + (funds.length ? ' · TEFAS katılım fon listesi (' + funds.length + ' fon)' : '') + (extraStocks.length ? ' · BIST 100 taraması (TradingView)' : '') + (G0.usPool ? ' · ABD hisse taraması (' + G0.usPool + ' hisse' + (f.halal ? ', Şer\'i listedekiler' : '') + '; TradingView) → ' + usPick.length + ' aday' : '') };
          });
        });
      });
    }
    function candOf(key, snap, o) {
      var c = L.classOfKey(key), fd = o.fund || null, halal = snap.halal || null, ov = U.halalOverride(key);
      if (ov) halal = { status: ov.status, label: ov.label, reason: ov.reason };
      var cand = { key: key, name: snap.name || key, cls: c, cur: c === 'fx' ? 'FX' : snap.currency === 'USD' ? 'USD' : 'TRY', halal: halal, snap: snap, price: snap.price, priceAt: snap.source && snap.source.live ? snap.source.live.at : snap.at, priceSrc: snap.source ? (snap.source.live ? snap.source.live.source : snap.source.label) : null, sector: o.sector || null, src: o.src };
      if (c === 'fund') { cand.tier = fd ? L.fundTier(fd) : L.fundTier({ type: snap.name, name: snap.name }); cand.fundType = fd ? fd.type : null; cand.liq = { size: fd ? fd.size : null }; }
      if (o.series) { var st = L.assetStats(o.series.bars); cand.vol1y = st.vol1y; cand.ret1y = st.ret1y; cand.series = o.series; }
      if (c === 'fund' && cand.vol1y != null) { var t2 = L.fundTierByVol(cand.tier, cand.vol1y, cand.name); if (t2 !== cand.tier) { cand.tierNote = 'Gözlenen yıllık oynaklık %' + (cand.vol1y * 100).toFixed(1).replace('.', ',') + ' → ' + L.TIER_LABEL[t2] + ' grup'; cand.tier = t2; } }
      return cand;
    }
    function toTLSeries(series, usdMap) {
      var bars = series.bars || []; if (series.currency !== 'USD') return bars.map(function (b) { return { d: b.d, c: b.c }; });
      return bars.filter(function (b) { return usdMap[b.d]; }).map(function (b) { return { d: b.d, c: b.c * usdMap[b.d] }; });
    }
    function usdOf(s) { return s ? (s.live && s.live.price || (s.bars.length ? s.bars[s.bars.length - 1].c : null)) : null; }
    function scoreInput(positions, snapOf) { return positions.map(function (p) { var sn = snapOf(p); return { weightBp: p.weightBp, score: p.score, liq: sn && sn.scores ? sn.scores.liquidity : null, halal: p.halal, entry: p.entry, cls: p.cls }; }); }
    /* Oluştur: evren → taslak → seçilenleri canlı güncelle → yeniden kur → risk + skor + sanal alım */
    function create() {
      var amtTxt = (document.getElementById('lab-amt') || {}).value || '', nm = ((document.getElementById('lab-name') || {}).value || '').trim();
      form.amount = amtTxt; form.name = nm;
      var amountK = null;
      if (String(amtTxt).trim()) { amountK = M.parse(amtTxt); if (amountK == null || amountK <= 0) { X.toast('Portföy tutarını geçerli bir TL tutarı olarak yaz (ör. 100.000) ya da boş bırak.'); return; } if (amountK < 100000) { X.toast('Tutar en az 1.000 TL olmalı ya da boş bırak (daha azında adetler yuvarlanıp çoğu nakitte kalır).'); return; } }
      var f = L.cleanFilters(F), at = nowIso();
      job = { running: true, step: '', log: [], error: null, f: f, amountK: amountK, name: nm };
      X.render();
      var usd = null, usdSeries = null, all = null;
      function refresh(keys) {
        return pool(keys.map(function (k) { return function () { return liveSnap(k); }; }), 4).then(function (rs) {
          rs.forEach(function (x, i) { var k = keys[i], idx = all.findIndex(function (c) { return c.key === k; }); if (idx < 0) return; if (!x || x.error || !x.snap) { all[idx].liveError = x && x.error; all[idx].src = 'sunucu (canlı alınamadı)'; return; } var old = all[idx]; var c = candOf(k, x.snap, { sector: old.sector, fund: old.fundType ? { type: old.fundType, size: old.liq && old.liq.size, name: old.name } : null, src: 'canlı', series: x.series }); if (old.tier && c.cls === 'fund') c.tier = old.tier; all[idx] = c; });
        });
      }
      gather(f).then(function (G) {
        if (!G.cands.length) throw new Error('Hiç aday varlık verisi alınamadı (internet bağlantısını kontrol et).');
        job.dataNote = G.dataNote; all = G.cands.slice();
        var d1 = L.build(all, f);
        step('Seçilen ' + d1.positions.length + ' varlık canlı fiyatla yeniden analiz ediliyor…');
        var need = d1.positions.filter(function (p) { return p.src !== 'canlı'; }).map(function (p) { return p.key; });
        return Promise.all([refresh(need), MD.load('fx:USD').then(function (s) { usdSeries = s; usd = usdOf(s); }, function () { usd = null; })]).then(function () {
          var d2 = L.build(all, f), need2 = d2.positions.filter(function (p) { return p.src === 'sunucu'; }).map(function (p) { return p.key; });
          return need2.length ? refresh(need2).then(function () { return L.build(all, f); }) : d2;
        });
      }).then(function (draft) {
        step('Risk, korelasyon ve geçmiş test hesaplanıyor…');
        var usdMap = {}; if (usdSeries) usdSeries.bars.forEach(function (b) { usdMap[b.d] = b.c; });
        var withS = draft.positions.filter(function (p) { return p.series && p.series.bars && p.series.bars.length >= 60; });
        var lists = withS.map(function (p) { return toTLSeries(p.series, usdMap); }), w = withS.map(function (p) { return p.weightBp; });
        var risk = lists.length ? L.riskStats(lists.map(function (x) { return x.slice(-260); }), w) : { error: 'Fiyat geçmişi yok' };
        var bt = lists.length ? AN.backtest(lists.map(function (x) { return x.slice(-756); }), w) : { error: 'Fiyat geçmişi yok' };
        var rk = risk.error ? null : risk;
        var sc = L.portfolioScore({ positions: scoreInput(draft.positions, function (p) { return p.snap; }), risk: rk, profileRisk: f.risk });
        var alloc = L.allocate(draft, job.amountK, usd, at);
        var R = {}; if (rk) { R.vol = rk.vol; R.mdd = rk.mdd; R.var95m = rk.var95m; R.mddEst = rk.mddEst; R.nEffCorr = rk.nEffCorr; R.days = rk.days; R.from = rk.from; R.to = rk.to; }
        if (!bt.error) { R.cagr = bt.cagr; R.worst12 = bt.worst12; R.best12 = bt.best12; R.btMdd = bt.mdd; }
        var name = job.name || ('Portföy ' + ymdTR(at).split('-').reverse().join('.') + ' · ' + (L.PROFILES[f.profile] ? L.PROFILES[f.profile].label.split(' ')[0] : 'Özel'));
        var rec = L.makeRecord(draft, alloc, { name: name, at: at, score: { total: sc.total, grade: sc.grade, at: at, parts: sc.parts, reason: sc.reason, coverage: sc.coverage }, risk: R, dataNote: job.dataNote + (usd ? ' · USD/TL ' + fp(usd) : '') });
        var quotes = {}; draft.positions.forEach(function (p) { quotes[p.key] = { price: p.price, at: p.priceAt }; });
        var V = L.valuate(rec, quotes, usd); L.addHistory(rec, ymdTR(at), V);
        job = { running: false, done: true, rec: rec, bt: bt.error ? null : bt, btErr: bt.error || null, V: V, usd: usd, excluded: draft.excluded, warnings: draft.warnings, info: draft.info, corr: rk ? rk.corr : null, corrNames: withS.map(function (p) { return short(p.name); }), log: job.log };
        X.render();
        setTimeout(function () { var el = document.getElementById('lab-result'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }, 60);
      }).catch(function (e) { console.error(e); job = { running: false, error: 'Oluşturulamadı: ' + (e && e.message || e) + ' — canlı veri gerekli; uydurma veriyle portföy kurulmaz.', log: job ? job.log : [] }; X.render(); });
    }
    function save() {
      if (!job || !job.rec) return;
      var rec = job.rec, nameEl = document.getElementById('lab-save-name'); if (nameEl && nameEl.value.trim()) rec.name = nameEl.value.trim().slice(0, 60);
      if (list().length >= L.MAX_PORTFOLIOS) { X.toast('En fazla ' + L.MAX_PORTFOLIOS + ' portföy kaydedilebilir; eskilerden birini sil.'); return; }
      var id = rec.id;
      det[id] = { V: job.V, at: Date.now(), usd: job.usd, bt: job.bt, corr: job.corr, corrNames: job.corrNames };
      var ok = X.mutate(function (s) { s.labPortfolios = Array.isArray(s.labPortfolios) ? s.labPortfolios : []; s.labPortfolios.push(JSON.parse(JSON.stringify(rec))); }, '"' + rec.name + '" kaydedildi (sanal portföy — gerçek varlıklarına dokunulmadı).');
      if (ok) { job = null; location.hash = '#analiz/portfoylerim/' + id; }
    }

    /* ---------- Takip: güncelle / yeniden analiz ---------- */
    function refreshOne(id) {
      var P = byId(id); if (!P) return Promise.resolve();
      var D = det[id] = det[id] || {}; if (D.busy) return D.busy; D.err = null;
      var keys = P.positions.map(function (p) { return p.key; });
      D.busy = Promise.all([pool(keys.map(function (k) { return function () { return liveSnap(k); }; }), 4), MD.load('fx:USD').catch(function () { return null; })]).then(function (r) {
        var res = r[0], us = r[1], usd = usdOf(us), usdMap = {}; if (us) us.bars.forEach(function (b) { usdMap[b.d] = b.c; });
        var quotes = {}, snaps = {}, series = {}, fails = [], fills = 0;
        res.forEach(function (x, i) { var k = keys[i]; if (!x || x.error || !x.snap) { fails.push(short(P.positions[i].name)); return; } snaps[k] = x.snap; series[k] = x.series; quotes[k] = { price: x.snap.price, at: x.snap.source && x.snap.source.live ? x.snap.source.live.at : x.snap.at }; });
        if (!Object.keys(snaps).length) throw new Error('Hiçbir varlığın güncel verisi alınamadı (internet bağlantısını kontrol et).');
        X.mutate(function (s) {
          var Q = (s.labPortfolios || []).filter(function (p) { return p.id === id; })[0]; if (!Q) return;
          var since = ymdTR(Q.createdAt);
          Q.positions.forEach(function (p) {
            var sn = snaps[p.key], se = series[p.key]; if (!sn) return;
            if (p.status === 'pending') { var fl = L.scanFill(p, se.bars, since, usdMap, usd, { price: sn.price, d: sn.lastDate }); if (fl && L.applyFill(Q, p.key, fl)) fills++; }
            if (p.status === 'held') { var have = {}; (p.events || []).forEach(function (e) { have[e.t] = 1; }); L.scanEvents(p, se.bars).forEach(function (e) { if (!have[e.t]) p.events.push(e); }); }
            // güncel analiz: skor ve önerilen seviyeler (bekleyen emrin limiti ayrı tutulur)
            var sc = L.assetScore(sn); p.score = sc.score; p.parts = sc.parts.map(function (x) { return { k: x.k, s: x.s, w: x.w }; }); p.conf = sn.confidence;
            var e = L.entryStatus(sn, sn.price, p.cls); p.entry = { code: e.code, label: e.label, buyLo: e.buyLo, buyHi: e.buyHi, stop: e.stop, t1: e.t1, t2: e.t2, tMain: e.tMain, rrNow: e.rrNow, plan: e.plan, why: e.why };
            var st = L.assetStats(se.bars); p.vol1y = st.vol1y; p.ret1y = st.ret1y;
          });
          var V = L.valuate(Q, quotes, usd);
          var withS = Q.positions.filter(function (p) { return series[p.key] && series[p.key].bars.length >= 60; });
          var lists = withS.map(function (p) { return toTLSeries(series[p.key], usdMap); }), w = withS.map(function (p) { return p.weightBp || 1; });
          var rk = lists.length ? L.riskStats(lists.map(function (x) { return x.slice(-260); }), w) : { error: 'yok' };
          var bt = lists.length ? AN.backtest(lists.map(function (x) { return x.slice(-756); }), w) : { error: 'yok' };
          var sc2 = L.portfolioScore({ positions: scoreInput(Q.positions, function (p) { return snaps[p.key]; }), risk: rk.error ? null : rk, profileRisk: Q.filters.risk });
          Q.score = { total: sc2.total, grade: sc2.grade, at: nowIso(), parts: sc2.parts, reason: sc2.reason, coverage: sc2.coverage };
          if (!rk.error) Q.risk = Object.assign({}, Q.risk || {}, { vol: rk.vol, mdd: rk.mdd, var95m: rk.var95m, mddEst: rk.mddEst, nEffCorr: rk.nEffCorr, days: rk.days, from: rk.from, to: rk.to });
          if (!bt.error) Q.risk = Object.assign({}, Q.risk || {}, { cagr: bt.cagr, worst12: bt.worst12, best12: bt.best12, btMdd: bt.mdd });
          L.addHistory(Q, ymdTR(), V); Q.updatedAt = nowIso();
          D.V = V; D.usd = usd; D.bt = bt.error ? null : bt; D.corr = rk.error ? null : rk.corr; D.corrNames = withS.map(function (p) { return short(p.name); });
        }, null, { quiet: true });
        D.at = Date.now(); D.autoTried = false; D.fails = fails; D.fills = fills;
        if (fills) X.toast(fills + ' bekleyen emir seviyesine geldi ve sanal olarak alındı.');
      }).catch(function (e) { D.err = e && e.message || String(e); }).then(function () { D.busy = null; X.render(); });
      X.render();
      return D.busy;
    }
    function valOf(P) { var D = det[P.id]; return D && D.V ? D.V : null; }
    function lastVal(P) { var h = P.history || []; return h.length ? h[h.length - 1] : null; }

    /* ---------- Form parçaları ---------- */
    function seg(name, field, opts, cur) {
      return '<div class="seg" role="group" aria-label="' + esc(name) + '">' + opts.map(function (o) { return '<button type="button" data-act="lab-f" data-f="' + field + '" data-v="' + esc(String(o[0])) + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
    }
    function chk(field, label, on, hint) { return '<label class="lab-chk"><input type="checkbox" data-lab-f="' + esc(field) + '"' + (on ? ' checked' : '') + '> <span>' + esc(label) + (hint ? ' <small class="muted">' + esc(hint) + '</small>' : '') + '</span></label>'; }
    function sel(field, label, opts, cur) { return '<label class="lab-sel"><span>' + esc(label) + '</span><select data-lab-f="' + field + '">' + opts.map(function (o) { return '<option value="' + esc(String(o[0])) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>'; }
    function notices(arr) { return (arr || []).map(function (w) { return '<div class="notice ' + (w.level === 'danger' ? 'danger' : w.level === 'warn' ? 'warn' : w.level === 'ok' ? 'ok' : '') + ' lab-n" data-code="' + esc(w.code || '') + '">' + (w.level === 'info' ? 'ℹ ' : w.level === 'ok' ? '✓ ' : '⚠ ') + esc(w.text) + '</div>'; }).join(''); }
    function filtersCard() {
      var f = F, R = L.resolveFilters(f), secs = Object.keys(L.SECTORS_TR);
      var h = '<section class="card lab-filters" id="lab-filters"><h2>Filtreler ve yatırımcı profili</h2>';
      h += '<div class="lab-row"><div class="label">Yatırımcı profili</div>' + seg('Yatırımcı profili', 'profile', [['muhafazakar', 'Muhafazakâr'], ['dengeli', 'Dengeli (standart)'], ['agresif', 'Agresif'], ['ozel', 'Özel']], f.profile) +
        ' <button type="button" class="btn small" data-act="lab-std">Standart filtreye dön</button><p class="hint">Profil seçince aşağıdaki filtreler otomatik ayarlanır; birini değiştirirsen profil "Özel" olur.</p></div>';
      h += '<div class="lab-row lab-halal"><label class="lab-switch"><input type="checkbox" data-lab-f="halal" role="switch"' + (f.halal ? ' checked aria-checked="true"' : ' aria-checked="false"') + '> <b>Helal (katılım) filtresi ' + (f.halal ? 'AÇIK' : 'KAPALI') + '</b></label>' +
        '<p class="hint">' + (f.halal ? 'Yalnız Katılım endeksindeki hisseler, TEFAS\'ta İslami (katılım) etiketli fonlar, gram altın, peşin döviz ve Şer\'i endeks ETF\'leri.' : 'Şüpheli/bilinmeyen varlıklar da girebilir (kripto, katılım endeksi dışı hisse). Faizli araçlar yine girmez.') + '</p></div>';
      h += '<div class="grid two lab-g"><div><div class="label">Vade</div>' + seg('Vade', 'horizon', [['short', 'Kısa (< 2 yıl)'], ['medium', 'Orta (2-5 yıl)'], ['long', 'Uzun (5+ yıl)']], f.horizon) + '</div>' +
        '<div><div class="label">Risk seviyesi</div>' + seg('Risk', 'risk', [['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']], f.risk) + '</div></div>';
      h += '<div class="grid two lab-g"><fieldset class="lab-fs"><legend>Varlık sınıfları</legend>' + chk('cls.bist', 'BIST hisse', f.classes.bist) + chk('cls.fund', 'Fon (TEFAS)', f.classes.fund) + chk('cls.gold', 'Altın / gümüş (gram, TL)', f.classes.gold) + chk('cls.crypto', 'Kripto', f.classes.crypto, f.halal ? '(helal filtresi açıkken eklenmez)' : '') + chk('cls.us', 'ABD hisseleri (USD)', f.classes.us, f.halal ? '(yalnız Şer\'i listedekiler)' : '(helal olmayanlar yine girmez)') + '</fieldset>' +
        '<fieldset class="lab-fs" id="lab-doviz"><legend>Döviz</legend>' + chk('fx', 'Döviz (dolar / euro)', f.fx) + chk('usdEtf', 'Dolar bazlı helal ETF dahil', f.usdEtf) + chk('tlOnly', 'Yalnız TL araçlar', f.tlOnly) +
        '<p class="hint">Üçü birbirinden bağımsız seçilir. "Yalnız TL araçlar" + "Dolar bazlı helal ETF dahil" = TL araçlar + istisna olarak helal ETF (dövize bağlı pay en fazla %' + (L.FX_CAP_BP / 100) + ').</p></fieldset></div>';
      h += '<div class="lab-sels">' + sel('count', 'Varlık sayısı', [3, 4, 5, 6, 8, 10, 12, 15].map(function (n) { return [n, n + ' varlık']; }), f.count) +
        sel('maxSingleBp', 'Tek varlık üst sınırı', [1000, 1500, 2000, 2500, 3000, 4000, 5000].map(function (n) { return [n, '%' + n / 100]; }), f.maxSingleBp) +
        sel('minScore', 'En düşük analiz skoru', [[0, 'Sınır yok'], [40, '40'], [45, '45'], [50, '50'], [55, '55'], [60, '60'], [65, '65']], f.minScore) +
        sel('liquidity', 'Likidite', [['any', 'Hepsi'], ['mid', 'Orta ve üstü'], ['high', 'Yalnız yüksek']], f.liquidity) +
        sel('minNowBp', 'Hemen alınabilir pay hedefi', [[0, 'Hedef yok'], [3000, '%30'], [4000, '%40'], [5000, '%50'], [6000, '%60'], [7000, '%70']], f.minNowBp) + '</div>';
      h += '<div class="lab-row">' + chk('preferZone', 'Alım bölgesindeki varlıkları öne al', f.preferZone, '(hepsi beklemede kalmasın)') + '</div>';
      h += '<details class="fold fold-sm lab-sec"><summary><b>Sektör (BIST)</b> <span class="hint">' + (f.sectors.length ? f.sectors.length + ' sektör seçili' : 'Tümü') + '</span></summary><div class="lab-secs">' +
        secs.map(function (s) { return chk('sec:' + s, L.SECTORS_TR[s], f.sectors.indexOf(s) >= 0); }).join('') + '<p class="hint">Hiçbiri seçili değilse tüm sektörler. Aynı sektörden en fazla 2 hisse alınır (çeşitlendirme).</p></div></details>';
      h += '<div id="lab-warn">' + notices(R.warnings.concat(R.info)) + '</div>';
      return h + '</section>';
    }
    function builderPage() {
      var h = '<section class="card lab-start"><h2>Portföy tutarı ve adı</h2><div class="grid two"><div class="field"><label for="lab-amt">Portföy tutarı (TL) — isteğe bağlı</label><input id="lab-amt" inputmode="decimal" autocomplete="off" placeholder="ör. 100.000 (boş bırakılabilir)" value="' + esc(form.amount) + '"><p class="hint">Yazarsan tutar analiz sonucuna göre varlıklara dağıtılır ve oluşturma anındaki gerçek fiyattan "almış gibi" sanal alım kaydedilir. Boş bırakırsan yalnızca yüzde ağırlıklar (model portföy) çıkar.</p></div>' +
        '<div class="field"><label for="lab-name">Portföy adı — isteğe bağlı</label><input id="lab-name" maxlength="60" autocomplete="off" placeholder="ör. Emeklilik, Çocuk birikimi" value="' + esc(form.name) + '"></div></div></section>';
      h += filtersCard();
      var R = L.resolveFilters(F), blocked = R.warnings.some(function (w) { return w.level === 'danger'; });
      h += '<div class="btnrow lab-go"><button class="btn primary" type="button" data-act="lab-create"' + (job && job.running || blocked ? ' disabled' : '') + '>' + (job && job.running ? 'Canlı veriden oluşturuluyor…' : 'Portföyü oluştur') + '</button> <a class="btn" href="#analiz/portfoylerim">Kayıtlı portföylerim (' + list().length + ')</a></div>';
      if (job && job.running) h += '<section class="card lab-progress"><p class="loading-line"><span class="spinner"></span> ' + esc(job.step || 'Başlıyor…') + '</p><p class="hint">Sunucu analizleri, TEFAS listesi ve seçilen her varlığın canlı analizi alınır; 10–60 saniye sürebilir.</p></section>';
      if (job && job.error) h += '<div class="notice danger">' + esc(job.error) + '</div>';
      if (job && job.done && job.rec) {
        h += '<section class="card lab-savebar" id="lab-result"><h2>Oluşturulan portföy (henüz kaydedilmedi)</h2><div class="lab-saverow"><label class="sr" for="lab-save-name">Ad</label><input id="lab-save-name" maxlength="60" value="' + esc(job.rec.name) + '"> <button class="btn primary" type="button" data-act="lab-save">💾 Kaydet ve takibe al</button> <button class="btn" type="button" data-act="lab-discard">Vazgeç</button></div>' +
          '<p class="hint">Kaydedilen portföy "Kayıtlı portföylerim"de durur; gerçek varlıklarına, alım-satımlarına ve bütçene karışmaz. Eşitleme açıksa diğer cihazlarına da gider.</p>' + notices(job.warnings.concat(job.info || [])) + '</section>';
        h += report(job.rec, { V: job.V, bt: job.bt, corr: job.corr, corrNames: job.corrNames, excluded: job.excluded, btErr: job.btErr });
      }
      return h;
    }

    /* ---------- Rapor: grafikler ---------- */
    function CHs() { return window.Charts; }
    function donut(P) {
      var CH = CHs(); if (!CH) return '';
      var items = P.positions.map(function (p) { return { name: short(p.name), value: p.weightBp }; }); if (P.cashBp) items.push({ name: 'Nakit', value: P.cashBp });
      return CH.custom('lab-donut-' + P.id, 260, 'Dağılım: ' + items.map(function (x) { return x.name + ' %' + (x.value / 100).toFixed(1); }).join(', '), function (t) {
        return CH.anim({ color: t.pal, tooltip: CH.tooltip(t, { trigger: 'item', formatter: function (p) { return '<b>' + esc(p.name) + '</b><br>%' + (p.value / 100).toFixed(1).replace('.', ','); } }),
          legend: { type: 'scroll', bottom: 0, textStyle: { color: t.muted } }, series: [{ type: 'pie', radius: ['42%', '68%'], center: ['50%', '42%'], label: { show: false }, data: items }] });
      });
    }
    function scoreBars(P) {
      var CH = CHs(); if (!CH) return '';
      var rows = P.positions.slice().sort(function (a, b) { return (a.score == null ? -1 : a.score) - (b.score == null ? -1 : b.score); });
      return CH.custom('lab-sc-' + P.id, Math.max(160, 28 * rows.length + 40), 'Varlık analiz skorları: ' + rows.map(function (p) { return short(p.name) + ' ' + (p.score == null ? 'veri yok' : p.score); }).join(', '), function (t) {
        return CH.anim({ grid: { left: 6, right: 34, top: 8, bottom: 4, containLabel: true }, tooltip: CH.tooltip(t, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
          xAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted } }, yAxis: { type: 'category', data: rows.map(function (p) { return short(p.name); }), axisLabel: { color: t.muted, width: 80, overflow: 'truncate' } },
          series: [{ type: 'bar', name: 'Skor', barMaxWidth: 18, label: { show: true, position: 'right', color: t.ink, formatter: function (p) { return p.value == null ? 'veri yok' : p.value; } }, data: rows.map(function (p) { return { value: p.score, itemStyle: { color: p.score == null ? t.muted : p.score >= 70 ? t.ok : p.score >= 55 ? t.brand : p.score >= 45 ? t.medium : t.risky, borderRadius: [0, 5, 5, 0] } }; }) }] });
      });
    }
    function scatter(P) {
      var CH = CHs(), pts = P.positions.filter(function (p) { return p.vol1y != null && p.ret1y != null; }); if (!CH) return '';
      if (pts.length < 2) return '<p class="hint">Risk/getiri grafiği için en az iki varlığın 1 yıllık fiyat geçmişi gerekir.</p>';
      return CH.custom('lab-rr-' + P.id, 270, 'Risk / getiri: yatay eksen yıllık oynaklık, dikey eksen 1 yıllık getiri', function (t) {
        return CH.anim({ grid: { left: 8, right: 16, top: 20, bottom: 28, containLabel: true }, tooltip: CH.tooltip(t, { trigger: 'item', formatter: function (p) { return '<b>' + esc(p.data.n) + '</b><br>Oynaklık %' + p.data.value[0].toFixed(1) + '<br>1Y getiri %' + p.data.value[1].toFixed(1) + '<br>Pay %' + (p.data.w / 100).toFixed(1); } }),
          xAxis: { type: 'value', name: 'Oynaklık %', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.line } } },
          yAxis: { type: 'value', name: '1Y getiri %', nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'scatter', data: pts.map(function (p) { return { n: short(p.name), w: p.weightBp, value: [p.vol1y * 100, p.ret1y * 100], symbolSize: 8 + Math.sqrt(p.weightBp) / 4, itemStyle: { color: p.tier === 'safe' ? t.safe : p.tier === 'medium' ? t.medium : t.risky } }; }), label: { show: true, position: 'top', color: t.muted, fontSize: 10, formatter: function (p) { return p.data.n; } } }] });
      });
    }
    function histChart(P) {
      var CH = CHs(), h = P.history || []; if (!CH) return '';
      if (h.length < 2) return '<p class="hint">Değer grafiği her gün ilk güncellemede bir nokta ekler. İlk nokta: ' + esc(h[0] ? h[0].d.split('-').reverse().join('.') : '—') + (h[0] && h[0].v != null ? ' · ' + tl(h[0].v) : '') + '. Sonraki günler bu sayfayı açınca veya "Güncelle" ile dolar.</p>';
      var useV = !!P.amountK;
      return CH.custom('lab-h-' + P.id, 210, useV ? 'Portföy değeri zaman içinde' : 'Model portföy getirisi zaman içinde', function (t) {
        return CH.anim({ grid: { left: 8, right: 12, top: 14, bottom: 6, containLabel: true }, tooltip: CH.tooltip(t, { trigger: 'axis', formatter: function (ps) { var p = ps[0]; return '<b>' + esc(p.axisValue) + '</b><br>' + (useV ? tl(p.data) : '%' + Number(p.data).toFixed(2)); } }),
          xAxis: { type: 'category', data: h.map(function (x) { return x.d.split('-').reverse().join('.'); }), axisLabel: { color: t.muted } }, yAxis: { type: 'value', scale: true, axisLabel: { color: t.muted, formatter: function (v) { return useV ? M.formatShort(v) : '%' + v; } }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'line', name: 'Değer', smooth: 0.2, areaStyle: { opacity: 0.12 }, lineStyle: { width: 3, color: t.brand }, itemStyle: { color: t.brand }, data: h.map(function (x) { return useV ? x.v : (x.r || 0) * 100; }) }].concat(useV ? [{ type: 'line', name: 'Yatırılan', symbol: 'none', lineStyle: { type: 'dashed', color: t.muted }, data: h.map(function () { return P.amountK; }) }] : []) });
      });
    }
    function btChart(P, bt) {
      var CH = CHs(); if (!CH || !bt || !bt.nav) return '';
      return CH.custom('lab-bt-' + P.id, 190, 'Geçmiş test: 100 ile başlayan karışım endeksi', function (t) {
        return CH.anim({ grid: { left: 8, right: 12, top: 14, bottom: 6, containLabel: true }, tooltip: CH.tooltip(t, { trigger: 'axis', formatter: function (ps) { return '<b>' + esc(ps[0].axisValue) + '</b><br>' + Number(ps[0].data).toFixed(1); } }),
          xAxis: { type: 'category', data: bt.nav.map(function (x) { return x.d; }), axisLabel: { color: t.muted } }, yAxis: { type: 'value', scale: true, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'line', symbol: 'none', lineStyle: { width: 2, color: t.brand }, areaStyle: { opacity: 0.1 }, data: bt.nav.map(function (x) { return Math.round(x.c * 1000) / 10; }) }] });
      });
    }
    function corrTable(corr, names) {
      if (!corr || !names || names.length < 2) return '';
      return '<details class="fold fold-sm"><summary><b>Korelasyon tablosu</b> <span class="hint">1 = birlikte hareket eder, 0 = ilişkisiz</span></summary><div class="tscroll"><table class="mini lab-corr"><thead><tr><th></th>' + names.map(function (n) { return '<th>' + esc(n) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        corr.map(function (row, i) { return '<tr><th>' + esc(names[i]) + '</th>' + row.map(function (c) { return '<td class="' + (c == null ? '' : c > 0.7 ? 'neg' : c < 0.3 ? 'pos' : '') + '">' + (c == null ? '—' : c.toFixed(2).replace('.', ',')) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></details>';
    }
    // Fiyat-seviye şeridi: stop (kırmızı) · alım bölgesi (yeşil) · fiyat (nokta) · emir (kesikli) · hedefler (mavi)
    function ladder(p, price) {
      var e = p.entry || {}, vals = [e.stop, e.buyLo, e.buyHi, price, e.t1, e.t2, p.limit].filter(num);
      if (vals.length < 2) return '';
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || hi * 0.02; lo -= pad; hi += pad;
      function x(v) { return Math.round((v - lo) / (hi - lo) * 1000) / 10; }
      var s = '<svg class="lab-ladder" viewBox="0 0 100 26" preserveAspectRatio="none" role="img" aria-label="' + esc('Seviyeler: stop ' + fp(e.stop) + ', alım ' + fp(e.buyLo) + '–' + fp(e.buyHi) + ', fiyat ' + fp(price) + ', hedef ' + fp(e.t1)) + '">';
      s += '<line x1="0" y1="13" x2="100" y2="13" class="ll-axis"/>';
      if (num(e.buyLo) && num(e.buyHi)) s += '<rect x="' + x(e.buyLo) + '" y="7" width="' + Math.max(0.8, x(e.buyHi) - x(e.buyLo)) + '" height="12" class="ll-zone"/>';
      if (num(e.stop)) s += '<line x1="' + x(e.stop) + '" y1="3" x2="' + x(e.stop) + '" y2="23" class="ll-stop"/>';
      [e.t1, e.t2].forEach(function (t) { if (num(t)) s += '<line x1="' + x(t) + '" y1="3" x2="' + x(t) + '" y2="23" class="ll-tgt"/>'; });
      if (num(p.limit) && p.status === 'pending') s += '<line x1="' + x(p.limit) + '" y1="5" x2="' + x(p.limit) + '" y2="21" class="ll-lim"/>';
      if (num(price)) s += '<circle cx="' + x(price) + '" cy="13" r="2.6" class="ll-px"/>';
      return s + '</svg><div class="ll-leg"><span class="ll-k s">Stop ' + fp(e.stop) + '</span><span class="ll-k z">Alım ' + (num(e.buyLo) ? fp(e.buyLo) + '–' + fp(e.buyHi) : '—') + '</span><span class="ll-k p">Fiyat ' + fp(price) + '</span><span class="ll-k t">Hedef ' + (num(e.t1) ? fp(e.t1) : '—') + (num(e.t2) ? ' / ' + fp(e.t2) : '') + '</span></div>';
    }
    function advice(p, r) { // öneri cümlesi
      var e = p.entry || {}, price = r && r.price != null ? r.price : p.price0, cur = p.cur, stopW = p.cls === 'fund' ? 'gözden geçirme seviyesi ' : 'stop ';
      if (p.status === 'held') return (e.code === 'now' || e.code === 'trail' ? 'Tut — eklemek için de uygun. ' : 'Tut. ') + (num(e.stop) ? stopW.charAt(0).toUpperCase() + stopW.slice(1) + money(e.stop, cur) + '. ' : '') + (num(e.t1) ? 'Hedef ' + money(e.t1, cur) + (num(e.t2) ? ' → ' + money(e.t2, cur) : '') + '.' : '');
      if (p.status === 'pending' && num(p.limit)) return (num(price) && price <= p.limit ? 'Fiyat seviyeye GELDİ — "Güncelle" ile sanal alım yapılır: ' : 'Bekle: ') + money(p.limit, cur) + ' ve altına gelirse al' + (num(e.stop) ? ' (' + stopW + money(e.stop, cur) + ')' : '') + '.';
      if (e.code === 'now' || e.code === 'trail') return 'Şimdi alınabilir' + (num(e.stop) ? ' · ' + stopW + money(e.stop, cur) : '') + (num(e.t1) ? ' · hedef ' + money(e.t1, cur) : '') + '.';
      if (e.code === 'wait') return 'Bekle: ' + (num(e.buyLo) ? money(e.buyLo, cur) + '–' + money(e.buyHi, cur) : '—') + ' aralığına gelirse al.';
      return e.label || 'Seviye yok';
    }
    function assetCard(P, p, i, V) {
      var r = V && V.rows[i], price = r && r.price != null ? r.price : p.price0, e = p.entry || {}, sp = ST_PILL[e.code] || ST_PILL.none, rest = String(p.name).split(' — ').slice(1).join(' — ');
      var h = '<article class="lab-asset t-' + p.tier + '" data-key="' + esc(p.key) + '"><div class="la-top"><div><b><a href="#analiz/varlik/' + esc(p.key) + '">' + esc(short(p.name)) + '</a></b> <span class="hint">' + esc(L.CLASS[p.cls].label) + (p.sector ? ' · ' + esc(L.sectorTr(p.sector)) : '') + ' · ' + esc(L.TIER_LABEL[p.tier]) + '</span>' +
        (rest ? '<div class="hint">' + esc(rest.slice(0, 60)) + '</div>' : '') + '</div><div class="la-sc">' + U.scoreBadge(p.score) + '<div class="hint">' + (p.score == null ? 'veri yetersiz' : 'skor') + '</div></div></div>';
      h += '<div class="la-pills">' + pill(sp[0], sp[1]) + ' ' + pill(p.status === 'held' ? 'ok' : p.status === 'pending' ? 'info' : 'warn', STATUS_L[p.status]) + ' ' + (p.halal ? pill(p.halal.status === 'uygun' ? 'ok' : 'warn', 'Helal: ' + (p.halal.label || p.halal.status)) : '') + ' <span class="pill">Pay %' + (p.weightBp / 100).toFixed(1).replace('.', ',') + '</span></div>';
      h += '<p class="la-rec"><b>' + esc(advice(p, r)) + '</b></p>' + ladder(p, price);
      h += '<div class="la-kv"><span>Fiyat <b>' + money(price, p.cur) + '</b></span><span>Oluşturmada <b>' + money(p.price0, p.cur) + '</b></span>' + (num(e.rrNow) ? '<span>Risk/ödül <b>' + (e.rrNow > 9 ? '> 9' : e.rrNow.toFixed(1).replace('.', ',')) + '</b></span>' : '') + (num(e.stop) && num(price) ? '<span>Stopa uzaklık <b>%' + pc(price / e.stop - 1) + '</b></span>' : '') + (p.vol1y != null ? '<span>Yıllık oynaklık <b>%' + pc(p.vol1y) + '</b></span>' : '') + '</div>';
      if (P.amountK) {
        if (p.status === 'held') h += '<div class="la-kv"><span>Sanal adet <b>' + String(p.units).replace('.', ',') + '</b></span><span>Maliyet <b>' + tl(p.costK) + '</b> (' + money(p.fillPrice, p.cur) + (p.fillVia ? ', emir ' + esc(String(p.filledAt).slice(0, 10).split('-').reverse().join('.')) + ' doldu' : '') + ')</span>' + (r && r.valueK != null ? '<span>Değer <b>' + tl(r.valueK) + '</b></span><span>K/Z <b class="' + cls(r.pnlK) + '">' + tlS(r.pnlK) + ' (' + pcS(r.pnlPct) + ')</b></span>' : '') + '</div>';
        else if (p.status === 'pending') h += '<div class="la-kv"><span>Bekleyen nakit <b>' + tl(p.budgetK) + '</b></span>' + (num(p.limit) ? '<span>Emir seviyesi <b>' + money(p.limit, p.cur) + '</b></span><span>Planlanan adet ≈ <b>' + String(p.plannedUnits || 0).replace('.', ',') + '</b></span>' : '') + (num(p.limit) && num(e.buyHi) && Math.abs(e.buyHi / p.limit - 1) > 0.01 ? '<span>Güncel önerilen seviye <b>' + money(e.buyHi, p.cur) + '</b></span>' : '') + '</div>';
        else if (p.status === 'cash') h += '<div class="la-kv"><span>Nakitte <b>' + tl(p.budgetK) + '</b></span></div>';
      } else if (r && r.ret != null) h += '<div class="la-kv"><span>Oluşturmadan beri <b class="' + cls(r.ret) + '">' + pcS(r.ret) + '</b></span></div>';
      if (p.note) h += '<p class="hint">' + esc(p.note) + '</p>';
      (p.events || []).filter(function (x) { return x.t !== 'fill'; }).forEach(function (x) { h += '<p class="hint ' + (x.t === 'stop' ? 'neg' : 'pos') + '">' + (x.t === 'stop' ? '⚠ Stop seviyesi ' : '✓ ' + (x.t === 't1' ? '1.' : '2.') + ' hedef ') + money(x.p, p.cur) + ' — ' + esc(String(x.d).split('-').reverse().join('.')) + '</p>'; });
      h += '<details class="fold fold-sm"><summary>Skor bileşenleri ve gerekçe</summary>' + (p.parts && p.parts.length ? '<div class="hbars">' + p.parts.map(function (x) { return U.bar(x.s, (AN.SUB_LABEL[x.k] || x.k) + ' (ağırlık ' + x.w + ')'); }).join('') + '</div>' : '<p class="hint">Bileşen yok (veri yetersiz).</p>') +
        '<p class="hint">' + esc(e.why || '') + (p.conf != null ? ' · Güven ' + p.conf + '/100' : '') + (p.priceSrc ? ' · Fiyat kaynağı: ' + esc(p.priceSrc) : '') + '</p></details>';
      return h + '</article>';
    }
    function report(P, o) {
      o = o || {}; var V = o.V || null, sc = P.score || {}, rk = P.risk || {}, f = P.filters, D = det[P.id] || {};
      var h = '<section class="card lab-head" id="lab-report"><div class="lab-hgrid"><div class="lab-gauge">' + U.gaugeHtml('lab-g-' + P.id, sc.total, 'Portföy analiz skoru', 150) + '<div class="center"><b>' + (sc.total == null ? 'Veri yetersiz' : 'Portföy skoru ' + sc.total + '/100 · ' + esc(sc.grade || '')) + '</b></div></div><div>' +
        '<h2>' + esc(P.name) + '</h2><p class="hint">Oluşturma: ' + when(P.createdAt) + (P.updatedAt && P.updatedAt !== P.createdAt ? ' · son güncelleme ' + when(P.updatedAt) : '') + '</p>' +
        '<p>' + pill('info', L.PROFILES[f.profile] ? L.PROFILES[f.profile].label : 'Özel profil') + ' ' + pill(f.halal ? 'ok' : 'warn', f.halal ? 'Helal filtresi açık' : 'Helal filtresi kapalı') + ' ' + pill('info', { short: 'Kısa vade', medium: 'Orta vade', long: 'Uzun vade' }[f.horizon]) + ' ' + pill('info', { low: 'Düşük risk', medium: 'Orta risk', high: 'Yüksek risk' }[f.risk]) + (f.tlOnly ? ' ' + pill('info', 'Yalnız TL' + (f.usdEtf || f.fx ? ' + istisna' : '')) : '') + '</p>';
      if (P.amountK) {
        h += '<div class="kpis grid lab-kpis"><div class="kpi card"><div class="label">Tutar</div><div class="value">' + tl(P.amountK) + '</div></div>' +
          '<div class="kpi card"><div class="label">Güncel değer</div><div class="value">' + (V && V.totalK != null ? tl(V.totalK) : '—') + '</div></div>' +
          '<div class="kpi card"><div class="label">Kâr / zarar</div><div class="value ' + cls(V && V.pnlK) + '">' + (V ? tlS(V.pnlK) : '—') + '</div><div class="sub">' + (V ? pcS(V.pnlPct, 2) : '') + '</div></div>' +
          '<div class="kpi card"><div class="label">Bekleyen nakit</div><div class="value">' + (V ? tl(V.pendingK) : '—') + '</div><div class="sub">artan nakit ' + (V ? tl(V.cashK) : '—') + '</div></div></div>';
      } else h += '<div class="kpis grid lab-kpis"><div class="kpi card"><div class="label">Tür</div><div class="value">Model</div><div class="sub">tutar girilmedi — yüzde ağırlıklar</div></div><div class="kpi card"><div class="label">Oluşturmadan beri</div><div class="value ' + cls(V && V.modelRet) + '">' + (V ? pcS(V.modelRet, 2) : '—') + '</div><div class="sub">hemen alınabilir varlıkların ağırlıklı getirisi</div></div></div>';
      h += '</div></div>';
      h += '<h3>Portföy skoru bileşenleri</h3><div class="hbars">' + (sc.parts || []).map(function (x) { return U.bar(x.score, x.label + ' · ağırlık ' + x.w); }).join('') + '</div>' + (sc.reason ? '<p class="notice warn">' + esc(sc.reason) + '</p>' : '') +
        '<details class="fold fold-sm"><summary>Skor nasıl hesaplandı?</summary><ul class="ev small">' + (sc.parts || []).map(function (x) { return '<li><b>' + esc(x.label) + '</b> (ağırlık ' + x.w + '): ' + esc(x.ev || '—') + '</li>'; }).join('') + '<li>Hesaplanamayan bileşenin ağırlığı diğerlerine dağıtılır; kapsam %50\'nin altındaysa veya varlık skorları yoksa skor verilmez ("veri yetersiz").</li></ul></details></section>';
      var al = L.alertsOf(P, V), rb = L.rebalance(P, V);
      if (al.length || rb.length || (P.notes || []).length) {
        h += '<section class="card"><h2>Uyarılar ve öneriler</h2>' + notices(al);
        if (rb.length) h += '<h3>Yeniden dengeleme</h3><ul class="ev">' + rb.map(function (x) { return '<li><b>' + esc(short(x.name)) + '</b>: hedef %' + (x.tgt / 100).toFixed(1) + ', şu an %' + (x.cur / 100).toFixed(1) + ' — ' + esc(x.text) + '</li>'; }).join('') + '</ul><p class="hint">Satış zorunlu değil: önce yeni parayla geride kalanları tamamla (vergi ve komisyon maliyeti doğmaz).</p>';
        if ((P.notes || []).length) h += '<h3>Kurulum notları</h3><ul class="ev small">' + P.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
        h += '</section>';
      }
      h += '<div class="grid two"><section class="card"><h2>Dağılım</h2>' + donut(P) + '<div class="tiers">' + ['safe', 'medium', 'risky'].map(function (k) { return '<span class="tier t-' + k + '">' + L.TIER_LABEL[k] + ' <b>%' + ((P.tiers[k] || 0) / 100).toFixed(0) + '</b></span>'; }).join('') + (P.cashBp ? '<span class="tier t-safe">Nakit <b>%' + (P.cashBp / 100).toFixed(0) + '</b></span>' : '') + '</div></section>' +
        '<section class="card"><h2>Varlık skorları</h2>' + scoreBars(P) + '</section></div>';
      h += '<div class="grid two"><section class="card"><h2>Risk / getiri</h2>' + scatter(P) + '<p class="hint">Sağa gittikçe oynaklık, yukarı gittikçe son 1 yılın getirisi artar; nokta büyüklüğü = pay. Geçmiş getiri geleceği garanti etmez.</p></section>' +
        '<section class="card"><h2>Değer takibi</h2>' + histChart(P) + '</section></div>';
      h += '<section class="card"><h2>Beklenen risk</h2><div class="kpis grid lab-kpis">' +
        '<div class="kpi card"><div class="label">Yıllık oynaklık</div><div class="value">' + (num(rk.vol) ? '%' + pc(rk.vol) : '—') + '</div><div class="sub">profil sınırı %' + Math.round(AN.PROFILE_CAPS[f.risk].vol * 100) + '</div></div>' +
        '<div class="kpi card"><div class="label">1 aylık riske maruz değer (%95)</div><div class="value neg">' + (num(rk.var95m) ? '−%' + pc(rk.var95m) : '—') + '</div><div class="sub">' + (P.amountK && num(rk.var95m) ? '≈ ' + tl(Math.round(P.amountK * rk.var95m)) + ' (20 ayda 1 bundan kötü)' : 'normal dağılım varsayımı') + '</div></div>' +
        '<div class="kpi card"><div class="label">En büyük düşüş (1 yıl)</div><div class="value neg">' + (num(rk.mdd) ? '−%' + pc(Math.abs(rk.mdd)) : '—') + '</div><div class="sub">3 yıllık test: ' + (num(rk.btMdd) ? '−%' + pc(Math.abs(rk.btMdd)) : '—') + '</div></div>' +
        '<div class="kpi card"><div class="label">Olası en büyük düşüş tahmini</div><div class="value neg">' + (num(rk.mddEst) ? '−%' + pc(rk.mddEst) : '—') + '</div><div class="sub">geçmiş düşüş ile 2σ\'nın büyüğü</div></div></div>' +
        (num(rk.cagr) ? '<p>Geçmiş test (aylık dengeleme): yıllık getiri <b>%' + pc(rk.cagr) + '</b>, en kötü 12 ay <b>%' + pc(rk.worst12) + '</b>, en iyi 12 ay <b>%' + pc(rk.best12) + '</b>.</p>' : '<p class="hint">Geçmiş test için ortak tarihli yeterli fiyat geçmişi yok' + (o.btErr ? ' (' + esc(o.btErr) + ')' : '') + '.</p>') +
        btChart(P, o.bt || D.bt) + corrTable(o.corr || D.corr, o.corrNames || D.corrNames) + '<p class="hint">Oynaklık ve düşüş, seçilen varlıkların son 1 yılının günlük TL fiyatlarından (dolar bazlılar günün kuruyla) hesaplanır. Geçmiş, geleceğin garantisi değildir.</p></section>';
      var nowN = P.positions.filter(function (p) { return p.entry && (p.entry.code === 'now' || p.entry.code === 'trail'); }).length;
      h += '<section class="card"><h2>Varlıklar: alım, hedef ve stop seviyeleri</h2><p class="hint">' + P.positions.length + ' varlık · ' + nowN + ' tanesi şu an alım bölgesinde · seviyeler gerçek fiyat yapısından (destek/direnç bölgeleri, ATR) hesaplanır.</p><div class="lab-assets">' + P.positions.map(function (p, i) { return assetCard(P, p, i, V); }).join('') + '</div></section>';
      h += '<section class="card"><h2>Özet tablo</h2><div class="tscroll"><table class="atable stack lab-tbl"><thead><tr><th>Varlık</th><th>Pay</th><th>Skor</th><th>Durum</th><th>Alım bölgesi</th><th>Stop</th><th>Hedef 1 / 2</th><th>R/Ö</th>' + (P.amountK ? '<th>K/Z</th>' : '') + '</tr></thead><tbody>' +
        P.positions.map(function (p, i) { var e = p.entry || {}, r = V && V.rows[i]; return '<tr><td>' + esc(short(p.name)) + '</td><td>%' + (p.weightBp / 100).toFixed(1).replace('.', ',') + '</td><td>' + U.scoreBadge(p.score) + '</td><td>' + esc((ST_PILL[e.code] || ST_PILL.none)[1]) + ' · ' + esc(STATUS_L[p.status]) + '</td><td>' + (num(e.buyLo) ? money(e.buyLo, p.cur) + '–' + money(e.buyHi, p.cur) : '—') + '</td><td>' + money(e.stop, p.cur) + '</td><td>' + money(e.t1, p.cur) + ' / ' + money(e.t2, p.cur) + '</td><td>' + (num(e.rrNow) ? (e.rrNow > 9 ? '> 9' : e.rrNow.toFixed(1).replace('.', ',')) : '—') + '</td>' + (P.amountK ? '<td class="' + cls(r && r.pnlK) + '">' + (r && p.status === 'held' ? tlS(r.pnlK) : '—') + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div></section>';
      if (o.excluded && o.excluded.length) h += '<section class="card"><details class="fold fold-sm"><summary><b>Filtre dışında kalanlar</b> <span class="hint">' + o.excluded.length + ' varlık</span></summary><ul class="ev small">' + o.excluded.slice(0, 80).map(function (x) { return '<li>' + esc(short(x.name)) + ': ' + esc(x.reason) + '</li>'; }).join('') + '</ul></details></section>';
      h += '<section class="card"><details class="fold fold-sm"><summary><b>Yöntem ve veri</b></summary><ul class="ev small">' +
        '<li><b>Varlık skoru</b>: Varlık analizindeki motorun 0-100 skoru (trend, momentum, risk/oynaklık, değerleme, göreli güç, likidite; ağırlıklar varlık türüne göre "Yöntem ve doğrulama" sekmesinde). Veri yoksa skor verilmez.</li>' +
        '<li><b>Alım bölgesi</b>: destek bölgesi (≥ 2 dokunuşlu pivot kümeleri) veya kırılan direncin geri testi; fiyat bölgede ve güncel R/Ö ≥ 1,5 ise "şimdi alınabilir". Değilse bölgenin üst sınırı bekleyen emir seviyesi olur. Stop = yapısal dip − ATR tamponu; hedefler = sonraki direnç bölgeleri / Fibonacci uzantıları. Altında destek olmayan ve trendi güçlü varlıkta iz süren stop (fiyat − 2,5×ATR). Düşük oynaklıklı fonlarda zamanlama gerekmez.</li>' +
        '<li><b>Dağılım</b>: vade × risk tablosundan güvenli/orta/riskli paylar; grup içinde (skor − 30) × alım bölgesi (×1,15) × oynaklık uyarlaması; tek varlık sınırı; boş grubun payı daha düşük riskli gruba ya da nakde (risk artırılmaz).</li>' +
        '<li><b>Sanal alım</b>: oluşturma anındaki canlı fiyat (BIST 15 dk gecikmeli TradingView, TEFAS son fiyat, Binance; dolar bazlılar anlık USD/TL ile). Bekleyen emir, oluşturma gününden sonraki ilk günlük mumda en düşük fiyat emir seviyesine inince o seviyeden (açılış daha düşükse açılıştan) dolmuş sayılır.</li>' +
        '<li><b>Portföy skoru</b>: ' + Object.keys(L.PSCORE_W).map(function (k) { return esc(L.PSCORE_LABEL[k]) + ' ' + L.PSCORE_W[k]; }).join(' · ') + '.</li>' +
        '<li>Veri: ' + esc(P.dataNote || '—') + '</li></ul></details><p class="hint">Bu bir hesaplama aracıdır, yatırım tavsiyesi değildir. Sanal portföy gerçek emir göndermez.</p></section>';
      return h;
    }

    /* ---------- Kayıtlı portföyler ---------- */
    function listPage() {
      var L0 = list(), h = '<section class="card lab-listc"><h2>Kayıtlı portföylerim</h2>';
      if (!L0.length) return h + '<p class="muted">Henüz kayıtlı portföy yok. <a href="#analiz/olustur">Portföy oluşturucu</a>dan bir portföy oluşturup "Kaydet ve takibe al"a bas.</p></section>';
      h += '<div class="btnrow"><button class="btn" type="button" data-act="lab-refresh-all"' + (listBusy ? ' disabled' : '') + '>' + (listBusy ? 'Güncelleniyor…' : '↻ Tümünü güncelle') + '</button> <a class="btn primary" href="#analiz/olustur">+ Yeni portföy</a></div><div class="lab-list">';
      h += L0.map(function (P) {
        var V = valOf(P), lv = lastVal(P), sc = P.score || {};
        var pnl = P.amountK ? (V ? V.pnlPct : lv && lv.v != null ? lv.v / P.amountK - 1 : null) : (V ? V.modelRet : lv ? lv.r : null);
        return '<article class="lab-item" data-id="' + esc(P.id) + '"><div class="li-top"><a class="li-name" href="#analiz/portfoylerim/' + esc(P.id) + '"><b>' + esc(P.name) + '</b></a>' + U.scoreBadge(sc.total) + '</div>' +
          '<div class="hint">' + when(P.createdAt) + ' · ' + P.positions.length + ' varlık · ' + esc(L.PROFILES[P.filters.profile] ? L.PROFILES[P.filters.profile].label : 'Özel') + (P.amountK ? ' · ' + tl(P.amountK) : ' · model') + '</div>' +
          '<div class="li-kv"><span>' + (P.amountK ? 'Değer <b>' + (V && V.totalK != null ? tl(V.totalK) : lv && lv.v != null ? tl(lv.v) : '—') + '</b>' : 'Model portföy') + '</span><span>K/Z <b class="' + cls(pnl) + '">' + pcS(pnl, 2) + '</b></span><span>Bekleyen <b>' + P.positions.filter(function (p) { return p.status === 'pending'; }).length + '</b></span></div>' +
          '<div class="btnrow"><a class="btn small primary" href="#analiz/portfoylerim/' + esc(P.id) + '">Aç ve analiz et</a> <button class="btn small" type="button" data-act="lab-rename" data-id="' + esc(P.id) + '">Yeniden adlandır</button> <button class="btn small danger" type="button" data-act="lab-del" data-id="' + esc(P.id) + '">Sil</button> <label class="lab-chk small"><input type="checkbox" data-lab-cmp="' + esc(P.id) + '"' + (cmpSel[P.id] ? ' checked' : '') + '> Karşılaştır</label></div></article>';
      }).join('') + '</div></section>';
      var ids = Object.keys(cmpSel).filter(function (k) { return cmpSel[k] && byId(k); }), chosen = ids.length >= 2 ? ids.map(byId) : L0;
      if (chosen.length >= 2) {
        var rows = L.compare(chosen, chosen.map(valOf));
        h += '<section class="card"><h2>Portföy karşılaştırma</h2><p class="hint">' + (ids.length >= 2 ? 'Seçtiğin ' + ids.length + ' portföy.' : 'Tüm portföyler (karşılaştırmak istediklerini kutucukla seç).') + '</p><div class="tscroll"><table class="atable stack lab-cmp"><thead><tr><th>Portföy</th><th>Skor</th><th>K/Z</th><th>Oynaklık</th><th>En büyük düşüş</th><th>Varlık</th><th>Alınan / bekleyen</th></tr></thead><tbody>' +
          rows.map(function (r) { return '<tr><td><a href="#analiz/portfoylerim/' + esc(r.id) + '">' + esc(r.name) + '</a></td><td>' + U.scoreBadge(r.score) + ' ' + esc(r.grade || '') + '</td><td class="' + cls(r.pnlPct) + '">' + pcS(r.pnlPct, 2) + '</td><td>' + (r.vol != null ? '%' + pc(r.vol) : '—') + '</td><td>' + (r.mdd != null ? '−%' + pc(Math.abs(r.mdd)) : '—') + '</td><td>' + r.n + '</td><td>' + r.held + ' / ' + r.pending + '</td></tr>'; }).join('') + '</tbody></table></div><p class="hint">K/Z son güncellemedeki değerdir ("Tümünü güncelle" canlı fiyatlardan yeniler).</p></section>';
      }
      return h;
    }
    function detailPage(id) {
      var P = byId(id); if (!P) return '<div class="notice warn">Portföy bulunamadı (silinmiş olabilir). <a href="#analiz/portfoylerim">Kayıtlı portföylerim →</a></div>';
      var D = det[id] || (det[id] = {}), stale = !D.at || Date.now() - D.at > 30 * 60000;
      if (stale && !D.busy && !D.autoTried) { D.autoTried = true; setTimeout(function () { refreshOne(id); }, 0); }
      var h = '<p class="crumbs"><a href="#analiz/portfoylerim">← Kayıtlı portföylerim</a></p><section class="card lab-actions"><div class="btnrow"><button class="btn primary" type="button" data-act="lab-refresh" data-id="' + esc(id) + '"' + (D.busy ? ' disabled' : '') + '>' + (D.busy ? 'Canlı fiyatlarla analiz ediliyor…' : '↻ Güncelle ve yeniden analiz et') + '</button>' +
        ' <button class="btn" type="button" data-act="lab-rename" data-id="' + esc(id) + '">Yeniden adlandır</button>' +
        (P.positions.some(function (p) { return p.status === 'pending' && p.entry && num(p.entry.buyHi) && num(p.limit) && Math.abs(p.entry.buyHi / p.limit - 1) > 0.01; }) ? ' <button class="btn" type="button" data-act="lab-relimit" data-id="' + esc(id) + '">Bekleyen emirleri güncel seviyelere taşı</button>' : '') +
        ' <button class="btn" type="button" data-act="lab-apply" data-id="' + esc(id) + '">Gerçek portföyüme hedef olarak uygula…</button> <button class="btn" type="button" data-act="lab-print">Yazdır / PDF</button> <button class="btn danger" type="button" data-act="lab-del" data-id="' + esc(id) + '">Sil</button></div>' +
        '<p class="hint">' + (D.busy ? 'Canlı fiyatlar ve analiz alınıyor…' : D.at ? 'Son canlı güncelleme: ' + new Date(D.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) + ' TSİ' : 'Açılışta canlı fiyatlar ve analiz alınır.') + (D.fails && D.fails.length ? ' · alınamayan: ' + esc(D.fails.join(', ')) : '') + '</p>' + (D.err ? '<div class="notice danger">Güncellenemedi: ' + esc(D.err) + '</div>' : '') + '</section>';
      return h + report(P, { V: D.V || null, bt: D.bt, corr: D.corr, corrNames: D.corrNames });
    }

    /* ---------- Olaylar ---------- */
    function guessProfile(f) { var ks = Object.keys(L.PROFILES); for (var i = 0; i < ks.length; i++) if (L.profileMatches(Object.assign({}, f, { profile: ks[i] }))) return ks[i]; return 'ozel'; }
    function rememberForm() { var a = document.getElementById('lab-amt'), n = document.getElementById('lab-name'); if (a) form.amount = a.value; if (n) form.name = n.value; }
    function setF(field, v) {
      var o = L.cleanFilters(F);
      if (field === 'profile') { if (v === 'ozel') o.profile = 'ozel'; else o = L.applyProfile(o, v); F = L.cleanFilters(o); if (v === 'ozel') F.profile = 'ozel'; }
      else {
        if (field.indexOf('cls.') === 0) o.classes[field.slice(4)] = !!v;
        else if (field.indexOf('sec:') === 0) { var s = field.slice(4), i = o.sectors.indexOf(s); if (v && i < 0) o.sectors.push(s); if (!v && i >= 0) o.sectors.splice(i, 1); }
        else if (['count', 'maxSingleBp', 'minScore', 'minNowBp'].indexOf(field) >= 0) o[field] = parseInt(v, 10);
        else if (['halal', 'fx', 'usdEtf', 'tlOnly', 'preferZone'].indexOf(field) >= 0) o[field] = !!v;
        else o[field] = v;
        F = L.cleanFilters(o); if (field !== 'halal') F.profile = guessProfile(F);
      }
      saveF(); rememberForm(); X.render();
    }
    function actions(t) {
      return {
        'lab-f': function () { setF(t.dataset.f, t.dataset.v); },
        'lab-std': function () { F = L.defaultFilters(); saveF(); rememberForm(); X.render(); X.toast('Standart filtre yüklendi: Dengeli profil, helal filtresi açık.'); },
        'lab-create': function () { create(); },
        'lab-save': function () { save(); },
        'lab-discard': function () { job = null; X.render(); },
        'lab-refresh': function () { var id = t.dataset.id; if (det[id]) det[id].err = null; refreshOne(id); },
        'lab-refresh-all': function () { if (listBusy) return; listBusy = true; X.render(); var ids = list().map(function (p) { return p.id; }); ids.reduce(function (pr, id) { return pr.then(function () { return refreshOne(id); }); }, Promise.resolve()).then(function () { listBusy = false; X.render(); X.toast(ids.length + ' portföy güncellendi.'); }); },
        'lab-rename': function () { var P = byId(t.dataset.id); if (!P) return; var n = prompt('Portföyün yeni adı:', P.name); if (n == null) return; n = n.trim().slice(0, 60); if (!n) { X.toast('Ad boş olamaz.'); return; } X.mutate(function (s) { (s.labPortfolios || []).forEach(function (q) { if (q.id === P.id) q.name = n; }); }, 'Ad değişti: ' + n); },
        'lab-del': function () { var P = byId(t.dataset.id); if (!P) return; if (!confirm('"' + P.name + '" silinsin mi?\n\nYalnızca bu sanal portföy silinir; gerçek varlıkların ve alım-satımların etkilenmez. Hemen ardından "Geri al" ile geri getirebilirsin.')) return; delete det[P.id]; delete cmpSel[P.id]; var onDetail = location.hash.indexOf('#analiz/portfoylerim/') === 0; X.mutate(function (s) { s.labPortfolios = (s.labPortfolios || []).filter(function (q) { return q.id !== P.id; }); }, '"' + P.name + '" silindi.'); if (onDetail) location.hash = '#analiz/portfoylerim'; },
        'lab-relimit': function () { var id = t.dataset.id; X.mutate(function (s) { (s.labPortfolios || []).forEach(function (Q) { if (Q.id !== id) return; Q.positions.forEach(function (p) { if (p.status === 'pending' && p.entry && num(p.entry.buyHi)) { p.limit = p.entry.buyHi; var lTL = p.cur === 'USD' ? p.limit * (Q.usdtry0 || 1) : p.limit; p.plannedUnits = L.floorStep(p.budgetK / 100 / lTL, L.CLASS[p.cls].step); } }); }); }, 'Bekleyen emirler güncel alım seviyelerine taşındı.'); },
        'lab-apply': function () { var P = byId(t.dataset.id); if (P) U.applyLab(P); },
        'lab-print': function () { window.print(); }
      };
    }
    function onChange(el) {
      if (el.dataset && el.dataset.labF) { setF(el.dataset.labF, el.type === 'checkbox' ? el.checked : el.value); return true; }
      if (el.dataset && el.dataset.labCmp) { cmpSel[el.dataset.labCmp] = el.checked; X.render(); return true; }
      return false;
    }
    return { builderPage: builderPage, listPage: listPage, detailPage: detailPage, actions: actions, onChange: onChange, report: report, refreshOne: refreshOne, filters: function () { return F; }, job: function () { return job; } };
  };
})();
