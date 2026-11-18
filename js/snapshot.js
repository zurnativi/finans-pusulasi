/* snapshot.js — Sunucu tarafı analiz anlık görüntüsü (v8.1). Aynı Analysis motoru tarayıcıda ve Node'da çalışır; bu modül yalnız
 * (1) helal durumunu belirleyen saf kuralı ve (2) analiz çıktısını küçük, deterministik bir JSON'a indirgemeyi içerir.
 * İş akışı (tools/precompute.js) bunu üretir; site anında gösterir, kullanıcının kendi varlıkları için tarayıcı yeniden hesaplar.
 * Portföy/tutar/pozisyon bilgisi içermez (herkese açık depoya yazılır): ctx.holding / portfolioValue burada hiç kullanılmaz. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./analysis.js'));
  else root.Snap = factory(root.Analysis);
})(typeof self !== 'undefined' ? self : this, function (AN) {
  'use strict';
  var VERSION = 1;
  var US_HALAL = { SPUS: 1, HLAL: 1, SPSK: 1, SPRE: 1, SPTE: 1, SPWO: 1, UMMA: 1 };
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function r(x, d) { if (!num(x)) return null; var m = Math.pow(10, d == null ? 4 : d); return Math.round(x * m) / m; }
  /* Helal durumu: kullanıcı etiketi yoksa varlığın türüne göre kural (analysis-ui bunu da kullanır → tek kaynak) */
  function halalBase(key, series) {
    var k = key.split(':')[0], s = key.slice(k.length + 1);
    if (k === 'bist') { var m = (series && series.katilim) || []; return m.indexOf('XKTUM') >= 0 ? { status: 'uygun', label: 'Uygun', reason: 'Borsa İstanbul Katılım Tüm endeksinde' + (m.indexOf('XK050') >= 0 ? ' (Katılım 50 dahil)' : '') } : { status: 'bilinmiyor', label: 'Katılım endeksinde değil', reason: 'Katılım endekslerinde yer almıyor — helal filtresinden geçmez' }; }
    if (k === 'tefas') { var f = series && series.fund; if (f && f.tags && f.tags.islamic) return { status: 'uygun', label: 'Uygun', reason: 'Katılım (İslami) fon — TEFAS etiketi' }; if (f && /borçlanma|para piyasası|eurobond|repo/i.test(f.type || '')) return { status: 'uygun_degil', label: 'Uygun değil', reason: 'Faizli araçlara yatırım yapan fon türü (' + f.type + ')' }; return { status: 'bilinmiyor', label: 'Bilinmiyor', reason: 'Katılım fonu etiketi yok' }; }
    if (k === 'us' || k === 'td') return US_HALAL[s] ? { status: 'uygun', label: 'Uygun', reason: 'Şer\'i endeks izleyen ETF' } : { status: 'bilinmiyor', label: 'Bilinmiyor', reason: 'Şer\'i tarama bilgisi yok' };
    if (k === 'cg') return { status: 'supheli', label: 'Şüpheli', reason: 'Kripto paralar hakkında âlimler arasında görüş ayrılığı var' };
    if (k === 'metal' || k === 'macro') return { status: 'uygun', label: 'Uygun', reason: 'Fiziki/peşin altın-gümüş için (vadeli kontrat değil; ons grafiği yalnızca fiyat okumak için)' };
    if (k === 'fx') return { status: 'uygun', label: 'Uygun', reason: 'Peşin (spot) döviz' };
    return { status: 'bilinmiyor', label: 'Bilinmiyor', reason: 'Yatırım aracı değil (yalnızca piyasa okuması)' };
  }
  /* Analiz bağlamı (temel veriler, göreli güç kıyası, fon emsalleri): tarayıcı ve iş akışı aynı kodu kullanır. MD = MData.
   * opts.halal verilirse (kullanıcının Yönetim'deki etiketi) o kullanılır; yoksa halalBase. Dönen söz: ctx (holding/portfolioValue içermez). */
  function contextFor(MD, key, series, opts) {
    opts = opts || {};
    var k = key.split(':')[0], jobs = [], ctx = { halal: opts.halal || halalBase(key, series) };
    if (series.kind === 'stock' && k === 'bist') {
      jobs.push(MD.fundamentals(key.slice(5)).then(function (f) { ctx.fundamentals = f; }, function (e) { ctx.fundErr = e.message; }));
      // Göreli güç: Katılım endeksindeki hisse → Katılım Tüm (XKTUM, gerçek endeks değerleri); değilse BIST 100. XKTUM dosyası yoksa BIST 100'e düşülür (etiketlenir).
      var isK = (series.katilim || []).indexOf('XKTUM') >= 0, xu = function () { return MD.loadMd('index', 'XU100').then(function (b) { ctx.benchBars = b.bars; ctx.benchName = 'BIST 100'; }, function () { }); };
      jobs.push(isK ? MD.loadMd('index', 'XKTUM').then(function (b) { if (b.bars.length < 130) return xu(); ctx.benchBars = b.bars; ctx.benchName = 'Katılım Tüm (XKTUM)'; }, xu) : xu());
      jobs.push(MD.tvLive('BIST:XKTUM').then(function (x) { ctx.benchTv = x.raw; }, function () { }));
    }
    if (series.kind === 'fund' && series.fund && series.fund.type) jobs.push(MD.fundPeers(series.fund.type).then(function (p) { ctx.fundPeers = p; }, function () { }));
    if (series.kind === 'crypto' && k === 'cg' && key !== 'cg:bitcoin') jobs.push(MD.load('cg:bitcoin').then(function (b) { ctx.benchBars = b.bars; ctx.benchName = 'Bitcoin'; }, function () { }));
    if (k === 'metal') jobs.push(MD.load('fx:USD').then(function (b) { ctx.benchBars = b.bars; ctx.benchName = 'Dolar/TL'; }, function () { }));
    return Promise.all(jobs).then(function () { return ctx; });
  }
  function planOf(p) {
    if (!p) return null;
    return { how: p.how, ok: !!p.ok, verdict: p.verdict, entryLo: r(p.entryLo), entryHi: r(p.entryHi), stop: r(p.stop), stopLabel: p.stopLabel, riskPct: r(p.riskPct, 4), rr: r(p.rr, 2),
      targets: (p.targets || []).map(function (t) { return { p: r(t.p), rr: r(t.rr, 2), minor: !!t.minor, why: t.why }; }) };
  }
  function last(a) { for (var i = a.length - 1; i >= 0; i--) if (num(a[i])) return a[i]; return null; }
  /* A: Analysis.analyze çıktısı (ctx.halal içerir). meta: { at, source } — zaman damgası dışarıdan verilir (deterministik test için). */
  function compact(A, meta) {
    meta = meta || {};
    var out = { v: VERSION, key: A.key, name: A.name, kind: A.kind, tf: A.tf || '1d', currency: A.currency, n: A.n, closeOnly: !!A.closeOnly, at: meta.at || null,
      price: r(A.price), lastDate: A.lastDate || null, total: A.total, confidence: A.confidence, confLabel: A.confLabel, blocked: !!A.blocked, blockReasons: A.blockReasons || [], warnings: A.warnings || [] };
    out.scores = {}; Object.keys(A.scores || {}).forEach(function (k) { var s = A.scores[k]; out.scores[k] = s && num(s.score) ? s.score : null; });
    out.stance = A.stance ? { code: A.stance.code, label: A.stance.label, why: (A.stance.why || []).slice(0, 4), hold: A.stance.hold ? { code: A.stance.hold.code, label: A.stance.hold.label, why: (A.stance.hold.why || []).slice(0, 3) } : null } : null;
    out.halalOk = !!A.halalOk; out.halal = A.ctx && A.ctx.halal ? { status: A.ctx.halal.status, label: A.ctx.halal.label, reason: A.ctx.halal.reason } : null;
    if (A.plans) out.plans = { conservative: planOf(A.plans.conservative), aggressive: planOf(A.plans.aggressive), notes: (A.plans.notes || []).slice(0, 3), halalNote: A.plans.halalNote || null };
    if (A.col) {
      var p = A.price, a = A.atr;
      out.structure = {
        zones: (A.zones || []).slice().sort(function (x, y) { return Math.abs(x.mid - p) - Math.abs(y.mid - p); }).slice(0, 6).sort(function (x, y) { return x.mid - y.mid; }).map(function (z) { return { lo: r(z.lo), hi: r(z.hi), touches: z.touches, side: z.mid > p ? 'direnç' : 'destek' }; }),
        trend: A.trendlines ? { support: A.trendlines.support ? { valid: true } : null, resistance: A.trendlines.resistance ? { valid: true } : null } : null,
        patterns: (A.patterns || []).slice(0, 4).map(function (x) { return { name: x.name || x.type || x.kind || null, dir: x.dir || x.bias || null, conf: x.conf, status: x.status || null }; }),
        divergences: (A.divergences || []).slice(-3).map(function (d) { return { type: d.type, fresh: !!d.fresh }; })
      };
      var I = A.ind || {};
      out.ind = { rsi: r(last(I.rsi || []), 1), adx: r(last((I.adx && I.adx.adx) || []), 1), atr: r(a), atrPct: num(a) && p ? r(a / p, 4) : null, sma50: r(last(I.sma50 || []), 4), sma200: r(last(I.sma200 || []), 4) };
    }
    out.xcheck = A.xcheck ? { compared: A.xcheck.compared, ok: A.xcheck.ok } : null;
    var S = A.series || {};
    out.source = { label: S.histSource ? S.histSource.label : null, at: S.histSource ? S.histSource.at : null, lastBar: S.histSource ? S.histSource.lastBar : null,
      live: S.live ? { price: r(S.live.price), at: S.live.at, source: S.live.source } : null, liveError: S.liveError || null };
    return out;
  }
  /* Genel bakış satırı (analysis/index.json) */
  function row(s) { return { key: s.key, name: s.name, kind: s.kind, total: s.total, conf: s.confidence, confLabel: s.confLabel, stance: s.stance && s.stance.label, stanceCode: s.stance && s.stance.code, price: s.price, cur: s.currency, lastDate: s.lastDate, at: s.at, blocked: s.blocked, halal: s.halal && s.halal.status, rr: s.plans && s.plans.conservative ? s.plans.conservative.rr : null }; }
  function fileOf(key) { return String(key).replace(/[^A-Za-z0-9_.-]/g, '-'); }
  /* Bir anahtarın tam analizi → sıkıştırılmış anlık görüntü (sunucu işleri ve arka plan portföy kontrolü bunu kullanır) */
  function analyzeKey(MD, AN, key, at, opts) {
    return MD.load(key, {}).then(function (series) {
      return contextFor(MD, key, series, opts).then(function (ctx) { var A = AN.analyze(series, ctx); A.series = series; A.ctx = ctx; return compact(A, { at: at }); });
    });
  }
  return { VERSION: VERSION, analyzeKey: analyzeKey, US_HALAL: US_HALAL, halalBase: halalBase, contextFor: contextFor, compact: compact, row: row, fileOf: fileOf };
});
