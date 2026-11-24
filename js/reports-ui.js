/* reports-ui.js — "Raporlar" sayfası (v8.5): seans raporları (özet + varlık sayfaları + yazdır/PDF), zarar durdur (stop) yönetimi ve uygulama içi stop kontrolü.
 * Hesaplar js/report.js, js/stops.js, js/sessions.js'te (testli; GitHub Actions'ta aynı kod). Bu dosya yalnızca gösterir, kullanıcı eylemini uygular.
 * Rapor kaynakları: (1) arka plan kişisel raporları (PORTFOLIO_KEY kuruluysa; bg/reports.enc.json, bu cihazdaki anahtarla açılır), (2) yoksa bu cihazda,
 * aynı kodla, son rapor saati için anında üretilen rapor. Kişisel rapor cihaz dışına düz metin çıkmaz. */
(function () {
  'use strict';
  window.ReportsUI = function (X) {
    var R = window.Report, SS = window.Sessions, ST = window.Stops, BG = window.BgWatch, PF = window.Portfolio, MD = window.MData, AN = window.Analysis, SN = window.Snap, N = window.News, HD = window.HubData, esc = X.esc, tip = X.tip;
    var RAW = 'https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/', NOTIFY_KEY = 'finans-pusulasi:uyari-bildirim';
    var cache = {}, busy = {}, errs = {}, srv = { tried: false, items: [], err: null, at: 0, on: false }, pubIx = null, sugg = {}, sbusy = {}, stopLast = {}, stopTimer = 0, edit = null;

    /* ---------- yardımcılar ---------- */
    function st() { return X.state(); }
    function num(x) { return typeof x === 'number' && isFinite(x); }
    function fp(x) { return ST.fmtP(x); }
    function pc(x, d) { return R.pc(x, d); }
    function cls(x) { return !num(x) ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : ''; }
    function when(iso) { var t = Date.parse(iso); return isFinite(t) ? SS.fmtTsiFull(t) + ' TSİ' : '—'; }
    function dl(ymd) { return ymd ? ymd.slice(8, 10) + '.' + ymd.slice(5, 7) + '.' + ymd.slice(0, 4) : '—'; }
    function curSym(c) { return c === 'USD' ? '$' : c === 'EUR' ? '€' : '₺'; }
    function heldMarkets() { try { return R.marketsHeld(BG, st(), X.today()); } catch (e) { return {}; } }
    function sideTR(s) { return s === 'buy' ? 'Alış' : s === 'sell' ? 'Satış' : s; }
    function light(c) { return '<span class="rp-light rp-' + c + '" aria-hidden="true"></span>'; }
    function holdingsAll() { var out = []; ['bist', 'us', 'crypto'].forEach(function (m) { try { out = out.concat(R.holdingsFor(BG, PF, st(), X.today(), m).map(function (h) { h.market = m; return h; })); } catch (e) { /* */ } }); return out; }
    function assetById(id) { return (st().assets || []).filter(function (a) { return a.id === id; })[0]; }
    function priceOfAsset(a) { var pr = PF.currentPrice(st(), a); return pr ? { p: pr.p / 1e6, d: pr.d, src: pr.src, fromTrade: pr.fromTrade } : null; }

    /* ---------- arka plan (şifreli) raporları ---------- */
    function loadServer(force) {
      if (srv.loading || (srv.tried && !force && Date.now() - srv.at < 5 * 60000)) return Promise.resolve(srv);
      srv.loading = true;
      return window.Store.getSecret('bgwatch').then(function (cfg) {
        if (!cfg || !cfg.on || !cfg.key) { srv.on = false; return null; }
        srv.on = true;
        return MD.fetchJson(RAW + 'bg/reports.enc.json?t=' + Date.now(), { timeout: 20000 }).then(function (env) {
          if (env.kid !== cfg.kid) { srv.err = 'Arka plan raporları başka bir anahtarla şifrelenmiş (Actions sırrı ile bu cihazdaki anahtar farklı).'; return null; }
          return BG.open(BG.unb64u(cfg.key), env).then(function (o) { srv.items = (o && o.items) || []; srv.err = null; srv.items.forEach(function (r) { cache[r.id] = cache[r.id] && cache[r.id].origin === 'app' && Date.parse(cache[r.id].generatedAt) > Date.parse(r.generatedAt) ? cache[r.id] : r; }); });
        }, function (e) { if (e.status !== 404) srv.err = 'Arka plan raporları okunamadı: ' + e.message; });
      }).catch(function (e) { srv.err = e.message; }).then(function () { srv.tried = true; srv.loading = false; srv.at = Date.now(); return srv; });
    }
    function loadPublicIndex() { if (pubIx) return Promise.resolve(pubIx); return MD.fetchJson(RAW + 'reports/index.json?t=' + Math.floor(Date.now() / 300000), { timeout: 15000 }).then(function (j) { pubIx = j; return j; }, function () { pubIx = { items: [] }; return pubIx; }); }

    /* ---------- bu cihazda üretim ---------- */
    function generate(slot) {
      var id = slot.id; if (busy[id]) return; busy[id] = true; errs[id] = null; X.render();
      var now = Date.now(), s = st(), today = X.today();
      HD.load().catch(function () { return HD.get() || {}; }).then(function (hub) {
        hub = hub || {};
        var hold = R.holdingsFor(BG, PF, s, today, slot.market), allHold = BG.holdingsOf(BG.calcOf(s, today, today.slice(0, 7)));
        var gaps = []; ['macro', 'calendar', 'feed'].forEach(function (k) { if (!hub[k]) gaps.push('Veri dosyası alınamadı: ' + k); else if (hub.stale && hub.stale[k]) gaps.push(k + ' verisi güncel değil (son başarılı kopya)'); });
        return BG.kapItems(MD, allHold).catch(function () { return []; }).then(function (kap) {
          var news = N.process(((hub.feed && hub.feed.items) || []).concat(kap), allHold, now);
          return R.generate({ MD: MD, AN: AN, SN: SN, now: now }, { slot: slot, nowMs: now, holdings: hold, news: news, calendar: hub.calendar, scenarios: hub.scenarios, probs: hub.probs, macro: hub.macro, alerts: hub.alerts, gaps: gaps, feedAt: hub.feed && hub.feed.generatedAt, origin: 'app' });
        });
      }).then(function (rep) { cache[id] = rep; busy[id] = false; X.render(); }, function (e) { busy[id] = false; errs[id] = e.message || String(e); X.render(); });
    }

    /* ---------- sayfa ---------- */
    function render() {
      var sub = decodeURIComponent(X.sub() || ''), h = '<h1>Raporlar</h1>' + X.subtabs('raporlar', [['', 'Son raporlar'], ['stop', 'Zarar durdur (stop)'], ['saatler', 'Rapor saatleri ve kurulum']]);
      if (!srv.tried) loadServer().then(function () { if (X.tab() === 'raporlar') X.render(); });
      if (sub === 'stop') return h + renderStops();
      if (sub === 'saatler') return h + renderSchedule();
      var slot = SS.parseId(sub);
      if (slot) return h + renderReportFor(slot);
      return h + renderLatest(/^(bist|us|crypto)$/.test(sub) ? sub : null);
    }
    function renderLatest(pick) {
      var held = heldMarkets(), list = ['bist', 'us', 'crypto'].filter(function (m) { return held[m]; }), now = Date.now();
      if (!list.length) return '<div class="notice info">Portföyünde alım-satımla izlenen piyasa varlığı yok. Rapor, Portföy Yönetimi\'ne işlem girdiğin varlıklar için üretilir.</div>' + renderPublicList();
      var m = pick && held[pick] ? pick : list[0], h = '<div class="row rp-mk" role="group" aria-label="Piyasa seçimi">';
      list.forEach(function (k) { var ms = SS.marketState(k, now), ls = SS.latestSlot(k, now), ns = SS.nextSlot(k, now); h += '<a class="btn' + (k === m ? ' primary' : '') + '" href="#raporlar/' + k + '" aria-pressed="' + (k === m) + '"><b>' + esc(SS.MARKETS[k].short) + '</b> <span class="hint">' + esc(ms.label) + (ns ? ' · sonraki: ' + esc(ns.label.toLowerCase()) + ' ' + esc(ns.tsi) + ' TSİ' : '') + '</span></a>'; });
      h += '</div>';
      var ls = SS.latestSlot(m, now);
      if (!ls) return h + '<p class="muted">Bu piyasa için rapor saati bulunamadı.</p>';
      return h + renderReportFor(ls) + renderArchive(m);
    }
    function renderArchive(m) {
      var items = Object.keys(cache).map(function (k) { return cache[k]; }).filter(function (r) { return r.market === m; }).sort(function (a, b) { return a.slotAt < b.slotAt ? 1 : -1; });
      if (items.length < 2) return '';
      return '<section class="card no-print"><h2>Önceki raporlar</h2><ul class="rp-arch">' + items.slice(0, 12).map(function (r) { return '<li><a href="#raporlar/' + esc(r.id) + '">' + esc(dl(r.ymd) + ' · ' + r.slotLabel) + '</a> <span class="hint">' + (r.origin === 'actions' ? 'arka planda üretildi' : 'bu cihazda üretildi') + ' · ' + esc(when(r.generatedAt)) + '</span></li>'; }).join('') + '</ul></section>';
    }
    function renderPublicList() {
      if (!pubIx) { loadPublicIndex().then(function () { if (X.tab() === 'raporlar') X.render(); }); return ''; }
      var it = (pubIx.items || []).filter(function (x) { return !x.skipped; }).slice(0, 6); if (!it.length) return '';
      return '<section class="card"><h2>Piyasa raporları (genel)</h2><ul class="rp-arch">' + it.map(function (x) { return '<li><b>' + esc(x.title) + '</b> · ' + esc(dl(x.ymd)) + ' <span class="hint">' + esc(x.line1 || '') + '</span></li>'; }).join('') + '</ul></section>';
    }
    function renderReportFor(slot) {
      var rep = cache[slot.id];
      if (!rep && !busy[slot.id] && !errs[slot.id] && srv.tried) setTimeout(function () { generate(slot); }, 0);
      if (!rep) {
        if (errs[slot.id]) return '<div class="notice danger">Rapor üretilemedi: ' + esc(errs[slot.id]) + ' <button type="button" class="btn small" data-act="rp-gen" data-id="' + esc(slot.id) + '">Yeniden dene</button></div>';
        return '<div class="card rp-wait"><span class="spinner"></span> ' + esc(SS.MARKETS[slot.market].short + ' ' + slot.label.toLowerCase()) + ' raporu hazırlanıyor… Gerçek piyasa verisi, analiz ve haberler alınıyor (birkaç saniye).</div>';
      }
      return reportHtml(rep);
    }

    /* ---------- rapor görünümü ---------- */
    function reportHtml(rep) {
      var s = rep.summary, h = '<article class="rp" id="rp-doc">';
      var gen = rep.origin === 'actions' ? 'Arka planda (GitHub Actions) üretildi' : 'Bu cihazda üretildi';
      h += '<header class="card rp-head"><div class="rp-kicker">' + esc(rep.marketLabel) + ' · ' + esc(rep.slotLabel) + (rep.half ? ' · yarım gün' : '') + '</div><h2>' + esc(s.headline.title) + ' — ' + esc(dl(rep.ymd)) + '</h2>' +
        '<p class="rp-focus">' + esc(rep.focus) + '</p><p class="hint">Rapor saati ' + esc(when(rep.slotAt)) + ' · ' + gen + ' ' + esc(when(rep.generatedAt)) + (rep.dayNote ? ' · ' + esc(rep.dayNote) : '') + '</p>' +
        '<div class="row no-print"><button type="button" class="btn" data-act="rp-print">PDF indir / Yazdır</button> <button type="button" class="btn" data-act="rp-gen" data-id="' + esc(rep.id) + '">Şimdi yenile</button> <a class="btn" href="#raporlar/stop">Stopları yönet</a></div></header>';
      // 1. sayfa: özet
      h += '<section class="card rp-sum"><h2>Özet</h2><div class="rp-kpis">' +
        kpi('Bugün (bu grup)', num(s.dayTL) ? '<span class="' + cls(s.dayTL) + '">' + (s.dayTL >= 0 ? '+' : '−') + X.tl(Math.abs(s.dayTL)) + '</span>' : '—', num(s.dayPct) ? '<span class="' + cls(s.dayPct) + '">' + pc(s.dayPct) + '</span>' + (num(s.coverage) && s.coverage < 0.999 ? ' · kapsam %' + Math.round(s.coverage * 100) : '') : 'veri yok') +
        kpi('Grup değeri', num(s.totalTL) ? X.tl(s.totalTL) : '—', (rep.assets || []).length + ' varlık') +
        kpi('En iyi', s.winners[0] ? esc(s.winners[0].name) : '—', s.winners[0] ? '<span class="pos">' + pc(s.winners[0].chg) + '</span>' : 'yükselen yok') +
        kpi('En zayıf', s.losers[0] ? esc(s.losers[0].name) : '—', s.losers[0] ? '<span class="neg">' + pc(s.losers[0].chg) + '</span>' : 'düşen yok') + '</div>';
      h += '<div class="rp-lights">' + s.lights.map(function (l) { return '<div class="rp-li">' + light(l.c) + '<div><b>' + esc(l.label) + '</b><div class="hint">' + esc(l.text) + '</div></div></div>'; }).join('') + '</div>';
      h += '<div class="grid2 rp-charts">';
      if (s.moves && s.moves.length) h += '<div>' + window.Charts.custom('rp-moves-' + rep.id, Math.max(140, 34 * s.moves.length + 40), 'Varlıkların günlük değişimi (%)', function (t) {
        var mv = s.moves.slice().reverse();
        return { animation: !window.Charts.reduced(), grid: { left: 70, right: 46, top: 8, bottom: 20 }, tooltip: window.Charts.tooltip(t, { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: function (v) { return (v >= 0 ? '+%' : '−%') + Math.abs(v).toFixed(2).replace('.', ','); } }),
          xAxis: { type: 'value', axisLabel: { color: t.muted, formatter: function (v) { return '%' + v; } }, splitLine: { lineStyle: { color: t.line } } }, yAxis: { type: 'category', data: mv.map(function (x) { return x.name; }), axisLabel: { color: t.ink } },
          series: [{ type: 'bar', barMaxWidth: 22, data: mv.map(function (x) { return { value: +(x.chg * 100).toFixed(2), itemStyle: { color: x.chg >= 0 ? t.safe : t.risky } }; }), label: { show: true, position: 'right', color: t.ink, formatter: function (p) { return (p.value >= 0 ? '+' : '') + String(p.value).replace('.', ','); } } }] };
      }) + '<p class="hint">Günlük değişim — ' + (rep.slot === 'pre' ? 'önceki işlem günü' : 'bugün') + '. Kaynak ve saat varlık sayfalarında.</p></div>';
      if (s.alloc && s.alloc.length) h += '<div>' + window.Charts.custom('rp-alloc-' + rep.id, 220, 'Bu raporun varlık dağılımı', function (t) {
        return { animation: !window.Charts.reduced(), tooltip: window.Charts.tooltip(t, { trigger: 'item', valueFormatter: function (v) { return window.Money.format(v, { noDecimals: true }); } }), legend: { bottom: 0, type: 'scroll', textStyle: { color: t.muted, fontSize: 11 } },
          series: [{ type: 'pie', radius: ['45%', '70%'], center: ['50%', '44%'], label: { show: false }, data: s.alloc.map(function (x, i) { return { name: x.name, value: x.v, itemStyle: { color: t.pal[i % t.pal.length] } }; }) }] };
      }) + '</div>';
      h += '</div>';
      if (rep.overview && rep.overview.length) h += '<h3>Piyasa göstergeleri</h3><div class="tablewrap"><table class="stack"><thead><tr><th>Gösterge</th><th class="r">Son</th><th class="r">Günlük</th><th class="r">5 gün</th><th>Veri saati</th></tr></thead><tbody>' + rep.overview.map(function (o) { return '<tr><td>' + esc(o.label) + '</td><td class="r num">' + esc(String(o.last).replace('.', ',')) + '</td><td class="r num ' + cls(o.chg1d) + '">' + pc(o.chg1d) + '</td><td class="r num ' + cls(o.chg5d) + '">' + pc(o.chg5d, 1) + '</td><td class="hint">' + esc(when(o.asOf)) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="hint">Endeks, VIX, faiz gibi göstergeler yalnızca piyasayı okumak içindir (yatırım önerisi değildir). Kaynak: Yahoo Finance (resmî olmayan).</p>';
      if (s.keyLevels && s.keyLevels.length) h += '<h3>Kilit seviyeler</h3><div class="tablewrap"><table class="stack"><thead><tr><th>Varlık</th><th class="r">Fiyat</th><th class="r">Yakın destek</th><th class="r">Yakın direnç</th><th class="r">Stop</th></tr></thead><tbody>' + s.keyLevels.map(function (k) { return '<tr><td>' + esc(k.name) + '</td><td class="r num">' + fp(k.price) + '</td><td class="r num">' + (num(k.sup) ? fp(k.sup) + ' <span class="hint">(' + pc(k.supD, 1) + ')</span>' : '—') + '</td><td class="r num">' + (num(k.res) ? fp(k.res) + ' <span class="hint">(' + pc(k.resD, 1) + ')</span>' : '—') + '</td><td class="r num">' + (num(k.stop) ? fp(k.stop) : '<span class="muted">yok</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      h += '<h3>Bugünün olayları</h3>' + (s.events && s.events.length ? '<ul class="rp-ev">' + s.events.map(evLi).join('') + '</ul>' : '<p class="muted">Önümüzdeki 24 saatte bu piyasayı ilgilendiren yüksek/orta etkili olay yok (kaynak: ekonomik takvim).</p>');
      if (rep.publicNews && rep.publicNews.length) h += '<h3>Öne çıkan başlıklar</h3><ul class="rp-news">' + rep.publicNews.map(newsLi).join('') + '</ul>';
      h += '</section>';
      // varlık sayfaları
      (rep.assets || []).forEach(function (a, i) { h += assetHtml(rep, a, i); });
      h += '<section class="card rp-end"><h2>Veri boşlukları</h2>' + (rep.gaps.length ? '<ul>' + rep.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' : '<p class="muted">Bu raporda eksik veri yok.</p>') +
        '<h3>Kaynaklar</h3><ul class="rp-src">' + (rep.sources || []).map(function (x) { return '<li>' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.label) + '</a>' : esc(x.label)) + (x.at ? ' <span class="hint">' + esc(when(x.at)) + '</span>' : '') + '</li>'; }).join('') + '</ul><p class="hint">' + esc(rep.disclaimer) + '</p></section>';
      return h + '</article>';
    }
    function kpi(l, v, sub) { return '<div class="rp-kpi"><div class="label">' + esc(l) + '</div><div class="value">' + v + '</div><div class="sub">' + sub + '</div></div>'; }
    function evLi(e) { return '<li><b>' + esc((e.date ? dl(e.date).slice(0, 5) : '') + (e.time ? ' ' + e.time : '')) + '</b> ' + esc(e.title) + ' <span class="sev sev-' + (e.impact === 'high' ? 'high' : 'medium') + '">' + (e.impact === 'high' ? 'yüksek' : 'orta') + '</span>' + (e.forecast != null || e.previous != null ? ' <span class="hint">beklenti ' + esc(e.forecast == null ? '—' : e.forecast) + ' · önceki ' + esc(e.previous == null ? '—' : e.previous) + (e.actual != null ? ' · açıklanan ' + esc(e.actual) : '') + '</span>' : '') + (e.src ? ' <span class="hint">(' + esc(e.src) + ')</span>' : '') + '</li>'; }
    function newsLi(n) { return '<li><a href="' + esc(n.u) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a> <span class="hint">' + esc(n.s || '') + ' · ' + esc(when(n.a)) + '</span></li>'; }
    function assetHtml(rep, a, i) {
      var P = a.px, cs = curSym(a.currency), h = '<section class="card rp-asset" id="rp-a-' + i + '"><div class="rp-ah"><h2>' + esc(a.sym || a.name) + ' <span class="hint">' + esc(a.name) + '</span></h2>';
      if (!a.ok) return h + '</div><div class="notice warn">Bu varlık için piyasa verisi alınamadı: ' + esc(a.error || '') + '. Rakam uydurulmadı.</div>' + notesHtml(a) + '</section>';
      h += '<div class="rp-price"><b>' + fp(P.price) + ' ' + cs + '</b> <span class="' + cls(P.chg) + '">' + pc(P.chg) + '</span><div class="hint">' + esc(P.kind === 'canlı' ? 'Canlı/gecikmeli fiyat' : 'Kapanış') + ' · ' + esc(P.src) + ' · ' + esc(P.kind === 'canlı' ? when(P.asOf) : dl(P.day)) + '</div></div></div>';
      if (a.liveNote) h += '<p class="hint">' + esc(a.liveNote) + '</p>';
      h += '<div class="rp-meta">' + [num(a.share) ? 'Grupta pay %' + (a.share * 100).toFixed(1).replace('.', ',') : null, num(a.valueTL) ? 'Değer ' + X.tl(a.valueTL) : null, num(P.w1) ? '1 hafta ' + pc(P.w1, 1) : null, num(P.m1) ? '1 ay ' + pc(P.m1, 1) : null, num(P.fromHi) ? '52h zirveye ' + pc(P.fromHi, 1) : null].filter(Boolean).map(esc).join(' · ') + '</div>';
      h += '<div class="rp-story"><h3>' + esc(rep.slotLabel) + ': ' + esc(rep.focus.toLowerCase()) + '</h3>' + a.story.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>';
      if (a.spark && a.spark.length > 5) h += window.Charts.custom('rp-ch-' + rep.id + '-' + i, 200, a.name + ' son 60 gün kapanış, destek/direnç ve stop', function (t) {
        var ml = []; (a.levels.support || []).slice(0, 1).forEach(function (z) { ml.push({ yAxis: z.hi, name: 'Destek', lineStyle: { color: t.safe, type: 'dashed' } }); }); (a.levels.resistance || []).slice(0, 1).forEach(function (z) { ml.push({ yAxis: z.lo, name: 'Direnç', lineStyle: { color: t.medium, type: 'dashed' } }); });
        if (a.stop && num(a.stop.eff)) ml.push({ yAxis: a.stop.eff, name: 'Stop', lineStyle: { color: t.risky, type: 'solid', width: 2 } });
        var vals = a.spark.map(function (p) { return p[1]; }).concat(ml.map(function (m) { return m.yAxis; })), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.06;
        return { animation: !window.Charts.reduced(), grid: { left: 54, right: 70, top: 10, bottom: 24 }, tooltip: window.Charts.tooltip(t, { trigger: 'axis', valueFormatter: function (v) { return fp(v); } }),
          xAxis: { type: 'category', data: a.spark.map(function (p) { return p[0].slice(5); }), axisLabel: { color: t.muted, fontSize: 10 }, axisLine: { lineStyle: { color: t.line } } }, yAxis: { type: 'value', min: lo - pad, max: hi + pad, axisLabel: { color: t.muted, formatter: function (v) { return fp(v); } }, splitLine: { lineStyle: { color: t.line } } },
          series: [{ type: 'line', showSymbol: false, data: a.spark.map(function (p) { return p[1]; }), lineStyle: { width: 2, color: t.brand }, markLine: { symbol: 'none', label: { formatter: function (p) { return p.name + ' ' + fp(p.value); }, color: t.ink, fontSize: 10 }, data: ml } }] };
      });
      h += '<div class="grid2"><div><h3>Teknik görünüm</h3><ul class="rp-tech">' + a.tech.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div><div><h3>Destek / direnç</h3>' + levelsHtml(a) + '</div></div>';
      h += '<div class="rp-assess rp-' + a.assess.kind + '"><h3>Analize dayalı değerlendirme — ' + esc(a.assess.title) + '</h3>' + a.assess.lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '<p class="hint">Analiz: ' + esc(when(a.src.analysisAt)) + '. Satış emri değildir; "gözden geçir" ancak taze tam analizden sonra senin kararındır.</p></div>';
      h += stopHtml(a);
      var sc = (a.techScen || []), es = (a.scen || []);
      if (sc.length || es.length) {
        h += '<h3>Senaryolar</h3>';
        if (sc.length) h += '<div class="tablewrap"><table class="stack"><thead><tr><th>Senaryo</th><th>Koşul</th><th>Sonuç</th><th>Olasılık</th></tr></thead><tbody>' + sc.map(function (x) { return '<tr><td><b>' + esc(x.label) + '</b></td><td>' + esc(x.cond) + '</td><td>' + esc(x.then) + '</td><td class="hint">kaynak yok — sayı verilmez</td></tr>'; }).join('') + '</tbody></table></div>';
        es.forEach(function (e) { h += '<p><b>' + esc(e.label || e.title) + '</b> · ' + esc(dl(e.date)) + (e.time ? ' ' + esc(e.time) : '') + ': ' + e.scenarios.map(function (x) { return esc(x.label) + ' → ' + (x.dir === 'up' ? '↑' : x.dir === 'down' ? '↓' : x.dir === 'mixed' ? '↕' : '—') + (num(x.prob) ? ' (%' + Math.round(x.prob * 100) + (e.source ? ', ' + esc(e.source) : '') + ')' : ''); }).join(' · ') + (e.probsNote && !e.scenarios.some(function (x) { return num(x.prob); }) ? ' <span class="hint">' + esc(e.probsNote) + '</span>' : '') + '</p>'; });
      }
      h += '<div class="grid2"><div><h3>Haber ve KAP</h3>' + (a.kap.length || a.news.length ? '<ul class="rp-news">' + a.kap.concat(a.news).map(function (n) { return '<li>' + (n.kap ? '<span class="sev sev-medium">KAP</span> ' : '') + '<a href="' + esc(n.u) + '" target="_blank" rel="noopener">' + esc(n.t) + '</a> <span class="hint">' + esc(n.s || '') + ' · ' + esc(when(n.a)) + '</span></li>'; }).join('') + '</ul>' : '<p class="muted">Son ' + (rep.slot === 'pre' ? '36' : '24') + ' saatte doğrudan ilgili haber/KAP yok.</p>') +
        '<p class="hint">Yatırımcı/yabancı takas akışı: ücretsiz ve güvenilir kaynak yok — gösterilmiyor.</p></div><div><h3>Takvim</h3>' + (a.events.length ? '<ul class="rp-ev">' + a.events.slice(0, 5).map(evLi).join('') + '</ul>' : '<p class="muted">3 gün içinde ilgili olay yok.</p>') + '</div></div>';
      h += notesHtml(a);
      h += '<p class="rp-halal">' + light(a.halal.status === 'uygun' ? 'green' : a.halal.status === 'uygun_degil' ? 'red' : 'amber') + ' <b>Helal notu:</b> ' + esc(a.halal.text) + '</p>';
      h += '<p class="hint">Veri: ' + esc((a.src.hist && a.src.hist.label) || '—') + (a.src.hist && a.src.hist.at ? ' (' + esc(when(a.src.hist.at)) + ')' : '') + (a.src.live ? ' · canlı: ' + esc(a.src.live.source || '') : '') + '</p>';
      return h + '</section>';
    }
    function levelsHtml(a) {
      var L = a.levels, rows = [];
      L.resistance.slice().reverse().forEach(function (z) { rows.push('<tr><td>Direnç</td><td class="r num">' + fp(z.lo) + '–' + fp(z.hi) + '</td><td class="r num">' + pc(z.d, 1) + '</td><td class="hint">' + (z.touches || '—') + ' dokunuş</td></tr>'); });
      rows.push('<tr class="rp-now"><td>Fiyat</td><td class="r num"><b>' + fp(a.px.price) + '</b></td><td></td><td></td></tr>');
      L.support.forEach(function (z) { rows.push('<tr><td>Destek</td><td class="r num">' + fp(z.lo) + '–' + fp(z.hi) + '</td><td class="r num">' + pc(z.d, 1) + '</td><td class="hint">' + (z.touches || '—') + ' dokunuş</td></tr>'); });
      var h = '<table class="rp-lv"><tbody>' + rows.join('') + '</tbody></table>';
      if (L.plan) h += '<p class="hint"><b>Analiz planı (emir değil):</b> ' + esc(L.plan.how) + ' · giriş ' + fp(L.plan.entryLo) + '–' + fp(L.plan.entryHi) + ' · zarar-kes ' + fp(L.plan.stop) + (L.plan.targets.length ? ' · hedef ' + L.plan.targets.map(function (t) { return fp(t.p); }).join(' / ') : '') + ' · ' + esc(L.plan.verdict || '') + (a.halal.status !== 'uygun' ? ' — helal doğrulanmadığı için alım önerilmez' : '') + '</p>';
      (L.planNotes || []).slice(0, 2).forEach(function (n) { h += '<p class="hint">' + esc(n) + '</p>'; });
      if (!L.support.length && !L.resistance.length) h += '<p class="muted">Güvenilir destek/direnç bölgesi bulunamadı.</p>';
      return h;
    }
    function stopHtml(a) {
      if (a.stop) { var lv = a.stop.level, c = lv === 'hit' ? 'red' : lv === 'near' || lv === 'below_intraday' ? 'red' : lv === 'approach' ? 'amber' : lv === 'ok' ? 'green' : 'gray';
        return '<div class="rp-stop rp-stop-' + c + '"><h3>' + light(c) + ' Zarar durdur (stop)</h3><p><b>' + esc(a.stop.text) + '</b></p><p class="hint">' + esc(a.stop.how) + ' · ' + (a.stop.mode === 'close' ? 'kapanış bazlı' : 'fiyat bazlı') + (a.stop.midas ? ' · Midas\'a girildi ✓' : '') + (a.stop.reason ? ' · Gerekçe: ' + esc(a.stop.reason) : '') + '</p><p class="hint">' + esc(a.stop.note) + '</p><a class="btn small no-print" href="#raporlar/stop">Stopu düzenle</a></div>'; }
      return '<div class="rp-stop rp-stop-gray"><h3>Zarar durdur (stop) — tanımlı değil</h3><p class="hint">' + esc(a.stopSuggest ? a.stopSuggest.text : '') + '</p><a class="btn small no-print" href="#raporlar/stop">Stop koy</a></div>';
    }
    function notesHtml(a) {
      if (!a.notes || !a.notes.length) return '<p class="hint">İşlem notu yok. Alım/satım gerekçeni Portföy Yönetimi → İşlemler\'de "Gerekçe / not" alanına yazarsan burada görünür.</p>';
      return '<h3>Alım-satım notların</h3><ul class="rp-notes">' + a.notes.map(function (n) { return '<li><b>' + esc(dl(n.date)) + ' ' + esc(sideTR(n.side)) + ':</b> ' + esc(n.note) + '</li>'; }).join('') + '</ul>';
    }
    /* Arka plan raporlarına bu cihazdaki işlem notlarını ekle (notlar şifreli yüke bile konmaz) */
    function withLocalNotes(rep) {
      if (!rep || rep.origin !== 'actions' || !rep.assets) return rep; var trades = st().trades || [];
      rep.assets.forEach(function (a) { if (a.assetId && (!a.notes || !a.notes.length)) a.notes = trades.filter(function (t) { return t.assetId === a.assetId && t.note && (t.side === 'buy' || t.side === 'sell'); }).sort(function (x, y) { return x.date < y.date ? 1 : -1; }).slice(0, 4).map(function (t) { return { date: t.date, side: t.side, note: t.note }; }); });
      return rep;
    }

    /* ---------- Stop yönetimi ---------- */
    function renderStops() {
      var hold = holdingsAll(), h = '<div class="notice warn"><b>Otomatik satış Midas\'ta stop emriyle yapılır.</b> Uygulama emir iletemez (Midas\'ın herkese açık emir API\'si yok; şifreni/oturumunu kullanarak otomasyon yapılmaz). Burada koyduğun seviye izlenir: yaklaşınca (%3), çok yaklaşınca (%1) ve kırılınca <b>kritik</b> bildirim gelir. Aynı seviyeyi Midas\'ta stop/koşullu emir olarak girmeni öneririz.</div>';
      h += '<p class="hint">Kontrol: uygulama açıkken 5 dakikada bir; arka planda (kuruluysa) seans saatlerinde yaklaşık 10 dakikada bir. Fiyatlar TradingView (BIST 15 dk gecikmeli), Yahoo ve TEFAS\'tan; kaynak ve saat her uyarıda yazılır.</p>';
      if (!hold.length) return h + '<p class="muted">Stop koyulabilecek (alım-satımla izlenen, elde adedi olan) varlık yok.</p>';
      h += '<div class="tablewrap"><table class="stack rp-stops"><thead><tr><th>Varlık</th><th class="r">Fiyat</th><th>Stop</th><th>Durum</th><th></th></tr></thead><tbody>';
      hold.forEach(function (x) {
        var a = assetById(x.assetId); if (!a) return; var pr = priceOfAsset(a), s2 = a.stop ? ST.clean(a.stop) : null, q = stopLast[a.id];
        var ev = s2 && q ? ST.evaluate(s2, q.q) : null;
        h += '<tr><td><b>' + esc(a.symbol || a.name) + '</b><div class="hint">' + esc(SS.MARKETS[x.market].short) + '</div></td><td class="r num">' + (pr ? fp(pr.p) + ' ' + curSym(a.currency) + '<div class="hint">' + esc(pr.fromTrade ? 'son işlem fiyatı' : dl(pr.d)) + '</div>' : '—') + '</td>' +
          '<td>' + (s2 ? '<b>' + fp(s2.price) + '</b> ' + (s2.mode === 'close' ? 'kapanış' : 'fiyat') + (s2.trail ? ' · iz süren ' + (s2.trail.kind === 'pct' ? '%' + s2.trail.pct : s2.trail.mult + '×ATR') : '') + (s2.midas ? '<div class="hint">Midas\'a girildi ✓</div>' : '<div class="hint">Midas\'a girilmedi</div>') : '<span class="muted">yok</span>') + '</td>' +
          '<td>' + (ev && ev.level ? light(ev.level === 'hit' || ev.level === 'near' || ev.level === 'below_intraday' ? 'red' : ev.level === 'approach' ? 'amber' : 'green') + ' ' + esc(ev.text) + '<div class="hint">' + esc(q.q.source || '') + ' · ' + esc(when(q.q.at)) + '</div>' : s2 ? '<span class="hint">' + (q && q.err ? 'Fiyat alınamadı: ' + esc(q.err) : 'Kontrol bekleniyor') + '</span>' : '') + '</td>' +
          '<td><button type="button" class="btn small" data-act="rp-st-edit" data-id="' + esc(a.id) + '">' + (s2 ? 'Düzenle' : 'Stop koy') + '</button></td></tr>';
        if (edit === a.id) h += '<tr class="rp-edit"><td colspan="5">' + stopForm(a, s2, pr, x) + '</td></tr>';
      });
      h += '</tbody></table></div><div class="row no-print"><button type="button" class="btn" data-act="rp-st-check">Şimdi kontrol et</button></div>';
      var log = mergedLog();
      h += '<section class="card"><h2>Stop uyarı geçmişi</h2>' + (log.length ? '<ul class="rp-log">' + log.slice(0, 40).map(function (l) { return '<li>' + light(l.level === 'hit' ? 'red' : l.level === 'approach' ? 'amber' : 'red') + ' <b>' + esc(when(l.at)) + '</b> ' + esc(l.name) + ': ' + esc(ST.LEVEL_TR[l.level]) + ' — fiyat ' + fp(l.price) + ', stop ' + fp(l.stop) + ' <span class="hint">' + esc(l.src || '') + ' · ' + (l.origin === 'bg' ? 'arka plan' : 'uygulama') + '</span></li>'; }).join('') + '</ul>' : '<p class="muted">Henüz stop uyarısı yok.</p>') + '</section>';
      return h;
    }
    function mergedLog() { var an = st().analysis || {}, l = (an.stopLog || []).slice(); return l.sort(function (a, b) { return a.at < b.at ? 1 : -1; }); }
    function stopForm(a, s2, pr, x) {
      var sg = sugg[a.id], v = s2 || { mode: a.cls === 'gold' || a.cls === 'katilim_fund' || a.cls === 'sukuk' ? 'close' : 'price', approachPct: 3, nearPct: 1, reason: '' };
      var h = '<form id="rp-st-form" data-id="' + esc(a.id) + '" class="rp-stform"><div class="grid3">' +
        '<div class="field"><label for="rp-st-p">Stop fiyatı (' + curSym(a.currency) + ')</label><input id="rp-st-p" inputmode="decimal" maxlength="20" value="' + (s2 ? esc(String(s2.price).replace('.', ',')) : '') + '" placeholder="ör. ' + (pr ? esc(fp(pr.p * 0.93)) : '') + '"></div>' +
        '<div class="field"><label for="rp-st-mode">Kural</label><select id="rp-st-mode"><option value="price"' + (v.mode === 'price' ? ' selected' : '') + '>Fiyat bu seviyeye inerse</option><option value="close"' + (v.mode === 'close' ? ' selected' : '') + '>Günlük kapanış altında kalırsa</option></select></div>' +
        '<div class="field"><label for="rp-st-trail">İz süren stop</label><select id="rp-st-trail"><option value="">Yok (sabit)</option>' + [5, 8, 10, 15].map(function (p) { return '<option value="pct:' + p + '"' + (s2 && s2.trail && s2.trail.kind === 'pct' && s2.trail.pct === p ? ' selected' : '') + '>En yüksekten %' + p + ' aşağıda</option>'; }).join('') + (sg && sg.trailAtr ? '<option value="atr:' + sg.trailAtr.mult + ':' + sg.trailAtr.atr + '"' + (s2 && s2.trail && s2.trail.kind === 'atr' ? ' selected' : '') + '>En yüksekten ' + String(sg.trailAtr.mult).replace('.', ',') + '×ATR aşağıda</option>' : (s2 && s2.trail && s2.trail.kind === 'atr' ? '<option value="atr:' + s2.trail.mult + ':' + s2.trail.atr + '" selected>En yüksekten ' + s2.trail.mult + '×ATR</option>' : '')) + '</select></div>' +
        '<div class="field"><label for="rp-st-ap">Yaklaşma uyarısı (%)</label><input id="rp-st-ap" inputmode="decimal" maxlength="5" value="' + esc(String(v.approachPct).replace('.', ',')) + '"></div>' +
        '<div class="field"><label for="rp-st-np">Çok yakın uyarısı (%)</label><input id="rp-st-np" inputmode="decimal" maxlength="5" value="' + esc(String(v.nearPct).replace('.', ',')) + '"></div>' +
        '<div class="field"><label class="al-switch"><input type="checkbox" id="rp-st-midas"' + (s2 && s2.midas ? ' checked' : '') + '> Aynı stopu Midas\'a girdim</label></div></div>' +
        '<div class="field"><label for="rp-st-reason">Gerekçe (neden bu seviye?)</label><textarea id="rp-st-reason" maxlength="1000" rows="3">' + esc(v.reason || '') + '</textarea></div>';
      h += '<div class="rp-sugg">' + (sg ? (sg.ok ? '<p><b>Uygulamanın önerisi:</b> ' + esc(sg.text) + '</p><button type="button" class="btn small" data-act="rp-st-use" data-id="' + esc(a.id) + '">Öneriyi forma aktar</button>' : '<p class="hint">' + esc(sg.why) + '</p>') : sbusy[a.id] ? '<p><span class="spinner"></span> Analiz yapılıyor…</p>' : '<button type="button" class="btn small" data-act="rp-st-sugg" data-id="' + esc(a.id) + '">Seviye öner (yapı + ATR)</button>') + '</div>';
      h += '<p class="hint">' + esc(ST.midasNote(a, s2 || { price: pr ? pr.p : 0 })) + '</p>';
      h += '<div class="row"><button class="btn primary" type="submit">Kaydet</button> <button type="button" class="btn" data-act="rp-st-cancel">Vazgeç</button>' + (s2 ? ' <button type="button" class="btn danger" data-act="rp-st-del" data-id="' + esc(a.id) + '">Stopu kaldır</button>' : '') + '</div></form>';
      return h;
    }
    function suggestFor(a) {
      var key = BG.keyOfAsset(a); if (!key) { sugg[a.id] = { ok: false, why: 'Bu varlığın piyasa anahtarı yok (sembol/fiyat kaynağı tanımla).' }; X.render(); return; }
      sbusy[a.id] = true; X.render();
      R.gatherAsset({ MD: MD, AN: AN, SN: SN, now: Date.now() }, key, { holding: true }).then(function (g) { sbusy[a.id] = false; sugg[a.id] = g.ok ? ST.suggest(g.snap) : { ok: false, why: 'Analiz yapılamadı: ' + g.error }; X.render(); });
    }
    function pnum(v) { var s = String(v || '').trim().replace(/\s/g, ''); if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); var n = parseFloat(s); return isFinite(n) ? n : NaN; }
    function saveStop(form) {
      var id = form.dataset.id, a = assetById(id); if (!a) return;
      var p = pnum(document.getElementById('rp-st-p').value), mode = document.getElementById('rp-st-mode').value, tv = document.getElementById('rp-st-trail').value, ap = pnum(document.getElementById('rp-st-ap').value), np = pnum(document.getElementById('rp-st-np').value);
      var reason = document.getElementById('rp-st-reason').value.trim(), midas = document.getElementById('rp-st-midas').checked, trail = null;
      if (tv) { var t = tv.split(':'); trail = t[0] === 'pct' ? { kind: 'pct', pct: +t[1] } : { kind: 'atr', mult: +t[1], atr: +t[2] }; }
      var pr = priceOfAsset(a), q = stopLast[id] && stopLast[id].q, ref = q && num(q.price) ? q.price : pr ? pr.p : null, s2;
      var sg = sugg[id], fromApp = !!(sg && sg.ok && Math.abs(sg.price - p) / p < 0.0005);
      try { s2 = ST.make({ price: p, mode: mode, trail: trail, approachPct: ap, nearPct: np, reason: reason, source: fromApp ? 'app' : 'user', midas: midas, refPrice: ref }, new Date().toISOString()); } catch (e) { return X.toast(e.message); }
      var old = a.stop ? ST.clean(a.stop) : null;
      if (old && old.price === s2.price && old.mode === s2.mode && JSON.stringify(old.trail) === JSON.stringify(s2.trail)) s2.setAt = old.setAt; // yalnız metin/kutu değiştiyse tekrar önleme durumu korunur
      X.mutate(function (s) { var x = s.assets.filter(function (y) { return y.id === id; })[0]; if (x) x.stop = s2; }, 'Stop kaydedildi: ' + (a.symbol || a.name) + ' ' + fp(s2.price));
      edit = null; X.render(); setTimeout(function () { checkStops('stop kaydedildi'); }, 300);
    }

    /* ---------- Uygulama içi stop kontrolü (açıkken) ---------- */
    function notifyOn() { try { return localStorage.getItem(NOTIFY_KEY) === '1'; } catch (e) { return false; } }
    function browserNotify(title, body, tag, crit) {
      if (!notifyOn() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      var opt = { body: body, tag: tag, requireInteraction: !!crit };
      (navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration().then(function (r) { if (r && r.showNotification) return r.showNotification(title, opt); throw new Error('sw yok'); }) : Promise.reject(new Error('sw yok'))).catch(function () { try { new Notification(title, opt); } catch (e) { /* */ } });
    }
    var checking = false;
    function checkStops(why) {
      var s = st(); if (!s || checking || s.isExample) return Promise.resolve(0);
      var list = (s.assets || []).filter(function (a) { return a.stop && ST.clean(a.stop) && a.stop.active !== false; }); if (!list.length) return Promise.resolve(0);
      var held = {}; holdingsAll().forEach(function (h) { held[h.assetId] = h; }); list = list.filter(function (a) { return held[a.id]; }); if (!list.length) return Promise.resolve(0);
      checking = true; var now = Date.now(), nowIso = new Date(now).toISOString(), events = [];
      return Promise.all(list.map(function (a) {
        var key = BG.keyOfAsset(a), s2 = ST.clean(a.stop), mk = SS.marketOfKey(key);
        return MD.load(key, {}).then(function (series) {
          var q = R.stopQuote({ ok: true, bars: (series.bars || []).filter(function (b) { return b && num(b.c); }), live: series.live || null, hist: series.histSource || null }, mk, now, s2); if (!q) throw new Error('fiyat yok');
          stopLast[a.id] = { q: q, at: now }; var ev = ST.evaluate(s2, q), an = s.analysis || {}, stp = ST.step((an.stopState || {})[a.id], s2, ev, nowIso);
          events.push({ a: a, s2: s2, stp: stp });
        }).catch(function (e) { stopLast[a.id] = { err: String(e && e.message || e).slice(0, 80), at: now }; });
      })).then(function () {
        checking = false; var fired = events.filter(function (x) { return x.stp.event; });
        var changed = events.some(function (x) { var old = ((s.analysis || {}).stopState || {})[x.a.id]; return JSON.stringify(old || null) !== JSON.stringify(x.stp.state); });
        if (changed || fired.length) X.mutate(function (s3) { s3.analysis = s3.analysis || { watchlist: [], profile: {} }; var m = s3.analysis.stopState || {}; events.forEach(function (x) { m[x.a.id] = x.stp.state; }); s3.analysis.stopState = m; var lg = s3.analysis.stopLog || []; fired.forEach(function (x) { lg = ST.addLog(lg, ST.logEntry(x.a, x.s2, x.stp.event, 'app')); }); s3.analysis.stopLog = lg; }, null, { quiet: true });
        fired.forEach(function (x) { var c = ST.notifCand(x.a, x.s2, x.stp.event); X.toast((c.sev === 'critical' ? '🔴 ' : '🟠 ') + c.title); browserNotify('Finans Pusulası — ' + (c.sev === 'critical' ? 'STOP' : 'stop uyarısı'), c.title + '. ' + c.body, c.id, c.sev === 'critical'); });
        if (X.tab() === 'raporlar' && (X.sub() || '') === 'stop') X.render();
        return fired.length;
      });
    }
    function mergeBg() { // arka plan sonuçlarındaki stop geçmişini bu cihazdaki geçmişe ekle
      return window.Store.getSecret('bgwatch-res').then(function (c) {
        var r = c && c.res; if (!r || !r.stopLog || !r.stopLog.length) return;
        var have = {}; ((st().analysis || {}).stopLog || []).forEach(function (l) { have[l.id] = 1; }); var add = r.stopLog.filter(function (l) { return !have[l.id]; }); if (!add.length) return;
        X.mutate(function (s) { s.analysis = s.analysis || { watchlist: [], profile: {} }; var lg = s.analysis.stopLog || []; add.forEach(function (l) { lg = ST.addLog(lg, l); }); s.analysis.stopLog = ST.cleanLog(lg).sort(function (a, b) { return a.at < b.at ? 1 : -1; }); }, null, { quiet: true });
      }).catch(function () { /* */ });
    }
    function start() {
      setTimeout(function () { checkStops('açılış'); mergeBg(); }, 5000);
      clearInterval(stopTimer); stopTimer = setInterval(function () { if (!document.hidden) { checkStops('5 dk'); mergeBg(); } }, 5 * 60000);
    }

    /* ---------- Saatler ve kurulum ---------- */
    function renderSchedule() {
      var h = '<section class="card"><h2>Raporlar ne zaman hazırlanır? (TSİ)</h2><p>Her piyasa kendi seans saatine göre raporlanır: Borsa İstanbul İstanbul saatiyle, ABD borsaları New York saatiyle (yaz saati değişimini uygulama kendisi hesaplar), tatil günlerinde rapor üretilmez.</p><div class="tablewrap"><table class="stack"><thead><tr><th>Grup</th><th>Açılış öncesi</th><th>Seans ortası</th><th>Kapanış sonrası</th><th>Not</th></tr></thead><tbody>';
      SS.scheduleTable().forEach(function (r) { h += '<tr><td><b>' + esc(r.label) + '</b><div class="hint">' + esc(r.when) + '</div></td>' + r.slots.map(function (s) { return '<td class="num">' + esc(s.tsi) + (r.market === 'us' ? ' <span class="hint">(' + esc(s.local) + ' NY)</span>' : '') + '</td>'; }).join('') + '<td class="hint">' + esc(r.note) + '</td></tr>'; });
      h += '</tbody></table></div><p class="hint">Açılış öncesi = beklentiler ve izlenecek seviyeler · Seans ortası = ne hareket etti, neden (kanıtıyla) · Kapanış sonrası = gün özeti ve yarının planı.</p>';
      var hb = SS.holidaysOf('bist', X.today(), 120), hu = SS.holidaysOf('us', X.today(), 120);
      h += '<h3>Yaklaşan tatiller</h3><div class="grid2"><div><b>Borsa İstanbul</b><ul>' + (hb.length ? hb.map(function (x) { return '<li>' + esc(dl(x.ymd)) + ' — ' + esc(x.reason) + '</li>'; }).join('') : '<li class="muted">120 gün içinde yok</li>') + '</ul></div><div><b>NYSE</b><ul>' + (hu.length ? hu.map(function (x) { return '<li>' + esc(dl(x.ymd)) + ' — ' + esc(x.reason) + '</li>'; }).join('') : '<li class="muted">120 gün içinde yok</li>') + '</ul></div></div></section>';
      h += '<section class="card"><h2>Arka planda (site kapalıyken) rapor ve stop bildirimi</h2>' + (srv.on ? '<p>✓ Arka plan izleme bu cihazda kurulu. Kişisel raporlar ve stop kontrolü GitHub Actions\'ta şifreli verinle çalışır; rapor hazır olunca ve stop yaklaşınca/kırılınca telefonuna (ntfy) bildirim gelir.' + (srv.err ? ' <b>Sorun:</b> ' + esc(srv.err) : '') + (srv.items.length ? ' Son arka plan raporu: ' + esc(when(srv.items[0].generatedAt)) + '.' : ' Henüz arka plan raporu yok (bir sonraki rapor saatini bekle).') + '</p>'
        : '<p>Şu an raporlar yalnızca siteyi açtığında bu cihazda üretilir. Site kapalıyken de rapor ve stop bildirimi için <b>Haberler → Bildirim ayarları → "Arka planda portföyümü de izle"</b> kurulumunu bir kez yap: uygulama bir anahtar üretir, verini şifreler; sen bu anahtarı GitHub\'da <b>PORTFOLIO_KEY</b> sırrı olarak eklersin ve telefonuna ntfy uygulamasını kurarsın. Kurulum adım adım ekranda anlatılır.</p>') + '</section>';
      return h;
    }

    /* ---------- olaylar ---------- */
    function onClick(act, t) {
      var A = {
        'rp-print': function () { window.print(); },
        'rp-gen': function () { var sl = SS.parseId(t.dataset.id); if (sl) { delete cache[sl.id]; errs[sl.id] = null; generate(sl); } },
        'rp-st-edit': function () { edit = edit === t.dataset.id ? null : t.dataset.id; X.render(); var el = document.getElementById('rp-st-p'); if (el) el.focus(); },
        'rp-st-cancel': function () { edit = null; X.render(); },
        'rp-st-sugg': function () { var a = assetById(t.dataset.id); if (a) suggestFor(a); },
        'rp-st-use': function () { var sg = sugg[t.dataset.id]; if (!sg || !sg.ok) return; document.getElementById('rp-st-p').value = String(sg.price).replace('.', ','); document.getElementById('rp-st-mode').value = sg.mode; var r = document.getElementById('rp-st-reason'); r.value = 'Uygulama önerisi: ' + sg.text; },
        'rp-st-del': function () { var id = t.dataset.id, a = assetById(id); if (!a || !confirm((a.symbol || a.name) + ' için stop kaldırılsın mı? Midas\'taki emrini ayrıca iptal etmen gerekir.')) return; X.mutate(function (s) { var x = s.assets.filter(function (y) { return y.id === id; })[0]; if (x) delete x.stop; if (s.analysis && s.analysis.stopState) delete s.analysis.stopState[id]; }, 'Stop kaldırıldı: ' + (a.symbol || a.name)); edit = null; X.render(); },
        'rp-st-check': function () { X.toast('Stoplar kontrol ediliyor…'); checkStops('elle').then(function (n) { X.toast(n ? n + ' yeni stop uyarısı' : 'Kontrol tamam — yeni uyarı yok'); X.render(); }); }
      };
      if (A[act]) { A[act](); return true; }
      return false;
    }
    function onSubmit(e) { if (e.target && e.target.id === 'rp-st-form') { e.preventDefault(); saveStop(e.target); return true; } return false; }
    function viewHook(rep) { return withLocalNotes(rep); }
    var _render = render;
    render = function () { Object.keys(cache).forEach(function (k) { withLocalNotes(cache[k]); }); return _render(); };
    return { render: function () { return render(); }, onClick: onClick, onSubmit: onSubmit, start: start, checkStops: checkStops, loadServer: loadServer, _cache: cache, _gen: generate, viewHook: viewHook };
  };
})();
