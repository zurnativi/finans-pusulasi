/* events.js — Ekonomik takvim, olay senaryoları, beklenti/sürpriz hesabı ve geçmiş benzer olaylar. SAF (testli); veri hub/*.json'dan gelir.
 * İLKELER: (1) Olasılık yalnız gerçek piyasa fiyatından (Kalshi/Polymarket) ya da TCMB'nin yayımladığı dağılımdan gelir; kaynağı yoksa "olasılık yok" yazılır.
 * (2) Senaryo etkileri "genel iktisat çerçevesi"dir (yön + gerekçe); kesin sonuç değildir. Sayısal kanıt yalnız geçmiş olay çalışmasından (n ile) gelir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./news.js'));
  else root.Events = factory(root.News);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';
  var TZ = 3 * 3600000; // Türkiye UTC+3 (sabit)
  function tsiYmd(ms) { return new Date(ms + TZ).toISOString().slice(0, 10); }
  function ymdMs(ymd) { return Date.parse(ymd + 'T00:00:00+03:00'); }
  function eventMs(ev) {
    if (ev.at) return Date.parse(ev.at);
    if (ev.date && ev.time) return Date.parse(ev.date + 'T' + ev.time + ':00+03:00');
    return ev.date ? ymdMs(ev.date) : NaN;
  }
  function daysBetween(a, b) { return Math.round((ymdMs(b) - ymdMs(a)) / 86400000); }
  function E(d, t) { return { d: d, t: t }; }
  var DIR_TR = { up: 'yukarı', down: 'aşağı', mixed: 'karışık', flat: 'sınırlı' };
  var DIR_ICON = { up: '▲', down: '▼', mixed: '◆', flat: '–' };

  /* ---------- Olay türleri ve senaryo şablonları ---------- */
  var T_CUT_TR = { tr_equity: E('up', 'Faiz düşünce finansman maliyeti ve iskonto oranı azalır; iç talebe ve borca duyarlı şirketler lehine okunur (beklenti zaten fiyatlandıysa etki küçük).'), tr_income: E('mixed', 'Yeni kâr payı/mevduat oranları zamanla düşer; mevcut sabit getirili kira sertifikaları ise değer kazanabilir.'), gold: E('up', 'TL reel getirisi azalınca TL cinsi altın/döviz talebi artabilir (kur etkisiyle).'), us_equity: E('flat', 'Doğrudan etki yok; TL değeri USD/TL ile değişir.'), crypto: E('flat', 'Doğrudan etki yok.') };
  var T_HIKE_TR = { tr_equity: E('down', 'Finansman maliyeti artar; kısa vadede hisse değerlemeleri ve kredi duyarlı sektörler baskılanabilir.'), tr_income: E('mixed', 'Yeni kâr payı oranları yükselir; fon fiyatları kısa vadede baskılanabilir.'), gold: E('mixed', 'TL güçlenirse TL cinsi altın baskılanır; ons tarafı ayrı hareket eder.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') };
  var T_HOLD_TR = { tr_equity: E('mixed', 'Etki beklentiye bağlıdır: indirim beklenirken sabit kalmak “şahin sürpriz” sayılır (hisseler zayıflar); sabit beklenirken nötrdür.'), tr_income: E('mixed', 'İndirim beklentisi sönerse TL getirili araçlar görece avantajlı kalır.'), gold: E('flat', 'Sınırlı.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') };
  var T_HIKE_US = { us_equity: E('down', 'Yüksek faiz değerleme çarpanlarını ve borçlanmayı baskılar.'), gold: E('down', 'Reel faiz ve dolar yükselişi altına baskı yapar.'), crypto: E('down', 'Likidite sıkılaşması riskli varlıkları zayıflatır.'), tr_equity: E('down', 'Gelişen piyasalardan sermaye çıkışı riski artar.'), tr_income: E('mixed', 'Dolar güçlenirse kur baskısı artar; TCMB tepkisi belirleyicidir.') };
  var T_HOLD_US = { us_equity: E('flat', 'Karar beklentideyse sınırlı; asıl etki toplantı metni ve projeksiyonlardan gelir.'), gold: E('flat', 'Sınırlı.'), crypto: E('flat', 'Sınırlı.'), tr_equity: E('flat', 'Sınırlı.'), tr_income: E('flat', 'Sınırlı.') };
  var T_CUT_US = { us_equity: E('up', 'Düşen faiz değerlemeleri ve likiditeyi destekler.'), gold: E('up', 'Reel faiz düşer, dolar zayıflarsa altın destek bulur.'), crypto: E('up', 'Likidite artışı riskli varlıkları destekler.'), tr_equity: E('up', 'Gelişen piyasalara sermaye girişi kolaylaşır.'), tr_income: E('mixed', 'Dolar zayıflarsa kur baskısı hafifler; TL getirisi için TCMB belirleyici.') };
  var T_ECB_HAWK = { us_equity: E('flat', 'Dolaylı.'), gold: E('mixed', 'Euro güçlenirse dolar bazında altın destek bulabilir.'), crypto: E('flat', 'Dolaylı.'), tr_equity: E('flat', 'Dolaylı (Avrupa talebi ve risk iştahı).'), tr_income: E('flat', 'Sınırlı.') };
  var T_ECB_DOVE = { us_equity: E('flat', 'Dolaylı.'), gold: E('mixed', 'Euro zayıflarsa dolar güçlenir; altın baskılanabilir.'), crypto: E('flat', 'Dolaylı.'), tr_equity: E('flat', 'Dolaylı.'), tr_income: E('flat', 'Sınırlı.') };
  var T_CPI_HI_TR = { tr_income: E('down', 'Reel getiri düşer; TCMB’nin indirim temposu yavaşlayabilir.'), tr_equity: E('mixed', 'Nominal gelir artar, ama faiz indirimi beklentisi azalırsa değerleme baskılanır.'), gold: E('up', 'Enflasyondan korunma talebi artabilir.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') };
  var T_CPI_IN = { tr_income: E('flat', 'Beklentiyle uyumlu veri fiyatlanmıştır.'), tr_equity: E('flat', 'Sınırlı.'), gold: E('flat', 'Sınırlı.'), us_equity: E('flat', 'Sınırlı.'), crypto: E('flat', 'Sınırlı.') };
  var T_CPI_LO_TR = { tr_income: E('up', 'Reel getiri artar; indirim beklentisi güçlenir.'), tr_equity: E('up', 'Faiz indirimi beklentisi güçlenirse hisseler lehine okunur.'), gold: E('flat', 'Korunma talebi azalabilir.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') };
  var T_CPI_HI_US = { us_equity: E('down', 'Faiz indirimi beklentisi azalır, tahvil faizleri yükselir.'), gold: E('down', 'Reel faiz ve dolar yükselirse baskı; enflasyon korunması ters yönde çeker.'), crypto: E('down', 'Sıkı para politikası beklentisi riskli varlıklara olumsuz.'), tr_equity: E('down', 'Küresel risk iştahı zayıflar.'), tr_income: E('flat', 'Dolaylı.') };
  var T_CPI_LO_US = { us_equity: E('up', 'İndirim beklentisi artar.'), gold: E('up', 'Reel faiz düşer.'), crypto: E('up', 'Likidite beklentisi artar.'), tr_equity: E('up', 'Küresel risk iştahı artar.'), tr_income: E('flat', 'Dolaylı.') };
  var T_JOBS_STRONG = { us_equity: E('mixed', 'Güçlü büyüme olumlu, ama faiz indirimi beklentisi azalırsa olumsuz.'), gold: E('down', 'Faiz beklentisi yükselir.'), crypto: E('down', 'Faiz beklentisi yükselir.'), tr_equity: E('flat', 'Dolaylı.'), tr_income: E('flat', 'Dolaylı.') };
  var T_JOBS_WEAK = { us_equity: E('mixed', 'Yavaşlama kaygısı vs. faiz indirimi beklentisi.'), gold: E('up', 'Faiz indirimi beklentisi ve güvenli liman talebi.'), crypto: E('mixed', 'Likidite beklentisi vs. risk kaçışı.'), tr_equity: E('flat', 'Dolaylı.'), tr_income: E('flat', 'Dolaylı.') };

  var TYPES = {
    cbrt_ppk: { label: 'TCMB faiz kararı', topic: 'rates_tr', scen: [
      { id: 'cut', label: 'İndirim', code: 'cut', analog: 'cbrt_cut', effects: T_CUT_TR }, { id: 'hold', label: 'Sabit', code: 'hold', analog: null, effects: T_HOLD_TR }, { id: 'hike', label: 'Artırım', code: 'hike', analog: 'cbrt_hike', effects: T_HIKE_TR }] },
    fomc: { label: 'Fed faiz kararı', topic: 'rates_us', scen: [
      { id: 'cut', label: 'İndirim', code: 'cut', analog: 'fed_cut', effects: T_CUT_US }, { id: 'hold', label: 'Sabit', code: 'hold', analog: null, effects: T_HOLD_US }, { id: 'hike', label: 'Artırım', code: 'hike', analog: 'fed_hike', effects: T_HIKE_US }] },
    ecb_rate: { label: 'ECB faiz kararı', topic: 'rates_eu', scen: [
      { id: 'cut', label: 'İndirim', code: 'cut', analog: null, effects: T_ECB_DOVE }, { id: 'hold', label: 'Sabit', code: 'hold', analog: null, effects: T_HOLD_US }, { id: 'hike', label: 'Artırım', code: 'hike', analog: null, effects: T_ECB_HAWK }] },
    tr_cpi: { label: 'TÜİK enflasyon verisi', topic: 'inflation', scen: [
      { id: 'low', label: 'Beklentinin altında', code: 'below', analog: null, effects: T_CPI_LO_TR }, { id: 'in', label: 'Beklentiye yakın', code: 'inline', analog: null, effects: T_CPI_IN }, { id: 'high', label: 'Beklentinin üstünde', code: 'above', analog: null, effects: T_CPI_HI_TR }] },
    us_cpi: { label: 'ABD enflasyon verisi (TÜFE)', topic: 'inflation', scen: [
      { id: 'low', label: 'Beklentinin altında', code: 'below', analog: null, effects: T_CPI_LO_US }, { id: 'in', label: 'Beklentiye yakın', code: 'inline', analog: null, effects: T_CPI_IN }, { id: 'high', label: 'Beklentinin üstünde', code: 'above', analog: null, effects: T_CPI_HI_US }] },
    us_jobs: { label: 'ABD istihdam raporu', topic: 'macro_us', scen: [
      { id: 'weak', label: 'Zayıf', code: 'below', analog: null, effects: T_JOBS_WEAK }, { id: 'strong', label: 'Güçlü', code: 'above', analog: null, effects: T_JOBS_STRONG }] }
  };
  /* Kalshi/Polymarket'te izlenen siyasi riskler (tarihi belli olmayan, olasılığı piyasa fiyatlayan gelişmeler) */
  var POLITICS = {
    tr_early_election: { label: 'Erken seçim takvimi açıklanırsa', analog: 'turkey_election', effects: { tr_equity: E('mixed', 'Seçim öncesi belirsizlik primi oynaklığı artırır; yön sonuca ve politika beklentisine göre değişir.'), tr_income: E('mixed', 'Kur ve faiz beklentisi seçim sonucuna bağlıdır.'), gold: E('up', 'Belirsizlikte TL cinsi altına talep artabilir.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') } },
    tr_erdogan_out: { label: 'Cumhurbaşkanı görevden ayrılırsa', analog: 'turkey_shock', effects: { tr_equity: E('mixed', 'Kurumsal belirsizlik şoku; ilk tepki genelde sert, kalıcı etki devir sürecine bağlı.'), tr_income: E('mixed', 'Kur ve faiz primi yükselebilir.'), gold: E('up', 'Belirsizlikte TL cinsi altın talebi artabilir.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') } },
    tr_imamoglu: { label: 'İmamoğlu serbest bırakılırsa', analog: 'turkey_shock', effects: { tr_equity: E('mixed', 'Siyasi risk primi azalırsa olumlu okunabilir; tek benzer olay 19 Mart 2025 (ters yönde) olduğundan örnek sayısı çok küçük.'), tr_income: E('mixed', 'Kur riski primi etkilenebilir.'), gold: E('flat', 'Sınırlı.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') } },
    tr_constitution: { label: 'Anayasa referandumu ilan edilirse', analog: 'turkey_election', effects: { tr_equity: E('mixed', 'Siyasi belirsizlik primi; yön içeriğe bağlı.'), tr_income: E('mixed', 'Sınırlı veri.'), gold: E('flat', 'Sınırlı.'), us_equity: E('flat', 'Doğrudan etki yok.'), crypto: E('flat', 'Doğrudan etki yok.') } }
  };
  var ANALOG_LABEL = { cbrt_cut: 'TCMB indirim günleri', cbrt_hike: 'TCMB artırım günleri', fed_cut: 'Fed indirim günleri', fed_hike: 'Fed artırım günleri', turkey_shock: 'Türkiye siyasi/ekonomik şokları', turkey_election: 'Türkiye seçim günleri', cbrt_governor: 'TCMB başkanı değişiklikleri', global_shock: 'Küresel şoklar', global_event: 'Küresel olaylar' };
  var GROUP_ASSET = { tr_equity: ['XU100', 'BIST 100'], us_equity: ['SPX', 'S&P 500'], gold: ['XAUTRY', 'Altın (TL)'], crypto: ['BTCUSD', 'Bitcoin'], tr_income: ['USDTRY', 'USD/TL (kur riski)'] };

  /* ---------- Takvim ---------- */
  function upcoming(cal, nowMs, horizonDays) {
    var today = tsiYmd(nowMs), out = [];
    ((cal && cal.events) || []).forEach(function (ev) {
      var ms = eventMs(ev); if (!isFinite(ms)) return;
      var dl = daysBetween(today, ev.date); if (dl < -1 || dl > (horizonDays == null ? 120 : horizonDays)) return;
      out.push(Object.assign({}, ev, { ms: ms, daysLeft: dl, phase: dl < 0 ? 'past' : dl === 0 ? 'today' : dl === 1 ? 'tomorrow' : dl <= 7 ? 'soon' : 'later', ti: TYPES[ev.type] || null }));
    });
    return out.sort(function (a, b) { return a.ms - b.ms; });
  }
  function whenText(ev) { var d = ev.daysLeft; return d < 0 ? 'geçti' : d === 0 ? 'bugün' : d === 1 ? 'yarın' : d + ' gün sonra'; }

  /* ---------- Beklenti (kaynağıyla) ---------- */
  function sameMonthCpi(ev, survey) {
    // TÜİK verisi ayın başında bir önceki ayı açıklar; anketin "cari ay" değeri anketin yapıldığı ay içindir (Kasım anketi → Kasım TÜFE, Aralık'ın 3'ünde açıklanır).
    if (!survey || !survey.monthlyCpi || !survey.period) return null;
    var mi = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'], p = /^(\S+) (\d{4})$/.exec(survey.period); if (!p) return null;
    var sm = mi.indexOf(p[1]), sy = +p[2]; if (sm < 0) return null;
    var em = +ev.date.slice(5, 7) - 1, ey = +ev.date.slice(0, 4), ref = em === 0 ? { m: 11, y: ey - 1 } : { m: em - 1, y: ey }; // yayımlanan ay = olay ayının bir öncesi
    var diff = (ref.y - sy) * 12 + (ref.m - sm);
    if (diff === 0) return { v: survey.monthlyCpi.cur, label: mi[ref.m] + ' ' + ref.y + ' aylık TÜFE' };
    if (diff === 1) return { v: survey.monthlyCpi.next, label: mi[ref.m] + ' ' + ref.y + ' aylık TÜFE' };
    return null;
  }
  function expectation(ev, ctx) {
    ctx = ctx || {}; var sv = ctx.survey, probs = (ctx.probs && ctx.probs.items) || [];
    if (ev.type === 'cbrt_ppk') {
      if (!sv || !sv.currentRate) return null;
      var next = sv.nextMeeting && sv.nextMeeting.rate, cur = sv.currentRate.rate;
      if (next == null) return null;
      var bp = Math.round((next - cur) * 100);
      return { kind: 'survey', text: 'TCMB anketi (' + sv.period + '): ' + fmtN(next) + '% (mevcut ' + fmtN(cur) + '%, ' + (bp > 0 ? '+' : '') + bp + ' bp)', value: next, deltaBp: bp, code: bp < 0 ? 'cut' : bp > 0 ? 'hike' : 'hold', src: { name: sv.source + ' — ' + sv.period, url: sv.pageUrl || sv.url } };
    }
    if (ev.type === 'fomc') {
      var it = probs.filter(function (p) { return p.region === 'fed' && p.decisionDate === ev.date && p.outcomes; })[0]; if (!it) return null;
      var top = it.outcomes.slice().sort(function (a, b) { return b.p - a.p; })[0], sums = {}, NAMES = { cut: 'İndirim', hold: 'Sabit', hike: 'Artırım' };
      it.outcomes.forEach(function (o) { var c = codeOf(o.label); sums[c] = (sums[c] || 0) + o.p; });
      var gk = Object.keys(sums).sort(function (a, b) { return sums[b] - sums[a]; })[0], gtxt = NAMES[gk] ? NAMES[gk] + ' %' + Math.round(sums[gk] * 100) : top.label + ' %' + Math.round(top.p * 100);
      return { kind: 'market', text: 'Piyasa (Kalshi) en olası yön: ' + gtxt + (NAMES[gk] && top.label !== NAMES[gk] ? ' (tek sonuç olarak en olası: ' + top.label + ' %' + Math.round(top.p * 100) + ')' : ''), code: gk && NAMES[gk] ? gk : codeOf(top.label), src: { name: 'Kalshi', url: it.url } };
    }
    if (ev.type === 'tr_cpi') { var m = sameMonthCpi(ev, sv); if (!m) return null; return { kind: 'survey', text: 'TCMB anketi: ' + m.label + ' beklentisi %' + fmtN(m.v), value: m.v, src: { name: 'TCMB Piyasa Katılımcıları Anketi — ' + sv.period, url: sv.pageUrl || sv.url } }; }
    if (ev.type === 'us_cpi') { var c = probs.filter(function (p) { return p.kind === 'ladder'; })[0]; if (!c || c.impliedMedian == null) return null; return { kind: 'market', text: 'Piyasa (Kalshi) ima edilen medyan: %' + fmtN(c.impliedMedian) + ' (yıllık TÜFE)', value: c.impliedMedian, src: { name: 'Kalshi', url: c.url } }; }
    if (ev.type === 'data' && ev.forecast != null) return { kind: 'consensus', text: 'Beklenti (konsensüs): ' + ev.forecast + (ev.previous ? ' · önceki ' + ev.previous : ''), src: ev.source };
    return null;
  }
  function fmtN(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
  function codeOf(label) { return /^Kesinti/i.test(label) ? 'cut' : /sabit/i.test(label) ? 'hold' : /^Art/i.test(label) ? 'hike' : null; }

  /* ---------- Olasılıklar (yalnız gerçek kaynaktan) ---------- */
  function probsFor(ev, ctx) {
    ctx = ctx || {}; var items = (ctx.probs && ctx.probs.items) || [];
    if (ev.type === 'fomc') {
      var it = items.filter(function (p) { return p.region === 'fed' && p.decisionDate === ev.date && p.outcomes; })[0]; if (!it) return null;
      var by = { cut: 0, hold: 0, hike: 0 }; it.outcomes.forEach(function (o) { var k = codeOf(o.label); if (k) by[k] += o.p; });
      var s = by.cut + by.hold + by.hike; if (!(s > 0.5)) return null;
      return { source: 'Kalshi (piyasa fiyatı)', url: it.url, kind: 'market', norm: s, by: { cut: by.cut / s, hold: by.hold / s, hike: by.hike / s }, detail: it.outcomes, note: 'Alış/satış ortası; toplam %' + Math.round(s * 100) + ' olduğundan %100\'e normalize edildi.' };
    }
    if (ev.type === 'us_cpi') {
      var c = items.filter(function (p) { return p.kind === 'ladder'; })[0]; if (!c || !c.ladder || !c.ladder.length) return null;
      var med = c.impliedMedian, r = Math.round(med * 10) / 10, pa = function (x) { var f = c.ladder.filter(function (l) { return Math.abs(l.above - x) < 1e-9; })[0]; return f ? f.p : null; };
      var pHi = pa(r), pLoEdge = pa(Math.round((r - 0.1) * 10) / 10); if (pHi == null || pLoEdge == null) return null;
      return { source: 'Kalshi (piyasa fiyatı)', url: c.url, kind: 'market', by: { below: Math.max(0, 1 - pLoEdge), inline: Math.max(0, pLoEdge - pHi), above: pHi }, ref: r, note: '“Beklenti” = ima edilen medyan %' + fmtN(med) + ' (en yakın %' + fmtN(r) + '). Altı = %' + fmtN(Math.round((r - 0.1) * 10) / 10) + ' ve altı; üstü = %' + fmtN(Math.round((r + 0.1) * 10) / 10) + ' ve üstü.' };
    }
    return null;
  }
  function probOfScenario(scn, pr) { if (!pr || !pr.by || scn.code == null) return null; return pr.by[scn.code] != null ? pr.by[scn.code] : null; }

  /* ---------- Portföy etkisi ---------- */
  function holdingImpact(scn, holdings) {
    var total = (holdings || []).reduce(function (s, h) { return s + (h.value > 0 ? h.value : 0); }, 0), rows = [], by = { up: 0, down: 0, mixed: 0, flat: 0 };
    (holdings || []).forEach(function (h) {
      if (!(h.value > 0)) return; var g = N.groupOf(h), ef = scn.effects && scn.effects[g]; if (!ef) { by.flat += h.value; return; }
      rows.push({ h: h, group: g, d: ef.d, t: ef.t }); by[ef.d] += h.value;
    });
    var pct = {}; Object.keys(by).forEach(function (k) { pct[k] = total > 0 ? by[k] / total : 0; });
    return { rows: rows, by: by, pct: pct, total: total };
  }
  function netTone(imp) { var u = imp.pct.up, d = imp.pct.down; return d - u > 0.1 ? 'olumsuz' : u - d > 0.1 ? 'olumlu' : 'karışık/sınırlı'; }

  /* ---------- Geçmiş benzer olaylar ---------- */
  function analogRows(analogs, group, groupsHeld) {
    if (!analogs || !analogs.groups || !group || !analogs.groups[group]) return null;
    var g = analogs.groups[group], keys = (groupsHeld && groupsHeld.length ? groupsHeld : Object.keys(GROUP_ASSET)).map(function (k) { return GROUP_ASSET[k]; }).filter(Boolean), seen = {}, rows = [];
    keys.forEach(function (k) { if (seen[k[0]]) return; seen[k[0]] = 1; var a = g.assets && g.assets[k[0]]; if (a) rows.push({ k: k[0], label: k[1], d1: a.d1, d5: a.d5, d20: a.d20 }); });
    var n = rows.length ? rows[0].d1.n : g.n;
    return { group: group, label: ANALOG_LABEL[group] || group, n: n, small: n <= 5, rows: rows, events: (analogs.events || []).filter(function (e) { return e.group === group; }) };
  }
  function recentCbrtDecisions(analogs, limit) {
    return ((analogs && analogs.events) || []).filter(function (e) { return e.auto && (e.group === 'cbrt_cut' || e.group === 'cbrt_hike'); }).slice(-(limit || 8)).map(function (e) { return { date: e.date, group: e.group, title: e.title }; });
  }
  /* ---------- Beklenti-sonuç sürprizi ---------- */
  function parseVal(s) {
    if (s == null) return null; var m = /^\s*(-?[\d.,]+)\s*([%KMBT])?\s*$/i.exec(String(s).replace(/,/g, '.').replace(/(\.)(?=.*\.)/g, '')); if (!m) return null;
    var x = parseFloat(m[1]); if (!isFinite(x)) return null; return { v: x, u: (m[2] || '').toUpperCase() };
  }
  var LOWER_BETTER = /unemployment|claims|jobless/i;
  function surprise(ev) {
    var a = parseVal(ev.actual), f = parseVal(ev.forecast); if (!a || !f || a.u !== f.u) return null;
    var diff = a.v - f.v, rel = Math.abs(f.v) > 0 ? Math.abs(diff) / Math.abs(f.v) : null;
    var code = Math.abs(diff) < 1e-9 ? 'inline' : diff > 0 ? 'above' : 'below', weakWhenHigh = LOWER_BETTER.test(ev.title || '');
    return { code: code, diff: diff, rel: rel, actual: ev.actual, forecast: ev.forecast, text: code === 'inline' ? 'Beklentiyle aynı (' + ev.actual + ')' : 'Gerçekleşen ' + ev.actual + ', beklenti ' + ev.forecast + ' → beklentinin ' + (code === 'above' ? 'üstünde' : 'altında') + (weakWhenHigh && code === 'above' ? ' (işsizlik göstergesinde yüksek = zayıf)' : ''), material: code !== 'inline' && (rel == null || rel >= 0.1 || Math.abs(diff) >= 0.2) };
  }
  /* Faiz kararı gerçekleştikten sonra: beklenen faiz (T-1'de kaydedilen) ile gerçekleşen faiz farkı (bp) */
  function rateSurprise(expectedRate, actualRate) { if (expectedRate == null || actualRate == null) return null; var bp = Math.round((actualRate - expectedRate) * 100); return { bp: bp, code: Math.abs(bp) < 25 ? 'inline' : bp > 0 ? 'hawkish' : 'dovish' }; }
  return { TYPES: TYPES, POLITICS: POLITICS, ANALOG_LABEL: ANALOG_LABEL, GROUP_ASSET: GROUP_ASSET, DIR_TR: DIR_TR, DIR_ICON: DIR_ICON, tsiYmd: tsiYmd, ymdMs: ymdMs, eventMs: eventMs, daysBetween: daysBetween, upcoming: upcoming, whenText: whenText,
    expectation: expectation, probsFor: probsFor, probOfScenario: probOfScenario, holdingImpact: holdingImpact, netTone: netTone, analogRows: analogRows, recentCbrtDecisions: recentCbrtDecisions, surprise: surprise, rateSurprise: rateSurprise, parseVal: parseVal, codeOf: codeOf, fmtN: fmtN };
});
