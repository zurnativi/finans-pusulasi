/* mdata.js — Analiz için piyasa verisi katmanı: geçmiş mumlar (OHLCV), canlı son fiyat, temel veriler, fon ayrıntısı ve veri sağlık kontrolleri.
 * İlke: hiçbir değer uydurulmaz. Her seri kaynağını, çekilme saatini ve son mum tarihini taşır; kontroller (checkBars) sorunları açıkça raporlar.
 * Kaynaklar (Kasım 2026'da tarayıcıdan CORS ile canlı test edildi):
 *  - BIST hisse/endeks, altın/gümüş ons, USD/EUR-TL, helal ABD ETF'leri: bu deponun `market-data` dalı (GitHub Actions her iş günü derler; kaynak Yahoo
 *    Finance chart API, BIST kapanışları İş Yatırım ile çapraz kontrol) → raw.githubusercontent.com
 *  - Canlı/son fiyat + TradingView'in kendi gösterge değerleri (çapraz doğrulama) + BIST temel oranları: scanner.tradingview.com (resmi olmayan, BIST 15 dk gecikmeli)
 *  - Kripto mumları: Binance (data-api.binance.vision), fonlama oranı: fapi.binance.com, Korku-Açgözlülük: alternative.me, arama: CoinGecko
 *  - TEFAS fonları: fon.yourapiservice.com (TEFAS verisi, günde bir; fiyat geçmişi, getiriler, risk, varlık dağılımı, KAP portföyü, İslami etiket)
 *  - ABD hisse/ETF (listede olmayanlar): Twelve Data (kullanıcının ücretsiz anahtarı ile)
 *  - Diğer her şey: kullanıcının yüklediği CSV/Excel/yapıştırılan OHLCV */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ta.js'));
  else root.MData = factory(root.TA);
})(typeof self !== 'undefined' ? self : this, function (TA) {
  'use strict';
  var num = TA.num;
  var REPO_RAW = 'https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/';
  var URL = {
    mdIndex: REPO_RAW + 'index.json',
    md: function (kind, sym) { return REPO_RAW + kind + '/' + encodeURIComponent(sym) + '.json'; },
    h1: function (kind, sym) { return REPO_RAW + 'h1/' + kind + '/' + encodeURIComponent(sym) + '.json'; },
    kap: function (sym) { return REPO_RAW + 'kap/' + encodeURIComponent(sym) + '.json'; },
    newsSym: function (sym) { return REPO_RAW + 'news/bist/' + encodeURIComponent(sym) + '.json'; },
    newsTopic: function (t) { return REPO_RAW + 'news/topic/' + t + '.json'; },
    tvSymbol: function (tv, fields) { return 'https://scanner.tradingview.com/symbol?symbol=' + encodeURIComponent(tv) + '&fields=' + fields.join(','); },
    tvScan: function (market) { return 'https://scanner.tradingview.com/' + market + '/scan'; },
    binKlines: function (sym, interval, limit) { return 'https://data-api.binance.vision/api/v3/klines?symbol=' + sym + '&interval=' + (interval || '1d') + '&limit=' + (limit || 1000); },
    binFunding: function (sym) { return 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + sym; },
    binOI: function (sym) { return 'https://fapi.binance.com/fapi/v1/openInterest?symbol=' + sym; },
    fng: 'https://api.alternative.me/fng/?limit=30',
    cgSearch: function (q) { return 'https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(q); },
    tefas: function (code, days) { return 'https://fon.yourapiservice.com/api/v1/funds/' + encodeURIComponent(code) + '?history=' + (days || 1095); },
    tefasList: function (q) { return 'https://fon.yourapiservice.com/api/v1/funds?' + q; },
    twelve: function (sym, key) { return 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(sym) + '&interval=1day&outputsize=1000&apikey=' + encodeURIComponent(key); },
    gdelt: function (q) { return 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) + '&mode=artlist&format=json&maxrecords=15&timespan=14d&sort=datedesc'; }
  };
  var SOURCES = {
    md: 'Yahoo Finance (GitHub Actions ile günlük derlenir, depo: market-data dalı)',
    tv: 'TradingView tarayıcı (resmi olmayan; BIST 15 dk gecikmeli)',
    binance: 'Binance spot (USDT paritesi)',
    tefas: 'TEFAS verisi — fon.yourapiservice.com (günde bir)',
    twelve: 'Twelve Data (ücretsiz anahtar)',
    imp: 'Kullanıcının yüklediği dosya'
  };
  /* TradingView sembolleri (çapraz doğrulama ve canlı fiyat) */
  var TV_US = { SPUS: 'AMEX:SPUS', HLAL: 'NASDAQ:HLAL', SPSK: 'AMEX:SPSK', SPRE: 'AMEX:SPRE', SPTE: 'AMEX:SPTE', SPWO: 'AMEX:SPWO', UMMA: 'NASDAQ:UMMA' };
  var TV_MACRO = { XAUUSD: 'COMEX:GC1!', XAGUSD: 'COMEX:SI1!', USDTRY: 'FX_IDC:USDTRY', EURTRY: 'FX_IDC:EURTRY' };
  var TV_FIELDS = ['close', 'open', 'high', 'low', 'volume', 'time', 'RSI', 'ATR', 'ADX', 'MACD.macd', 'MACD.signal', 'SMA20', 'SMA50', 'SMA200', 'EMA20', 'EMA50', 'BB.upper', 'BB.lower', 'Ichimoku.BLine', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'currency'];
  var FUND_FIELDS = ['description', 'sector', 'industry', 'market_cap_basic', 'price_earnings_ttm', 'price_book_fq', 'enterprise_value_ebitda_ttm', 'price_sales_current', 'return_on_equity', 'net_margin', 'operating_margin',
    'gross_margin', 'debt_to_equity', 'current_ratio', 'total_revenue_yoy_growth_ttm', 'net_income_yoy_growth_ttm', 'earnings_per_share_basic_ttm', 'dividend_yield_recent', 'free_cash_flow_ttm', 'float_shares_percent_current',
    'average_volume_30d_calc', 'price_52_week_high', 'price_52_week_low', 'beta_1_year', 'Recommend.All', 'update_mode'];

  /* ---------- Ağ ---------- */
  function fetchJson(url, opts) {
    opts = opts || {};
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 20000) : null;
    var init = { signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit' };
    if (opts.body) { init.method = 'POST'; init.headers = { 'Content-Type': 'text/plain;charset=UTF-8' }; /* basit istek: CORS ön kontrolü (preflight) olmasın */ init.body = JSON.stringify(opts.body); }
    return fetch(url, init).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }, function (e) { if (t) clearTimeout(t); throw new Error(e && e.name === 'AbortError' ? 'zaman aşımı' : 'ağ hatası (' + (e && e.message || e) + ')'); });
  }
  var cache = {};
  function cached(key, ms, fn) { var c = cache[key]; if (c && Date.now() - c.t < ms) return c.p; var p = fn(); cache[key] = { t: Date.now(), p: p }; p.catch(function () { delete cache[key]; }); return p; }

  /* ---------- Tarih yardımcıları (İstanbul = UTC+3, yaz saati yok) ---------- */
  function ymdOfMs(ms, offH) { var d = new Date(ms + (offH == null ? 3 : offH) * 3600000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function dayNum(ymd) { var p = ymd.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
  function dow(ymd) { return new Date(dayNum(ymd) * 86400000).getUTCDay(); }
  function businessDaysBetween(a, b) { // a (hariç) → b (dahil) arası hafta içi gün sayısı
    if (b <= a) return 0; var n = 0, x = dayNum(a) + 1, y = dayNum(b); for (; x <= y; x++) { var w = new Date(x * 86400000).getUTCDay(); if (w !== 0 && w !== 6) n++; } return n;
  }

  /* ---------- Ayrıştırıcılar (saf, testli) ---------- */
  function parseMd(j) {
    if (!j || !Array.isArray(j.bars)) throw new Error('Veri dosyası biçimi tanınmadı');
    var bars = j.bars.map(function (b) { return { d: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: num(b[5]) && b[5] > 0 ? b[5] : null }; });
    return { bars: bars, currency: j.currency || null, fetchedAt: j.fetchedAt || null, source: j.source || SOURCES.md, check: j.check || null, splits: j.splits || [], dividends: j.dividends || [], stale: !!j.stale, lastError: j.lastError || null, name: j.name || null, sector: j.sector || null, katilim: j.katilim || [], droppedRows: j.droppedRows || 0 };
  }
  function parseBinanceKlines(arr, nowMs) {
    if (!Array.isArray(arr)) throw new Error('Binance yanıtı tanınmadı');
    var bars = arr.map(function (k) { return { d: ymdOfMs(k[0], 0), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], closeMs: k[6] }; });
    if (bars.length && nowMs && bars[bars.length - 1].closeMs > nowMs) bars[bars.length - 1].partial = true; // gün henüz kapanmadı (canlı mum)
    return bars;
  }
  function parseTefasHistory(j) {
    var h = (j && j.history) || [];
    return h.filter(function (x) { return num(x.price) && x.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.date); }).map(function (x) { return { d: x.date, o: null, h: null, l: null, c: x.price, v: null, size: x.size, investors: x.investors }; })
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; }); // kaynak sırası garanti değil; tekrarlar checkBars'ta yakalanır
  }
  function parseTwelve(j) {
    if (!j || j.status === 'error' || !Array.isArray(j.values)) throw new Error('Twelve Data: ' + ((j && j.message) || 'yanıt yok'));
    return { currency: (j.meta && j.meta.currency) || null, bars: j.values.map(function (v) { return { d: String(v.datetime).slice(0, 10), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: v.volume != null ? +v.volume : null }; }).reverse() };
  }
  function tvBarDate(timeSec) { return num(timeSec) ? ymdOfMs(timeSec * 1000, 3) : null; }
  // Canlı/son mumu geçmişe ekle: aynı günse yerine koy (daha taze), yeni günse ekle, eskiyse dokunma
  function mergeLive(bars, live) {
    if (!live || !live.d || !num(live.c) || !bars.length) return { bars: bars, action: 'none' };
    var lastB = bars[bars.length - 1], out = bars.slice();
    var bar = { d: live.d, o: num(live.o) ? live.o : null, h: num(live.h) ? live.h : null, l: num(live.l) ? live.l : null, c: live.c, v: num(live.v) && live.v > 0 ? live.v : null, live: true };
    if (bar.o == null || bar.h == null || bar.l == null) return { bars: bars, action: 'incomplete' };
    if (live.d > lastB.d) { out.push(bar); return { bars: out, action: 'append', diffPct: null }; }
    if (live.d === lastB.d) { var diff = lastB.c ? (live.c - lastB.c) / lastB.c * 100 : null; out[out.length - 1] = bar; return { bars: out, action: 'replace', diffPct: diff }; }
    return { bars: bars, action: 'older' };
  }
  /* Kullanıcı içe aktarımı: CSV / sekme / noktalı virgül; başlıklar TR veya EN; tarih gg.aa.yyyy, yyyy-aa-gg, gg/aa/yyyy; sayı 1.234,56 veya 1,234.56 */
  var HDR = { d: /^(tarih|date|time|zaman|gün|gun)/i, o: /^(açılış|acilis|open|aof?$|ilk)/i, h: /^(en ?yüksek|en ?yuksek|yüksek|yuksek|high|max)/i, l: /^(en ?düşük|en ?dusuk|düşük|dusuk|low|min)/i, c: /^(kapanış|kapanis|close|son|fiyat|price|adj ?close)/i, v: /^(hacim|volume|vol|miktar|lot)/i };
  function parseNumLoose(s) {
    if (typeof s === 'number') return isFinite(s) ? s : null; s = String(s == null ? '' : s).trim().replace(/[^\d.,\-−]/g, '').replace('−', '-'); if (!s) return null;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.'), nc = s.split(',').length - 1, nd = s.split('.').length - 1;
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); // 1.234,56 (TR) veya 1,234.56 (EN)
    else if (nc > 1) s = s.replace(/,/g, '');      // 1,234,567
    else if (nc === 1) s = s.replace(',', '.');     // 12,5 (TR ondalık)
    else if (nd > 1) s = s.replace(/\./g, '');     // 1.234.567
    var v = parseFloat(s); return isFinite(v) ? v : null;
  }
  function parseDateLoose(s) {
    s = String(s || '').trim(); var m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/))) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return null;
  }
  function parseOhlcText(text) {
    var lines = String(text || '').split(/\r?\n/).filter(function (x) { return x.trim(); }); if (lines.length < 2) throw new Error('En az bir başlık ve bir veri satırı gerekli');
    var sep = ['\t', ';', ','].reduce(function (best, s) { var n = lines[0].split(s).length; return n > best.n ? { s: s, n: n } : best; }, { s: ',', n: 1 }).s;
    var head = lines[0].split(sep).map(function (x) { return x.trim().replace(/^"|"$/g, ''); }), idx = {};
    Object.keys(HDR).forEach(function (k) { for (var i = 0; i < head.length; i++) if (HDR[k].test(head[i]) && !(i in Object.keys(idx).reduce(function (o, kk) { o[idx[kk]] = 1; return o; }, {}))) { idx[k] = i; break; } });
    if (idx.d == null || idx.c == null) throw new Error('Tarih ve kapanış sütunu bulunamadı (başlıklar: ' + head.join(', ') + ')');
    var bars = [], bad = 0;
    for (var r = 1; r < lines.length; r++) {
      var cells = lines[r].split(sep).map(function (x) { return x.trim().replace(/^"|"$/g, ''); }), d = parseDateLoose(cells[idx.d]), c = parseNumLoose(cells[idx.c]);
      if (!d || !num(c) || c <= 0) { bad++; continue; }
      var g = function (k) { return idx[k] != null ? parseNumLoose(cells[idx[k]]) : null; };
      bars.push({ d: d, o: g('o'), h: g('h'), l: g('l'), c: c, v: g('v') });
    }
    bars.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var ded = []; bars.forEach(function (b) { if (ded.length && ded[ded.length - 1].d === b.d) { bad++; ded[ded.length - 1] = b; } else ded.push(b); });
    var full = ded.every(function (b) { return num(b.o) && num(b.h) && num(b.l); });
    return { bars: ded, skipped: bad, closeOnly: !full, columns: Object.keys(idx) };
  }

  /* ---------- Veri sağlık kontrolleri ---------- */
  // Dönen her kontrol: { id, level: ok|info|warn|fail, msg }. 'fail' olan seride teknik sinyal üretilmez.
  function checkBars(bars, kind, opts) {
    opts = opts || {}; var out = [], n = bars.length, today = opts.today || ymdOfMs(Date.now(), 3);
    function add(id, level, msg) { out.push({ id: id, level: level, msg: msg }); }
    if (n < 60) add('count', 'fail', 'Yalnızca ' + n + ' gün veri var; güvenilir teknik analiz için en az 60 gün gerekir.');
    else if (n < 200) add('count', 'warn', n + ' gün veri var; 200 günlük ortalama ve uzun vadeli yapı hesaplanamaz.');
    else add('count', 'ok', n + ' günlük mum (' + bars[0].d + ' → ' + bars[n - 1].d + ').');
    var order = 0, dup = 0; for (var i = 1; i < n; i++) { if (bars[i].d < bars[i - 1].d) order++; if (bars[i].d === bars[i - 1].d) dup++; }
    if (order || dup) add('order', 'fail', 'Tarih sırası bozuk (' + order + ') veya tekrar eden gün (' + dup + ').'); else if (n) add('order', 'ok', 'Tarihler sıralı, tekrar yok.');
    if (!opts.closeOnly) {
      var badBars = []; bars.forEach(function (b) { if (!(b.h >= Math.max(b.o, b.c) - 1e-9 && b.l <= Math.min(b.o, b.c) + 1e-9 && b.l > 0)) badBars.push(b.d); });
      if (badBars.length) add('ohlc', badBars.length > Math.max(2, n * 0.01) ? 'fail' : 'warn', badBars.length + ' mumda en yüksek/en düşük, açılış-kapanışla tutarsız (kaynak hatası): ' + badBars.slice(-3).join(', ') + '. Bu mumlar olduğu gibi gösterilir.');
      else add('ohlc', 'ok', 'Tüm mumlarda en yüksek ≥ açılış/kapanış ≥ en düşük.');
    } else add('ohlc', 'info', 'Kaynak yalnızca kapanış fiyatı veriyor (mum yok): ATR, ADX, Stokastik, Supertrend, Ichimoku ve formasyonlar kapanışla sınırlı/kapalı.');
    // Boşluklar
    var gapLim = kind === 'crypto' ? 2 : 7, gaps = [];
    for (i = 1; i < n; i++) { var g = dayNum(bars[i].d) - dayNum(bars[i - 1].d); if (g > gapLim) gaps.push(bars[i - 1].d + '→' + bars[i].d + ' (' + g + ' gün)'); }
    if (gaps.length) add('gaps', gaps.length > 3 ? 'warn' : 'info', gaps.length + ' veri boşluğu (tatil olabilir): ' + gaps.slice(-3).join(', ')); else if (n) add('gaps', 'ok', 'Beklenmeyen veri boşluğu yok.');
    // Günlük fiyat sınırı / aykırı hareket
    var splitDays = {}; (opts.splits || []).forEach(function (s) { splitDays[s[0]] = 1; });
    var jumps = [], lim = kind === 'stock' ? 0.105 : null;
    var lr = []; for (i = 1; i < n; i++) if (bars[i - 1].c > 0) lr.push(Math.log(bars[i].c / bars[i - 1].c));
    var med = lr.slice().sort(function (a, b) { return a - b; })[Math.floor(lr.length / 2)] || 0, mad = lr.map(function (x) { return Math.abs(x - med); }).sort(function (a, b) { return a - b; })[Math.floor(lr.length / 2)] || 0, sig = 1.4826 * mad;
    for (i = 1; i < n; i++) {
      var r = bars[i].c / bars[i - 1].c - 1;
      if (splitDays[bars[i].d]) continue;
      if (lim != null ? Math.abs(r) > lim : (sig > 0 && Math.abs(Math.log(1 + r) - med) > 8 * sig && Math.abs(r) > 0.15)) jumps.push({ d: bars[i].d, r: r, i: i });
    }
    if (jumps.length) {
      var recent = jumps.filter(function (j) { return j.i >= n - 60; });
      add('jumps', recent.length ? 'warn' : 'info', (lim != null ? 'Günlük %10 BIST sınırını aşan ' : 'Aşırı (aykırı) ') + jumps.length + ' hareket: ' + jumps.slice(-3).map(function (j) { return j.d + ' %' + (j.r * 100).toFixed(1); }).join(', ') +
        (lim != null ? ' — düzeltilmemiş bölünme/bedelsiz/temettü olabilir; bu tarihler civarındaki yapı seviyelerine dikkat.' : ''));
    } else if (n) add('jumps', 'ok', lim != null ? 'Hiçbir gün %10 BIST fiyat sınırını aşmıyor (düzeltme hatası yok).' : 'Aykırı fiyat sıçraması yok.');
    // Güncellik
    if (n) {
      var lastD = bars[n - 1].d, bd = kind === 'crypto' ? dayNum(today) - dayNum(lastD) : businessDaysBetween(lastD, today), lw = kind === 'fund' ? 4 : kind === 'crypto' ? 1 : 2, lf = kind === 'fund' ? 8 : kind === 'crypto' ? 3 : 5;
      if (lastD > today) add('fresh', 'fail', 'Son mum gelecekte (' + lastD + ') — saat/kaynak hatası.');
      else if (bd > lf) add('fresh', 'fail', 'Veri eski: son mum ' + lastD + ' (' + bd + (kind === 'crypto' ? ' gün' : ' iş günü') + ' önce). Sinyal üretilmez.');
      else if (bd > lw) add('fresh', 'warn', 'Son mum ' + lastD + ' (' + bd + (kind === 'crypto' ? ' gün' : ' iş günü') + ' önce).');
      else add('fresh', 'ok', 'Güncel: son mum ' + lastD + (bars[n - 1].live ? ' (canlı/gecikmeli fiyatla)' : bars[n - 1].partial ? ' (gün içi, kapanmamış mum)' : '') + '.');
    }
    // Hacim
    if (!opts.closeOnly && kind !== 'fx' && kind !== 'index') {
      var z = 0, m = Math.min(n, 120); for (i = n - m; i < n; i++) if (!num(bars[i].v) || bars[i].v <= 0) z++;
      if (m && z / m > 0.2) add('volume', 'warn', 'Son ' + m + ' günün %' + Math.round(z / m * 100) + "'inde hacim yok — hacim göstergeleri güvenilmez.");
      else if (m) add('volume', 'ok', 'Hacim verisi mevcut.');
    }
    if (opts.crossCheck) {
      var cc = opts.crossCheck;
      if (cc.error) add('cross', 'info', 'İkinci kaynak (' + cc.source + ') kontrolü yapılamadı: ' + cc.error);
      else if (!cc.compared) add('cross', 'info', 'İkinci kaynakla (' + cc.source + ') karşılaştırılacak gün bulunamadı.');
      else if (cc.recentMaxAbsDiffPct != null && cc.recentMaxAbsDiffPct > 0.5) add('cross', 'fail', cc.source + ' ile son kapanışlar uyuşmuyor (en büyük fark %' + cc.recentMaxAbsDiffPct + ').');
      else if (cc.over05) add('cross', 'info', cc.source + ' ile son ' + (cc.recentCompared || 5) + ' kapanış aynı; daha eski ' + cc.over05 + ' günde sabit fark var (kaynaklardan biri geçmişi temettüye göre düzeltiyor, en büyük %' + cc.maxAbsDiffPct + ').');
      else add('cross', 'ok', cc.source + ' ile son ' + cc.compared + ' günün kapanışı birebir uyumlu (en büyük fark %' + cc.maxAbsDiffPct + ').');
    }
    if (opts.liveMerge && opts.liveMerge.action === 'replace' && num(opts.liveMerge.diffPct) && Math.abs(opts.liveMerge.diffPct) > 3) add('live', 'warn', 'Canlı fiyat ile günlük dosyanın aynı gün kapanışı arasında %' + opts.liveMerge.diffPct.toFixed(2) + ' fark var (gün içi hareket olabilir).');
    if (opts.stale) add('stale', 'warn', 'Günlük derleyici bu sembolü son çalıştırmada alamadı; önceki veri kullanılıyor (' + (opts.lastError || '') + ').');
    return out;
  }
  function worstLevel(checks) { var o = { ok: 0, info: 0, warn: 1, fail: 2 }, w = 'ok'; checks.forEach(function (c) { if (o[c.level] > o[w]) w = c.level; }); return w; }

  /* ---------- Varlık çözümleme (kullanıcının yazdığı isim/kod) ---------- */
  var mdIndexP = null;
  function mdIndex() { if (!mdIndexP) { mdIndexP = fetchJson(URL.mdIndex, { timeout: 20000 }); mdIndexP.catch(function () { mdIndexP = null; }); } return mdIndexP; }
  var ALIASES = { altin: 'metal:XAU', 'altın': 'metal:XAU', 'gram altin': 'metal:XAU', 'gram altın': 'metal:XAU', gumus: 'metal:XAG', 'gümüş': 'metal:XAG', 'ons altin': 'macro:XAUUSD', 'ons altın': 'macro:XAUUSD', xauusd: 'macro:XAUUSD', xagusd: 'macro:XAGUSD',
    dolar: 'fx:USD', usd: 'fx:USD', usdtry: 'fx:USD', euro: 'fx:EUR', eur: 'fx:EUR', eurtry: 'fx:EUR', 'bist100': 'idx:XU100', xu100: 'idx:XU100', 'bist 100': 'idx:XU100', xu030: 'idx:XU030', 'bist30': 'idx:XU030',
    'katılım': 'idx:XKTUM', katilim: 'idx:XKTUM', 'katılım tüm': 'idx:XKTUM', xktum: 'idx:XKTUM', 'katılım 50': 'idx:XK050', 'katilim 50': 'idx:XK050', xk050: 'idx:XK050', katlm: 'idx:XK050', 'katılım 100': 'idx:XK100', xk100: 'idx:XK100', 'katılım 30': 'idx:XK030', xk030: 'idx:XK030',
    bitcoin: 'cg:bitcoin', btc: 'cg:bitcoin', ethereum: 'cg:ethereum', eth: 'cg:ethereum' };
  function norm(q) { return String(q || '').trim().toLocaleLowerCase('tr-TR'); }
  function resolve(query) {
    var q = String(query || '').trim(), n = norm(q), up = q.toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9İŞĞÜÖÇ.\-]/g, '');
    if (!q) return Promise.resolve([]);
    var out = [], seen = {};
    function add(x) { if (!seen[x.key]) { seen[x.key] = 1; out.push(x); } }
    if (ALIASES[n]) add(describe(ALIASES[n]));
    if (/^(bist|tefas|cg|us|td|macro|metal|fx|idx|imp):/.test(q)) add(describe(q));
    return mdIndex().then(function (ix) {
      (ix.bist || []).forEach(function (b) { if (b.s === up || (n.length >= 3 && norm(b.n).indexOf(n) >= 0)) add({ key: 'bist:' + b.s, kind: 'stock', label: b.s + ' — ' + b.n, sub: 'BIST hissesi' + (b.k ? ' · Katılım endeksinde' : ''), katilim: !!b.k }); });
      (ix.us || []).forEach(function (s) { if (s === up) add({ key: 'us:' + s, kind: 'etf', label: s, sub: 'ABD ETF (USD)' }); });
      (ix.index || []).forEach(function (s) { if (s === up) add(describe('idx:' + s)); });
      return out;
    }, function () { return out; }).then(function () {
      var jobs = [];
      if (/^[A-Z0-9]{3}$/.test(up)) jobs.push(fetchJson(URL.tefas(up, 0), { timeout: 12000 }).then(function (j) { if (j && j.code) add({ key: 'tefas:' + j.code, kind: 'fund', label: j.code + ' — ' + j.name, sub: 'TEFAS fonu · ' + (j.type || '') + (j.tags && j.tags.islamic ? ' · Katılım (İslami)' : '') }); }, function () { }));
      if (n.length >= 2 && out.length < 3) jobs.push(fetchJson(URL.cgSearch(q), { timeout: 12000 }).then(function (j) { (j.coins || []).slice(0, 4).forEach(function (c) { add({ key: 'cg:' + c.id, kind: 'crypto', label: c.symbol + ' — ' + c.name, sub: 'Kripto' + (c.market_cap_rank ? ' · piyasa değeri sırası ' + c.market_cap_rank : ''), symbol: c.symbol }); }); }, function () { }));
      if (n.length >= 4 && !/^[A-Z0-9]{3}$/.test(up)) jobs.push(fetchJson(URL.tefasList('kind=yat&limit=5&q=' + encodeURIComponent(q)), { timeout: 12000 }).then(function (j) { (j.items || []).forEach(function (f) { add({ key: 'tefas:' + f.code, kind: 'fund', label: f.code + ' — ' + f.name, sub: 'TEFAS fonu · ' + f.type + (f.tags && f.tags.islamic ? ' · Katılım (İslami)' : '') }); }); }, function () { }));
      return Promise.all(jobs).then(function () { if (!out.length && /^[A-Z]{1,5}$/.test(up)) add({ key: 'td:' + up, kind: 'etf', label: up, sub: 'ABD hisse/ETF — Twelve Data anahtarı gerekir' }); return out; });
    });
  }
  function describe(key) {
    var k = key.split(':')[0], s = key.slice(k.length + 1);
    var L = { 'metal:XAU': ['Gram altın (TL)', 'metal'], 'metal:XAG': ['Gram gümüş (TL)', 'metal'], 'fx:USD': ['ABD doları / TL', 'fx'], 'fx:EUR': ['Euro / TL', 'fx'], 'idx:XU100': ['BIST 100 endeksi', 'index'], 'idx:XU030': ['BIST 30 endeksi', 'index'],
      'macro:XAUUSD': ['Altın ons (USD)', 'metal'], 'macro:XAGUSD': ['Gümüş ons (USD)', 'metal'],
      'idx:XKTUM': ['Katılım Tüm endeksi', 'index'], 'idx:XK100': ['Katılım 100 endeksi', 'index'], 'idx:XK050': ['Katılım 50 endeksi', 'index'], 'idx:XK030': ['Katılım 30 endeksi', 'index'] }[key];
    if (L) return { key: key, kind: L[1], label: L[0], sub: '' };
    var kind = { bist: 'stock', tefas: 'fund', cg: 'crypto', us: 'etf', td: 'etf', imp: 'import', idx: 'index', fx: 'fx', metal: 'metal', macro: 'metal' }[k] || 'other';
    return { key: key, kind: kind, label: s, sub: '' };
  }

  /* ---------- Seri yükleme ---------- */
  function tvLive(tvSym) {
    return fetchJson(URL.tvSymbol(tvSym, TV_FIELDS), { timeout: 15000 }).then(function (j) {
      if (!j || !num(j.close)) throw new Error('TradingView fiyat vermedi');
      return { d: tvBarDate(j.time), o: j.open, h: j.high, l: j.low, c: j.close, v: j.volume, raw: j, at: new Date().toISOString(), source: SOURCES.tv };
    });
  }
  function loadMd(kind, sym) { return cached('md:' + kind + ':' + sym, 10 * 60000, function () { return fetchJson(URL.md(kind, sym), { timeout: 25000 }).then(parseMd); }); }
  function cryptoPair(id, symbol) {
    var sym = String(symbol || { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP', binancecoin: 'BNB', 'avalanche-2': 'AVAX', cardano: 'ADA', dogecoin: 'DOGE', tron: 'TRX', chainlink: 'LINK', polkadot: 'DOT' }[id] || '').toUpperCase();
    return sym ? sym + 'USDT' : null;
  }
  function finish(res, kind, opts) {
    res.closeOnly = res.closeOnly || res.bars.some(function (b) { return !num(b.o) || !num(b.h) || !num(b.l); });
    res.checks = checkBars(res.bars, kind, { closeOnly: res.closeOnly, splits: res.splits, crossCheck: res.crossCheck, liveMerge: res.liveMerge, stale: res.stale, lastError: res.lastError, today: opts && opts.today });
    res.quality = worstLevel(res.checks);
    return res;
  }
  function load(key, opts) {
    opts = opts || {}; var d = describe(key), k = key.split(':')[0], s = key.slice(k.length + 1), now = Date.now();
    var base = { key: key, kind: d.kind, name: d.label, currency: 'TRY', bars: [], sources: [], fetchedAt: new Date(now).toISOString() };
    if (k === 'bist' || k === 'idx' || k === 'us' || k === 'macro' || k === 'fx' || (k === 'td' && TV_US[s])) {
      var mk = k === 'bist' ? 'bist' : k === 'idx' ? 'index' : (k === 'us' || k === 'td') ? 'us' : 'macro', ms = k === 'fx' ? s + 'TRY' : s;
      var tvSym = k === 'bist' || k === 'idx' ? 'BIST:' + s : (k === 'us' || k === 'td') ? TV_US[s] : TV_MACRO[ms];
      return Promise.all([loadMd(mk, ms), tvSym ? tvLive(tvSym).catch(function (e) { return { error: e.message }; }) : Promise.resolve(null)]).then(function (r) {
        var md = r[0], lv = r[1], res = Object.assign(base, { bars: md.bars, currency: md.currency || (k === 'bist' ? 'TRY' : 'USD'), splits: md.splits, dividends: md.dividends, crossCheck: md.check, stale: md.stale, lastError: md.lastError,
          sector: md.sector, katilim: md.katilim, tvSymbol: tvSym, name: md.name ? (k === 'bist' ? s + ' — ' + md.name : md.name) : d.label, histSource: { label: md.source, at: md.fetchedAt, lastBar: md.bars.length ? md.bars[md.bars.length - 1].d : null } });
        if (k === 'fx') res.currency = 'TRY';
        if (lv && !lv.error) { var mg = mergeLive(res.bars, lv); res.bars = mg.bars; res.liveMerge = mg; res.live = { price: lv.c, at: lv.at, barDate: lv.d, source: lv.source, raw: lv.raw }; res.tv = lv.raw; }
        else res.liveError = lv && lv.error;
        return finish(res, d.kind === 'index' ? 'index' : d.kind === 'fx' ? 'fx' : d.kind === 'metal' ? 'metal' : k === 'bist' ? 'stock' : 'etf', opts);
      });
    }
    if (k === 'metal') { // gram TL = ons USD × USD/TL ÷ 31,1035 (aynı tarihli kapanışlar; türetilmiş, yalnızca kapanış)
      var sym = s === 'XAU' ? 'XAUUSD' : 'XAGUSD';
      return Promise.all([loadMd('macro', sym), loadMd('macro', 'USDTRY')]).then(function (r) {
        var fx = {}; r[1].bars.forEach(function (b) { fx[b.d] = b.c; });
        var bars = r[0].bars.filter(function (b) { return fx[b.d]; }).map(function (b) { return { d: b.d, o: null, h: null, l: null, c: b.c * fx[b.d] / 31.1034768, v: null }; });
        var res = Object.assign(base, { bars: bars, currency: 'TRY', closeOnly: true, derived: 'ons (' + r[0].source + ') × USD/TL ÷ 31,1035 — aynı günün kapanışları', histSource: { label: r[0].source + ' (türetilmiş)', at: r[0].fetchedAt, lastBar: bars.length ? bars[bars.length - 1].d : null } });
        return finish(res, 'metal', opts);
      });
    }
    if (k === 'cg') {
      var pair = cryptoPair(s, opts.symbol);
      if (!pair) return Promise.reject(new Error('Bu kripto için Binance paritesi bilinmiyor; sembolüyle ara (ör. SOL).'));
      return Promise.all([
        fetchJson(URL.binKlines(pair, '1d', 1000), { timeout: 20000 }),
        tvLive('BINANCE:' + pair).catch(function (e) { return { error: e.message }; }),
        fetchJson(URL.binFunding(pair), { timeout: 10000 }).catch(function () { return null; }),
        fetchJson(URL.fng, { timeout: 10000 }).catch(function () { return null; })
      ]).then(function (r) {
        var bars = parseBinanceKlines(r[0], now), res = Object.assign(base, { bars: bars, currency: 'USD', pair: pair, tvSymbol: 'BINANCE:' + pair, name: pair.replace('USDT', '') + ' / USDT',
          histSource: { label: SOURCES.binance, at: new Date(now).toISOString(), lastBar: bars.length ? bars[bars.length - 1].d : null } });
        if (r[1] && !r[1].error) { res.tv = r[1].raw; res.live = { price: bars.length ? bars[bars.length - 1].c : null, at: new Date(now).toISOString(), source: SOURCES.binance + ' (gün içi mum)' }; }
        if (r[2] && num(+r[2].lastFundingRate)) res.funding = { rate: +r[2].lastFundingRate, mark: +r[2].markPrice, at: new Date(r[2].time || now).toISOString(), source: 'Binance vadeli (fapi)' };
        if (r[3] && r[3].data) res.fng = { values: r[3].data.map(function (x) { return { v: +x.value, c: x.value_classification, d: ymdOfMs(+x.timestamp * 1000, 0) }; }), source: 'alternative.me Korku & Açgözlülük' };
        return finish(res, 'crypto', opts);
      });
    }
    if (k === 'tefas') {
      return fetchJson(URL.tefas(s, 1095), { timeout: 25000 }).then(function (j) {
        if (!j || !j.code) throw new Error('Fon bulunamadı');
        var bars = parseTefasHistory(j), res = Object.assign(base, { bars: bars, currency: 'TRY', closeOnly: true, fund: j, name: j.code + ' — ' + j.name, histSource: { label: SOURCES.tefas, at: new Date(now).toISOString(), lastBar: j.date || (bars.length ? bars[bars.length - 1].d : null) } });
        return finish(res, 'fund', opts);
      });
    }
    if (k === 'td') {
      if (!opts.twelveKey) return Promise.reject(new Error(s + ': Bu ABD hissesi/ETF günlük listede yok. Twelve Data ücretsiz anahtarı gir (Portföy → Fiyatlar) ya da OHLCV dosyası yükle.'));
      return fetchJson(URL.twelve(s, opts.twelveKey), { timeout: 20000 }).then(function (j) {
        var t = parseTwelve(j), res = Object.assign(base, { bars: t.bars, currency: t.currency || 'USD', histSource: { label: SOURCES.twelve, at: new Date(now).toISOString(), lastBar: t.bars.length ? t.bars[t.bars.length - 1].d : null } });
        return finish(res, 'etf', opts);
      });
    }
    if (k === 'imp') {
      var imp = opts.imported; if (!imp) return Promise.reject(new Error('İçe aktarılmış veri bulunamadı'));
      var res2 = Object.assign(base, { bars: imp.bars, name: imp.name || s, currency: imp.currency || 'TRY', closeOnly: imp.closeOnly, kind: imp.kind || 'import', histSource: { label: SOURCES.imp + ' (' + (imp.file || 'yapıştırma') + ')', at: imp.at, lastBar: imp.bars.length ? imp.bars[imp.bars.length - 1].d : null } });
      return Promise.resolve(finish(res2, imp.kind === 'crypto' ? 'crypto' : imp.kind === 'fund' ? 'fund' : 'stock', opts));
    }
    return Promise.reject(new Error('Bu varlık türü için veri kaynağı yok: ' + key));
  }

  /* ---------- Temel veriler (BIST, TradingView) + sektör medyanı ---------- */
  function fundamentals(sym) {
    return cached('fund:' + sym, 30 * 60000, function () {
      return fetchJson(URL.tvSymbol('BIST:' + sym, FUND_FIELDS), { timeout: 15000 }).then(function (f) {
        if (!f || !f.sector) return { self: f, peers: null, at: new Date().toISOString(), source: SOURCES.tv };
        var cols = ['name', 'price_earnings_ttm', 'price_book_fq', 'enterprise_value_ebitda_ttm', 'return_on_equity', 'net_margin', 'total_revenue_yoy_growth_ttm', 'debt_to_equity', 'market_cap_basic'];
        return fetchJson(URL.tvScan('turkey'), { timeout: 15000, body: { filter: [{ left: 'sector', operation: 'equal', right: f.sector }, { left: 'exchange', operation: 'equal', right: 'BIST' }, { left: 'type', operation: 'equal', right: 'stock' }], columns: cols, range: [0, 400] } })
          .then(function (j) { return { self: f, peers: peerStats(j, cols), at: new Date().toISOString(), source: SOURCES.tv }; }, function () { return { self: f, peers: null, at: new Date().toISOString(), source: SOURCES.tv }; });
      });
    });
  }
  function median(a) { var x = a.filter(num).sort(function (p, q) { return p - q; }); if (!x.length) return null; var m = Math.floor(x.length / 2); return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; }
  function peerStats(j, cols) {
    var rows = (j && j.data) || [], st = { n: rows.length };
    cols.slice(1).forEach(function (c, i) { var vals = rows.map(function (r) { return r.d[i + 1]; }); if (c === 'price_earnings_ttm' || c === 'price_book_fq' || c === 'enterprise_value_ebitda_ttm') vals = vals.filter(function (v) { return num(v) && v > 0; }); st[c] = median(vals); st[c + '_n'] = vals.filter(num).length; });
    return st;
  }
  /* Fon kategorisi: aynı türdeki fonlar arasında 1 yıllık getiri ve oynaklık sıralaması */
  function fundPeers(type) {
    return cached('fpeers:' + type, 30 * 60000, function () {
      return fetchJson(URL.tefasList('kind=yat&limit=500&type=' + encodeURIComponent(type)), { timeout: 20000 }).then(function (j) { return { items: j.items || [], date: j.data_date, total: j.total }; });
    });
  }
  function katilimFunds() { return cached('katfunds', 60 * 60000, function () { return fetchJson(URL.tefasList('kind=yat&limit=500&q=' + encodeURIComponent('katılım')), { timeout: 20000 }).then(function (j) { return { items: (j.items || []).filter(function (f) { return f.active !== false; }), date: j.data_date }; }); }); }
  function katilimScreen() { // Katılım Tüm endeksindeki hisseler: TradingView'in kendi teknik/temel alanlarıyla hızlı tarama (portföy oluşturucu için aday listesi)
    var cols = ['name', 'description', 'close', 'market_cap_basic', 'average_volume_30d_calc', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'RSI', 'SMA50', 'SMA200', 'price_earnings_ttm', 'price_book_fq', 'return_on_equity', 'debt_to_equity', 'Volatility.M', 'sector'];
    return cached('katscreen', 30 * 60000, function () {
      return fetchJson(URL.tvScan('turkey'), { timeout: 20000, body: { columns: cols, symbols: { symbolset: ['SYML:BIST;XKTUM'] }, range: [0, 400] } }).then(function (j) {
        return { at: new Date().toISOString(), source: SOURCES.tv, rows: (j.data || []).map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r.d[i]; }); return o; }) };
      });
    });
  }
  /* ---------- Gün içi (1S / 4S) mumlar ---------- */
  var TF_MS = { '1h': 3600000, '4h': 14400000 };
  function pad2(x) { return String(x).padStart(2, '0'); }
  function labelOfMs(ms) { var d = new Date(ms + 3 * 3600000); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()); } // TSİ
  function parseH1(j) {
    if (!j || !Array.isArray(j.bars)) throw new Error('Saatlik veri dosyası biçimi tanınmadı');
    var bars = j.bars.filter(function (b) { return num(b[0]) && num(b[4]) && b[4] > 0; }).map(function (b) { var t = b[0] * 1000; return { t: t, d: labelOfMs(t), o: b[1], h: b[2], l: b[3], c: b[4], v: num(b[5]) && b[5] > 0 ? b[5] : null }; });
    return { bars: bars, currency: j.currency || null, fetchedAt: j.fetchedAt || null, source: j.source || 'Yahoo Finance 60 dk', stale: !!j.stale, lastError: j.lastError || null, name: j.name || null };
  }
  function parseBinanceIntraday(arr, nowMs) {
    if (!Array.isArray(arr)) throw new Error('Binance yanıtı tanınmadı');
    return arr.map(function (k) { return { t: k[0], d: labelOfMs(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], partial: nowMs ? k[6] > nowMs : false }; });
  }
  // 4 saatlik birleştirme. mode 'bist': seans yarıları (TSİ 13:30 öncesi / sonrası; BIST 10:00–18:10), '24h': UTC 4 saatlik dilimler (00, 04, 08…)
  function aggregate(bars, mode, nowMs) {
    var out = [], cur = null, key = null;
    bars.forEach(function (b) {
      var k = mode === 'bist' ? b.d.slice(0, 10) + (b.d.slice(11) < '13:30' ? 'A' : 'B') : String(Math.floor(b.t / 14400000));
      if (k !== key) { if (cur) out.push(cur); key = k; cur = { t: b.t, d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: num(b.v) ? b.v : null, n: 1, partial: !!b.partial, k: k }; return; }
      cur.h = num(cur.h) && num(b.h) ? Math.max(cur.h, b.h) : null; cur.l = num(cur.l) && num(b.l) ? Math.min(cur.l, b.l) : null; cur.c = b.c; cur.n++;
      if (num(b.v)) cur.v = (cur.v || 0) + b.v; if (b.partial) cur.partial = true;
    });
    if (cur) out.push(cur);
    if (nowMs && out.length) { // son dilim henüz kapanmadıysa işaretle
      var L = out[out.length - 1], end;
      if (mode === 'bist') { var day = Date.UTC(+L.d.slice(0, 4), +L.d.slice(5, 7) - 1, +L.d.slice(8, 10)) - 3 * 3600000; end = day + (L.k.slice(-1) === 'A' ? 13.5 : 18 + 1 / 6) * 3600000; }
      else end = (Math.floor(L.t / 14400000) + 1) * 14400000;
      if (nowMs < end) L.partial = true;
    }
    return out.map(function (b) { delete b.k; return b; });
  }
  function checkIntraday(bars, kind, tf, opts) {
    opts = opts || {}; var out = [], n = bars.length, now = opts.nowMs || Date.now(), today = ymdOfMs(now, 3);
    function add(id, level, msg) { out.push({ id: id, level: level, msg: msg }); }
    if (n < 60) add('count', 'fail', 'Yalnızca ' + n + ' mum var; gün içi teknik analiz için en az 60 mum gerekir.');
    else if (n < 200) add('count', 'warn', n + ' mum var; 200 mumluk ortalama hesaplanamaz.');
    else add('count', 'ok', n + ' adet ' + tf + ' mum (' + bars[0].d + ' → ' + bars[n - 1].d + ' TSİ).');
    var order = 0; for (var i = 1; i < n; i++) if (!(bars[i].t > bars[i - 1].t)) order++;
    if (order) add('order', 'fail', 'Zaman sırası bozuk veya tekrar eden mum (' + order + ').'); else if (n) add('order', 'ok', 'Mumlar zaman sırasında, tekrar yok.');
    if (!opts.closeOnly) {
      var bad = []; bars.forEach(function (b) { if (!(b.h >= Math.max(b.o, b.c) - 1e-9 && b.l <= Math.min(b.o, b.c) + 1e-9 && b.l > 0)) bad.push(b.d); });
      if (bad.length) add('ohlc', bad.length > Math.max(2, n * 0.01) ? 'fail' : 'warn', bad.length + ' mumda en yüksek/en düşük tutarsız: ' + bad.slice(-3).join(', ')); else add('ohlc', 'ok', 'Tüm mumlarda en yüksek ≥ açılış/kapanış ≥ en düşük.');
    } else add('ohlc', 'info', 'Türetilmiş seri: yalnızca kapanış (mum yok).');
    if (n) {
      var L = bars[n - 1], ageH = (now - L.t) / 3600000, lastDay = L.d.slice(0, 10);
      if (L.t > now + 5 * 60000) add('fresh', 'fail', 'Son mum gelecekte (' + L.d + ') — saat/kaynak hatası.');
      else if (kind === 'crypto') { var lim = TF_MS[tf] / 3600000; if (ageH > 3 * lim) add('fresh', 'fail', 'Veri eski: son mum ' + L.d + ' TSİ (' + Math.round(ageH) + ' saat önce).'); else add('fresh', 'ok', 'Güncel: son mum ' + L.d + ' TSİ' + (L.partial ? ' (kapanmamış, canlı)' : '') + '.'); }
      else { var bd = businessDaysBetween(lastDay, today); if (bd > 3) add('fresh', 'fail', 'Veri eski: son mum ' + L.d + ' TSİ (' + bd + ' iş günü önce). Sinyal üretilmez.'); else if (bd > 1) add('fresh', 'warn', 'Son mum ' + L.d + ' TSİ (' + bd + ' iş günü önce).'); else add('fresh', 'ok', 'Son mum ' + L.d + ' TSİ' + (L.partial ? ' (kapanmamış)' : '') + ' — saatlik derleme seans içinde yaklaşık saatte bir güncellenir.'); }
    }
    if (!opts.closeOnly && kind !== 'fx' && kind !== 'index' && kind !== 'metal') {
      var z = 0, m = Math.min(n, 120); for (i = n - m; i < n; i++) if (!num(bars[i].v) || bars[i].v <= 0) z++;
      if (m && z / m > 0.2) add('volume', 'warn', 'Son ' + m + ' mumun %' + Math.round(z / m * 100) + "'inde hacim yok — hacim göstergeleri güvenilmez."); else if (m) add('volume', 'ok', 'Hacim verisi mevcut.');
    }
    if (opts.stale) add('stale', 'warn', 'Saatlik derleyici bu sembolü son çalıştırmada alamadı; önceki veri kullanılıyor.');
    return out;
  }
  var H1_MISSING = 'Bu varlık için gün içi veri derlenmiyor (saatlik veri: Katılım endeksi + BIST 100/30 hisseleri, endeksler, altın/gümüş, döviz, helal ETF\'ler; kripto Binance\'ten).';
  // market-data dizini, hangi dosyaların var olduğunu söyler: listede olmayan dosya istenmez (gereksiz 404 yok)
  function listedIn(listFn) { return mdIndex().then(function (ix) { var L = listFn(ix); return L == null ? null : L; }, function () { return null; }); }
  function loadH1(kind, sym) { return cached('h1:' + kind + ':' + sym, 5 * 60000, function () { return listedIn(function (ix) { return ix.intraday && ix.intraday.symbols ? ix.intraday.symbols[kind] || [] : null; }).then(function (L) { if (L && L.indexOf(sym) < 0) throw new Error(H1_MISSING); return fetchJson(URL.h1(kind, sym), { timeout: 25000 }); }).then(parseH1, function (e) { if (e.status === 404) throw new Error(H1_MISSING); throw e; }); }); }
  function loadIntraday(key, tf, opts) {
    opts = opts || {}; if (!TF_MS[tf]) return Promise.reject(new Error('Bilinmeyen zaman dilimi: ' + tf));
    var d = describe(key), k = key.split(':')[0], s = key.slice(k.length + 1), now = opts.nowMs || Date.now();
    var base = { key: key, kind: d.kind, name: d.label, currency: 'TRY', tf: tf, intraday: true, fetchedAt: new Date(now).toISOString() };
    function done(res, kind) { res.checks = checkIntraday(res.bars, kind, tf, { closeOnly: res.closeOnly, stale: res.stale, nowMs: now }); res.quality = worstLevel(res.checks); return res; }
    if (k === 'tefas') return Promise.reject(new Error('Yatırım fonları günde bir fiyat açıklar; gün içi grafik yoktur.'));
    if (k === 'imp' || k === 'td') return Promise.reject(new Error('Bu varlık için gün içi veri kaynağı yok.'));
    if (k === 'cg') {
      var pair = cryptoPair(s, opts.symbol); if (!pair) return Promise.reject(new Error('Bu kripto için Binance paritesi bilinmiyor.'));
      return fetchJson(URL.binKlines(pair, tf, 1000), { timeout: 20000 }).then(function (arr) {
        var bars = parseBinanceIntraday(arr, now);
        return done(Object.assign(base, { bars: bars, currency: 'USD', pair: pair, name: pair.replace('USDT', '') + ' / USDT', histSource: { label: SOURCES.binance + ' — ' + tf + ' mumlar (anlık)', at: new Date(now).toISOString(), lastBar: bars.length ? bars[bars.length - 1].d : null } }), 'crypto');
      });
    }
    if (k === 'metal') {
      var sym = s === 'XAU' ? 'XAUUSD' : 'XAGUSD';
      return Promise.all([loadH1('macro', sym), loadH1('macro', 'USDTRY')]).then(function (r) {
        var fx = {}; r[1].bars.forEach(function (b) { fx[b.t] = b.c; });
        var h = r[0].bars.filter(function (b) { return fx[b.t]; }).map(function (b) { return { t: b.t, d: b.d, o: null, h: null, l: null, c: b.c * fx[b.t] / 31.1034768, v: null }; });
        var bars = tf === '4h' ? aggregate(h, '24h', now).map(function (b) { return Object.assign(b, { o: null, h: null, l: null }); }) : h;
        return done(Object.assign(base, { bars: bars, currency: 'TRY', closeOnly: true, derived: 'ons × USD/TL ÷ 31,1035 — aynı saatin kapanışları', stale: r[0].stale || r[1].stale, histSource: { label: r[0].source + ' (türetilmiş)', at: r[0].fetchedAt, lastBar: bars.length ? bars[bars.length - 1].d : null } }), 'metal');
      });
    }
    if (k === 'bist' || k === 'idx' || k === 'us' || k === 'macro' || k === 'fx') {
      var mk = k === 'bist' ? 'bist' : k === 'idx' ? 'index' : k === 'us' ? 'us' : 'macro', ms = k === 'fx' ? s + 'TRY' : s;
      return loadH1(mk, ms).then(function (h) {
        var bars = tf === '4h' ? aggregate(h.bars, k === 'bist' || k === 'idx' ? 'bist' : '24h', now) : h.bars.slice();
        if (tf === '1h' && bars.length && (k === 'bist' || k === 'idx')) { var L = bars[bars.length - 1]; if (now < L.t + 3600000 && now < Date.UTC(+L.d.slice(0, 4), +L.d.slice(5, 7) - 1, +L.d.slice(8, 10)) + 15.17 * 3600000) L.partial = true; }
        var kind = k === 'bist' ? 'stock' : k === 'idx' ? 'index' : k === 'us' ? 'etf' : k === 'fx' ? 'fx' : 'metal';
        return done(Object.assign(base, { bars: bars, currency: h.currency || (k === 'bist' || k === 'idx' || k === 'fx' ? 'TRY' : 'USD'), stale: h.stale, name: h.name ? (k === 'bist' ? s + ' — ' + h.name : h.name) : d.label,
          histSource: { label: h.source, at: h.fetchedAt, lastBar: bars.length ? bars[bars.length - 1].d : null } }), kind);
      });
    }
    return Promise.reject(new Error('Bu varlık türü için gün içi veri yok.'));
  }

  /* ---------- KAP bildirimleri ve önbelleklenmiş haberler (market-data dalı; iş akışı sunucu tarafında derler) ---------- */
  function notFoundEmpty(e) { if (e && e.status === 404) return { items: [], none: true }; throw e; }
  function kap(sym) { return cached('kap:' + sym, 10 * 60000, function () { return listedIn(function (ix) { return ix.kap && ix.kap.list ? ix.kap.list : null; }).then(function (L) { if (L && L.indexOf(sym) < 0) return { items: [], none: true, generatedAt: null }; return fetchJson(URL.kap(sym), { timeout: 15000 }).catch(notFoundEmpty); }); }); }
  function newsTopicOf(key) { var k = key.split(':')[0]; return k === 'metal' || key === 'macro:XAUUSD' || key === 'macro:XAGUSD' ? 'gold' : k === 'fx' || key === 'macro:USDTRY' || key === 'macro:EURTRY' ? 'fx' : k === 'cg' ? 'crypto' : k === 'idx' ? 'market' : null; }
  function newsCached(key) {
    var k = key.split(':')[0], s = key.slice(k.length + 1), t = newsTopicOf(key);
    var url = k === 'bist' ? URL.newsSym(s) : t ? URL.newsTopic(t) : null;
    if (!url) return Promise.resolve(null);
    return cached('news:' + key, 10 * 60000, function () { return (k === 'bist' ? listedIn(function (ix) { return ix.news && ix.news.symbols ? Object.keys(ix.news.symbols) : null; }) : Promise.resolve(null)).then(function (L) { if (L && L.indexOf(s) < 0) return { items: [], none: true, generatedAt: null }; return fetchJson(url, { timeout: 15000 }).catch(notFoundEmpty); }).then(function (j) { return { at: j.generatedAt || null, none: !!j.none, topic: t, keywords: j.keywords || null, items: (j.items || []).map(function (x) { return { title: x.title, url: x.url, src: x.src, at: x.at, match: x.match || null }; }) }; }); });
  }
  function news(q) { return fetchJson(URL.gdelt(q), { timeout: 15000 }).then(function (j) { return { at: new Date().toISOString(), source: 'GDELT DOC 2.0', items: (j.articles || []).map(function (a) { return { title: a.title, url: a.url, domain: a.domain, lang: a.language, d: a.seendate ? a.seendate.slice(0, 4) + '-' + a.seendate.slice(4, 6) + '-' + a.seendate.slice(6, 8) : null }; }) }; }); }

  return { URL: URL, SOURCES: SOURCES, TV_US: TV_US, TV_MACRO: TV_MACRO, fetchJson: fetchJson, ymdOfMs: ymdOfMs, dayNum: dayNum, dow: dow, businessDaysBetween: businessDaysBetween,
    parseMd: parseMd, parseBinanceKlines: parseBinanceKlines, parseTefasHistory: parseTefasHistory, parseTwelve: parseTwelve, tvBarDate: tvBarDate, mergeLive: mergeLive, parseOhlcText: parseOhlcText,
    parseNumLoose: parseNumLoose, parseDateLoose: parseDateLoose, checkBars: checkBars, worstLevel: worstLevel, resolve: resolve, describe: describe, load: load, mdIndex: mdIndex, fundamentals: fundamentals,
    peerStats: peerStats, median: median, parseH1: parseH1, parseBinanceIntraday: parseBinanceIntraday, aggregate: aggregate, checkIntraday: checkIntraday, loadH1: loadH1, loadIntraday: loadIntraday, labelOfMs: labelOfMs, TF_MS: TF_MS,
    kap: kap, newsCached: newsCached, newsTopicOf: newsTopicOf, fundPeers: fundPeers, katilimFunds: katilimFunds, katilimScreen: katilimScreen, news: news, cryptoPair: cryptoPair, tvLive: tvLive, loadMd: loadMd };
});
