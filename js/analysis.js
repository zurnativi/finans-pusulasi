/* analysis.js — Analiz motoru: göstergeler + grafik yapısı → alt skorlar, toplam skor, güven, alım/satım/stop planları (temkinli ve atak),
 * TradingView ile çapraz doğrulama, portföy sağlık skoru ve portföy oluşturucu. Saf fonksiyonlar (ağ yok) — tümü testli.
 * Sentez kuralı: her alt skor 0-100; puan katkıları (kanıtlar) tek tek listelenir; ağırlıklar WEIGHTS tablosunda sabit ve belgelidir;
 * eksik alt skorun ağırlığı diğerlerine orantılı dağıtılır ve güven düşer. Veri kontrolü 'fail' ise sinyal üretilmez. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ta.js'), require('./structure.js'));
  else root.Analysis = factory(root.TA, root.Structure);
})(typeof self !== 'undefined' ? self : this, function (TA, ST) {
  'use strict';
  var num = TA.num, last = TA.last;
  // Zaman dilimi bağlamı (analyze içinde ayarlanır; günlük = null). Metinler ve yıllıklaştırma buna göre: "200 günlük" ↔ "200 mumluk (1S)".
  var TFX = null;
  function UA() { return TFX ? 'mumluk' : 'günlük'; }
  function UN() { return TFX ? 'mum' : 'gün'; }
  function UNde() { return TFX ? 'mumda' : 'günde'; }
  function UNdur() { return TFX ? 'mumdur' : 'gündür'; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function interp(x, pts) { // parçalı doğrusal: pts = [[x0,y0],[x1,y1],...] artan x
    if (!num(x)) return null; if (x <= pts[0][0]) return pts[0][1]; for (var i = 1; i < pts.length; i++) if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return pts[pts.length - 1][1];
  }

  /* ---------- Ağırlıklar (belgeli, sabit) ---------- */
  var WEIGHTS = {
    stock: { trend: 25, momentum: 15, risk: 15, value: 20, rel: 15, liquidity: 10 },
    etf: { trend: 30, momentum: 20, risk: 20, rel: 15, liquidity: 15 },
    crypto: { trend: 30, momentum: 20, risk: 20, rel: 15, liquidity: 15 },
    fund: { value: 30, risk: 25, trend: 20, momentum: 10, liquidity: 15 },
    metal: { trend: 35, momentum: 25, risk: 25, rel: 15 },
    fx: { trend: 35, momentum: 25, risk: 25, rel: 15 },
    index: { trend: 35, momentum: 25, risk: 25, rel: 15 },
    import: { trend: 35, momentum: 25, risk: 25, rel: 15 }
  };
  var SUB_LABEL = { trend: 'Trend', momentum: 'Momentum', risk: 'Risk / oynaklık', value: 'Temel / değerleme', rel: 'Göreli güç', liquidity: 'Likidite', halal: 'Helal durumu' };
  var VOL_BASE = { stock: 0.40, stock_usd: 0.30, etf: 0.20, crypto: 0.70, fund: 0.15, metal: 0.20, fx: 0.12, index: 0.25, import: 0.35 }; // sınıfın tipik yıllık oynaklığı (karşılaştırma tabanı)
  var CONF = [[75, 'Yüksek'], [55, 'Orta'], [35, 'Düşük'], [0, 'Yetersiz']];
  function confLabel(c) { for (var i = 0; i < CONF.length; i++) if (c >= CONF[i][0]) return CONF[i][1]; return 'Yetersiz'; }

  /* ---------- Göstergeler ---------- */
  function columns(bars) { return { d: bars.map(function (b) { return b.d; }), o: bars.map(function (b) { return b.o; }), h: bars.map(function (b) { return num(b.h) ? b.h : b.c; }), l: bars.map(function (b) { return num(b.l) ? b.l : b.c; }), c: bars.map(function (b) { return b.c; }), v: bars.map(function (b) { return num(b.v) ? b.v : null; }) }; }
  function indicators(col, closeOnly) {
    var c = col.c, h = col.h, l = col.l, v = col.v, hasVol = v.filter(num).length > c.length * 0.8;
    var I = { sma20: TA.sma(c, 20), sma50: TA.sma(c, 50), sma200: TA.sma(c, 200), ema20: TA.ema(c, 20), ema50: TA.ema(c, 50), rsi: TA.rsi(c, 14), macd: TA.macd(c), stochRsi: TA.stochRsi(c), bb: TA.bollinger(c, 20, 2), roc20: TA.roc(c, 20) };
    if (!closeOnly) { I.atr = TA.atr(h, l, c, 14); I.adx = TA.adx(h, l, c, 14); I.ichimoku = TA.ichimoku(h, l, c); I.supertrend = TA.supertrend(h, l, c, 10, 3); }
    else { // yalnızca kapanış: ATR yerine 14 günlük ortalama mutlak kapanış değişimi × 1,25 (yaklaşık; açıkça etiketlenir)
      var ch = c.map(function (x, i) { return i && num(x) && num(c[i - 1]) ? Math.abs(x - c[i - 1]) : null; }), m = TA.sma(ch, 14);
      I.atr = m.map(function (x) { return num(x) ? x * 1.25 : null; }); I.atrApprox = true;
    }
    if (hasVol) { I.obv = TA.obv(c, v); I.vp = TA.volumeProfile(h, l, v, 120, 24); }
    I.hasVol = hasVol;
    return I;
  }

  /* ---------- Çapraz doğrulama (TradingView'in kendi hesapladığı değerler) ---------- */
  var XCHECK = [ // [ad, TradingView alanı, bizim değer, tolerans türü, tolerans]
    ['RSI(14)', 'RSI', function (I) { return last(I.rsi); }, 'abs', 1.5],
    ['ATR(14)', 'ATR', function (I) { return I.atrApprox ? null : last(I.atr); }, 'rel', 0.04],
    ['ADX(14)', 'ADX', function (I) { return I.adx ? last(I.adx.adx) : null; }, 'abs', 2.5],
    ['SMA(20)', 'SMA20', function (I) { return last(I.sma20); }, 'rel', 0.006],
    ['SMA(50)', 'SMA50', function (I) { return last(I.sma50); }, 'rel', 0.006],
    ['SMA(200)', 'SMA200', function (I) { return last(I.sma200); }, 'rel', 0.006],
    ['EMA(20)', 'EMA20', function (I) { return last(I.ema20); }, 'rel', 0.006],
    ['EMA(50)', 'EMA50', function (I) { return last(I.ema50); }, 'rel', 0.006],
    ['MACD', 'MACD.macd', function (I) { return last(I.macd.macd); }, 'price', 0.002],
    ['Bollinger üst', 'BB.upper', function (I) { return last(I.bb.upper); }, 'rel', 0.006],
    ['Bollinger alt', 'BB.lower', function (I) { return last(I.bb.lower); }, 'rel', 0.006],
    ['Ichimoku Kijun', 'Ichimoku.BLine', function (I) { return I.ichimoku ? last(I.ichimoku.kijun) : null; }, 'rel', 0.006]
  ];
  function crossVerify(I, tv, price, sameBar) {
    var rows = [];
    if (!tv) return { rows: rows, compared: 0, ok: 0, note: 'TradingView karşılaştırma verisi alınamadı.' };
    if (!sameBar) return { rows: rows, compared: 0, ok: 0, note: 'Son mum tarihleri farklı olduğu için karşılaştırma yapılmadı (veri dosyası ile canlı fiyat aynı güne ait değil).' };
    XCHECK.forEach(function (x) {
      var ours = x[2](I), theirs = tv[x[1]]; if (!num(ours) || !num(theirs)) return;
      var diff = x[3] === 'abs' ? Math.abs(ours - theirs) : x[3] === 'price' ? Math.abs(ours - theirs) / Math.max(1e-12, Math.abs(price)) : Math.abs(ours - theirs) / Math.max(1e-12, Math.abs(theirs));
      rows.push({ name: x[0], ours: ours, theirs: theirs, diff: diff, tolType: x[3], tol: x[4], ok: diff <= x[4] });
    });
    var ok = rows.filter(function (r) { return r.ok; }).length;
    return { rows: rows, compared: rows.length, ok: ok, note: rows.length ? null : 'Karşılaştırılabilir gösterge yok.' };
  }

  /* ---------- Alt skorlar ---------- */
  function ev(list, text, pts) { list.push({ t: text, p: pts }); return pts; }
  function trendScore(col, I, sw, tl) {
    var c = col.c, n = c.length, p = c[n - 1], e = [], s = 0;
    var s200 = last(I.sma200), s50 = last(I.sma50), e20 = last(I.ema20);
    if (num(s200)) s += ev(e, p > s200 ? 'Fiyat 200 ' + UA() + ' ortalamanın üstünde' : 'Fiyat 200 ' + UA() + ' ortalamanın altında', p > s200 ? 20 : -20);
    if (num(s200) && num(s50)) s += ev(e, s50 > s200 ? '50 ' + UA() + ' ortalama 200 ' + UA() + ' ortalamanın üstünde (altın kesişim bölgesi)' : '50 ' + UA() + ' ortalama 200 ' + UA() + ' ortalamanın altında (ölüm kesişimi bölgesi)', s50 > s200 ? 15 : -15);
    if (num(s50)) s += ev(e, p > s50 ? 'Fiyat 50 ' + UA() + ' ortalamanın üstünde' : 'Fiyat 50 ' + UA() + ' ortalamanın altında', p > s50 ? 10 : -10);
    if (num(e20)) s += ev(e, p > e20 ? 'Fiyat 20 ' + UA() + ' üssel ortalamanın üstünde' : 'Fiyat 20 ' + UA() + ' üssel ortalamanın altında', p > e20 ? 5 : -5);
    if (I.adx) { var ax = last(I.adx.adx), pd = last(I.adx.pdi), md = last(I.adx.mdi); if (num(ax)) { if (ax >= 25) s += ev(e, 'ADX ' + r1(ax) + ': güçlü trend, ' + (pd > md ? 'alıcılar (+DI) baskın' : 'satıcılar (−DI) baskın'), pd > md ? 15 : -15); else ev(e, 'ADX ' + r1(ax) + ': belirgin trend yok (yatay piyasa)', 0); } }
    if (I.supertrend) { var sd = last(I.supertrend.dir); if (num(sd)) s += ev(e, 'Supertrend ' + (sd > 0 ? 'yükseliş' : 'düşüş') + ' modunda', sd > 0 ? 10 : -10); }
    if (I.ichimoku) { var A = last(I.ichimoku.senkouA), B = last(I.ichimoku.senkouB), tk = last(I.ichimoku.tenkan), kj = last(I.ichimoku.kijun);
      if (num(A) && num(B)) s += ev(e, p > Math.max(A, B) ? 'Fiyat Ichimoku bulutunun üstünde' : p < Math.min(A, B) ? 'Fiyat Ichimoku bulutunun altında' : 'Fiyat Ichimoku bulutunun içinde (kararsız)', p > Math.max(A, B) ? 10 : p < Math.min(A, B) ? -10 : 0);
      if (num(tk) && num(kj)) s += ev(e, tk > kj ? 'Tenkan, Kijun\'un üstünde' : 'Tenkan, Kijun\'un altında', tk > kj ? 5 : -5); }
    var conf = sw.filter(function (x) { return !x.tentative; }), H = conf.filter(function (x) { return x.type === 'H'; }).slice(-2), L = conf.filter(function (x) { return x.type === 'L'; }).slice(-2);
    if (H.length === 2 && L.length === 2) { if (H[1].p > H[0].p && L[1].p > L[0].p) s += ev(e, 'Yükselen tepeler ve yükselen dipler (yükseliş yapısı)', 10); else if (H[1].p < H[0].p && L[1].p < L[0].p) s += ev(e, 'Alçalan tepeler ve alçalan dipler (düşüş yapısı)', -10); else ev(e, 'Tepe/dip yapısı karışık', 0); }
    if (tl && tl.support && tl.support.slope > 0 && tl.support.touches >= 3) s += ev(e, 'Yükselen trend desteği (' + tl.support.touches + ' dokunuş) korunuyor', 5);
    if (tl && tl.resistance && tl.resistance.slope < 0 && tl.resistance.touches >= 3) s += ev(e, 'Alçalan trend direnci (' + tl.resistance.touches + ' dokunuş) üzerinde baskı', -5);
    return { score: Math.round(clamp(50 + s / 2, 0, 100)), ev: e };
  }
  function momentumScore(col, I, divs) {
    var e = [], s = 0, n = col.c.length, rs = last(I.rsi);
    if (num(rs)) s += ev(e, 'RSI ' + r1(rs) + (rs > 80 ? ' — aşırı alım (yorulma riski)' : rs > 70 ? ' — güçlü ama aşırı alım bölgesinde' : rs >= 55 ? ' — olumlu momentum' : rs >= 45 ? ' — nötr' : rs >= 30 ? ' — zayıf momentum' : ' — aşırı satım (zayıf; dönüş için onay gerekir)'), rs > 80 ? -5 : rs > 70 ? 10 : rs >= 55 ? 20 : rs >= 45 ? 0 : rs >= 30 ? -10 : -20);
    var m = last(I.macd.macd), sg = last(I.macd.signal), hi = I.macd.hist;
    if (num(m) && num(sg)) {
      s += ev(e, m > sg ? 'MACD sinyal çizgisinin üstünde' : 'MACD sinyal çizgisinin altında', m > sg ? 15 : -15);
      s += ev(e, m > 0 ? 'MACD sıfırın üstünde' : 'MACD sıfırın altında', m > 0 ? 10 : -10);
      var h3 = hi.slice(-3); if (h3.every(num)) { if (h3[2] > h3[1] && h3[1] > h3[0]) s += ev(e, 'MACD histogramı 3 ' + UNdur() + ' yükseliyor', 5); else if (h3[2] < h3[1] && h3[1] < h3[0]) s += ev(e, 'MACD histogramı 3 ' + UNdur() + ' düşüyor', -5); }
    }
    var k = last(I.stochRsi.k), d = last(I.stochRsi.d);
    if (num(k) && num(d)) { if (k > d && k < 80) s += ev(e, 'Stokastik RSI yukarı kesişimde (%K ' + r1(k) + ')', 10); else if (k < d && k > 20) s += ev(e, 'Stokastik RSI aşağı kesişimde (%K ' + r1(k) + ')', -10); else ev(e, 'Stokastik RSI uç bölgede (%K ' + r1(k) + ')', 0); }
    var rc = last(I.roc20); if (num(rc)) s += ev(e, 'Son 20 ' + UNde() + ' ' + (rc >= 0 ? '+' : '') + r1(rc) + '% değişim', rc > 0 ? 10 : -10);
    (divs || []).filter(function (x) { return x.fresh; }).forEach(function (x) { s += ev(e, x.name + ' (RSI, ' + x.age + ' mum önce)', x.type === 'bull' ? 15 : -15); });
    if (I.obv) { var ob = I.obv.slice(-20), xs = ob.map(function (_, i) { return i; }), lr = ob.every(num) ? TA.linreg(xs, ob) : null, pr = TA.linreg(xs, col.c.slice(-20));
      if (lr && pr) { if (lr.slope > 0 && pr.slope > 0) s += ev(e, 'Hacim (OBV) yükselişi doğruluyor', 10); else if (lr.slope < 0 && pr.slope < 0) s += ev(e, 'Hacim (OBV) düşüşü doğruluyor', -10); else ev(e, 'Hacim (OBV) fiyatla uyumsuz — hareketin gücü şüpheli', lr.slope > 0 ? 5 : -5), s += lr.slope > 0 ? 5 : -5; } }
    return { score: Math.round(clamp(50 + s / 1.9, 0, 100)), ev: e };
  }
  function riskScore(col, I, kind, ctx) {
    var e = [], c = col.c, n = c.length, vol = TA.annVol(c.slice(-61), ctx && ctx.ppy ? ctx.ppy : kind === 'crypto' ? 365 : 252), base = kind === 'stock' && ctx && ctx.currency === 'USD' ? VOL_BASE.stock_usd : VOL_BASE[kind] || 0.35;
    if (ctx && ctx.fundRisk) base = [0, 0.02, 0.05, 0.10, 0.15, 0.22, 0.30, 0.40][ctx.fundRisk] || base;
    var sc = num(vol) ? interp(vol / base, [[0.6, 90], [1, 60], [1.5, 35], [2.2, 15]]) : 50;
    ev(e, num(vol) ? 'Yıllık oynaklık (son 60 ' + UN() + ') %' + r1(vol * 100) + ' — sınıf tabanı %' + Math.round(base * 100) : 'Oynaklık hesaplanamadı', 0);
    var dd = TA.maxDrawdown(c.slice(-252)); if (num(dd.current)) { var pen = dd.current < -0.35 ? -15 : dd.current < -0.2 ? -8 : dd.current < -0.1 ? -3 : 0; sc += pen; ev(e, (TFX ? 'Son 252 mumdaki zirveden' : '52 haftalık zirveden') + ' uzaklık %' + r1(dd.current * 100), pen); }
    var mdd = TA.maxDrawdown(c); ev(e, 'Dönemdeki en büyük düşüş %' + r1(mdd.mdd * 100), 0);
    var bw = I.bb.width.slice(-252).filter(num); if (bw.length > 50) { var cur = bw[bw.length - 1], rank = bw.filter(function (x) { return x <= cur; }).length / bw.length; if (rank > 0.9) { sc -= 5; ev(e, (TFX ? 'Bollinger bant genişliği son 252 mumun' : 'Bollinger bant genişliği yılın') + ' en geniş %10\'unda (yüksek oynaklık dönemi)', -5); } else if (rank < 0.1) ev(e, 'Bollinger bantları çok dar — sert hareket öncesi sıkışma olabilir', 0); }
    return { score: Math.round(clamp(sc, 0, 100)), ev: e, vol: vol, mdd: mdd.mdd, ddNow: dd.current };
  }
  function valueScoreStock(f, peers) {
    if (!f) return null; var e = [], s = 0, P = peers || {}, fin = /finance/i.test(f.sector || '');
    var pe = f.price_earnings_ttm, pb = f.price_book_fq, mpe = P.price_earnings_ttm, mpb = P.price_book_fq;
    if (num(pe)) { if (pe <= 0) s += ev(e, 'Son 12 ayda zarar (F/K negatif)', -20); else if (num(mpe)) { var rr = pe / mpe; s += ev(e, 'F/K ' + r1(pe) + ' — sektör medyanı ' + r1(mpe) + (rr < 0.7 ? ' (ucuz)' : rr <= 1.3 ? ' (makul)' : rr <= 2 ? ' (pahalı)' : ' (çok pahalı)'), rr < 0.7 ? 15 : rr <= 1.3 ? 5 : rr <= 2 ? -10 : -15); } else ev(e, 'F/K ' + r1(pe) + ' (sektör kıyası yok)', 0); }
    else if (f.price_earnings_ttm === null && num(f.net_margin) && f.net_margin < 0) s += ev(e, 'Zarar eden şirket (F/K yok)', -20);
    if (num(pb) && pb > 0 && num(mpb)) { var rb = pb / mpb; s += ev(e, 'PD/DD ' + r1(pb) + ' — sektör medyanı ' + r1(mpb), rb < 0.7 ? 10 : rb <= 1.3 ? 3 : -8); }
    if (num(f.return_on_equity)) { var mroe = P.return_on_equity; s += ev(e, 'Özsermaye kârlılığı %' + r1(f.return_on_equity) + (num(mroe) ? ' (sektör medyanı %' + r1(mroe) + ')' : ''), f.return_on_equity < 0 ? -15 : num(mroe) ? (f.return_on_equity > mroe ? 10 : -5) : 0); }
    if (num(f.net_margin)) s += ev(e, 'Net kâr marjı %' + r1(f.net_margin), f.net_margin > 0 ? 5 : -10);
    if (num(f.total_revenue_yoy_growth_ttm)) { var mg = P.total_revenue_yoy_growth_ttm; s += ev(e, 'Satış büyümesi (yıllık, nominal) %' + r1(f.total_revenue_yoy_growth_ttm) + (num(mg) ? ' — sektör medyanı %' + r1(mg) : ''), num(mg) ? (f.total_revenue_yoy_growth_ttm > mg ? 10 : -5) : 0); }
    if (!fin && num(f.debt_to_equity)) s += ev(e, 'Borç/özsermaye ' + r1(f.debt_to_equity), f.debt_to_equity < 0.5 ? 10 : f.debt_to_equity <= 1.5 ? 0 : -10);
    if (fin) ev(e, 'Finans şirketi: borç/özsermaye oranı değerlendirmeye alınmadı', 0);
    if (num(f.free_cash_flow_ttm)) s += ev(e, 'Serbest nakit akışı ' + (f.free_cash_flow_ttm > 0 ? 'pozitif' : 'negatif'), f.free_cash_flow_ttm > 0 ? 5 : -5);
    if (!e.length) return null;
    return { score: Math.round(clamp(50 + s, 0, 100)), ev: e, note: 'Kaynak: TradingView temel verileri (son 12 ay / son çeyrek); sektör medyanı ' + (P.n || 0) + ' ' + (P.market && P.market !== 'BIST' ? P.market + ' şirketinden' : 'BIST şirketinden') + '.' };
  }
  function valueScoreFund(fund, peers, I, col) {
    if (!fund) return null; var e = [], s = 0, R = fund.returns || {}, items = (peers && peers.items) || [];
    function pctRank(key) { var vals = items.map(function (x) { return x.returns && x.returns[key]; }).filter(num); if (vals.length < 5 || !num(R[key])) return null; return vals.filter(function (v) { return v <= R[key]; }).length / vals.length; }
    var p1 = pctRank('y1'), p6 = pctRank('m6');
    if (num(p1)) s += ev(e, '1 yıllık getiri %' + r1(R.y1) + ' — kategorisindeki ' + items.length + ' fonun %' + Math.round(p1 * 100) + '\'inden iyi', Math.round((p1 - 0.5) * 40));
    if (num(p6)) s += ev(e, '6 aylık getiri %' + r1(R.m6) + ' — kategori yüzdeliği %' + Math.round(p6 * 100), Math.round((p6 - 0.5) * 20));
    var sh = TA.sharpe(col.c.slice(-253), 0), so = TA.sortino(col.c.slice(-253), 0);
    var fv = TA.annVol(col.c.slice(-253), 252);
    if (num(fv) && fv < 0.04) ev(e, 'Sharpe/Sortino değerlendirilmedi: oynaklık çok düşük (%' + r1(fv * 100) + '), oran anlamsız büyür', 0);
    else if (num(sh)) s += ev(e, 'Sharpe oranı (1 yıl, risksiz oran 0 varsayımı) ' + sh.toFixed(2) + ' · Sortino ' + (num(so) ? so.toFixed(2) : '—'), sh > 1.5 ? 10 : sh > 0.8 ? 5 : sh > 0 ? 0 : -10);
    var b = fund.benchmarks || {}; ['USD', 'ALTIN'].forEach(function (k) { var br = b[k] && b[k].returns && b[k].returns.y1; if (num(br) && num(R.y1)) s += ev(e, '1 yılda ' + b[k].name + ' (%' + r1(br) + ') ' + (R.y1 > br ? 'geride bırakıldı' : 'gerisinde kalındı'), R.y1 > br ? 5 : -5); });
    var hist = col.bars || [], inv0 = null, inv1 = null; if (hist.length > 130) { inv0 = hist[hist.length - 126].investors; inv1 = hist[hist.length - 1].investors; }
    if (num(inv0) && num(inv1) && inv0 > 0) s += ev(e, 'Yatırımcı sayısı 6 ayda ' + (inv1 >= inv0 ? '+' : '') + r1((inv1 / inv0 - 1) * 100) + '%', inv1 >= inv0 ? 5 : -5);
    var fl = fund.flows && fund.flows.m3; if (num(fl) && num(fund.size) && fund.size > 0) s += ev(e, '3 aylık net para girişi ' + (fl >= 0 ? '+' : '') + r1(fl / fund.size * 100) + '% (fon büyüklüğüne göre)', fl >= 0 ? 5 : -5);
    if (fund.liquidation_notice) s += ev(e, 'Tasfiye duyurusu var!', -40);
    return { score: Math.round(clamp(50 + s, 0, 100)), ev: e, note: 'Kaynak: TEFAS verisi (fon.yourapiservice.com); kategori = aynı fon türü.' };
  }
  function relScore(col, ctx, kind) {
    var e = [], s = 0, c = col.c, bm = ctx && ctx.benchBars;
    if (bm && bm.length > 130) {
      var map = {}; bm.forEach(function (b) { map[b.d] = b.c; });
      [[63, '3 ay'], [126, '6 ay']].forEach(function (w) {
        var n = col.d.length, i0 = n - 1 - w[0]; if (i0 < 0) return; var a0 = c[i0], a1 = c[n - 1], b0 = map[col.d[i0]], b1 = map[col.d[n - 1]] || map[bm[bm.length - 1].d];
        if (!num(a0) || !num(b0) || !num(b1)) return; var ex = (a1 / a0 - 1) - (b1 / b0 - 1); s += ev(e, w[1] + ': ' + ctx.benchName + '\'e göre ' + (ex >= 0 ? '+' : '') + r1(ex * 100) + ' puan', clamp(ex * 100, -25, 25));
      });
    }
    if (ctx && ctx.tv && ctx.benchTv && !/XKTUM/.test(ctx.benchName || '')) { var x = ctx.tv['Perf.6M'], y = ctx.benchTv['Perf.6M']; if (num(x) && num(y)) ev(e, '6 ay: Katılım Tüm endeksine (XKTUM) göre ' + (x - y >= 0 ? '+' : '') + r1(x - y) + ' puan (TradingView)', 0); }
    if (!e.length) return null;
    return { score: Math.round(clamp(50 + s, 0, 100)), ev: e };
  }
  function liquidityScore(col, kind, ctx) {
    var e = [], c = col.c, v = col.v, n = c.length, sc = null;
    if (kind === 'stock' || kind === 'etf' || kind === 'crypto') {
      var m = Math.min(30, n), tv = 0, cnt = 0; for (var i = n - m; i < n; i++) if (num(v[i])) { tv += v[i] * c[i]; cnt++; }
      if (!cnt) return null; var avg = tv / cnt;
      // v8.8.2: TL eşikleri yalnız TL işlem gören hisseye; ABD hissesi (USD) dolar eşikleriyle ölçülür (önceden TL eşiği USD hacme uygulanırdı → ~40 kat düşük likidite)
      var tlStock = kind === 'stock' && !(ctx && ctx.currency && ctx.currency !== 'TRY');
      if (tlStock) sc = interp(Math.log10(avg), [[6, 15], [6.7, 40], [7.3, 60], [8, 80], [8.7, 95]]);
      else sc = interp(Math.log10(avg), [[6, 20], [7, 50], [8, 80], [9, 95]]);
      ev(e, 'Günlük ortalama işlem hacmi (30 gün) ≈ ' + fmtBig(avg) + (tlStock ? ' TL' : ' ' + (ctx && ctx.currency === 'TRY' ? 'TL' : ctx && ctx.currency ? ctx.currency : 'USD')), 0);
      if (ctx && ctx.tv && num(ctx.tv.float_shares_percent_current)) ev(e, 'Halka açıklık %' + r1(ctx.tv.float_shares_percent_current), 0);
    } else if (kind === 'fund' && ctx && ctx.fund) {
      var sz = ctx.fund.size; if (!num(sz)) return null; sc = interp(Math.log10(sz), [[7.3, 25], [8, 50], [9, 75], [9.7, 90]]);
      ev(e, 'Fon büyüklüğü ' + fmtBig(sz) + ' TL, ' + (ctx.fund.investors || '—') + ' yatırımcı', 0);
    } else return null;
    return { score: Math.round(clamp(sc, 0, 100)), ev: e };
  }
  function fmtBig(x) { if (!num(x)) return '—'; var a = Math.abs(x); return a >= 1e9 ? (x / 1e9).toFixed(1).replace('.', ',') + ' milyar' : a >= 1e6 ? (x / 1e6).toFixed(1).replace('.', ',') + ' milyon' : a >= 1e3 ? Math.round(x / 1e3) + ' bin' : String(Math.round(x)); }
  var HALAL_SCORE = { uygun: 100, supheli: 50, uygun_degil: 0 };

  /* ---------- Planlar (yapıdan türetilir; sabit yüzde yok) ---------- */
  function confluence(price, lo, hi, ctx) { // bölgeyle çakışan diğer seviyeler
    var out = [], pad = 0.0; (ctx.levels || []).forEach(function (L) { if (num(L.p) && L.p >= lo - pad && L.p <= hi + pad) out.push(L.name); }); return out;
  }
  function plans(A) {
    var p = A.price, a = A.atr, zs = A.zones, fib = A.fib, pats = A.patterns, tl = A.trendlines, isFund = A.kind === 'fund';
    var res = { conservative: null, aggressive: null, notes: [] };
    if (!num(a) || !num(p)) { res.notes.push('ATR hesaplanamadığı için seviye üretilmedi.'); return res; }
    var levels = [];
    ['sma50', 'sma200'].forEach(function (k) { var v = last(A.ind[k]); if (num(v)) levels.push({ name: k === 'sma50' ? 'SMA50' : 'SMA200', p: v }); });
    if (fib) fib.retr.forEach(function (r) { levels.push({ name: 'Fib %' + (r.r * 100).toFixed(1).replace('.0', ''), p: r.p }); });
    if (A.ind.vp) { levels.push({ name: 'Hacim profili POC', p: A.ind.vp.poc }); }
    if (tl.support) levels.push({ name: 'Trend desteği', p: tl.support.value });
    var major = function (z) { return z.touches >= 3 || z.extreme; };
    var supports = zs.filter(function (z) { return z.hi < p || (z.role === 'inside' && z.mid <= p); }).sort(function (x, y) { return y.hi - x.hi; });
    // Temkinli giriş için güçlü (≥3 dokunuş) destek tercih edilir: 4 ATR içinde güçlü destek varsa zayıf olanın yerine o kullanılır
    var majorSup = supports.filter(function (z) { return major(z) && p - z.hi <= 4 * a; })[0];
    if (majorSup) supports = [majorSup].concat(supports.filter(function (z) { return z !== majorSup; }));
    var resists = zs.filter(function (z) { return z.lo > p; }).sort(function (x, y) { return x.lo - y.lo; }), resMajor = resists.filter(major);
    function targetsAbove(from, extra) {
      var t = [];
      resists.forEach(function (z) { if (z.lo > from + 0.3 * a) t.push({ p: z.lo, minor: !major(z), why: (major(z) ? 'Direnç bölgesi ' : 'Ara direnç (zayıf, kısmi kâr) ') + fmtP(z.lo) + '–' + fmtP(z.hi) + ' (' + z.touches + ' dokunuş)' }); });
      (extra || []).forEach(function (x) { if (num(x.p) && x.p > from + 0.3 * a) t.push(x); });
      if (fib && fib.up) fib.ext.forEach(function (x) { if (x.p > from + 0.3 * a) t.push({ p: x.p, why: 'Fibonacci uzantısı ' + x.r + ' (' + fmtP(fib.from.p) + '→' + fmtP(fib.to.p) + ' salınımı)' }); });
      if (tl.channelFromSupport && tl.channelFromSupport.valid && tl.channelFromSupport.value > from + 0.3 * a) t.push({ p: tl.channelFromSupport.value, why: 'Kanal üst bandı (' + tl.channelFromSupport.touches + ' dokunuş)' });
      t.sort(function (x, y) { return x.p - y.p; });
      var dedup = []; t.forEach(function (x) { var pr = dedup[dedup.length - 1]; if (!pr || x.p - pr.p > 0.5 * a) dedup.push(x); else if (pr.minor && !x.minor) dedup[dedup.length - 1] = x; });
      var out = [], majors = 0; dedup.forEach(function (x) { if (majors < 2 && out.length < 4) { out.push(x); if (!x.minor) majors++; } });
      return out;
    }
    var patT = pats.filter(function (x) { return x.dir > 0 && num(x.target); }).map(function (x) { return { p: x.target, why: x.name + ' ölçülen hareket hedefi (' + x.status + ')' }; });
    // Temkinli: en yakın destek bölgesinde kademeli alım, stop bölgenin altına 1 ATR tampon
    var sz = supports[0];
    if (sz) {
      var entryHi = Math.min(sz.hi, p), entryLo = sz.lo, mid = (entryHi + entryLo) / 2, stop = entryLo - 1.0 * a;
      var lowerSw = A.swings.filter(function (s) { return s.type === 'L' && s.p < entryLo && s.p > stop - 1.5 * a; }).pop();
      var why = ['Destek bölgesi ' + fmtP(sz.lo) + '–' + fmtP(sz.hi) + ' (' + sz.touches + ' dokunuş, ' + (sz.lows || 0) + ' dip)'];
      if (lowerSw) { stop = Math.min(stop, lowerSw.p - 0.5 * a); why.push('Stop, bölgenin hemen altındaki yapısal dibin (' + fmtP(lowerSw.p) + ') altına alındı'); }
      var cf = confluence(p, entryLo - 0.3 * a, entryHi + 0.3 * a, { levels: levels }); if (cf.length) why.push('Çakışan seviyeler: ' + cf.join(', '));
      var tg = targetsAbove(Math.max(mid, p), patT);
      res.conservative = mkPlan('Temkinli (düşük risk)', 'Destekte kademeli alım', entryLo, entryHi, stop, tg, why, isFund, 0.005);
    } else res.notes.push('Fiyatın altında güvenilir destek bölgesi bulunamadı — temkinli plan üretilmedi (dip arama yapılmaz).');
    // Atak: en yakın direncin kırılımında alım (veya yeni kırılmış direncin geri testinde)
    var rz = resMajor[0] && resMajor[0].lo - p <= 4 * a ? resMajor[0] : resists[0], brokeRecently = zs.filter(function (z) { return z.hi < p && z.hi > p - 2.5 * a && z.highs >= 1; }).sort(function (x, y) { return y.hi - x.hi; })[0];
    if (brokeRecently && A.scores.trend.score >= 55) {
      var e1 = brokeRecently.lo, e2 = brokeRecently.hi + 0.2 * a, st2 = brokeRecently.lo - 0.5 * a;
      res.aggressive = mkPlan('Atak (yüksek risk)', 'Kırılan direncin geri testinde alım', e1, e2, st2, targetsAbove(p, patT), ['Eski direnç ' + fmtP(brokeRecently.lo) + '–' + fmtP(brokeRecently.hi) + ' yukarı kırıldı; geri testte destek olması beklenir', 'Stop bölgenin 0,5 ATR altında'], isFund, 0.01);
    } else if (rz) {
      var trig = rz.hi + 0.2 * a, st3 = rz.lo - 0.5 * a, lastL = A.swings.filter(function (s) { return s.type === 'L' && s.p < trig; }).pop();
      if (lastL && lastL.p - 0.3 * a > st3 && lastL.p < rz.lo) st3 = lastL.p - 0.3 * a;
      if (trig - st3 < 1.0 * a) st3 = trig - 1.0 * a;
      var why3 = ['Direnç ' + fmtP(rz.lo) + '–' + fmtP(rz.hi) + ' (' + rz.touches + ' dokunuş) üzerinde ' + (TFX ? TFX + ' mum kapanışı' : 'günlük kapanış') + ' + 0,2 ATR onay', 'Kırılım hacimle desteklenmeli; stop kırılım bölgesinin altında'];
      var mm = rz.hi - (supports[0] ? supports[0].lo : rz.lo - 2 * a); var ex = patT.concat([{ p: rz.hi + mm, why: 'Ölçülen hareket (son destek–direnç aralığı kadar) ' + fmtP(rz.hi + mm) }]);
      res.aggressive = mkPlan('Atak (yüksek risk)', 'Direnç kırılımında alım (al-stop emri)', trig, trig, st3, targetsAbove(trig, ex), why3, isFund, 0.01);
    } else res.notes.push('Fiyat son bir yılın üstünde/zirvede: üstte direnç yok. Hedef yerine iz süren stop önerilir (Supertrend veya son dip − 0,5 ATR).');
    return res;
  }
  function mkPlan(name, how, lo, hi, stop, targets, why, isFund, riskFrac) {
    var mid = (lo + hi) / 2, risk = mid - stop, t = targets.map(function (x) { return { p: x.p, why: x.why, minor: !!x.minor, rr: risk > 0 ? (x.p - mid) / risk : null }; });
    var main = t.filter(function (x) { return !x.minor; })[0] || t[0], rr = main ? main.rr : null, ok = risk > 0 && num(rr) && rr >= 1.5; // R/R ilk güçlü hedefe göre
    return { name: name, how: how, entryLo: Math.min(lo, hi), entryHi: Math.max(lo, hi), entry: mid, stop: stop, stopLabel: isFund ? 'Gözden geçirme seviyesi (fonlarda stop emri yok)' : 'Zarar-kes (stop)', targets: t, rr: rr, riskPct: risk / mid,
      mainTarget: main || null, ok: ok, verdict: !t.length ? 'Hedef belirlenemedi — iz süren stop kullan' : ok ? 'Risk/ödül uygun (≥ 1,5)' : 'Risk/ödül yetersiz (< 1,5) — bekle', why: why, riskFrac: riskFrac };
  }
  function fmtP(x) { if (!num(x)) return '—'; var a = Math.abs(x); return x.toFixed(a >= 1000 ? 0 : a >= 100 ? 2 : a >= 1 ? 2 : 4).replace('.', ','); }
  // Pozisyon büyüklüğü: portföyün riskFrac'ı kadarını kaybetmeyi göze alarak; tek varlık sınırıyla kırpılır
  function sizing(plan, portfolioValue, maxSingleFrac) {
    if (!plan || !num(portfolioValue) || portfolioValue <= 0 || !(plan.entry > plan.stop)) return null;
    var riskMoney = portfolioValue * plan.riskFrac, units = riskMoney / (plan.entry - plan.stop), value = units * plan.entry, cap = num(maxSingleFrac) ? portfolioValue * maxSingleFrac : Infinity;
    return { riskMoney: riskMoney, value: Math.min(value, cap), capped: value > cap, units: Math.min(value, cap) / plan.entry };
  }

  /* ---------- Duruş (sinyal) ve satış kuralı ---------- */
  function stance(A, holding) {
    var t = A.total, tr = A.scores.trend.score, out = { code: 'neutral', label: 'Nötr — bekle', why: [] };
    if (A.blocked) return { code: 'nosignal', label: 'Sinyal yok — veri yetersiz/sorunlu', why: A.blockReasons };
    if (t >= 70 && tr >= 60) out = { code: 'strong', label: 'Güçlü görünüm', why: [] };
    else if (t >= 55) out = { code: 'positive', label: 'Olumlu — kontrollü/kademeli', why: [] };
    else if (t >= 45) out = { code: 'neutral', label: 'Nötr — bekle', why: [] };
    else if (t >= 30) out = { code: 'weak', label: 'Zayıf — yeni alım yok', why: [] };
    else out = { code: 'veryweak', label: 'Çok zayıf — yeni alım yok', why: [] };
    // Elde tutulan varlık: satış yalnızca dirençte yorgunluk kanıtı varsa
    if (holding) {
      var p = A.price, a = A.atr, atRes = A.zones.some(function (z) { return z.lo - 0.5 * a <= p && p <= z.hi + 0.5 * a && (z.highs || 0) >= 1 && z.mid >= p - a; });
      var weak = [], rsi = A.ind.rsi, n = rsi.length, h = A.ind.macd.hist;
      if (A.divergences.some(function (d) { return d.type === 'bear' && d.fresh; })) weak.push('Güncel negatif RSI uyumsuzluğu');
      if (num(rsi[n - 1]) && num(rsi[n - 3]) && Math.max(rsi[n - 2], rsi[n - 3]) > 70 && rsi[n - 1] < rsi[n - 2]) weak.push('RSI aşırı alımdan dönüyor');
      for (var k = Math.max(1, n - 5); k < n; k++) if (num(h[k]) && num(h[k - 1]) && h[k - 1] > 0 && h[k] <= 0) { weak.push('MACD son 5 ' + UNde() + ' aşağı kesti'); break; }
      if (A.ind.supertrend) { var d = A.ind.supertrend.dir; if (d[n - 1] === -1 && d.slice(-6, -1).indexOf(1) >= 0) weak.push('Supertrend düşüşe döndü'); }
      if (A.patterns.some(function (x) { return x.dir < 0 && x.status === 'onaylandı'; })) weak.push('Onaylı düşüş formasyonu');
      if (atRes && weak.length >= 2) { out.hold = { code: 'trim', label: 'Kısmi kâr al / azaltmayı gözden geçir', why: ['Fiyat direnç bölgesinde'].concat(weak) }; }
      else if (tr >= 60 && A.zones.some(function (z) { return z.hi < p && z.hi > p - 2 * a && (z.highs || 0) >= 1; })) {
        var trail = Math.max(A.ind.supertrend ? last(A.ind.supertrend.line) || -Infinity : -Infinity, (A.swings.filter(function (s) { return s.type === 'L' && !s.tentative; }).pop() || { p: -Infinity }).p - 0.5 * a);
        out.hold = { code: 'raise', label: 'Tut — hedefi yükselt, stopu yukarı çek', why: ['Direnç yukarı kırıldı ve trend güçlü'].concat(num(trail) && isFinite(trail) ? ['Önerilen iz süren stop: ' + fmtP(trail)] : []), trail: isFinite(trail) ? trail : null };
      } else out.hold = { code: 'hold', label: 'Tut', why: weak.length ? ['Zayıflık işaretleri var ama fiyat dirençte değil: ' + weak.join(', ')] : ['Satış için gereken koşul (dirençte yorulma) oluşmadı'] };
    }
    return out;
  }

  /* ---------- Ana analiz ---------- */
  // series: MData.load çıktısı; ctx: { fundamentals:{self,peers}, fundPeers, benchBars, benchName, benchTv, halal:{status,reason}, holding, portfolioValue, maxSingleFrac }
  function analyze(series, ctx) {
    TFX = series && series.tf && series.tf !== '1d' ? series.tf : null;
    try { return analyzeInner(series, ctx); } finally { TFX = null; }
  }
  // Yıllık periyot sayısı (gün içi): son 20 takvim gününde gün başına düşen mum sayısından ölçülür (BIST ~10/gün, kripto 24/gün)
  function periodsPerYear(bars, kind) {
    if (!TFX) return kind === 'crypto' ? 365 : 252;
    var n = bars.length, days = {}, cnt = 0; for (var i = Math.max(0, n - 200); i < n; i++) { days[String(bars[i].d).slice(0, 10)] = 1; cnt++; }
    var per = cnt / Math.max(1, Object.keys(days).length); return (kind === 'crypto' ? 365 : 252) * per;
  }
  function analyzeInner(series, ctx) {
    ctx = ctx || {}; var bars = series.bars || [], kind = series.kind || 'import', W = WEIGHTS[kind] || WEIGHTS.import;
    var A = { key: series.key, tf: TFX || '1d', kind: kind, name: series.name, currency: series.currency, n: bars.length, closeOnly: !!series.closeOnly, checks: series.checks || [], blocked: false, blockReasons: [], warnings: [] };
    if (bars.length < 30) { A.blocked = true; A.blockReasons.push('Yalnızca ' + bars.length + ' ' + UN() + ' veri var.'); A.total = null; A.confidence = 0; A.confLabel = 'Yetersiz'; A.scores = {}; A.stance = { code: 'nosignal', label: 'Sinyal yok — veri yetersiz', why: A.blockReasons }; return A; }
    var col = columns(bars); col.bars = bars;
    var I = indicators(col, A.closeOnly), atr = last(I.atr), price = col.c[col.c.length - 1];
    A.ind = I; A.col = col; A.price = price; A.atr = atr; A.lastDate = col.d[col.d.length - 1];
    var sw = ST.zigzag(col.h, col.l, I.atr, kind === 'fund' ? 3 : 2.5);
    A.swings = sw; A.zones = ST.zones(col.h, col.l, col.c, I.atr); A.trendlines = ST.trendlines(col.h, col.l, col.c, I.atr);
    A.fib = ST.fibonacci(sw, atr); A.patterns = A.closeOnly ? [] : ST.patterns(col, sw, I.atr, I.rsi); A.divergences = ST.divergences(col.h, col.l, I.rsi);
    // Çapalı VWAP: son onaylı zikzak dibinden (hacim varsa)
    if (I.hasVol) { var lastLow = sw.filter(function (s) { return s.type === 'L' && !s.tentative; }).pop(); if (lastLow) { I.vwap = TA.vwapAnchored(col.h, col.l, col.c, col.v, lastLow.i); I.vwapFrom = lastLow.i; } }
    // Alt skorlar
    var S = {};
    S.trend = trendScore(col, I, sw, A.trendlines);
    S.momentum = momentumScore(col, I, A.divergences);
    S.risk = riskScore(col, I, kind, { fundRisk: series.fund && series.fund.risk && series.fund.risk.score, ppy: periodsPerYear(bars, kind), currency: series.currency });
    // Çok düşük oynaklıklı fonlarda (kira sertifikası, katılım para piyasası gibi) fiyat neredeyse doğrusal artar: RSI/MACD anlamsızdır (RSI sürekli ~100).
    // Bu durumda momentum "uygulanamaz" sayılır; ağırlığı diğer alt skorlara dağıtılır ve güven düşürülmez.
    var vol60 = TA.annVol(col.c.slice(-121), 252);
    if (kind === 'fund' && vol60 != null && vol60 < 0.04) S.momentum = { score: null, na: true, ev: [{ t: 'Yıllık oynaklık %' + r1(vol60 * 100) + ' — fiyat neredeyse doğrusal; momentum göstergeleri bu fonda anlamlı değil', p: 0 }] };
    if (TFX) { // Gün içi: yalnız teknik (trend/momentum/risk). Temel, göreli güç ve likidite günlük analizde değerlendirilir.
      ['value', 'rel', 'liquidity'].forEach(function (k) { if (W[k]) S[k] = { score: null, na: true, ev: [{ t: 'Gün içi görünümde uygulanmaz — günlük analizde değerlendirilir', p: 0 }] }; });
    } else if (kind === 'stock') S.value = ctx.fundamentals ? valueScoreStock(ctx.fundamentals.self, ctx.fundamentals.peers) : null;
    if (kind === 'fund' && !TFX) S.value = valueScoreFund(series.fund, ctx.fundPeers, I, col);
    if (W.rel && !TFX) S.rel = relScore(col, { benchBars: ctx.benchBars, benchName: ctx.benchName, tv: series.tv, benchTv: ctx.benchTv }, kind);
    if (W.liquidity && !TFX) S.liquidity = liquidityScore(col, kind, { tv: (ctx.fundamentals && ctx.fundamentals.self) || series.tv, fund: series.fund, currency: series.currency });
    var hs = ctx.halal && ctx.halal.status; S.halal = { score: HALAL_SCORE[hs] != null ? HALAL_SCORE[hs] : null, ev: [{ t: ctx.halal ? (ctx.halal.label || hs) + (ctx.halal.reason ? ' — ' + ctx.halal.reason : '') : 'Bilinmiyor', p: 0 }], gate: true };
    A.scores = S;
    // Sentez: ağırlıklı ortalama (eksik alt skorların ağırlığı dağıtılır)
    var used = 0, tot = 0, missing = [], parts = [];
    Object.keys(W).forEach(function (k) { var sc = S[k]; if (sc && num(sc.score)) { used += W[k]; tot += W[k] * sc.score; parts.push({ k: k, w: W[k], s: sc.score }); } else missing.push(k); });
    A.total = used ? Math.round(tot / used) : null;
    A.synthesis = { weights: W, parts: parts.map(function (x) { return { k: x.k, label: SUB_LABEL[x.k], w: x.w, wEff: x.w / used, s: x.s, contrib: x.w / used * x.s }; }), missing: missing.map(function (k) { return SUB_LABEL[k]; }) };
    // Çapraz doğrulama
    var tvDate = series.live && series.live.barDate, sameBar = !!(series.tv && tvDate && tvDate === A.lastDate && (kind !== 'crypto' || true));
    A.xcheck = TFX ? { rows: [], compared: 0, ok: 0, note: 'Gün içi grafikte TradingView karşılaştırması yapılmaz (doğrulama günlük göstergelerle yapılır).' } : crossVerify(I, series.tv, price, kind === 'crypto' ? !!series.tv : sameBar);
    // Güven
    var conf = 100, cr = [];
    A.checks.forEach(function (c) { if (c.level === 'fail') { A.blocked = true; A.blockReasons.push(c.msg); } if (c.level === 'warn') { conf -= 10; cr.push('Veri uyarısı: ' + c.msg); } });
    if (A.closeOnly) { conf -= 15; cr.push('Yalnızca kapanış verisi (mum yok)'); }
    if (bars.length < 200) { conf -= 10; cr.push('200 ' + (TFX ? 'mumdan' : 'günden') + ' az veri'); }
    missing.forEach(function (k) { if (S[k] && S[k].na) return; conf -= 5; cr.push(SUB_LABEL[k] + ' hesaplanamadı'); });
    var bad = A.xcheck.rows.filter(function (r) { return !r.ok; }); if (bad.length) { conf -= Math.min(30, 10 * bad.length); cr.push('TradingView ile ' + bad.length + ' göstergede fark: ' + bad.map(function (r) { return r.name; }).join(', ')); }
    if (series.liveError && kind !== 'fund') { conf -= 5; cr.push('Canlı fiyat alınamadı: ' + series.liveError); }
    if (num(S.momentum.score) && Math.abs(S.trend.score - S.momentum.score) > 40) { conf -= 10; cr.push('Trend ve momentum çelişiyor'); }
    A.confidence = clamp(Math.round(conf), 0, 100); A.confReasons = cr; A.confLabel = confLabel(A.confidence);
    if (A.confidence < 35) { A.blocked = true; A.blockReasons.push('Güven düzeyi yetersiz (' + A.confidence + '/100).'); }
    // Planlar
    A.plans = plans(A);
    var halalOk = hs === 'uygun';
    A.halalOk = halalOk;
    if (!halalOk) A.plans.halalNote = 'Helal filtresi: bu varlık için alım planı önerilmez (durum: ' + (ctx.halal ? (ctx.halal.label || hs) : 'Bilinmiyor') + '). Analiz yalnızca piyasayı okumak içindir.';
    if (A.blocked) A.plans.blockedNote = 'Veri sorunu nedeniyle seviyeler yalnızca bilgi amaçlıdır; sinyal üretilmedi.';
    ['conservative', 'aggressive'].forEach(function (k) { var pl = A.plans[k]; if (pl) pl.size = sizing(pl, ctx.portfolioValue, ctx.maxSingleFrac); });
    A.stance = stance(A, ctx.holding);
    return A;
  }

  /* ---------- Portföy sağlık skoru ---------- */
  var HEALTH_W = { diversification: 15, concentration: 10, riskFit: 15, volatility: 10, emergency: 15, halal: 15, liquidity: 5, cost: 5, performance: 5, rules: 5 };
  var HEALTH_LABEL = { diversification: 'Çeşitlendirme', concentration: 'Yoğunlaşma', riskFit: 'Risk dağılımı uyumu', volatility: 'Oynaklık ve düşüş', emergency: 'Acil durum fonu', halal: 'Helal uyum', liquidity: 'Likidite', cost: 'Maliyet', performance: 'Performans', rules: 'Kural uyumu' };
  var PROFILE_CAPS = { low: { vol: 0.08, dd: 0.10 }, medium: { vol: 0.15, dd: 0.20 }, high: { vol: 0.25, dd: 0.35 } };
  // inp: { positions:[{name, value, tier, halal, liquid, kind}], target:{safe,medium,risky} (bp), current:{...}, emergency:{have, need}, rules:{ok,total,items}, fees, invested,
  //        perf:{xirr, bench, benchLabel}, profile:'low'|'medium'|'high', corr:{vol, mdd, nEffCorr} | null, maxSingleBp }
  function health(inp) {
    var S = {}, fixes = [], pos = (inp.positions || []).filter(function (p) { return p.value > 0; }), tot = pos.reduce(function (s, p) { return s + p.value; }, 0);
    function put(k, score, ev, fix) { S[k] = { score: score == null ? null : Math.round(clamp(score, 0, 100)), ev: ev, label: HEALTH_LABEL[k] }; if (fix && score != null && score < 70) fixes.push({ k: k, score: Math.round(score), text: fix.text, link: fix.link }); }
    if (tot > 0) {
      var w = pos.map(function (p) { return p.value / tot; }), hhi = w.reduce(function (s, x) { return s + x * x; }, 0), nEff = 1 / hhi, nUse = inp.corr && num(inp.corr.nEffCorr) ? Math.min(nEff, inp.corr.nEffCorr) : nEff;
      put('diversification', interp(nUse, [[1, 10], [2, 35], [3, 55], [5, 80], [8, 100]]), ['Etkin varlık sayısı (1/HHI) ' + r1(nEff) + (inp.corr && num(inp.corr.nEffCorr) ? ' · korelasyona göre etkin sayı ' + r1(inp.corr.nEffCorr) : ' · korelasyon hesaplanmadı')],
        { text: 'Birbirine benzemeyen (korelasyonu düşük) helal varlıklar ekle: ör. altın + kira sertifikası fonu + Katılım hisse fonu.', link: '#analiz/olustur' });
      var mx = Math.max.apply(null, w), lim = (inp.maxSingleBp || 2500) / 10000, top = pos[w.indexOf(mx)];
      put('concentration', mx <= lim ? 100 : 100 - (mx - lim) * 250, ['En büyük pay: ' + top.name + ' %' + r1(mx * 100) + ' (sınır %' + r1(lim * 100) + ')'], { text: top.name + ' payı sınırın üstünde; yeni parayı diğer varlıklara yönlendir.', link: '#portfoy/dengeleme' });
      var liq = pos.filter(function (p) { return p.liquid; }).reduce(function (s, p) { return s + p.value; }, 0) / tot;
      put('liquidity', interp(liq, [[0.3, 20], [0.6, 60], [0.8, 100]]), ['Piyasa fiyatı olan (kolay nakde dönen) varlıkların payı %' + r1(liq * 100)], { text: 'Elle değerlenen/likit olmayan varlıkların payı yüksek.', link: '#portfoy/varliklar' });
      var hv = { uygun: 0, supheli: 0, uygun_degil: 0, bilinmiyor: 0 }; pos.forEach(function (p) { hv[p.halal in hv ? p.halal : 'bilinmiyor'] += p.value / tot; });
      var hsc = 100 * hv.uygun + 50 * hv.supheli + 30 * hv.bilinmiyor; if (hv.uygun_degil > 0) hsc = Math.min(hsc, 40);
      put('halal', hsc, ['Uygun %' + r1(hv.uygun * 100) + ' · şüpheli %' + r1(hv.supheli * 100) + ' · uygun değil %' + r1(hv.uygun_degil * 100) + ' · bilinmiyor %' + r1(hv.bilinmiyor * 100)],
        { text: hv.uygun_degil > 0 ? 'Uygun olmayan (faizli) varlıkları helal alternatiflere taşı.' : 'Helal durumu bilinmeyen/şüpheli varlıkları etiketle veya Katılım alternatifleriyle değiştir.', link: '#portfoy/risk' });
    } else { ['diversification', 'concentration', 'liquidity', 'halal'].forEach(function (k) { put(k, null, ['Yatırım yok']); }); }
    if (inp.target && inp.current) { var drift = (Math.abs(inp.current.safe - inp.target.safe) + Math.abs(inp.current.medium - inp.target.medium) + Math.abs(inp.current.risky - inp.target.risky)) / 2 / 100;
      put('riskFit', interp(drift, [[0, 100], [10, 70], [20, 40], [35, 10]]), ['Hedef dağılımdan toplam sapma ' + r1(drift) + ' puan (güvenli/orta/riskli)'], { text: 'Risk gruplarını hedefe yaklaştır: Dengeleme sayfasındaki alım önerilerini uygula.', link: '#portfoy/dengeleme' }); }
    else put('riskFit', null, ['Hedef dağılım yok']);
    if (inp.corr && (num(inp.corr.vol) || num(inp.corr.mdd))) {
      var cap = PROFILE_CAPS[inp.profile || 'medium'], vs = num(inp.corr.vol) ? interp(inp.corr.vol / cap.vol, [[0.8, 100], [1, 85], [1.5, 45], [2.2, 10]]) : null, ds = num(inp.corr.mdd) ? interp(Math.abs(inp.corr.mdd) / cap.dd, [[0.8, 100], [1, 85], [1.5, 45], [2.2, 10]]) : null;
      var vv = [vs, ds].filter(num); put('volatility', vv.reduce(function (s, x) { return s + x; }, 0) / vv.length, ['Yıllık oynaklık %' + (num(inp.corr.vol) ? r1(inp.corr.vol * 100) : '—') + ' (profil sınırı %' + Math.round(cap.vol * 100) + ') · en büyük düşüş %' + (num(inp.corr.mdd) ? r1(inp.corr.mdd * 100) : '—') + ' (sınır %' + Math.round(cap.dd * 100) + ')'],
        { text: 'Portföy oynaklığı risk profilinin üstünde: riskli payı azalt veya düşük korelasyonlu güvenli varlık ekle.', link: '#analiz/olustur' });
    } else put('volatility', null, ['Oynaklık/düşüş için varlık geçmişleri yüklenmedi ("Korelasyon ve oynaklığı hesapla")']);
    if (inp.emergency) { var em = inp.emergency.need > 0 ? inp.emergency.have / inp.emergency.need : 1; put('emergency', clamp(em, 0, 1) * 100, ['Acil fon ' + Math.round(clamp(em, 0, 9) * 100) + '% dolu'], { text: 'Önce acil durum fonunu tamamla (katılım hesabı / kısa vadeli kira sertifikası fonu).', link: '#portfoy/risk' }); }
    if (num(inp.invested) && inp.invested > 0 && num(inp.fees)) { var fr = inp.fees / inp.invested; put('cost', interp(fr * 100, [[0.2, 100], [0.5, 80], [1, 50], [2, 20]]), ['Ödenen komisyon/ücret, yatırılan paranın %' + (fr * 100).toFixed(2).replace('.', ',') + '\'i'], { text: 'İşlem sıklığını azalt veya daha düşük komisyonlu kurum/fon seç.', link: '#portfoy/islemler' }); }
    else put('cost', null, ['Alım-satım kaydı yok']);
    if (inp.perf && num(inp.perf.xirr) && num(inp.perf.bench)) { var ex = inp.perf.xirr - inp.perf.bench; put('performance', interp(ex * 100, [[-15, 15], [-5, 45], [0, 70], [5, 90], [10, 100]]), ['Yıllık getiri %' + r1(inp.perf.xirr * 100) + ' — ' + inp.perf.benchLabel + ' %' + r1(inp.perf.bench * 100)], { text: inp.perf.benchLabel + ' gerisinde kalınıyor: zayıf skorlu varlıkları Analiz\'de incele.', link: '#analiz' }); }
    else put('performance', null, ['Kıyas için yeterli getiri geçmişi yok']);
    if (inp.rules && inp.rules.total) put('rules', inp.rules.ok / inp.rules.total * 100, [inp.rules.ok + '/' + inp.rules.total + ' risk kuralı tamam'], { text: 'Risk kuralı uyarılarını gider.', link: '#portfoy/risk' });
    var used = 0, sum = 0, missing = []; Object.keys(HEALTH_W).forEach(function (k) { var s = S[k]; if (s && num(s.score)) { used += HEALTH_W[k]; sum += HEALTH_W[k] * s.score; } else missing.push(HEALTH_LABEL[k]); });
    var total = used ? Math.round(sum / used) : null;
    fixes.sort(function (a, b) { return (HEALTH_W[b.k] * (100 - b.score)) - (HEALTH_W[a.k] * (100 - a.score)); });
    return { total: total, grade: total == null ? '—' : total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'E', scores: S, weights: HEALTH_W, missing: missing, coverage: used / 100, fixes: fixes };
  }
  // Korelasyon tabanlı etkin varlık sayısı ve portföy oynaklığı (günlük getiriler, ortak tarihler)
  function portfolioRisk(seriesList, weights) {
    var maps = seriesList.map(function (s) { var m = {}; s.forEach(function (b) { m[b.d] = b.c; }); return m; });
    var dates = Object.keys(maps[0] || {}).filter(function (d) { return maps.every(function (m) { return num(m[d]); }); }).sort().slice(-253);
    if (dates.length < 60) return { error: 'Ortak tarihli yeterli veri yok (' + dates.length + ' gün)' };
    var R = maps.map(function (m) { var r = []; for (var i = 1; i < dates.length; i++) r.push(m[dates[i]] / m[dates[i - 1]] - 1); return r; });
    var n = R.length, sd = R.map(function (r) { return TA.sd(r); }), cov = [];
    for (var i = 0; i < n; i++) { cov.push([]); for (var j = 0; j < n; j++) { var mi = TA.mean(R[i]), mj = TA.mean(R[j]), s = 0; for (var k = 0; k < R[i].length; k++) s += (R[i][k] - mi) * (R[j][k] - mj); cov[i].push(s / (R[i].length - 1)); } }
    var wsum = weights.reduce(function (s, x) { return s + x; }, 0), w = weights.map(function (x) { return x / wsum; }), varP = 0;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) varP += w[i] * w[j] * cov[i][j];
    var volP = Math.sqrt(varP), wsd = w.reduce(function (s, x, q) { return s + x * sd[q]; }, 0), dr = volP > 0 ? wsd / volP : null;
    var nav = [1]; for (k = 0; k < R[0].length; k++) { var rp = 0; for (i = 0; i < n; i++) rp += w[i] * R[i][k]; nav.push(nav[nav.length - 1] * (1 + rp)); }
    var corr = cov.map(function (row, a) { return row.map(function (c, b) { return sd[a] && sd[b] ? c / (sd[a] * sd[b]) : null; }); });
    return { days: dates.length, from: dates[0], to: dates[dates.length - 1], vol: volP * Math.sqrt(252), divRatio: dr, nEffCorr: dr ? dr * dr : null, mdd: TA.maxDrawdown(nav).mdd, corr: corr };
  }

  /* ---------- Portföy oluşturucu ---------- */
  var TIER_MATRIX = { // [güvenli, orta, riskli] baz puan — vade × risk
    short: { low: [9000, 1000, 0], medium: [7500, 2000, 500], high: [6000, 2500, 1500] },
    medium: { low: [7000, 2500, 500], medium: [5000, 3000, 2000], high: [3500, 3000, 3500] },
    long: { low: [5500, 3000, 1500], medium: [3500, 3000, 3500], high: [2000, 2500, 5500] }
  };
  var GLIDE_FOR_RISK = { low: 'conservative', medium: 'standard', high: 'aggressive' };
  // Fon seçimi: İslami etiketli, aktif, tasfiyede olmayan; ölçüt = 1 yıl getirisi (büyüklük ≥ eşik), eşitlikte büyüklük
  function pickFunds(items, filter, nPick, minSize) {
    var c = items.filter(function (f) { return f.active !== false && !f.liquidation_notice && f.tags && f.tags.islamic && filter(f) && num(f.size) && f.size >= (minSize || 2e8) && f.returns && num(f.returns.y1); });
    c.sort(function (a, b) { return (b.returns.y1 - a.returns.y1) || (b.size - a.size); });
    return c.slice(0, nPick);
  }
  function stockPickScore(r) { // Katılım Tüm hisseleri için deterministik kalite-momentum taraması (öneri değil, inceleme listesi)
    var s = 0, why = [];
    if (num(r.close) && num(r.SMA200)) { if (r.close > r.SMA200) { s += 25; why.push('200 günlük ortalamanın üstünde'); } }
    if (num(r.SMA50) && num(r.SMA200) && r.SMA50 > r.SMA200) { s += 15; why.push('SMA50 > SMA200'); }
    if (num(r['Perf.6M'])) s += clamp(r['Perf.6M'] / 2, -15, 20);
    if (num(r.return_on_equity) && r.return_on_equity > 20) { s += 10; why.push('ÖK kârlılığı %' + Math.round(r.return_on_equity)); }
    if (num(r.debt_to_equity) && r.debt_to_equity < 1) { s += 10; why.push('düşük borç'); }
    if (num(r.price_earnings_ttm) && r.price_earnings_ttm > 0 && r.price_earnings_ttm < 25) { s += 10; why.push('F/K ' + r1(r.price_earnings_ttm)); }
    if (num(r.RSI) && r.RSI > 75) { s -= 10; why.push('aşırı alım'); }
    var liq = num(r.average_volume_30d_calc) && num(r.close) ? r.average_volume_30d_calc * r.close : 0; if (liq < 5e7) s -= 30;
    return { s: Math.round(s), why: why, liq: liq };
  }
  // prof: {horizon, risk, halal, usd}; uni: { funds:[TEFAS listesi], stocks:[katilimScreen rows], etfs:['SPUS','HLAL'] }
  function buildPortfolio(prof, uni) {
    var tiers = TIER_MATRIX[prof.horizon] && TIER_MATRIX[prof.horizon][prof.risk]; if (!tiers) throw new Error('Geçersiz profil');
    var funds = (uni && uni.funds) || [], blocks = [], notes = [];
    function add(tier, share, item) { blocks.push({ tier: tier, shareOfTier: share, item: item }); }
    var isMM = function (f) { return /para piyasası/i.test(f.type) || (/kira sertifikası/i.test(f.type) && (f.risk && f.risk.score <= 2)); };
    var safe = pickFunds(funds, isMM, 2, 5e8);
    if (safe.length) safe.forEach(function (f, i) { add('safe', safe.length === 2 ? [6000, 4000][i] : 10000, fundItem(f, 'Katılım para piyasası / kira sertifikası fonu — düşük oynaklık, likit')); });
    else add('safe', 10000, { key: null, name: 'Katılım hesabı (TL)', cls: 'cash', why: 'Uygun fon verisi alınamadı; katılım bankası hesabı', generic: true });
    var gold = pickFunds(funds, function (f) { return /altın|kıymetli|değerli maden/i.test(f.name + ' ' + f.type); }, 1, 2e8);
    var mixed = pickFunds(funds, function (f) { return /karma|değişken|çoklu|fon sepeti|katılım/i.test(f.type) && !/para piyasası|kira sertifikası|hisse/i.test(f.type) && (f.stock_pct || 0) < 70; }, 1, 2e8);
    add('medium', mixed.length ? 6000 : 10000, { key: 'metal:XAU', name: 'Gram altın (fiziki / katılım bankası altın hesabı)', cls: 'gold', why: 'Enflasyon ve kur riskine karşı koruma; TL varlıklarla korelasyonu düşük' });
    if (gold.length) notes.push('Altına fon yoluyla da yatırılabilir: ' + gold[0].code + ' (' + gold[0].name + ').');
    if (mixed.length) add('medium', 4000, fundItem(mixed[0], 'Katılım karma/değişken fon — profesyonel varlık dağılımı'));
    if (tiers[2] > 0) {
      var eq = pickFunds(funds, function (f) { return /hisse/i.test(f.type) || (f.stock_pct || 0) >= 70; }, 1, 2e8);
      var parts = [];
      if (eq.length) parts.push(['fund', eq[0]]);
      if (prof.usd !== false) parts.push(['etf', 'SPUS']);
      var stocks = ((uni && uni.stocks) || []).map(function (r) { var sc = stockPickScore(r); return { r: r, sc: sc }; }).filter(function (x) { return x.sc.s >= 40; }).sort(function (a, b) { return b.sc.s - a.sc.s; }).slice(0, 3);
      if (stocks.length && prof.risk !== 'low') parts.push(['stocks', stocks]);
      var shares = parts.length === 3 ? [5000, 3000, 2000] : parts.length === 2 ? [6000, 4000] : [10000];
      parts.forEach(function (pt, i) {
        if (pt[0] === 'fund') add('risky', shares[i], fundItem(pt[1], 'Katılım hisse senedi fonu — Katılım endeksi hisselerine çeşitlendirilmiş erişim'));
        if (pt[0] === 'etf') add('risky', shares[i], { key: 'us:SPUS', priceKey: 'td:SPUS', name: 'SPUS — S&P 500 Şer\'i endeks ETF (USD)', cls: 'halal_etf', currency: 'USD', lot: 'whole', why: 'ABD büyük şirketleri, Şer\'i tarama; dolar bazlı çeşitlendirme' });
        if (pt[0] === 'stocks') { var each = M_alloc(shares[i], pt[1].length); pt[1].forEach(function (x, j) { add('risky', each[j], { key: 'bist:' + x.r.name, priceKey: 'bist:' + x.r.name, name: x.r.name + ' — ' + (x.r.description || ''), cls: 'katilim_stock', lot: 'whole', why: 'Katılım Tüm endeksinde; tarama puanı ' + x.sc.s + ' (' + x.sc.why.join(', ') + '). Analizini mutlaka incele.', screen: x.sc }); }); }
      });
      if (!parts.length) add('risky', 10000, { key: null, name: 'Katılım hisse fonu', cls: 'katilim_fund', why: 'Fon verisi alınamadı', generic: true });
    }
    blocks.forEach(function (b) { b.weightBp = Math.round(tiers[['safe', 'medium', 'risky'].indexOf(b.tier)] * b.shareOfTier / 10000); });
    var diff = 10000 - blocks.reduce(function (s, b) { return s + b.weightBp; }, 0); if (blocks.length && diff) { var big = blocks.reduce(function (m, b) { return b.weightBp > m.weightBp ? b : m; }); big.weightBp += diff; }
    notes.push('Kripto paralar helal açıdan tartışmalı (şüpheli) olduğu için oluşturucuya eklenmez.');
    return { profile: prof, tiers: { safe: tiers[0], medium: tiers[1], risky: tiers[2] }, glide: GLIDE_FOR_RISK[prof.risk], blocks: blocks.filter(function (b) { return b.weightBp > 0; }), notes: notes };
  }
  function M_alloc(total, n) { var base = Math.floor(total / n), out = []; for (var i = 0; i < n; i++) out.push(base); out[0] += total - base * n; return out; }
  function fundItem(f, why) { return { key: 'tefas:' + f.code, priceKey: 'tefas:' + f.code, name: f.code + ' — ' + f.name, cls: /kira/i.test(f.type) ? 'sukuk' : 'katilim_fund', why: why + ' · 1Y %' + r1(f.returns.y1) + ', büyüklük ' + fmtBig(f.size) + ' TL, risk ' + (f.risk ? f.risk.score : '—') + '/7', fund: { code: f.code, type: f.type, y1: f.returns.y1, size: f.size, risk: f.risk && f.risk.score } }; }
  // Geçmiş test: aylık yeniden dengelenen karışımın günlük değeri (ortak tarihler). series: [{d,c}] dizileri, w: ağırlıklar
  function backtest(seriesList, w) {
    var maps = seriesList.map(function (s) { var m = {}; s.forEach(function (b) { m[b.d] = b.c; }); return m; });
    var dates = Object.keys(maps[0] || {}).filter(function (d) { return maps.every(function (m) { return num(m[d]); }); }).sort();
    if (dates.length < 120) return { error: 'Ortak tarihli yeterli geçmiş yok (' + dates.length + ' gün)' };
    var ws = w.reduce(function (s, x) { return s + x; }, 0), wt = w.map(function (x) { return x / ws; }), units = null, nav = [], curM = null;
    dates.forEach(function (d) {
      var pr = maps.map(function (m) { return m[d]; }), val = units ? units.reduce(function (s, u, i) { return s + u * pr[i]; }, 0) : 1;
      if (!units || d.slice(0, 7) !== curM) { units = wt.map(function (x, i) { return val * x / pr[i]; }); curM = d.slice(0, 7); }
      nav.push({ d: d, c: val });
    });
    var c = nav.map(function (x) { return x.c; }), days = TA_days(dates[0], dates[dates.length - 1]), r12 = [];
    for (var i = 252; i < c.length; i++) r12.push(c[i] / c[i - 252] - 1);
    return { from: dates[0], to: dates[dates.length - 1], days: dates.length, nav: nav, cagr: TA.cagr(c, days), vol: TA.annVol(c, 252), mdd: TA.maxDrawdown(c).mdd, worst12: r12.length ? Math.min.apply(null, r12) : null, best12: r12.length ? Math.max.apply(null, r12) : null };
  }
  function TA_days(a, b) { var p = function (s) { var x = s.split('-'); return Date.UTC(+x[0], +x[1] - 1, +x[2]) / 86400000; }; return p(b) - p(a); }

  return { WEIGHTS: WEIGHTS, SUB_LABEL: SUB_LABEL, VOL_BASE: VOL_BASE, XCHECK: XCHECK, HEALTH_W: HEALTH_W, HEALTH_LABEL: HEALTH_LABEL, PROFILE_CAPS: PROFILE_CAPS, TIER_MATRIX: TIER_MATRIX, GLIDE_FOR_RISK: GLIDE_FOR_RISK,
    columns: columns, indicators: indicators, crossVerify: crossVerify, trendScore: trendScore, momentumScore: momentumScore, riskScore: riskScore, valueScoreStock: valueScoreStock, valueScoreFund: valueScoreFund,
    relScore: relScore, liquidityScore: liquidityScore, plans: plans, mkPlan: mkPlan, sizing: sizing, stance: stance, analyze: analyze, confLabel: confLabel, interp: interp, fmtP: fmtP, fmtBig: fmtBig,
    health: health, portfolioRisk: portfolioRisk, buildPortfolio: buildPortfolio, stockPickScore: stockPickScore, pickFunds: pickFunds, backtest: backtest };
});
