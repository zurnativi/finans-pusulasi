/* analysis-ui.js — Portföy Analizi bölümü: Genel bakış (portföy sağlık skoru, varlık skorları, izleme listesi), Varlık analizi (canlı grafik + yapı +
 * planlar + doğrulama), Portföy oluşturucu (profil + helal filtre → dağılım, geçmiş test, Yönetim'e uygula), Yöntem ve doğrulama.
 * Hesaplar analysis.js / ta.js / structure.js'te (testli); veri mdata.js'te. Bu dosya yalnızca gösterir, veri ister ve kullanıcı onayıyla kaydeder. */
(function () {
  'use strict';
  window.AnalysisUI = function (X) {
    var M = window.Money, PF = window.Portfolio, C = window.Calc, AN = window.Analysis, MD = window.MData, TA = window.TA, TC = window.TAChart;
    var esc = X.esc, tip = X.tip, tl = X.tl;
    var SUM_KEY = 'finans-pusulasi:analiz-ozet', IMP_KEY = 'finans-pusulasi:analiz-ice-aktarim';
    var cur = { key: null, loading: false, error: null, view: { range: '1Y', lower: 'volume', lens: 'conservative', overlays: { ma: true, structure: true, plan: true, patterns: true, fib: false, bb: false, ichimoku: false, supertrend: false, vwap: false } } };
    var cacheA = {}, search = { q: '', results: null, loading: false }, newsBy = {}, corr = null, corrBusy = false, bulk = null, verifyRun = null, liveTimer = null;
    var builder = { result: null, bt: null, loading: false, error: null };
    var KIND_LABEL = { stock: 'BIST hissesi', fund: 'TEFAS fonu', crypto: 'Kripto', etf: 'ABD ETF/hisse', metal: 'Emtia', fx: 'Döviz', index: 'Endeks', import: 'İçe aktarılan' };
    var US_HALAL = { SPUS: 1, HLAL: 1, SPSK: 1, SPRE: 1, SPTE: 1, SPWO: 1, UMMA: 1 };
    function st() { return X.state(); }
    function an() { var s = st(); return s.analysis && typeof s.analysis === 'object' ? s.analysis : { watchlist: [], profile: {} }; }
    function sums() { try { return JSON.parse(localStorage.getItem(SUM_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function saveSum(A) { var s = sums(); s[A.key] = { key: A.key, name: A.name, kind: A.kind, total: A.total, conf: A.confidence, confLabel: A.confLabel, stance: A.stance.label, stanceCode: A.stance.code, hold: A.stance.hold ? A.stance.hold.label : null, price: A.price, cur: A.currency, at: new Date().toISOString(), lastDate: A.lastDate, blocked: A.blocked }; try { localStorage.setItem(SUM_KEY, JSON.stringify(s)); } catch (e) { /* kota */ } }
    function imports() { try { return JSON.parse(localStorage.getItem(IMP_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function pill(level, text) { var c = level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'danger' || level === 'fail' ? 'err' : 'info'; return '<span class="pill ' + c + '">' + esc(text) + '</span>'; }
    function scoreCls(s) { return s == null ? 'sc-na' : s >= 70 ? 'sc-a' : s >= 55 ? 'sc-b' : s >= 45 ? 'sc-c' : 'sc-d'; }
    function scoreBadge(s) { return '<span class="score ' + scoreCls(s) + '">' + (s == null ? '—' : s) + '</span>'; }
    function fp(x) { return AN.fmtP(x); }
    function pc(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d).replace('.', ','); }
    function money(x, c) { return (c === 'USD' ? '$' : '') + fp(x) + (c === 'TRY' || !c ? ' ₺' : ''); }
    function when(iso) { if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return esc(iso); return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) + ' TSİ'; }
    function bar(score, label) { var w = score == null ? 0 : score; return '<div class="sbar"><span class="sbar-l">' + esc(label) + '</span><span class="sbar-t"><i class="' + scoreCls(score) + '" style="width:' + w + '%"></i></span><b class="sbar-v">' + (score == null ? '—' : score) + '</b></div>'; }
    function gaugeHtml(key, score, label, h) { return window.Charts ? window.Charts.custom(key, h || 150, label + ': ' + (score == null ? 'yok' : score + '/100'), function (t) { return TC.gauge(score, label, t); }, 'gauge') : '<div class="big">' + (score == null ? '—' : score) + '</div>'; }

    /* ---------- Portföy bağlantısı ---------- */
    function keyOfAsset(a) {
      if (!a) return null; var pk = a.priceKey || '', sym = String(a.symbol || '').toUpperCase();
      if (/^(bist|tefas|cg|metal|fx|idx):/.test(pk)) return pk;
      if (/^td:/.test(pk)) return US_HALAL[pk.slice(3)] ? 'us:' + pk.slice(3) : pk;
      if (a.cls === 'katilim_stock' && /^[A-Z0-9]{3,6}$/.test(sym)) return 'bist:' + sym;
      if ((a.cls === 'katilim_fund' || a.cls === 'sukuk') && /^[A-Z0-9]{3}$/.test(sym)) return 'tefas:' + sym;
      if (a.cls === 'halal_etf' && /^[A-Z]{2,5}$/.test(sym)) return US_HALAL[sym] ? 'us:' + sym : 'td:' + sym;
      if (a.cls === 'gold') return 'metal:XAU';
      return null;
    }
    function holdings() {
      var c; try { c = X.calc(); } catch (e) { return { list: [], c: null }; }
      var list = c.pos.filter(function (p) { return p.asset && p.valueTL > 0; }).map(function (p) { return { pos: p, key: keyOfAsset(p.asset), name: p.asset.name, value: p.valueTL, halal: p.halal }; });
      return { list: list, c: c };
    }
    function halalFor(key, series) {
      var a = (st().assets || []).find(function (x) { return keyOfAsset(x) === key; }), H = PF.HALAL;
      if (a && a.halal && a.halal.status && a.halal.status !== 'bilinmiyor' && H[a.halal.status]) return { status: a.halal.status, label: H[a.halal.status].label, reason: (a.halal.note || 'Yönetim\'deki etiketin') };
      var k = key.split(':')[0], s = key.slice(k.length + 1);
      if (k === 'bist') { var m = (series && series.katilim) || []; return m.indexOf('XKTUM') >= 0 ? { status: 'uygun', label: 'Uygun', reason: 'Borsa İstanbul Katılım Tüm endeksinde' + (m.indexOf('XK050') >= 0 ? ' (Katılım 50 dahil)' : '') } : { status: 'bilinmiyor', label: 'Katılım endeksinde değil', reason: 'Katılım endekslerinde yer almıyor — helal filtresinden geçmez' }; }
      if (k === 'tefas') { var f = series && series.fund; if (f && f.tags && f.tags.islamic) return { status: 'uygun', label: 'Uygun', reason: 'Katılım (İslami) fon — TEFAS etiketi' }; if (f && /borçlanma|para piyasası|eurobond|repo/i.test(f.type || '')) return { status: 'uygun_degil', label: 'Uygun değil', reason: 'Faizli araçlara yatırım yapan fon türü (' + f.type + ')' }; return { status: 'bilinmiyor', label: 'Bilinmiyor', reason: 'Katılım fonu etiketi yok' }; }
      if (k === 'us' || k === 'td') return US_HALAL[s] ? { status: 'uygun', label: 'Uygun', reason: 'Şer\'i endeks izleyen ETF' } : { status: 'bilinmiyor', label: 'Bilinmiyor', reason: 'Şer\'i tarama bilgisi yok' };
      if (k === 'cg') return { status: 'supheli', label: 'Şüpheli', reason: 'Kripto paralar hakkında âlimler arasında görüş ayrılığı var' };
      if (k === 'metal' || k === 'macro') return { status: 'uygun', label: 'Uygun', reason: 'Fiziki/peşin altın-gümüş için (vadeli kontrat değil; ons grafiği yalnızca fiyat okumak için)' };
      if (k === 'fx') return { status: 'uygun', label: 'Uygun', reason: 'Peşin (spot) döviz' };
      return { status: 'bilinmiyor', label: 'Bilinmiyor', reason: 'Yatırım aracı değil (yalnızca piyasa okuması)' };
    }
    function twelveKey() { try { return (JSON.parse(localStorage.getItem('finans-pusulasi:prices') || '{}') || {}).twelveKey || null; } catch (e) { return null; } }

    /* ---------- Analizi yükle ve hesapla ---------- */
    function runAnalysis(key, opts) {
      opts = opts || {};
      var imp = key.indexOf('imp:') === 0 ? imports()[key.slice(4)] : null;
      return MD.load(key, { symbol: opts.symbol, twelveKey: twelveKey(), imported: imp }).then(function (series) {
        var k = key.split(':')[0], jobs = [], ctx = { halal: halalFor(key, series) };
        if (series.kind === 'stock' && k === 'bist') {
          jobs.push(MD.fundamentals(key.slice(5)).then(function (f) { ctx.fundamentals = f; }, function (e) { ctx.fundErr = e.message; }));
          jobs.push(MD.loadMd('index', 'XU100').then(function (b) { ctx.benchBars = b.bars; ctx.benchName = 'BIST 100'; }, function () { }));
          jobs.push(MD.tvLive('BIST:XKTUM').then(function (x) { ctx.benchTv = x.raw; }, function () { }));
        }
        if (series.kind === 'fund' && series.fund && series.fund.type) jobs.push(MD.fundPeers(series.fund.type).then(function (p) { ctx.fundPeers = p; }, function () { }));
        if (series.kind === 'crypto' && k === 'cg' && key !== 'cg:bitcoin') jobs.push(MD.load('cg:bitcoin').then(function (b) { ctx.benchBars = b.bars; ctx.benchName = 'Bitcoin'; }, function () { }));
        if (k === 'metal') jobs.push(MD.load('fx:USD').then(function (b) { ctx.benchBars = b.bars; ctx.benchName = 'Dolar/TL'; }, function () { }));
        return Promise.all(jobs).then(function () {
          var h = holdings(), held = h.list.filter(function (x) { return x.key === key; })[0], total = h.list.reduce(function (s2, x) { return s2 + x.value; }, 0) / 100;
          var R = Object.assign({}, PF.DEFAULT_RULES, (st().settings && st().settings.riskRules) || {});
          ctx.holding = !!held; ctx.portfolioValue = total > 0 && series.currency === 'TRY' ? total : null; ctx.maxSingleFrac = R.maxAssetBp / 10000;
          var A = AN.analyze(series, ctx); A.series = series; A.ctx = ctx; A.at = new Date().toISOString();
          cacheA[key] = A; saveSum(A); return A;
        });
      });
    }
    function open(key, opts) {
      cur.key = key; cur.error = null; cur.loading = true;
      if (X.tab() !== 'analiz' || X.sub() !== 'varlik') location.hash = '#analiz/varlik/' + key; // route → render
      else { if (location.hash !== '#analiz/varlik/' + key) history.replaceState(null, '', '#analiz/varlik/' + key); X.render(); }
      runAnalysis(key, opts).then(function () { cur.loading = false; X.render(); }, function (e) { cur.loading = false; cur.error = e.message || String(e); X.render(); });
    }

    /* ---------- GÖRÜNÜMLER ---------- */
    var SUBS = [['', 'Genel bakış'], ['varlik', 'Varlık analizi'], ['olustur', 'Portföy oluşturucu'], ['yontem', 'Yöntem ve doğrulama']];
    function render() {
      var sub = X.sub(), h = '<h1>Portföy Analizi</h1>' + X.subtabs('analiz', SUBS);
      if (sub === 'varlik') { var hk = decodeURIComponent(location.hash.split('/')[2] || ''); if (hk && hk !== cur.key && !cur.loading) { setTimeout(function () { open(hk); }, 0); cur.key = hk; cur.loading = true; cur.error = null; } }
      try { h += ({ '': overview, varlik: assetPage, olustur: builderPage, yontem: methodPage }[sub] || overview)(); }
      catch (e) { console.error(e); h += '<div class="notice danger">Bu bölüm gösterilemedi: ' + esc(e.message) + '</div>'; }
      return h + '<p class="hint disc-a">Analizler hesaplama ve eğitim amaçlıdır, yatırım tavsiyesi değildir. Her sayı kaynağı ve saatiyle gösterilir; veri yetersizse sinyal verilmez.</p>';
    }
    function searchBox() {
      var r = search.results;
      return '<form class="asearch" id="a-search" role="search"><label for="a-q" class="sr">Varlık ara</label><input id="a-q" type="search" placeholder="Kod veya isim: ASELS, KTV, BTC, altın, SPUS, dolar…" value="' + esc(search.q) + '" autocomplete="off">' +
        '<button class="btn primary" type="submit"' + (search.loading ? ' disabled' : '') + '>' + (search.loading ? 'Aranıyor…' : 'Analiz et') + '</button></form>' +
        (r ? (r.length ? '<div class="sresults">' + r.map(function (x) { return '<button type="button" class="sres" data-act="a-open" data-key="' + esc(x.key) + '"' + (x.symbol ? ' data-sym="' + esc(x.symbol) + '"' : '') + '><b>' + esc(x.label) + '</b><span class="muted">' + esc(x.sub || KIND_LABEL[x.kind] || '') + '</span></button>'; }).join('') + '</div>'
          : '<p class="hint">Sonuç yok. BIST kodu (ASELS), TEFAS kodu (KTV), kripto (BTC, SOL), altın/gümüş/dolar veya ABD ETF (SPUS) dene. Başka bir varlık için Varlık analizi sekmesinden OHLCV verisi yükleyebilirsin.</p>') : '');
    }

    /* ----- Genel bakış ----- */
    function healthInput() {
      var h = holdings(), c = h.c; if (!c) return null;
      var s = st(), sm = c.sm, R = Object.assign({}, PF.DEFAULT_RULES, (s.settings && s.settings.riskRules) || {}), rr = null; try { rr = PF.returnsReport(s, c.today); } catch (e) { rr = null; }
      var bench = null; if (rr && !rr.empty && rr.benchmarks) { var b = rr.benchmarks.filter(function (x) { return x.sim && x.sim.xirr != null && x.halal; })[0]; if (b) bench = { v: b.sim.xirr, label: b.label }; }
      var prof = (an().profile && an().profile.risk) || ({ conservative: 'low', standard: 'medium', aggressive: 'high' }[(s.goals && s.goals[0] && s.goals[0].glide) || 'standard'] || 'medium');
      return { positions: c.pos.filter(function (p) { return p.valueTL > 0; }).map(function (p) { return { name: p.name, value: p.valueTL, tier: p.tier, halal: p.halal, liquid: !!(p.asset && p.asset.tracking === 'trades') || (p.isAccount && !p.synthetic) }; }),
        target: c.an.targetAlloc, current: c.an.currentAlloc, emergency: { have: c.an.emergency.current, need: c.an.emergency.target }, rules: { ok: c.risk.ok, total: c.risk.total },
        fees: sm.feesTL, invested: sm.boughtTL, perf: rr && !rr.empty && bench && rr.xirr != null ? { xirr: rr.xirr, bench: bench.v, benchLabel: bench.label } : null, profile: prof, maxSingleBp: R.maxAssetBp, corr: corr && !corr.error ? corr : null };
    }
    function overview() {
      var h = searchBox(), inp = healthInput(), H = inp ? AN.health(inp) : null, S = sums(), hl = holdings();
      if (st().isExample) h += '<p class="hint">Örnek portföy üzerinde gösteriliyor. Piyasa verileri ise <b>gerçek ve canlıdır</b>.</p>';
      h += '<div class="grid two a-top">';
      h += '<section class="card a-health"><h2>Portföy sağlık skoru ' + tip('10 ölçütün belgeli ağırlıklarla ortalaması: çeşitlendirme (korelasyon dahil), yoğunlaşma, risk dağılımı uyumu, oynaklık/düşüş, acil fon, helal uyum, likidite, maliyet, performans, kural uyumu. Hesaplanamayan ölçütün ağırlığı diğerlerine dağıtılır.') + '</h2>';
      if (H) {
        h += '<div class="hrow"><div class="hg">' + gaugeHtml('a-hg', H.total, 'Sağlık · ' + H.grade, 170) + '</div><div class="hbars">' + Object.keys(AN.HEALTH_W).map(function (k) { var x = H.scores[k]; return bar(x ? x.score : null, AN.HEALTH_LABEL[k]); }).join('') + '</div></div>';
        if (H.missing.length) h += '<p class="hint">Hesaplanamayan: ' + esc(H.missing.map(function (k) { return AN.HEALTH_LABEL[k] || k; }).join(', ')) + ' (kapsam %' + Math.round(H.coverage * 100) + ').</p>';
        h += '<div class="btnrow"><button class="btn small" type="button" data-act="a-corr"' + (corrBusy ? ' disabled' : '') + '>' + (corrBusy ? 'Hesaplanıyor…' : 'Korelasyon ve oynaklığı hesapla') + '</button>' + (corr ? (corr.error ? ' <span class="hint">' + esc(corr.error) + '</span>' : ' <span class="hint">' + corr.days + ' ortak gün (' + corr.from + ' → ' + corr.to + '), ' + corr.used + '/' + corr.total + ' varlık</span>') : '') + '</div>';
        if (H.fixes.length) h += '<h3>Önce bunları düzelt</h3><ol class="fixes">' + H.fixes.slice(0, 4).map(function (f) { return '<li><b>' + esc(AN.HEALTH_LABEL[f.k]) + ' (' + f.score + ')</b> — ' + esc(f.text) + ' <a href="' + f.link + '">git →</a></li>'; }).join('') + '</ol>';
        else h += '<p class="ok-line">✓ Belirgin bir sağlık sorunu yok.</p>';
        h += '<details class="detail-only"><summary>Ölçütlerin ayrıntısı</summary><ul class="ev">' + Object.keys(AN.HEALTH_W).map(function (k) { var x = H.scores[k]; return '<li><b>' + esc(AN.HEALTH_LABEL[k]) + '</b> (ağırlık ' + AN.HEALTH_W[k] + '): ' + esc(x ? x.ev.join(' · ') : 'hesaplanamadı') + '</li>'; }).join('') + '</ul></details>';
      } else h += '<p class="muted">Portföy hesaplanamadı.</p>';
      h += '</section>';
      var rows = hl.list.filter(function (x) { return x.key; }), noKey = hl.list.filter(function (x) { return !x.key; });
      h += '<section class="card"><h2>Varlıklarının skorları ' + tip('Her varlık kendi türüne uygun yöntemle analiz edilir. Skor 0-100; güven düzeyi veri kalitesine ve göstergelerin TradingView ile uyumuna göre belirlenir.') + '</h2>';
      if (rows.length) {
        h += '<div class="btnrow"><button class="btn small primary" type="button" data-act="a-bulk"' + (bulk && bulk.running ? ' disabled' : '') + '>' + (bulk && bulk.running ? 'Analiz ediliyor… ' + bulk.done + '/' + bulk.total : 'Tümünü analiz et') + '</button></div>';
        h += '<table class="atable"><thead><tr><th>Varlık</th><th>Skor</th><th>Durum</th><th class="detail-only">Güven</th></tr></thead><tbody>' + rows.map(function (x) { var s = S[x.key]; return '<tr><td><a href="#analiz/varlik/' + esc(x.key) + '">' + esc(x.name) + '</a><div class="hint">' + esc(x.key) + (s ? ' · ' + when(s.at) : '') + '</div></td><td>' + scoreBadge(s ? s.total : null) + '</td><td>' + (s ? esc(s.hold || s.stance) : '<span class="muted">analiz edilmedi</span>') + '</td><td class="detail-only">' + (s ? esc(s.confLabel) : '—') + '</td></tr>'; }).join('') + '</tbody></table>';
        if (bulk && bulk.errors.length) h += '<p class="hint">Alınamayanlar: ' + esc(bulk.errors.join(' · ')) + '</p>';
      } else h += '<p class="muted">Analiz edilebilecek varlık yok.</p>';
      if (noKey.length) h += '<p class="hint">Piyasa verisi eşleşmeyen: ' + esc(noKey.map(function (x) { return x.name; }).join(', ')) + '. Varlığa kod (ör. ASELS, KTV) veya fiyat kaynağı ekleyince analiz edilir. <a href="#portfoy/varliklar">Varlıklar →</a></p>';
      h += '</section></div>';
      var wl = an().watchlist || [];
      h += '<section class="card"><h2>İzleme listesi ' + tip('Takip etmek istediğin varlıklar. Varlık analizinde "İzlemeye al" ile eklenir; eşitleme açıksa tüm cihazlarına taşınır.') + '</h2>';
      if (wl.length) h += '<div class="wl">' + wl.map(function (w) { var s = S[w.key]; return '<a class="wcard" href="#analiz/varlik/' + esc(w.key) + '"><div class="wl-h"><b>' + esc(w.name || w.key) + '</b>' + scoreBadge(s ? s.total : null) + '</div><div class="hint">' + esc(s ? (s.stance + ' · ' + money(s.price, s.cur)) : 'henüz analiz edilmedi') + '</div><div class="hint">' + (s ? when(s.at) : '') + '</div></a>'; }).join('') + '</div>';
      else h += '<p class="muted">Liste boş. Bir varlığı analiz edip "İzlemeye al"a dokun.</p>';
      return h + '</section>';
    }

    /* ----- Varlık analizi ----- */
    function assetPage() {
      var h = searchBox();
      if (!cur.key) return h + '<section class="card"><h2>Nasıl çalışır?</h2><ul class="ev"><li>Yazdığın varlığın <b>güncel</b> fiyat geçmişi kaynağından çekilir (BIST 15 dk gecikmeli, kripto anlık).</li><li>Göstergeler (RSI, MACD, ADX, Ichimoku, Supertrend, Bollinger, OBV…) hesaplanır ve TradingView\'in kendi değerleriyle karşılaştırılarak doğrulanır.</li><li>Grafikteki tepe/dip noktalarından destek-direnç bölgeleri, trend çizgileri, Fibonacci ve formasyonlar bulunur.</li><li>Alım bölgesi, stop ve hedefler bu yapıdan çıkar — sabit yüzde kullanılmaz. Risk/ödül 1,5\'in altındaysa "bekle" denir.</li></ul>' +
        '<div class="btnrow">' + [['bist:ASELS', 'ASELS'], ['tefas:KTV', 'KTV fonu'], ['cg:bitcoin', 'Bitcoin'], ['metal:XAU', 'Gram altın'], ['us:SPUS', 'SPUS']].map(function (x) { return '<button class="btn small" type="button" data-act="a-open" data-key="' + x[0] + '">' + x[1] + '</button>'; }).join(' ') + '</div></section>' + importCard();
      if (cur.loading) return h + '<section class="card"><p class="loading-line">⏳ ' + esc(cur.key) + ' için güncel veri alınıyor ve analiz ediliyor…</p></section>';
      if (cur.error) return h + '<div class="notice danger"><b>' + esc(cur.key) + ' analiz edilemedi:</b> ' + esc(cur.error) + '<br>Uydurma veri kullanılmaz. Kaynağa ulaşılamıyorsa biraz sonra tekrar dene ya da OHLCV verisi yükle.</div>' + importCard();
      var A = cacheA[cur.key]; if (!A) return h;
      if (!A.col) return h + '<div class="notice danger"><b>' + esc(A.name || A.key) + ':</b> ' + esc(A.blockReasons.join(' ')) + ' Analiz için en az 30 günlük veri gerekir; sinyal üretilmedi.</div>';
      return h + assetView(A);
    }
    function assetView(A) {
      var S = A.series, h = '', inWl = (an().watchlist || []).some(function (w) { return w.key === A.key; }), ccy = A.currency;
      var prev = A.col.c.length > 1 ? A.col.c[A.col.c.length - 2] : null, chg = prev ? (A.price / prev - 1) * 100 : null, hs = A.ctx.halal.status;
      h += '<section class="card a-head"><div class="ah-l"><div class="ah-k">' + esc(KIND_LABEL[A.kind] || A.kind) + ' · ' + pill(hs === 'uygun' ? 'ok' : hs === 'uygun_degil' ? 'danger' : 'warn', 'Helal: ' + A.ctx.halal.label) + ' <span class="hint">' + esc(A.ctx.halal.reason) + '</span></div><h2 class="ah-n">' + esc(A.name) + '</h2>' +
        '<div class="ah-p"><span class="num big">' + money(A.price, ccy) + '</span> ' + (chg != null ? '<span class="chg ' + (chg >= 0 ? 'pos' : 'neg') + '">' + (chg >= 0 ? '▲ +' : '▼ ') + chg.toFixed(2).replace('.', ',') + '%</span>' : '') + '</div>' +
        '<div class="hint">' + (S.live ? '<span class="live-dot" aria-hidden="true"></span>Son fiyat: ' + esc(S.live.source) + ' · ' + when(S.live.at) : 'Son kapanış ' + esc(A.lastDate)) + ' · Geçmiş: ' + esc(S.histSource ? S.histSource.label : '') + (S.histSource && S.histSource.at ? ' (' + when(S.histSource.at) + ')' : '') + '</div></div>' +
        '<div class="ah-r"><button class="btn small" type="button" data-act="a-refresh">↻ Yenile</button> <button class="btn small" type="button" data-act="a-watch" aria-pressed="' + inWl + '">' + (inWl ? '★ İzlemede' : '☆ İzlemeye al') + '</button> <button class="btn small" type="button" data-act="a-ask">Asistana sor</button></div></section>';
      if (A.blocked) h += '<div class="notice danger"><b>Sinyal üretilmedi.</b> ' + esc(A.blockReasons.join(' ')) + '</div>';
      h += '<div class="grid two a-score"><section class="card"><h2>Skor ' + tip('Alt skorların belgeli ağırlıklarla ortalaması (Yöntem ve doğrulama sekmesinde tablo). Helal durumu skora katılmaz; alım planı için kapıdır.') + '</h2><div class="hrow"><div class="hg">' + gaugeHtml('a-sg', A.total, A.confLabel + ' güven', 160) + '</div><div class="hbars">' +
        Object.keys(AN.WEIGHTS[A.kind] || {}).map(function (k) { var x = A.scores[k]; return bar(x ? x.score : null, AN.SUB_LABEL[k]); }).join('') + bar(A.scores.halal ? A.scores.halal.score : null, 'Helal (kapı)') + '</div></div>' +
        '<div class="stance st-' + A.stance.code + '"><b>' + esc(A.stance.label) + '</b>' + (A.stance.hold ? '<div class="hold"><b>Elindeki pozisyon için: ' + esc(A.stance.hold.label) + '</b><div class="hint">' + esc(A.stance.hold.why.join(' · ')) + '</div></div>' : '') + '</div>' +
        '<p class="hint">Güven ' + A.confidence + '/100' + (A.confReasons.length ? ' — ' + esc(A.confReasons.slice(0, 3).join(' · ')) : '') + '</p></section>';
      h += planCards(A) + '</div>';
      h += chartCard(A);
      h += '<div class="grid two">' + evidenceCard(A) + structureCard(A) + '</div>';
      if (A.kind === 'stock' && A.key.indexOf('bist:') === 0) h += fundCardStock(A);
      if (A.kind === 'fund' && S.fund) h += fundCardTefas(A);
      if (A.kind === 'crypto' && A.key.indexOf('cg:') === 0) h += cryptoCard(A);
      if (S.derived) h += '<p class="hint">Bu seri türetilmiştir: ' + esc(S.derived) + '. Mum (açılış/en yüksek/en düşük) yok; teknik analiz kapanışla sınırlıdır. Tam mum analizi için "ons altın" ara.</p>';
      h += '<div class="grid two">' + verifyCard(A) + newsCard(A) + '</div>';
      return h;
    }
    function planCards(A) {
      var P = A.plans, h = '<section class="card a-plans"><h2>Alım planı ' + tip('Seviyeler grafikteki yapıdan hesaplanır: giriş = destek bölgesi veya direnç kırılımı; stop = yapısal dip altı + ATR tamponu; hedefler = sonraki direnç bölgeleri, ölçülen hareket ve Fibonacci uzantıları. R/Ö = (hedef − giriş) / (giriş − stop).') + '</h2>';
      if (P.halalNote) h += '<div class="notice warn">' + esc(P.halalNote) + '</div>';
      if (P.blockedNote) h += '<div class="notice warn">' + esc(P.blockedNote) + '</div>';
      h += '<div class="seg lens" role="group" aria-label="Risk merceği"><button type="button" data-act="a-lens" data-v="conservative" aria-pressed="' + (cur.view.lens === 'conservative') + '">Temkinli (düşük risk)</button><button type="button" data-act="a-lens" data-v="aggressive" aria-pressed="' + (cur.view.lens === 'aggressive') + '">Atak (yüksek risk)</button></div>';
      var p = P[cur.view.lens];
      if (!p) h += '<p class="muted">' + esc(P.notes.join(' ') || 'Bu mercek için yapısal bir plan yok.') + '</p>';
      else {
        var dim = !A.halalOk || A.blocked;
        h += '<div class="plan' + (dim ? ' dim' : '') + '"><div class="plan-h"><b>' + esc(p.how) + '</b> ' + pill(p.ok ? 'ok' : 'warn', p.verdict) + '</div>' +
          '<div class="lv"><span>Giriş</span><b>' + money(p.entryLo, A.currency) + (p.entryHi !== p.entryLo ? ' – ' + money(p.entryHi, A.currency) : '') + '</b><i></i></div>' +
          '<div class="lv stop"><span>' + esc(p.stopLabel) + '</span><b>' + money(p.stop, A.currency) + '</b><i>−' + pc(p.riskPct) + '%</i></div>' +
          p.targets.map(function (t, i) { return '<div class="lv tgt' + (t.minor ? ' minor' : '') + '"><span>Hedef ' + (i + 1) + (t.minor ? ' (ara)' : '') + '</span><b>' + money(t.p, A.currency) + '</b><i>R/Ö ' + (t.rr != null ? t.rr.toFixed(2).replace('.', ',') : '—') + '</i></div>'; }).join('') +
          (p.size ? '<p class="hint">Pozisyon büyüklüğü (portföyün %' + pc(p.riskFrac) + '\'i riske edilerek): ≈ ' + tl(Math.round(p.size.value * 100)) + (A.kind === 'stock' ? ' (' + Math.floor(p.size.units) + ' adet)' : '') + (p.size.capped ? ' — tek varlık sınırıyla kırpıldı' : '') + '</p>' : '') +
          '<ul class="ev small">' + p.why.concat(p.targets.map(function (t, i) { return 'Hedef ' + (i + 1) + ': ' + t.why; })).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
        if (P.notes.length) h += '<p class="hint">' + esc(P.notes.join(' ')) + '</p>';
      }
      return h + '</section>';
    }
    function chartCard(A) {
      var v = cur.view, ov = v.overlays, plan = A.plans[v.lens];
      var chips = [['ma', 'Ortalamalar'], ['structure', 'Destek/direnç + trend'], ['plan', 'Plan seviyeleri'], ['patterns', 'Formasyon/uyumsuzluk'], ['fib', 'Fibonacci'], ['bb', 'Bollinger'], ['ichimoku', 'Ichimoku'], ['supertrend', 'Supertrend'], ['vwap', 'VWAP']]
        .filter(function (c) { return !(A.closeOnly && (c[0] === 'ichimoku' || c[0] === 'supertrend' || c[0] === 'vwap')); });
      var lowers = [['volume', 'Hacim'], ['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stok. RSI'], ['adx', 'ADX']].filter(function (x) { return !(x[0] === 'volume' && !A.ind.hasVol) && !(x[0] === 'adx' && A.closeOnly); });
      if (!lowers.some(function (x) { return x[0] === v.lower; })) v.lower = lowers[0][0];
      var last = A.col.bars[A.col.bars.length - 1];
      return '<section class="card a-chart"><div class="ch-h"><h2>Grafik ' + tip('Fare tekerleği veya iki parmakla yakınlaştır, sürükleyerek kaydır. Üzerine gelince o günün fiyatları görünür. Çizimler analizden gelir: yeşil = destek, kırmızı = direnç, kesikli = trend çizgisi/kanal.') + '</h2>' +
        '<div class="seg" role="group" aria-label="Zaman aralığı">' + Object.keys(TC.RANGES).map(function (r) { return '<button type="button" data-act="a-range" data-v="' + r + '" aria-pressed="' + (v.range === r) + '">' + r + '</button>'; }).join('') + '</div></div>' +
        '<div class="chips" role="group" aria-label="Göstergeler">' + chips.map(function (c) { return '<button type="button" class="chip" data-act="a-ov" data-v="' + c[0] + '" aria-pressed="' + !!ov[c[0]] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
        (window.Charts ? window.Charts.custom('a-px', window.innerWidth < 560 ? 430 : 560, A.name + ' fiyat grafiği', function (t) { return TC.build(A, { range: v.range, overlays: ov, lower: v.lower, plan: plan }, t); }, 'pxchart') : '<p class="muted">Grafik kütüphanesi yüklenemedi.</p>') +
        '<div class="seg low" role="group" aria-label="Alt panel">' + lowers.map(function (x) { return '<button type="button" data-act="a-lower" data-v="' + x[0] + '" aria-pressed="' + (v.lower === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<p class="hint">' + A.n + ' günlük veri · son mum ' + esc(A.lastDate) + (last.live ? ' (canlı/gecikmeli)' : last.partial ? ' (gün içi, kapanmadı)' : '') + ' · ATR(14) ' + fp(A.atr) + (A.ind.atrApprox ? ' (yaklaşık: kapanış değişimlerinden)' : '') + '</p></section>';
    }
    function evidenceCard(A) {
      var ks = Object.keys(AN.WEIGHTS[A.kind] || {}), all = [];
      ks.forEach(function (k) { var x = A.scores[k]; if (x) x.ev.forEach(function (e) { all.push({ k: k, t: e.t, p: e.p }); }); });
      var pos = all.filter(function (e) { return e.p > 0; }).sort(function (a, b) { return b.p - a.p; }).slice(0, 5), neg = all.filter(function (e) { return e.p < 0; }).sort(function (a, b) { return a.p - b.p; }).slice(0, 5);
      var h = '<section class="card"><h2>Neden bu skor? ' + tip('Her alt skorun kanıtları ve puan katkıları. Artı puanlar olumlu, eksi puanlar olumsuz etkiler.') + '</h2>';
      h += '<div class="pn"><div><h3 class="pos">Olumlu</h3><ul class="ev">' + (pos.length ? pos.map(function (e) { return '<li>' + esc(e.t) + '</li>'; }).join('') : '<li class="muted">—</li>') + '</ul></div><div><h3 class="neg">Olumsuz</h3><ul class="ev">' + (neg.length ? neg.map(function (e) { return '<li>' + esc(e.t) + '</li>'; }).join('') : '<li class="muted">—</li>') + '</ul></div></div>';
      h += '<details class="detail-only"><summary>Tüm kanıtlar ve sentez tablosu</summary>' + ks.map(function (k) { var x = A.scores[k]; return '<h4>' + esc(AN.SUB_LABEL[k]) + ' — ' + (x ? x.score : 'hesaplanamadı') + '</h4>' + (x ? '<ul class="ev small">' + x.ev.map(function (e) { return '<li>' + esc(e.t) + (e.p ? ' <b class="' + (e.p > 0 ? 'pos' : 'neg') + '">' + (e.p > 0 ? '+' : '') + Math.round(e.p) + '</b>' : '') + '</li>'; }).join('') + '</ul>' + (x.note ? '<p class="hint">' + esc(x.note) + '</p>' : '') : ''); }).join('') +
        '<table class="mini"><thead><tr><th>Alt skor</th><th>Ağırlık</th><th>Skor</th><th>Katkı</th></tr></thead><tbody>' + A.synthesis.parts.map(function (p) { return '<tr><td>' + esc(p.label) + '</td><td>%' + Math.round(p.wEff * 100) + '</td><td>' + p.s + '</td><td>' + p.contrib.toFixed(1).replace('.', ',') + '</td></tr>'; }).join('') + '<tr><td><b>Toplam</b></td><td></td><td></td><td><b>' + (A.total == null ? '—' : A.total) + '</b></td></tr></tbody></table>' +
        (A.synthesis.missing.length ? '<p class="hint">Eksik (ağırlığı dağıtıldı): ' + esc(A.synthesis.missing.join(', ')) + '</p>' : '') + '</details>';
      return h + '</section>';
    }
    function structureCard(A) {
      var h = '<section class="card"><h2>Grafik yapısı ' + tip('Tepe/dip noktaları ATR tabanlı zikzakla bulunur; yakın noktalar 1 ATR genişliğinde bölgelerde kümelenir. Trend çizgileri en az iki dip/tepeden geçer ve kapanışlarla ihlal edilmemiştir.') + '</h2>';
      var sup = A.zones.filter(function (z) { return z.hi < A.price; }).slice(-3).reverse(), res = A.zones.filter(function (z) { return z.lo > A.price; }).slice(0, 3), inZ = A.zones.filter(function (z) { return z.lo <= A.price && z.hi >= A.price; });
      h += '<table class="mini levels"><thead><tr><th>Seviye</th><th>Bölge</th><th>Dokunuş</th></tr></thead><tbody>' + res.slice().reverse().map(function (z) { return '<tr class="res"><td>Direnç' + (z.extreme ? ' (52h)' : '') + '</td><td>' + fp(z.lo) + ' – ' + fp(z.hi) + '</td><td>' + z.touches + '</td></tr>'; }).join('') +
        '<tr class="now"><td>Fiyat' + (inZ.length ? ' (bölge içinde)' : '') + '</td><td><b>' + fp(A.price) + '</b></td><td></td></tr>' + sup.map(function (z) { return '<tr class="sup"><td>Destek' + (z.extreme ? ' (52h)' : '') + '</td><td>' + fp(z.lo) + ' – ' + fp(z.hi) + '</td><td>' + z.touches + '</td></tr>'; }).join('') + '</tbody></table>';
      var T = A.trendlines || {};
      if (T.support) h += '<p>📈 Yükselen trend desteği: ' + T.support.touches + ' dokunuş, bugün ' + fp(T.support.value) + (T.channelFromSupport && T.channelFromSupport.valid ? ' · kanal üst bandı ' + fp(T.channelFromSupport.value) : '') + '</p>';
      if (T.resistance) h += '<p>📉 Düşen trend direnci: ' + T.resistance.touches + ' dokunuş, bugün ' + fp(T.resistance.value) + '</p>';
      if (A.patterns.length) h += '<h3>Formasyonlar</h3><ul class="ev">' + A.patterns.map(function (p) { return '<li><b>' + esc(p.name) + '</b> — ' + esc(p.status) + ', güven %' + p.conf + (p.target ? ', hedef ' + fp(p.target) : '') + '<div class="hint">' + esc(p.why.join(' · ')) + (p.invalidation ? ' · geçersizlik ' + fp(p.invalidation) : '') + '</div></li>'; }).join('') + '</ul>';
      else if (!A.closeOnly) h += '<p class="hint">Belirgin formasyon yok (ikili tepe/dip, OBO/TOBO, üçgen, bayrak arandı).</p>';
      if (A.divergences.length) h += '<p>' + A.divergences.map(function (d) { return (d.type === 'bull' ? '🟢 ' : '🔴 ') + esc(d.name) + ' (' + d.age + ' mum önce' + (d.fresh ? ', güncel' : ', eski') + ')'; }).join('<br>') + '</p>';
      if (A.fib) h += '<p class="hint">Fibonacci (' + fp(A.fib.from.p) + ' → ' + fp(A.fib.to.p) + '): ' + A.fib.retr.filter(function (r) { return r.r === 0.382 || r.r === 0.5 || r.r === 0.618; }).map(function (r) { return '%' + (r.r * 100).toFixed(1).replace('.', ',').replace(',0', '') + ' ' + fp(r.p); }).join(' · ') + '</p>';
      if (A.ind.vp) h += '<p class="hint detail-only">Hacim profili (son 120 gün): en çok işlem gören fiyat (POC) ' + fp(A.ind.vp.poc) + ', değer alanı ' + fp(A.ind.vp.vaLow) + ' – ' + fp(A.ind.vp.vaHigh) + '</p>';
      return h + '</section>';
    }
    function fundCardStock(A) {
      var F = A.ctx.fundamentals, f = F && F.self, P = F && F.peers;
      if (!f) return '<section class="card"><h2>Temel analiz</h2><p class="muted">Temel veri alınamadı' + (A.ctx.fundErr ? ' (' + esc(A.ctx.fundErr) + ')' : '') + '. Skor temel veri olmadan hesaplandı ve güven düşürüldü.</p></section>';
      function row(lbl, v, m, sfx, dec) { var d = dec == null ? 1 : dec, fm = function (x) { return x == null || !isFinite(x) ? '—' : x.toFixed(d).replace('.', ',') + (sfx || ''); }; return '<tr><td>' + lbl + '</td><td><b>' + fm(v) + '</b></td><td>' + fm(m) + '</td></tr>'; }
      return '<section class="card"><h2>Temel analiz</h2><p class="hint">Sektör: ' + esc(f.sector || '—') + ' / ' + esc(f.industry || '—') + ' · Piyasa değeri ' + AN.fmtBig(f.market_cap_basic) + ' TL · Kaynak: ' + esc(F.source || 'TradingView') + ', ' + when(F.at) + '</p>' +
        '<div class="tscroll"><table class="mini"><thead><tr><th>Oran</th><th>Şirket</th><th>Sektör medyanı' + (P && P.n ? ' (' + P.n + ' şirket)' : '') + '</th></tr></thead><tbody>' +
        row('F/K', f.price_earnings_ttm, P && P.price_earnings_ttm) + row('PD/DD', f.price_book_fq, P && P.price_book_fq, '', 2) + row('FD/FAVÖK', f.enterprise_value_ebitda_ttm, P && P.enterprise_value_ebitda_ttm) +
        row('Özsermaye kârlılığı', f.return_on_equity, P && P.return_on_equity, '%') + row('Net marj', f.net_margin, P && P.net_margin, '%') + row('Satış büyümesi (yıllık)', f.total_revenue_yoy_growth_ttm, P && P.total_revenue_yoy_growth_ttm, '%') +
        row('Net kâr büyümesi', f.net_income_yoy_growth_ttm, null, '%') + row('Borç / özsermaye', f.debt_to_equity, P && P.debt_to_equity, '', 2) + row('Cari oran', f.current_ratio, null, '', 2) + row('Temettü verimi', f.dividend_yield_recent, null, '%') + '</tbody></table></div>' +
        '<p class="hint">Türkiye\'de yüksek enflasyon nedeniyle nominal büyüme ve kârlılık sektör medyanıyla kıyaslanır. Finans şirketlerinde borç oranı değerlendirilmez.</p></section>';
    }
    function fundCardTefas(A) {
      var f = A.series.fund, R = f.returns || {}, B = f.benchmarks || {}, keys = [['m1', '1 ay'], ['m3', '3 ay'], ['m6', '6 ay'], ['ytd', 'Yıl başı'], ['y1', '1 yıl'], ['y3', '3 yıl']];
      function v(x) { return x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '') + (+x).toFixed(1).replace('.', ',') + '%'; }
      var h = '<section class="card"><h2>Fon analizi — ' + esc(f.type || '') + '</h2><p class="hint">' + esc(f.founder || '') + ' · ' + AN.fmtBig(f.size) + ' TL · ' + (f.investors != null ? f.investors.toLocaleString('tr-TR') : '—') + ' yatırımcı · TEFAS risk değeri ' + (f.risk && f.risk.score ? f.risk.score : '—') + '/7 · Kaynak: TEFAS (fon.yourapiservice.com)</p>' +
        '<div class="tscroll"><table class="mini"><thead><tr><th>Dönem</th><th>Fon</th>' + Object.keys(B).map(function (k) { return '<th>' + esc(B[k].name || k) + '</th>'; }).join('') + '</tr></thead><tbody>' + keys.map(function (k) { return '<tr><td>' + k[1] + '</td><td><b>' + v(R[k[0]]) + '</b></td>' + Object.keys(B).map(function (b) { return '<td>' + v(B[b].returns && B[b].returns[k[0]]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      var c = A.col.c.slice(-253), sh = TA.sharpe(c, 0), so = TA.sortino(c, 0), md = TA.maxDrawdown(c), vo = TA.annVol(c, 252), low = vo != null && vo < 0.04;
      h += '<p>Yıllık oynaklık %' + pc(vo) + ' · 1 yılda en büyük düşüş %' + pc(md.mdd) + (low ? ' · Sharpe/Sortino: oynaklık çok düşük olduğu için anlamlı değil' : ' · Sharpe ' + (sh != null ? sh.toFixed(2).replace('.', ',') : '—') + ' · Sortino ' + (so != null ? so.toFixed(2).replace('.', ',') : '—') + ' <span class="hint">(risksiz oran 0 varsayımı; TL bazında)</span>') + '</p>';
      var al = (f.allocation && f.allocation.items) || [], hd = (f.holdings && f.holdings.items) || [];
      h += '<div class="grid two">';
      if (al.length && window.Charts) h += '<div><h3>Varlık dağılımı</h3>' + window.Charts.donut('a-falloc', { h: 210, label: 'Fon varlık dağılımı', items: al.filter(function (x) { return x.pct > 0; }).map(function (x) { return { name: x.name, value: Math.round(x.pct * 100) }; }) }) + '</div>';
      h += '<div><h3>En büyük pozisyonlar</h3>' + (hd.length ? '<table class="mini"><tbody>' + hd.slice(0, 8).map(function (x) { return '<tr><td>' + esc(x.ticker || x.code || x.name || '') + '</td><td>%' + (x.weight != null ? (+x.weight).toFixed(1).replace('.', ',') : '—') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="hint">Hisse pozisyonu bildirimi yok (fon hisse taşımıyor olabilir).</p>') + '</div></div>';
      if (f.liquidation_notice) h += '<div class="notice danger">Tasfiye duyurusu var.</div>';
      return h + '<p class="hint">Fonlarda stop emri verilemez; plan seviyeleri "gözden geçirme" noktasıdır. Fon fiyatı günde bir kez açıklanır.</p></section>';
    }
    function cryptoCard(A) {
      var S = A.series, h = '<section class="card"><h2>Kripto piyasa göstergeleri</h2>';
      if (S.funding) h += '<p>Fonlama oranı (vadeli, 8 saatlik): <b>' + (S.funding.rate * 100).toFixed(4).replace('.', ',') + '%</b> ' + (S.funding.rate > 0.0005 ? pill('warn', 'kaldıraçlı alıcılar aşırı') : S.funding.rate < 0 ? pill('info', 'açığa satış baskın') : pill('ok', 'dengeli')) + ' <span class="hint">' + esc(S.funding.source || 'Binance') + ', ' + when(S.funding.at) + '</span></p>';
      else h += '<p class="hint">Fonlama oranı alınamadı (bu paritenin vadeli piyasası olmayabilir).</p>';
      if (S.fng && S.fng.values && S.fng.values.length) { var f0 = S.fng.values[0]; h += '<p>Korku & Açgözlülük endeksi: <b>' + f0.v + '</b> (' + esc(f0.c) + ', ' + esc(f0.d) + ') <span class="hint">' + esc(S.fng.source || 'alternative.me') + ' — tüm kripto piyasası için</span></p>'; }
      return h + '<p class="hint">Analiz USDT paritesiyle yapılır (en derin piyasa). Helal durumu tartışmalı (şüpheli) olduğu için alım planı önerilmez; grafik ve skor piyasa okuması içindir.</p></section>';
    }
    function verifyCard(A) {
      var h = '<section class="card"><h2>Doğrulama ' + tip('1) Veri kontrolleri: tarih sırası, mum tutarlılığı, boşluk, BIST %10 fiyat sınırı, aykırı hareket, güncellik, ikinci kaynakla kapanış uyumu. 2) Göstergelerimiz TradingView\'in aynı gün için hesapladığı değerlerle karşılaştırılır. 3) Gösterge kütüphanesi TA-Lib referans değerleriyle birim testinden geçer (Yöntem ve doğrulama sekmesi).') + '</h2>';
      h += '<ul class="checks">' + A.checks.map(function (c) { return '<li class="ck-' + c.level + '"><span aria-hidden="true">' + (c.level === 'ok' ? '✓' : c.level === 'info' ? 'ℹ' : c.level === 'warn' ? '⚠' : '✗') + '</span> ' + esc(c.msg) + '</li>'; }).join('') + '</ul>';
      var x = A.xcheck || {};
      h += '<h3>TradingView ile karşılaştırma ' + (x.compared ? pill(x.ok === x.compared ? 'ok' : 'warn', x.ok + '/' + x.compared + ' uyumlu') : '') + '</h3>';
      if (x.compared) h += '<div class="tscroll"><table class="mini"><thead><tr><th>Gösterge</th><th>Bizim</th><th>TradingView</th><th></th></tr></thead><tbody>' + x.rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + fp(r.ours) + '</td><td>' + fp(r.theirs) + '</td><td>' + (r.ok ? '✓' : '⚠ fark') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      else h += '<p class="hint">' + esc(x.note || 'Karşılaştırma yapılamadı.') + '</p>';
      h += '<p class="hint">Kaynaklar: ' + esc(A.series.histSource ? A.series.histSource.label : '') + (A.series.tvSymbol ? ' · TradingView ' + esc(A.series.tvSymbol) : '') + '. Analiz zamanı ' + when(A.at) + '.</p>';
      return h + '</section>';
    }
    function newsQuery(A) { var k = A.key.split(':'); if (k[0] === 'bist') { var nm = (A.name.split(' — ')[1] || '').split(' ')[0]; return nm && nm.length > 3 ? nm : k[1]; } if (k[0] === 'cg') return A.name.split(' ')[0] + ' crypto'; if (k[0] === 'metal' || k[0] === 'macro') return 'gold price'; if (k[0] === 'fx') return 'Turkish lira'; return A.name.split(' — ')[0]; }
    var POSW = /(rekor|yüksel|artış|büyüme|kâr açıkla|anlaşma|ihale kazan|sipariş|onay|surge|rally|gain|record|growth|beat|upgrade|profit|deal|wins)/i, NEGW = /(düş|kayıp|zarar|ceza|soruşturma|dava|iflas|gerile|plunge|fall|loss|lawsuit|probe|downgrade|crash|drop|fraud|ban)/i;
    function sentiment(t) { var p = POSW.test(t || ''), n = NEGW.test(t || ''); return p && !n ? { c: 'pos', i: '▲', t: 'olumlu kelimeler' } : n && !p ? { c: 'neg', i: '▼', t: 'olumsuz kelimeler' } : { c: 'neu', i: '•', t: 'nötr/karışık' }; }
    function newsCard(A) {
      var N = newsBy[A.key], h = '<section class="card"><h2>Haberler ' + tip('Ücretsiz GDELT haber veritabanından son 14 günün başlıkları ve basit kelime tabanlı duygu etiketi. Kaynak yanıt vermezse haber gösterilmez; "Asistana sor" ile bağlam içinde değerlendirme isteyebilirsin.') + '</h2>';
      if (!N) h += '<button class="btn small" type="button" data-act="a-news">Haberleri getir</button> <span class="hint">Sorgu: ' + esc(newsQuery(A)) + '</span>';
      else if (N.loading) h += '<p class="loading-line">Haberler alınıyor…</p>';
      else if (N.error) h += '<p class="muted">Haber kaynağı yanıt vermedi (' + esc(/fetch|network|cors/i.test(N.error) ? 'bağlantı reddedildi — GDELT yoğunken veya 5 sn\'de birden fazla istekte erişimi kısıtlar' : N.error) + '). <button class="btn small" type="button" data-act="a-news">Tekrar dene</button> Haber analizi uydurulmaz — "Asistana sor" ile değerlendirme isteyebilirsin.</p>';
      else if (!N.items.length) h += '<p class="muted">Son 14 günde başlık bulunamadı.</p>';
      else h += '<ul class="news">' + N.items.slice(0, 8).map(function (it) { var s = sentiment(it.title); return '<li><span class="sent ' + s.c + '" title="' + s.t + '">' + s.i + '</span> <a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + '</a><div class="hint">' + esc(it.domain || '') + ' · ' + esc(it.d || '') + '</div></li>'; }).join('') + '</ul><p class="hint">Kaynak: ' + esc(N.source || 'GDELT') + ', ' + when(N.at) + '</p>';
      return h + '</section>';
    }
    function importCard() {
      var im = imports(), ks = Object.keys(im);
      return '<section class="card"><h2>Kendi verini yükle (OHLCV) ' + tip('Veri kaynağı olmayan bir varlık için (ör. yurt dışı hisse) CSV/Excel\'den kopyala-yapıştır. Sütunlar: Tarih, Açılış, En yüksek, En düşük, Kapanış, Hacim. Yalnız Tarih + Kapanış da olur; o zaman mum analizi yapılmaz.') + '</h2>' +
        '<form id="a-imp"><div class="grid two"><div class="field"><label for="a-imp-n">Varlık adı</label><input id="a-imp-n" required maxlength="40" placeholder="ör. AAPL"></div><div class="field"><label for="a-imp-k">Tür</label><select id="a-imp-k"><option value="stock">Hisse</option><option value="fund">Fon</option><option value="crypto">Kripto</option><option value="import">Diğer</option></select></div></div>' +
        '<div class="field"><label for="a-imp-t">Veri (başlık satırı dahil)</label><textarea id="a-imp-t" rows="4" placeholder="Tarih;Açılış;En Yüksek;En Düşük;Kapanış;Hacim&#10;17.11.2026;351,75;353,75;340,5;341,5;30164715"></textarea></div><button class="btn" type="submit">Yükle ve analiz et</button></form>' +
        (ks.length ? '<p class="hint">Yüklenenler: ' + ks.map(function (k) { return '<a href="#analiz/varlik/imp:' + esc(k) + '">' + esc(im[k].name) + '</a>'; }).join(', ') + '</p>' : '') + '</section>';
    }

    /* ----- Portföy oluşturucu ----- */
    function prof() { var p = Object.assign({ horizon: 'medium', risk: 'medium', halal: true, usd: true }, an().profile || {}); p.halal = true; return p; }
    function builderPage() {
      var p = prof(), c = null; try { c = X.calc(); } catch (e) { c = null; }
      var monthly = c && c.an.plan ? Math.max(0, c.an.plan.toInvest || 0) : 0;
      function seg(name, f, opts) { return '<div class="seg" role="group" aria-label="' + esc(name) + '">' + opts.map(function (o) { return '<button type="button" data-act="a-prof" data-f="' + f + '" data-v="' + o[0] + '" aria-pressed="' + (String(p[f]) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
      var h = '<section class="card"><h2>Profilin ' + tip('Vade ve risk seçimine göre güvenli/orta/riskli dağılımı belgeli bir tablodan gelir; her gruptaki araçlar canlı TEFAS ve Katılım endeksi verisinden, kurallı ölçütlerle seçilir.') + '</h2>' +
        '<div class="prof"><div><div class="label">Vade</div>' + seg('Vade', 'horizon', [['short', 'Kısa (< 2 yıl)'], ['medium', 'Orta (2-5 yıl)'], ['long', 'Uzun (5+ yıl)']]) + '</div>' +
        '<div><div class="label">Risk</div>' + seg('Risk', 'risk', [['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']]) + '</div>' +
        '<div><div class="label">Döviz</div>' + seg('Dolar', 'usd', [['true', 'Dolar bazlı helal ETF dahil'], ['false', 'Yalnız TL araçlar']]) + '</div></div>' +
        '<p>' + pill('ok', '✓ Helal filtresi açık') + ' <span class="hint">Yalnızca Katılım endeksindeki hisseler, TEFAS\'ta İslami (katılım) etiketli fonlar, fiziki altın ve Şer\'i endeks ETF\'leri önerilir. Kripto önerilmez.</span></p>' +
        '<p class="hint">Aylık yatırılabilir tutar (Bütçe\'den, acil fon payı düşülmüş): <b>' + tl(monthly) + '</b> · <a href="#butce">Bütçe →</a></p>' +
        '<button class="btn primary" type="button" data-act="a-build"' + (builder.loading ? ' disabled' : '') + '>' + (builder.loading ? 'Canlı veriden oluşturuluyor…' : (builder.result ? 'Yeniden oluştur' : 'Portföy oluştur')) + '</button></section>';
      if (builder.error) h += '<div class="notice danger">' + esc(builder.error) + '</div>';
      var R = builder.result; if (!R) return h;
      h += '<div class="grid two"><section class="card"><h2>Önerilen dağılım</h2>' + (window.Charts ? window.Charts.donut('a-bmix', { h: 240, label: 'Önerilen dağılım', items: R.blocks.map(function (b) { return { name: b.item.name.split(' — ')[0], value: b.weightBp }; }) }) : '') +
        '<div class="tiers">' + ['safe', 'medium', 'risky'].map(function (k) { return '<span class="tier t-' + k + '">' + C.RISK[k] + ' <b>%' + (R.tiers[k] / 100).toFixed(0) + '</b></span>'; }).join('') + '</div><p class="hint">Veri: ' + esc(R.dataNote || '') + '</p></section>';
      h += '<section class="card"><h2>Geçmiş test ' + tip('Önerilen karışım son 3 yılın fiyatlarıyla (aylık yeniden dengeleme) test edilir. Geçmiş, geleceğin garantisi değildir; aralıklar geçmişte yaşanmış değerlerdir.') + '</h2>';
      var B = builder.bt;
      if (!B) h += '<p class="loading-line">Geçmiş fiyatlar alınıyor…</p>';
      else if (B.error) h += '<p class="muted">' + esc(B.error) + '</p>';
      else {
        h += '<div class="kpis grid"><div class="kpi card"><div class="label">Yıllık getiri (TL)</div><div class="value">%' + pc(B.cagr) + '</div></div><div class="kpi card"><div class="label">Yıllık oynaklık</div><div class="value">%' + pc(B.vol) + '</div></div><div class="kpi card"><div class="label">En büyük düşüş</div><div class="value neg">%' + pc(B.mdd) + '</div></div></div>' +
          '<p>Beklenen aralık (geçmiş 12 aylık dilimler): en kötü <b>%' + pc(B.worst12) + '</b>, en iyi <b>%' + pc(B.best12) + '</b>' + (B.usdCagr != null ? ' · dolar bazında yıllık %' + pc(B.usdCagr) : '') + '</p>' +
          (window.Charts ? window.Charts.area('a-bt', { h: 190, label: 'Geçmiş test değer eğrisi (100 ile başlar)', today: X.today(), series: [{ name: 'Karışım (100 = başlangıç)', data: B.nav.map(function (x) { return { d: x.d, v: Math.round(x.c * 10000) }; }), color: 'brand' }] }) : '') +
          '<p class="hint">' + esc(B.from) + ' → ' + esc(B.to) + ' (' + B.days + ' ortak gün)' + (B.skipped && B.skipped.length ? ' · geçmişi yetersiz olduğu için teste girmeyen: ' + esc(B.skipped.join(', ')) : '') + '. Eğri 100 ile başlayan endekstir (₺ işareti grafiğin ortak biçimindendir).</p>';
      }
      h += '</section></div>';
      h += '<section class="card"><h2>Araçlar ve gerekçeleri</h2><div class="tscroll"><table class="atable"><thead><tr><th>Araç</th><th>Grup</th><th>Pay</th><th>Aylık</th><th class="detail-only">Neden</th></tr></thead><tbody>' + R.blocks.map(function (b) { var mon = M.mulBp(monthly, b.weightBp); return '<tr><td>' + (b.item.key ? '<a href="#analiz/varlik/' + esc(b.item.key) + '">' + esc(b.item.name) + '</a>' : esc(b.item.name)) + '<div class="hint simple-only">' + esc(b.item.why) + '</div></td><td>' + esc(C.RISK[b.tier]) + '</td><td>%' + (b.weightBp / 100).toFixed(1).replace('.', ',') + '</td><td>' + tl(mon) + '</td><td class="hint detail-only">' + esc(b.item.why) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<ul class="ev small">' + R.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
        '<div class="btnrow"><button class="btn primary" type="button" data-act="a-apply">Portföy Yönetimi\'ne hedef olarak uygula</button> <span class="hint">Eksik varlıklar (adet 0) oluşturulur, grup içi hedef payları ve hedeflerin risk yolu (' + esc(PF.GLIDES[R.glide] ? PF.GLIDES[R.glide].label : R.glide) + ') ayarlanır. Önce otomatik yedek alınır.</span></div></section>';
      return h;
    }
    function doBuild() {
      var p = prof();
      builder = { loading: true, result: null, bt: null, error: null }; X.render();
      Promise.all([MD.katilimFunds(), MD.katilimScreen().catch(function () { return { rows: [] }; })]).then(function (r) {
        if (!r[0].items || !r[0].items.length) throw new Error('Katılım fonu listesi alınamadı');
        var R = AN.buildPortfolio(p, { funds: r[0].items, stocks: r[1].rows || [] });
        R.dataNote = 'TEFAS (' + r[0].items.length + ' katılım fonu, ' + when(r[0].at) + ') · Katılım Tüm taraması (' + (r[1].rows || []).length + ' hisse, TradingView ' + when(r[1].at) + ')';
        builder.result = R; builder.loading = false; X.render();
        return backtestFor(R).then(function (bt) { builder.bt = bt; X.render(); });
      }).catch(function (e) { builder.loading = false; builder.error = 'Oluşturulamadı: ' + e.message + ' (canlı veri gerekli; uydurma veriyle portföy kurulmaz).'; X.render(); });
    }
    function backtestFor(R) {
      var items = R.blocks.filter(function (b) { return b.item.key; }), skipped = [];
      return Promise.all(items.map(function (b) { return MD.load(b.item.key).catch(function () { return null; }); }).concat([MD.load('fx:USD').catch(function () { return null; })])).then(function (ss) {
        var usd = ss.pop(), um = {}; if (usd) usd.bars.forEach(function (x) { um[x.d] = x.c; });
        var list = [], w = [];
        ss.forEach(function (s, i) {
          if (!s || s.bars.length < 250) { skipped.push(items[i].item.name.split(' — ')[0]); return; }
          var bars = s.currency === 'USD' ? s.bars.filter(function (x) { return um[x.d]; }).map(function (x) { return { d: x.d, c: x.c * um[x.d] }; }) : s.bars.map(function (x) { return { d: x.d, c: x.c }; });
          list.push(bars.slice(-756)); w.push(items[i].weightBp);
        });
        if (!list.length) return { error: 'Geçmiş fiyat alınamadı.' };
        var bt = AN.backtest(list, w); if (bt.error) return bt;
        bt.skipped = skipped;
        if (usd) { var n0 = bt.nav[0], n1 = bt.nav[bt.nav.length - 1], u0 = um[n0.d], u1 = um[n1.d]; if (u0 && u1) { var days = (Date.parse(n1.d) - Date.parse(n0.d)) / 86400000; if (days > 200) bt.usdCagr = Math.pow((n1.c / u1) / (n0.c / u0), 365 / days) - 1; } }
        return bt;
      });
    }
    function applyBuild() {
      var R = builder.result; if (!R) return;
      var n = R.blocks.filter(function (b) { return b.item.key; }).length;
      if (!confirm('Önerilen dağılım Portföy Yönetimi\'ne uygulansın mı?\n\n• Listede olmayan araçların varlık kaydı (adet 0) oluşturulur (' + n + ' araç).\n• Grup içi hedef payları bu dağılıma göre ayarlanır; aynı gruptaki diğer varlıkların grup içi hedefi 0 olur (satış önerilmez, yeni para bu araçlara yönlenir).\n• Hedeflerin risk yolu "' + (PF.GLIDES[R.glide] ? PF.GLIDES[R.glide].label : R.glide) + '" yapılır.\n\nÖnce otomatik yedek alınır.')) return;
      var go = function () {
        X.mutate(function (s) {
          var byTier = { safe: [], medium: [], risky: [] };
          s.assets = s.assets || [];
          R.blocks.forEach(function (b) {
            if (!b.item.key) return;
            var pk = b.item.priceKey || b.item.key, sym = b.item.symbol || pk.split(':')[1];
            var a = s.assets.find(function (x) { return x.priceKey === pk || keyOfAsset(x) === b.item.key; });
            if (!a) { a = PF.newAssetFromSymbol(sym, b.item.currency || 'TRY', function () { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }); a.name = String(b.item.name).slice(0, 80); s.assets.push(a); }
            a.priceKey = pk; a.cls = b.item.cls; a.risk = b.tier; a.lot = b.item.lot || (b.item.cls === 'katilim_stock' || b.item.cls === 'halal_etf' ? 'whole' : 'fraction'); if (b.item.currency) a.currency = b.item.currency;
            a.halal = { status: 'uygun', note: 'Portföy oluşturucu: ' + (b.item.cls === 'katilim_stock' ? 'Katılım Tüm endeksinde' : b.item.cls === 'halal_etf' ? 'Şer\'i endeks ETF' : b.item.cls === 'gold' ? 'Fiziki/peşin altın' : 'TEFAS İslami (katılım) etiketi'), source: 'Finans Pusulası analiz', date: X.today() };
            byTier[b.tier].push({ a: a, w: b.shareOfTier });
          });
          ['safe', 'medium', 'risky'].forEach(function (k) {
            if (!byTier[k].length) return; var ids = byTier[k].map(function (x) { return x.a.id; });
            s.assets.forEach(function (a) { if ((a.risk || 'medium') === k && ids.indexOf(a.id) < 0 && !a.emergency) a.withinTierBp = 0; });
            var tw = byTier[k].reduce(function (q, x) { return q + x.w; }, 0), acc = 0;
            byTier[k].forEach(function (x, i) { var v = i === byTier[k].length - 1 ? 10000 - acc : Math.round(x.w * 10000 / tw); x.a.withinTierBp = v; acc += v; });
          });
          (s.goals || []).forEach(function (g) { g.glide = R.glide; });
          s.analysis = s.analysis || { watchlist: [], profile: {} }; s.analysis.profile = Object.assign({}, prof());
        }, 'Dağılım Portföy Yönetimi\'ne uygulandı. Dengeleme bu hedeflere göre öneri yapar.');
        location.hash = '#portfoy/dengeleme';
      };
      if (X.snapshot) X.snapshot('Portföy oluşturucu uygulanmadan önce').then(go, go); else go();
    }

    /* ----- Yöntem ve doğrulama ----- */
    function methodPage() {
      var subs = Object.keys(AN.SUB_LABEL).filter(function (k) { return k !== 'halal'; });
      var h = '<section class="card"><h2>Skor ağırlıkları (varlık türüne göre)</h2><div class="tscroll"><table class="mini"><thead><tr><th>Tür</th>' + subs.map(function (k) { return '<th>' + esc(AN.SUB_LABEL[k]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        Object.keys(AN.WEIGHTS).filter(function (k) { return k !== 'import'; }).map(function (k) { return '<tr><td>' + esc(KIND_LABEL[k] || k) + '</td>' + subs.map(function (s) { return '<td>' + (AN.WEIGHTS[k][s] ? '%' + AN.WEIGHTS[k][s] : '—') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="hint">Helal durumu skora katılmaz; "Uygun" olmayan varlıkta alım planı gösterilmez. Eksik alt skorun ağırlığı diğerlerine orantılı dağıtılır ve güven düşer. Portföy sağlık skoru ağırlıkları: ' + Object.keys(AN.HEALTH_W).map(function (k) { return esc(AN.HEALTH_LABEL[k]) + ' ' + AN.HEALTH_W[k]; }).join(' · ') + '.</p></section>';
      h += '<section class="card"><h2>Kurallar</h2><ul class="ev">' +
        '<li><b>Trend</b>: fiyatın SMA20/50/200 ve EMA20\'ye göre yeri, SMA50/200 kesişimi, ADX(14) ≥ 25 ve ±DI, Supertrend(10,3), Ichimoku bulutu ve Tenkan/Kijun, zikzak tepe-dip yapısı, trend çizgileri.</li>' +
        '<li><b>Momentum</b>: RSI(14) bölgeleri, MACD(12,26,9) kesişim/sıfır/histogram, Stokastik RSI(14,14,3,3), 20 günlük değişim, güncel RSI uyumsuzlukları, OBV eğimi.</li>' +
        '<li><b>Risk</b>: 60 günlük yıllık oynaklığın varlık sınıfı tabanına oranı, 52 haftalık zirveden uzaklık, Bollinger genişliği; fonlarda TEFAS risk değeri.</li>' +
        '<li><b>Temel</b> (hisse): F/K, PD/DD, FD/FAVÖK sektör medyanına göre; özsermaye kârlılığı, satış büyümesi, net marj, borç/özsermaye (finans hariç), serbest nakit akışı. <b>Fon kalitesi</b>: kategori içi 1 yıl ve 6 ay getiri sırası, Sharpe/Sortino, dolar ve altına göre getiri, yatırımcı sayısı, para girişi.</li>' +
        '<li><b>Göreli güç</b>: 3 ve 6 aylık getiri farkı (hisse: BIST 100 ve Katılım Tüm; kripto: Bitcoin; altın: dolar). <b>Likidite</b>: 30 günlük ortalama işlem hacmi veya fon büyüklüğü.</li>' +
        '<li><b>Seviyeler</b>: zikzak eşiği ATR tabanlı; bölge = 1×ATR penceresinde kümelenen pivotlar (≥2 dokunuş; ≥3 veya 52 hafta uç = güçlü). Temkinli stop = destek altı − 1×ATR (veya yapısal dip − 0,5×ATR); atak giriş = direnç üstü + 0,2×ATR, stop = direnç altı − 0,5×ATR. R/Ö ilk güçlü hedefe göre; < 1,5 ise "bekle".</li>' +
        '<li><b>Satış kuralı</b>: "Azalt" yalnızca fiyat direnç bölgesindeyken en az iki yorulma kanıtı varsa (negatif uyumsuzluk, RSI aşırı alımdan dönüş, MACD aşağı kesişim, Supertrend dönüşü, onaylı düşüş formasyonu). Direnç kırılmış ve trend güçlüyse "tut, hedefi yükselt, stopu yukarı çek".</li>' +
        '<li><b>Güven</b>: veri uyarıları, yalnız kapanış verisi, kısa geçmiş, eksik alt skor, TradingView farkları ve trend/momentum çelişkisi düşürür. Güven < 35 veya veri hatası → sinyal verilmez.</li></ul></section>';
      h += '<section class="card"><h2>Gösterge doğrulaması (TA-Lib referansı) ' + tip('Gösterge kütüphanemiz, endüstri standardı TA-Lib 0.8.3 ve bağımsız uygulamalarla üretilmiş referans değerlerle (ASELS ve BTC/USDT gerçek verisi, 400+ gün) karşılaştırılır. Düğme testi tarayıcında yeniden çalıştırır.') + '</h2>';
      h += '<button class="btn small" type="button" data-act="a-verify"' + (verifyRun && verifyRun.running ? ' disabled' : '') + '>' + (verifyRun && verifyRun.running ? 'Çalışıyor…' : 'Testi şimdi çalıştır') + '</button>';
      if (verifyRun && verifyRun.error) h += '<p class="muted">' + esc(verifyRun.error) + '</p>';
      if (verifyRun && verifyRun.rows) h += '<p>' + pill(verifyRun.fail ? 'warn' : 'ok', verifyRun.pass + '/' + verifyRun.rows.length + ' gösterge serisi eşleşti') + ' <span class="hint">' + esc(verifyRun.gen) + '</span></p><div class="tscroll"><table class="mini"><thead><tr><th>Seri</th><th>Gösterge</th><th>Nokta</th><th>En büyük göreli fark</th><th></th></tr></thead><tbody>' + verifyRun.rows.map(function (r) { return '<tr><td>' + esc(r.s) + '</td><td>' + esc(r.k) + '</td><td>' + r.n + '</td><td>' + r.max.toExponential(1) + '</td><td>' + (r.ok ? '✓' : '✗') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      h += '</section>';
      h += '<section class="card"><h2>Veri kaynakları</h2><ul class="ev">' +
        '<li><b>BIST hisseleri, BIST 100/30, altın/gümüş ons, USD/EUR-TL, helal ABD ETF\'leri</b>: her iş günü 18:40 ve 10:30 TSİ\'de GitHub Actions ile Yahoo Finance\'tan derlenir (3 yıl günlük), BIST kapanışları İş Yatırım ile karşılaştırılır. Gün içi son fiyat TradingView\'den (BIST 15 dk gecikmeli).</li>' +
        '<li><b>Temel oranlar, sektör medyanları ve Katılım endeksi üyeleri</b> (Katılım Tüm/100/50/30): TradingView tarayıcı.</li>' +
        '<li><b>TEFAS fonları</b>: fon.yourapiservice.com (TEFAS verisi: fiyat geçmişi, getiriler, risk, dağılım, portföy, İslami etiket).</li>' +
        '<li><b>Kripto</b>: Binance (USDT mumları, vadeli fonlama oranı), alternative.me (Korku & Açgözlülük), CoinGecko (arama).</li>' +
        '<li><b>Haberler</b>: GDELT DOC 2.0 (isteğe bağlı; yanıt vermezse gösterilmez).</li>' +
        '<li>Kaynaklar resmî değildir; kesinti olursa veri "alınamadı" diye gösterilir, eski veri yeni gibi sunulmaz.</li></ul></section>';
      return h;
    }
    function runVerify() {
      if (location.protocol === 'file:') { verifyRun = { error: 'Sayfa dosyadan (file://) açıldığı için tarayıcı referans dosyasını okuyamaz; siteyi http(s) üzerinden aç. Birim testleri: node tests/run-tests.js' }; X.render(); return; }
      verifyRun = { running: true }; X.render();
      fetch('tests/fixtures/ta-reference.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (R) {
        var rows = [];
        Object.keys(R.series).forEach(function (sn) {
          var I = R.series[sn].input, f = R.series[sn].ref, m = TA.macd(I.c), bb = TA.bollinger(I.c, 20, 2), ad = TA.adx(I.h, I.l, I.c, 14), sr = TA.stochRsi(I.c, 14, 14, 3, 3), ich = TA.ichimoku(I.h, I.l, I.c), su = TA.supertrend(I.h, I.l, I.c, 10, 3);
          var ours = { SMA20: TA.sma(I.c, 20), EMA20: TA.ema(I.c, 20), EMA50: TA.ema(I.c, 50), RSI14: TA.rsi(I.c, 14), MACD: m.macd, MACDsignal: m.signal, ATR14: TA.atr(I.h, I.l, I.c, 14), BBupper: bb.upper, BBlower: bb.lower, ADX14: ad.adx, PLUS_DI14: ad.pdi, MINUS_DI14: ad.mdi, STOCHRSIfastd: sr.k, OBV: TA.obv(I.c, I.v), CCI20: TA.cci(I.h, I.l, I.c, 20), MFI14: TA.mfi(I.h, I.l, I.c, I.v, 14), ICH_spanA: ich.senkouA, ICH_spanB: ich.senkouB, ST10_3: su.line };
          Object.keys(ours).forEach(function (k) {
            var a = ours[k], b = f[k]; if (!a || !b) return; var mx = 0, n = 0, miss = 0;
            for (var i = 0; i < b.length; i++) { if (b[i] == null) continue; if (a[i] == null) { miss++; continue; } var d = Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])); if (d > mx) mx = d; n++; }
            rows.push({ s: sn, k: k, n: n, max: mx, ok: mx < 1e-6 && miss === 0 && n > 50 });
          });
        });
        verifyRun = { rows: rows, pass: rows.filter(function (r) { return r.ok; }).length, fail: rows.filter(function (r) { return !r.ok; }).length, gen: R.generator }; X.render();
      }).catch(function (e) { verifyRun = { error: 'Referans dosyası okunamadı (' + e.message + '). Sayfa dosyadan (file://) açıldıysa tarayıcı yerel dosya okumayı engeller; siteyi http(s) üzerinden aç. Birim testleri: node tests/run-tests.js' }; X.render(); });
    }

    /* ---------- Ana sayfa kartı ---------- */
    function homeCard() {
      var H = null; try { var inp = healthInput(); H = inp ? AN.health(inp) : null; } catch (e) { console.error(e); }
      var S = sums(), hk = holdings().list.map(function (x) { return x.key; }), wk = (an().watchlist || []).map(function (w) { return w.key; });
      var ks = Object.keys(S).map(function (k) { return S[k]; }).filter(function (x) { return x.total != null && (hk.indexOf(x.key) >= 0 || wk.indexOf(x.key) >= 0); }).sort(function (a, b) { return b.total - a.total; });
      var best = ks[0], worst = ks.length > 1 ? ks[ks.length - 1] : null;
      function nm(x) { return esc(String(x.name).split(' — ')[0]); }
      return '<a class="area card" href="#analiz"><div class="area-h"><span class="area-ic" aria-hidden="true">🔎</span><b>Portföy Analizi</b></div>' +
        '<div class="area-v">' + (H && H.total != null ? '<span class="score big ' + scoreCls(H.total) + '">' + H.total + '</span> <small class="muted">/100 sağlık · ' + H.grade + '</small>' : '<span class="muted">—</span>') + '</div>' +
        '<div class="hint">' + (best ? 'En güçlü: ' + nm(best) + ' (' + best.total + ')' + (worst ? ' · en zayıf: ' + nm(worst) + ' (' + worst.total + ')' : '') : 'Varlık skorları için Analiz\'e gir') + '</div>' +
        '<div class="area-f">' + (H && H.fixes.length ? pill('warn', H.fixes.length + ' iyileştirme önerisi') : H ? pill('ok', 'Belirgin sorun yok') : '') + '</div></a>';
    }

    /* ---------- Olaylar ---------- */
    function calcCorr() {
      var hl = holdings().list.filter(function (x) { return x.key; }); if (hl.length < 2) { X.toast('Korelasyon için piyasa verisi olan en az iki varlık gerekli.'); return; }
      corrBusy = true; X.render();
      Promise.all(hl.map(function (x) { return MD.load(x.key).catch(function () { return null; }); }).concat([MD.load('fx:USD').catch(function () { return null; })])).then(function (ss) {
        var usd = ss.pop(), um = {}; if (usd) usd.bars.forEach(function (b) { um[b.d] = b.c; });
        var list = [], w = [];
        ss.forEach(function (s, i) { if (!s || s.bars.length < 60) return; list.push(s.currency === 'USD' ? s.bars.filter(function (b) { return um[b.d]; }).map(function (b) { return { d: b.d, c: b.c * um[b.d] }; }) : s.bars); w.push(hl[i].value); });
        var r = list.length >= 2 ? AN.portfolioRisk(list, w) : { error: 'En az iki varlığın fiyat geçmişi gerekli' };
        r.used = list.length; r.total = hl.length; corr = r; corrBusy = false; X.render();
      }, function (e) { corr = { error: e.message }; corrBusy = false; X.render(); });
    }
    function bulkAnalyze() {
      var hl = holdings().list.filter(function (x) { return x.key; }), seen = {}; hl = hl.filter(function (x) { if (seen[x.key]) return false; seen[x.key] = 1; return true; });
      bulk = { running: true, done: 0, total: hl.length, errors: [] }; X.render();
      var i = 0; (function next() { if (i >= hl.length) { bulk.running = false; X.render(); return; } var x = hl[i++]; runAnalysis(x.key).then(function () { bulk.done++; X.render(); next(); }, function (e) { bulk.done++; bulk.errors.push(x.name + ': ' + e.message); X.render(); next(); }); })();
    }
    function contextText(A) {
      var p = A.plans[cur.view.lens] || A.plans.conservative;
      return 'Analiz bağlamı (' + when(A.at) + '): ' + A.name + ' (' + A.key + '), fiyat ' + fp(A.price) + ' ' + (A.currency || '') + ', skor ' + A.total + '/100, güven ' + A.confLabel + ', durum: ' + A.stance.label + '. Alt skorlar: ' + Object.keys(AN.WEIGHTS[A.kind] || {}).map(function (k) { return AN.SUB_LABEL[k] + ' ' + (A.scores[k] ? A.scores[k].score : '—'); }).join(', ') +
        '. Destekler: ' + A.zones.filter(function (z) { return z.hi < A.price; }).slice(-2).map(function (z) { return fp(z.lo) + '-' + fp(z.hi); }).join(', ') + '; dirençler: ' + A.zones.filter(function (z) { return z.lo > A.price; }).slice(0, 2).map(function (z) { return fp(z.lo) + '-' + fp(z.hi); }).join(', ') +
        (p ? '. Plan: giriş ' + fp(p.entryLo) + '-' + fp(p.entryHi) + ', stop ' + fp(p.stop) + ', hedefler ' + p.targets.map(function (t) { return fp(t.p); }).join('/') + ', R/Ö ' + (p.rr != null ? p.rr.toFixed(2) : '—') : '') + '. Helal: ' + A.ctx.halal.label + '.';
    }
    function actions(t) {
      return {
        'a-open': function () { search.results = null; open(t.dataset.key, { symbol: t.dataset.sym }); },
        'a-refresh': function () { if (cur.key) { delete cacheA[cur.key]; open(cur.key); } },
        'a-watch': function () {
          var A = cacheA[cur.key]; if (!A) return;
          X.mutate(function (s) { s.analysis = s.analysis || { watchlist: [], profile: {} }; var wl = s.analysis.watchlist = s.analysis.watchlist || []; var i = wl.findIndex(function (w) { return w.key === A.key; }); if (i >= 0) wl.splice(i, 1); else if (wl.length < 50) wl.push({ key: A.key, name: String(A.name).slice(0, 80), addedAt: X.today() }); }, 'İzleme listesi güncellendi.');
        },
        'a-ask': function () { var A = cacheA[cur.key]; if (!A) return; window.__analysisContext = contextText(A); location.hash = '#asistan'; setTimeout(function () { var i = document.getElementById('chat-in'); if (i) { i.value = A.name.split(' — ')[0] + ' için yaptığın analizi değerlendir: son haberler ve riskler neler, seviyeler mantıklı mı?'; i.focus(); } }, 250); },
        'a-lens': function () { cur.view.lens = t.dataset.v; X.render(); },
        'a-range': function () { cur.view.range = t.dataset.v; X.render(); },
        'a-lower': function () { cur.view.lower = t.dataset.v; X.render(); },
        'a-ov': function () { cur.view.overlays[t.dataset.v] = !cur.view.overlays[t.dataset.v]; X.render(); },
        'a-news': function () { var A = cacheA[cur.key]; if (!A) return; var k = A.key; newsBy[k] = { loading: true }; X.render(); MD.news(newsQuery(A)).then(function (n) { newsBy[k] = n; X.render(); }, function (e) { newsBy[k] = { error: e.message }; X.render(); }); },
        'a-prof': function () { var f = t.dataset.f, v = t.dataset.v; X.mutate(function (s) { s.analysis = s.analysis || { watchlist: [], profile: {} }; s.analysis.profile = s.analysis.profile || {}; s.analysis.profile[f] = v === 'true' ? true : v === 'false' ? false : v; }); },
        'a-build': doBuild, 'a-apply': applyBuild, 'a-verify': runVerify, 'a-corr': calcCorr, 'a-bulk': bulkAnalyze
      };
    }
    function onSubmit(e) {
      if (e.target.id === 'a-search') {
        e.preventDefault(); var q = document.getElementById('a-q').value.trim(); search.q = q; if (!q) return true;
        search.loading = true; search.results = null; X.render();
        MD.resolve(q).then(function (r) { search.loading = false; if (r.length === 1) { search.results = null; open(r[0].key, { symbol: r[0].symbol }); } else { search.results = r; X.render(); } }, function (err) { search.loading = false; search.results = []; X.toast('Arama yapılamadı: ' + err.message); X.render(); });
        return true;
      }
      if (e.target.id === 'a-imp') {
        e.preventDefault();
        try {
          var name = document.getElementById('a-imp-n').value.trim(), kind = document.getElementById('a-imp-k').value, r = MD.parseOhlcText(document.getElementById('a-imp-t').value);
          if (r.bars.length < 30) throw new Error('En az 30 satır gerekli (' + r.bars.length + ' okundu)');
          var id = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || ('veri' + Date.now()), im = imports();
          im[id] = { name: name, kind: kind, bars: r.bars, closeOnly: r.closeOnly, at: new Date().toISOString(), skipped: r.skipped };
          try { localStorage.setItem(IMP_KEY, JSON.stringify(im)); } catch (e2) { throw new Error('Tarayıcı depolaması dolu'); }
          X.toast(r.bars.length + ' satır yüklendi' + (r.skipped ? ', ' + r.skipped + ' satır atlandı' : '') + '.');
          delete cacheA['imp:' + id]; open('imp:' + id);
        } catch (err) { X.toast('Yüklenemedi: ' + err.message); }
        return true;
      }
      return false;
    }
    function afterRender() {
      // Canlı yenileme: varlık sayfası açıkken 60 sn'de bir son fiyat (TradingView/Binance) yenilenir; sekme gizliyse beklenir
      clearTimeout(liveTimer);
      if (X.tab() !== 'analiz' || X.sub() !== 'varlik' || !cur.key || cur.loading) return;
      var A = cacheA[cur.key]; if (!A || !(A.series.tvSymbol || A.kind === 'crypto')) return;
      liveTimer = setTimeout(function () {
        if (cacheA[cur.key] !== A || X.tab() !== 'analiz') return;
        if (document.hidden) return afterRender();
        runAnalysis(cur.key).then(function () { if (X.tab() === 'analiz' && X.sub() === 'varlik' && !document.querySelector('.a-chart :focus')) X.render(); }, function () { afterRender(); });
      }, 60000);
    }
    return { render: render, homeCard: homeCard, actions: actions, onSubmit: onSubmit, afterRender: afterRender, keyOfAsset: keyOfAsset, halalFor: halalFor, open: open, _cache: cacheA, _sums: sums };
  };
})();
