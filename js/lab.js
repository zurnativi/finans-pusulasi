/* lab.js — v8.8: Portföy Laboratuvarı (oluşturucu + kayıtlı sanal portföyler). Saf fonksiyonlar (ağ yok) — tümü testli.
 * - Filtreler: helal aç/kapa, yatırımcı profili (muhafazakâr / dengeli = standart / agresif / özel), varlık sınıfları, Döviz grubu
 *   ("Döviz", "Dolar bazlı helal ETF dahil", "Yalnız TL araçlar" birbirini dışlamaz), sektör, likidite, varlık sayısı, tek varlık üst sınırı, en düşük skor.
 * - Varlık skoru = analiz motorunun (analysis.js) 0-100 skoru + bileşenleri; veri yoksa null ("veri yetersiz"), uydurulmaz.
 * - Alım durumu: fiyat, motorun gerçek fiyat yapısından (destek/direnç bölgeleri, ATR) hesapladığı alım bölgesinde mi? Değilse "şu seviyeye gelirse al".
 * - Dağılım: vade × risk tablosu (güvenli/orta/riskli) → grup içinde skor, oynaklık ve alım bölgesine göre ağırlık; tek varlık sınırı; döviz payı sınırı.
 * - Sanal alım: tutar girildiyse oluşturma anındaki fiyattan "almış gibi" adet/maliyet; bölgede olmayanlar için bekleyen nakit/emir.
 * - Takip: değerleme, kâr/zarar, bekleyen emirlerin günlük mumlarla dolması, stop/hedef olayları, yeniden dengeleme, portföy skoru. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./analysis.js'), require('./ta.js'));
  else root.Lab = factory(root.Analysis, root.TA);
})(typeof self !== 'undefined' ? self : this, function (AN, TA) {
  'use strict';
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function interp(x, pts) { return AN.interp(x, pts); }
  var VERSION = 1, MAX_PORTFOLIOS = 30, MAX_HISTORY = 400, MAX_POS = 20;

  /* ---------- Varlık sınıfları ---------- */
  var CLASS = {
    bist: { label: 'BIST hissesi', cur: 'TRY', step: 1, tier: 'risky', baseVol: 0.40 },
    fund: { label: 'Fon (TEFAS)', cur: 'TRY', step: 1, tier: 'medium', baseVol: 0.15 },
    gold: { label: 'Altın / gümüş', cur: 'TRY', step: 0.01, tier: 'medium', baseVol: 0.20 },
    fx: { label: 'Döviz (dolar / euro)', cur: 'FX', step: 0.01, tier: 'medium', baseVol: 0.12 },
    etf: { label: 'Dolar bazlı helal ETF', cur: 'USD', step: 0.0001, tier: 'risky', baseVol: 0.20 },
    usstock: { label: 'ABD hissesi (USD)', cur: 'USD', step: 0.0001, tier: 'risky', baseVol: 0.30 }, // v8.8.2 (kesirli adet: Midas vb. ABD hisselerinde kesirli alım sunar)
    crypto: { label: 'Kripto', cur: 'USD', step: 0.000001, tier: 'risky', baseVol: 0.70 },
    cash: { label: 'Nakit (katılım hesabı)', cur: 'TRY', step: 0.01, tier: 'safe', baseVol: 0 }
  };
  var TIER_LABEL = { safe: 'Güvenli', medium: 'Orta', risky: 'Riskli' };
  /* v8.8.2: market-data'daki yabancı ETF'ler — mdata.js US_ETF ile aynı (test). Diğer 'us:' anahtarları ABD hissesidir. */
  var US_ETF = { SPUS: 1, HLAL: 1, SPSK: 1, SPRE: 1, SPTE: 1, SPWO: 1, UMMA: 1, ISDW: 1, ISDU: 1, ISDE: 1, HIWO: 1, SPY: 1, QQQ: 1 };
  function classOfKey(key) {
    var k = String(key || '').split(':')[0], s = String(key || '').slice(k.length + 1);
    if (k === 'us') return US_ETF[s] ? 'etf' : 'usstock';
    return { bist: 'bist', tefas: 'fund', metal: 'gold', fx: 'fx', td: 'etf', cg: 'crypto', cash: 'cash' }[k] || null;
  }
  function isForeign(cls) { return cls === 'fx' || cls === 'etf' || cls === 'crypto' || cls === 'usstock'; }
  // Fon grubu: TEFAS türü/adı (gerçek liste alanları) → güvenli/orta/riskli
  function trl(s) { return String(s || '').toLocaleLowerCase('tr-TR'); } // Türkçe büyük harf (İ, I) doğru küçültülsün: "PARA PİYASASI" → "para piyasası"
  function isGoldName(s) { return /(^|[^a-zçğıöşü])(altın|gümüş)([^a-zçğıöşü]|$)|kıymetli|değerli maden/.test(trl(s)); } // "ALTINCI" (altıncı) altın değildir
  function fundTier(f) {
    var t = trl((f && (f.type || '')) + ' ' + (f && f.name || ''));
    if (/para piyasası/i.test(t) || (/kira sertifika/i.test(t) && (!f.risk || (f.risk.score || f.risk) <= 2))) return 'safe';
    if (/hisse/i.test(t) || (f && (f.stock_pct || 0) >= 70)) return 'risky';
    return 'medium';
  }
  // Gözlenen oynaklıkla düzeltme: adı "serbest/kısa vadeli" olup para piyasası gibi davranan fon orta grupta, hisse ağırlıklı ama az oynayan fon riskli grupta kalmasın
  function fundTierByVol(tier, vol1y, name) {
    if (vol1y == null || !isFinite(vol1y)) return tier;
    if (tier === 'medium' && vol1y < 0.04 && !isGoldName(name)) return 'safe';
    if (tier === 'risky' && vol1y < 0.08) return 'medium';
    return tier;
  }

  /* ---------- Profiller ve filtreler ---------- */
  var SECTORS_TR = { 'Electronic Technology': 'Elektronik teknoloji', 'Finance': 'Finans', 'Energy Minerals': 'Enerji (petrol/gaz)', 'Utilities': 'Elektrik/gaz dağıtım', 'Non-Energy Minerals': 'Maden ve metal',
    'Process Industries': 'Kimya ve süreç sanayi', 'Producer Manufacturing': 'Makine ve imalat', 'Consumer Durables': 'Dayanıklı tüketim', 'Consumer Non-Durables': 'Gıda ve tüketim', 'Retail Trade': 'Perakende',
    'Transportation': 'Ulaşım', 'Communications': 'İletişim', 'Technology Services': 'Yazılım ve teknoloji', 'Health Technology': 'Sağlık teknolojisi', 'Health Services': 'Sağlık hizmetleri',
    'Industrial Services': 'Sanayi hizmetleri', 'Commercial Services': 'Ticari hizmetler', 'Distribution Services': 'Dağıtım', 'Consumer Services': 'Tüketici hizmetleri', 'Miscellaneous': 'Diğer' };
  function sectorTr(s) { return s ? (SECTORS_TR[s] || s) : 'Bilinmiyor'; }
  var PROFILES = {
    muhafazakar: { label: 'Muhafazakâr', horizon: 'medium', risk: 'low', classes: { bist: true, fund: true, gold: true, crypto: false, us: false }, fx: true, usdEtf: false, tlOnly: false, count: 6, maxSingleBp: 3000, minScore: 50, liquidity: 'high', preferZone: true, minNowBp: 6000 },
    dengeli: { label: 'Dengeli (standart)', horizon: 'medium', risk: 'medium', classes: { bist: true, fund: true, gold: true, crypto: false, us: true }, fx: false, usdEtf: true, tlOnly: false, count: 8, maxSingleBp: 2500, minScore: 45, liquidity: 'mid', preferZone: true, minNowBp: 5000 },
    agresif: { label: 'Agresif (büyüme)', horizon: 'long', risk: 'high', classes: { bist: true, fund: true, gold: true, crypto: false, us: true }, fx: false, usdEtf: true, tlOnly: false, count: 10, maxSingleBp: 2000, minScore: 45, liquidity: 'mid', preferZone: true, minNowBp: 4000 }
  };
  var PROFILE_KEYS = ['horizon', 'risk', 'classes', 'fx', 'usdEtf', 'tlOnly', 'count', 'maxSingleBp', 'minScore', 'liquidity', 'preferZone', 'minNowBp'];
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function defaultFilters() { var f = clone(PROFILES.dengeli); delete f.label; f.profile = 'dengeli'; f.halal = true; f.sectors = []; return f; }
  function applyProfile(f, name) {
    var p = PROFILES[name], out = clone(f || defaultFilters()); if (!p) { out.profile = 'ozel'; return out; }
    PROFILE_KEYS.forEach(function (k) { out[k] = clone(p[k]); }); out.profile = name; return out;
  }
  function profileMatches(f) { var p = PROFILES[f.profile]; if (!p) return false; return PROFILE_KEYS.every(function (k) { return JSON.stringify(p[k]) === JSON.stringify(f[k]); }); }
  function cleanFilters(f) {
    var d = defaultFilters(), o = {}; f = f && typeof f === 'object' ? f : {};
    o.profile = PROFILES[f.profile] || f.profile === 'ozel' ? f.profile : d.profile;
    o.halal = typeof f.halal === 'boolean' ? f.halal : true;
    o.horizon = ['short', 'medium', 'long'].indexOf(f.horizon) >= 0 ? f.horizon : d.horizon;
    o.risk = ['low', 'medium', 'high'].indexOf(f.risk) >= 0 ? f.risk : d.risk;
    o.classes = {}; ['bist', 'fund', 'gold', 'crypto'].forEach(function (k) { o.classes[k] = f.classes && typeof f.classes[k] === 'boolean' ? f.classes[k] : d.classes[k]; });
    // v8.8.2 'ABD hisseleri' sınıfı: eski kayıtta yoksa — sınıfları profilin aynısıysa profil varsayılanı, elle değiştirilmişse kapalı (yeni sınıf sessizce eklenmez)
    if (f.classes && typeof f.classes.us === 'boolean') o.classes.us = f.classes.us;
    else if (!f.classes) o.classes.us = d.classes.us;
    else { var pc = PROFILES[f.profile] && PROFILES[f.profile].classes; o.classes.us = !!(pc && ['bist', 'fund', 'gold', 'crypto'].every(function (k) { return pc[k] === o.classes[k]; }) && pc.us); }
    ['fx', 'usdEtf', 'tlOnly', 'preferZone'].forEach(function (k) { o[k] = typeof f[k] === 'boolean' ? f[k] : d[k]; });
    o.count = Number.isInteger(f.count) && f.count >= 3 && f.count <= 15 ? f.count : d.count;
    o.maxSingleBp = Number.isInteger(f.maxSingleBp) && f.maxSingleBp >= 1000 && f.maxSingleBp <= 5000 ? f.maxSingleBp : d.maxSingleBp;
    o.minScore = [0, 40, 45, 50, 55, 60, 65].indexOf(f.minScore) >= 0 ? f.minScore : d.minScore;
    o.liquidity = ['any', 'mid', 'high'].indexOf(f.liquidity) >= 0 ? f.liquidity : d.liquidity;
    o.minNowBp = [0, 3000, 4000, 5000, 6000, 7000].indexOf(f.minNowBp) >= 0 ? f.minNowBp : d.minNowBp;
    o.sectors = Array.isArray(f.sectors) ? f.sectors.filter(function (s) { return typeof s === 'string' && s.length <= 60; }).slice(0, 30) : [];
    if (o.profile !== 'ozel' && !profileMatches(o)) o.profile = 'ozel';
    return o;
  }
  var FX_CAP_BP = 3000; // "Yalnız TL araçlar" + döviz/ETF istisnası: dövize bağlı toplam pay en fazla %30 (TL ağırlıklı kalır)
  /* Filtreleri anlamlandır: hangi sınıflara izin var + açık uyarılar (çelişkiler sessizce yok sayılmaz). */
  function resolveFilters(fIn) {
    var f = cleanFilters(fIn), allow = { bist: f.classes.bist, fund: f.classes.fund, gold: f.classes.gold, crypto: f.classes.crypto, usstock: f.classes.us, fx: f.fx, etf: f.usdEtf, cash: true }, warnings = [], info = [], fxCapBp = null;
    if (f.halal && f.classes.crypto) { allow.crypto = false; warnings.push({ level: 'warn', code: 'halal-crypto', text: 'Helal filtresi açıkken kripto eklenmez: kripto paralar hakkında âlimler arasında görüş ayrılığı var (durum: şüpheli). Kripto istiyorsan helal filtresini kapat.' }); }
    if (f.tlOnly) {
      if (allow.usstock) { allow.usstock = false; warnings.push({ level: 'warn', code: 'tl-us', text: '"Yalnız TL araçlar" seçiliyken ABD hisseleri (dolar bazlı) eklenmez. ABD hissesi istiyorsan "Yalnız TL araçlar"ı kaldır (dolar bazlı helal ETF istisnası ayrıca seçilebilir).' }); }
      if (allow.crypto) { allow.crypto = false; warnings.push({ level: 'warn', code: 'tl-crypto', text: '"Yalnız TL araçlar" seçiliyken kripto (dolar bazlı) eklenmez. Kripto istiyorsan "Yalnız TL araçlar"ı kaldır.' }); }
      var ex = []; if (f.usdEtf) ex.push('dolar bazlı helal ETF'); if (f.fx) ex.push('döviz (dolar/euro)');
      if (ex.length) { fxCapBp = FX_CAP_BP; info.push({ level: 'info', code: 'tl-plus', text: 'TL araçlar + ' + ex.join(' + ') + ': portföyün ana gövdesi TL araçlardır (BIST, TEFAS fonu, gram altın); ' + ex.join(' ve ') + ' istisna olarak eklenir ve dövize bağlı toplam pay en fazla %' + (FX_CAP_BP / 100) + ' olur.' }); }
      else info.push({ level: 'info', code: 'tl-only', text: 'Yalnız TL araçlar: BIST hissesi, TEFAS fonu ve gram altın (TL). Dolar bazlı ETF, döviz ve kripto girmez.' });
      if (f.fx && f.usdEtf) info.push({ level: 'info', code: 'tl-all', text: 'Üçü birlikte seçili: "Yalnız TL araçlar" burada yalnızca kriptoyu dışarıda bırakır ve dövize bağlı payı %' + (FX_CAP_BP / 100) + ' ile sınırlar.' });
    }
    if (!f.halal) warnings.push({ level: 'warn', code: 'halal-off', text: 'Helal filtresi KAPALI: şüpheli veya katılım endeksinde olmayan varlıklar da önerilebilir. Her varlığın helal durumu raporda ayrıca yazılır; faizli (uygun değil) araçlar yine önerilmez.' });
    var anyClass = ['bist', 'fund', 'gold', 'crypto', 'usstock', 'fx', 'etf'].some(function (k) { return allow[k]; });
    if (!anyClass) warnings.push({ level: 'danger', code: 'no-class', text: 'Hiç varlık sınıfı seçili değil: portföy yalnızca nakitten oluşur. En az bir sınıf seç.' });
    if (f.risk === 'high' && f.horizon === 'short') warnings.push({ level: 'warn', code: 'short-high', text: 'Kısa vade + yüksek risk: 2 yıldan kısa sürede hisse/kripto ağırlıklı portföy büyük düşüşten toparlanamayabilir.' });
    if (f.risk === 'low' && !allow.fund && !allow.gold && !allow.fx) warnings.push({ level: 'warn', code: 'low-nosafe', text: 'Düşük risk seçili ama fon, altın ve döviz kapalı: güvenli ve orta paylar nakitte bekler.' });
    if (f.sectors.length && !allow.bist) warnings.push({ level: 'warn', code: 'sector-nobist', text: 'Sektör filtresi yalnızca BIST hisselerine uygulanır; BIST hissesi kapalı olduğu için etkisi yok.' });
    if (f.count * f.maxSingleBp < 10000) warnings.push({ level: 'warn', code: 'cap-count', text: f.count + ' varlık × en fazla %' + (f.maxSingleBp / 100) + ' = %' + (f.count * f.maxSingleBp / 100) + ': kalan pay nakitte kalır. Varlık sayısını veya tek varlık sınırını artır.' });
    return { f: f, allow: allow, warnings: warnings, info: info, fxCapBp: fxCapBp };
  }

  /* ---------- Varlık skoru ve alım durumu ---------- */
  var KIND_OF_CLASS = { bist: 'stock', fund: 'fund', gold: 'metal', fx: 'fx', etf: 'etf', crypto: 'crypto', usstock: 'stock' };
  // snap: snapshot.js compact() çıktısı (sunucu veya tarayıcı aynı kodla)
  function assetScore(snap) {
    if (!snap) return { score: null, reason: 'Analiz verisi alınamadı', parts: [] };
    var kind = snap.kind || 'stock', W = AN.WEIGHTS[kind] || AN.WEIGHTS.stock, S = snap.scores || {}, used = 0, parts = [], missing = [];
    Object.keys(W).forEach(function (k) { if (num(S[k])) { used += W[k]; parts.push({ k: k, label: AN.SUB_LABEL[k], w: W[k], s: S[k] }); } else missing.push(AN.SUB_LABEL[k]); });
    parts.forEach(function (p) { p.wEff = used ? p.w / used : 0; p.contrib = p.wEff * p.s; });
    if (snap.blocked) return { score: null, conf: snap.confidence, reason: 'Veri sorunu: ' + ((snap.blockReasons || [])[0] || 'sinyal üretilmedi'), parts: parts, missing: missing };
    if (!num(snap.total)) return { score: null, conf: snap.confidence, reason: 'Veri yetersiz (skor hesaplanamadı)', parts: parts, missing: missing };
    return { score: snap.total, conf: snap.confidence, confLabel: snap.confLabel, parts: parts, missing: missing, reason: null };
  }
  function mainTarget(pl) { if (!pl || !pl.targets || !pl.targets.length) return null; var m = pl.targets.filter(function (t) { return !t.minor; })[0]; return (m || pl.targets[0]).p; }
  /* Alım durumu (fiyat: anlık; plan: motorun temkinli/atak planı). code: now (şimdi alınabilir), wait (şu seviyeye gelirse al), trail (zirvede, iz süren stopla kademeli),
   * broken (fiyat stopun altında — yapı bozuldu, bekle), none (seviye hesaplanamadı). */
  function entryStatus(snap, priceIn, cls) {
    var price = num(priceIn) ? priceIn : snap && snap.price, atr = snap && snap.ind ? snap.ind.atr : null, pls = snap && snap.plans ? [snap.plans.conservative, snap.plans.aggressive] : [];
    var out = { code: 'none', label: 'Seviye hesaplanamadı', price: price, buyLo: null, buyHi: null, stop: null, t1: null, t2: null, rrNow: null, plan: null, why: '' };
    if (!num(price)) { out.why = 'Fiyat yok'; return out; }
    var cands = pls.map(function (pl, i) {
      if (!pl || !num(pl.entryLo) || !num(pl.entryHi) || !num(pl.stop)) return null;
      var tol = num(atr) ? 0.25 * atr : (pl.entryHi - pl.entryLo) * 0.2, mt = mainTarget(pl), ts = (pl.targets || []).map(function (t) { return t.p; }).filter(num);
      var inZone = price <= pl.entryHi + tol && price > pl.stop, rrNow = mt != null && price > pl.stop ? (mt - price) / Math.max(price - pl.stop, num(atr) ? 0.5 * atr : 0, price * 0.005) : null; // risk en az 0,5×ATR (stopa çok yakın girişte R/Ö şişmesin)
      return { pl: pl, i: i, inZone: inZone, rrNow: rrNow, mt: mt, ts: ts };
    }).filter(Boolean);
    if (!cands.length) {
      if (cls === 'fund' && snap && num(snap.total) && !snap.blocked && snap.ind && num(snap.ind.atrPct) && snap.ind.atrPct < 0.004) return Object.assign(out, { code: 'now', label: 'Şimdi alınabilir (düşük oynaklıklı fon)', plan: 'fund', why: 'Günlük oynaklık %' + r1(snap.ind.atrPct * 100) + ': zamanlama gerekmez; fonlarda stop emri yoktur.' });
      if (num(atr) && snap && num(snap.total) && snap.total >= 55 && !snap.blocked) { // zirvede/destek yok: ATR iz süren stop (Chandelier mantığı, 2,5×ATR)
        return Object.assign(out, { code: 'trail', label: 'Kademeli alınabilir (zirvede, iz süren stop)', stop: price - 2.5 * atr, buyLo: price - atr, buyHi: price, plan: 'trail', why: 'Altında güvenilir destek yok, trend güçlü: giriş kademeli, stop = fiyat − 2,5×ATR (iz süren).' });
      }
      out.why = (snap && snap.plans && snap.plans.notes && snap.plans.notes[0]) || 'Plan üretilmedi'; return out;
    }
    var stopAll = Math.max.apply(null, cands.map(function (c) { return c.pl.stop; }));
    var zone = cands.filter(function (c) { return c.inZone && (c.rrNow == null || c.rrNow >= 1.5); }).sort(function (a, b) { return (b.rrNow || 0) - (a.rrNow || 0); })[0];
    var pick = zone || cands.slice().sort(function (a, b) { return b.pl.entryHi - a.pl.entryHi; }).filter(function (c) { return c.pl.entryHi < price; })[0] || cands[0];
    Object.assign(out, { buyLo: pick.pl.entryLo, buyHi: pick.pl.entryHi, stop: pick.pl.stop, t1: pick.ts[0] != null ? pick.ts[0] : null, t2: pick.ts[1] != null ? pick.ts[1] : null, tMain: pick.mt, rrNow: pick.rrNow, rrPlan: pick.pl.rr, plan: pick.i === 0 ? 'conservative' : 'aggressive', how: pick.pl.how });
    if (zone) { out.code = 'now'; out.label = 'Şimdi alınabilir'; out.why = 'Fiyat alım bölgesinde (' + pick.pl.how + '); güncel fiyata göre risk/ödül ' + (zone.rrNow != null ? r1(zone.rrNow) : '—') + '.'; return out; }
    if (price <= stopAll && cands.every(function (c) { return price <= c.pl.stop; })) { out.code = 'broken'; out.label = 'Bekle — fiyat stop seviyesinin altında'; out.why = 'Fiyat destek yapısının altına indi; yeni dip oluşmadan alım önerilmez.'; return out; }
    var inZoneLowRR = cands.filter(function (c) { return c.inZone; })[0];
    if (inZoneLowRR && price <= pick.pl.entryHi + (num(atr) ? 0.25 * atr : 0)) { out.code = 'wait'; out.label = 'Bölgede ama risk/ödül düşük — ' + fmt(pick.pl.entryLo) + ' civarı beklenmeli'; out.buyHi = pick.pl.entryLo + (pick.pl.entryHi - pick.pl.entryLo) * 0.5; out.why = 'Risk/ödül 1,5\'in altında (' + (inZoneLowRR.rrNow != null ? r1(inZoneLowRR.rrNow) : '—') + '); bölgenin alt yarısında alım daha uygun.'; return out; }
    out.code = 'wait'; out.label = fmt(pick.pl.entryLo) + '–' + fmt(pick.pl.entryHi) + ' aralığına gelirse al'; out.why = 'Fiyat (' + fmt(price) + ') alım bölgesinin üstünde; acele alım risk/ödülü bozar.';
    return out;
  }
  function fmt(x) { return AN.fmtP(x); }

  /* ---------- Aday filtreleme ---------- */
  // cand: { key, name, cls, tier, cur, halal:{status,label,reason}, snap, sector, liq:{score, vol30TL, size}, fundType, vol1y, ret1y }
  function liqOk(c, level) {
    if (level === 'any') return true;
    var s = c.liq && num(c.liq.score) ? c.liq.score : c.snap && c.snap.scores && num(c.snap.scores.liquidity) ? c.snap.scores.liquidity : null;
    if (c.cls === 'fund') { var sz = c.liq && num(c.liq.size) ? c.liq.size : null; if (sz != null) return sz >= (level === 'high' ? 1e9 : 2e8); return s == null ? true : s >= (level === 'high' ? 65 : 40); }
    if (c.cls === 'gold' || c.cls === 'fx' || c.cls === 'cash') return true; // derin piyasalar
    if (s == null) return level !== 'high';
    return s >= (level === 'high' ? 65 : 40);
  }
  function filterCandidates(cands, fIn) {
    var R = resolveFilters(fIn), f = R.f, kept = [], excluded = [];
    (cands || []).forEach(function (c) {
      var why = null, sc = assetScore(c.snap);
      if (!R.allow[c.cls]) why = CLASS[c.cls] ? CLASS[c.cls].label + ' filtrede kapalı' : 'Sınıf kapalı';
      else if (f.tlOnly && isForeign(c.cls) && !(c.cls === 'etf' && f.usdEtf) && !(c.cls === 'fx' && f.fx)) why = 'Yalnız TL araçlar';
      else if (c.halal && c.halal.status === 'uygun_degil') why = 'Helal değil (faizli) — hiçbir ayarda önerilmez';
      else if (f.halal && (!c.halal || c.halal.status !== 'uygun')) why = 'Helal filtresi: durum ' + (c.halal ? c.halal.label || c.halal.status : 'bilinmiyor');
      else if (c.cls === 'bist' && f.sectors.length && f.sectors.indexOf(c.sector || '') < 0) why = 'Sektör filtresi (' + sectorTr(c.sector) + ')';
      else if (!liqOk(c, f.liquidity)) why = 'Likidite eşiğinin altında';
      else if (sc.score == null) why = sc.reason || 'Veri yetersiz';
      else if (sc.score < f.minScore) why = 'Skor ' + sc.score + ' < en düşük skor ' + f.minScore;
      if (why) excluded.push({ key: c.key, name: c.name, reason: why }); else kept.push(c);
    });
    return { kept: kept, excluded: excluded, resolved: R };
  }

  /* ---------- Seçim ve dağılım ---------- */
  function rankOf(c, f) {
    var sc = assetScore(c.snap).score || 0, e = c.entry || entryStatus(c.snap, c.price, c.cls), b = 0;
    if (f.preferZone && (e.code === 'now' || e.code === 'trail')) b += e.code === 'now' ? 12 : 6;
    if (num(e.rrNow)) b += clamp((e.rrNow - 1.5) * 3, -5, 6);
    if (e.code === 'broken') b -= 15;
    return sc + b;
  }
  function largestRemainder(raw, total) { // raw ≥ 0 → tam sayılar, toplam = total
    var s = raw.reduce(function (a, x) { return a + x; }, 0); if (!s) return raw.map(function () { return 0; });
    var ex = raw.map(function (x) { return x * total / s; }), fl = ex.map(Math.floor), left = total - fl.reduce(function (a, x) { return a + x; }, 0);
    ex.map(function (x, i) { return { i: i, r: x - fl[i] }; }).sort(function (a, b) { return b.r - a.r || a.i - b.i; }).slice(0, left).forEach(function (o) { fl[o.i]++; });
    return fl;
  }
  /* build: aday listesinden portföy taslağı (ağırlıklar). Sonuç: { tiers, positions:[{...cand, tier, weightBp, rank, entry, score}], cashBp, notes, warnings, excluded } */
  function isGoldLike(c) { return c.cls === 'gold' || (c.cls === 'fund' && isGoldName((c.name || '') + ' ' + (c.fundType || ''))); }
  function build(cands, fIn) {
    var FC = filterCandidates(cands, fIn), R = FC.resolved, f = R.f, notes = [], warnings = R.warnings.slice();
    var tm = AN.TIER_MATRIX[f.horizon][f.risk], tiers = { safe: tm[0], medium: tm[1], risky: tm[2] };
    var pool = FC.kept.map(function (c) { var e = c.entry || entryStatus(c.snap, c.price, c.cls); return Object.assign({}, c, { entry: e, score: assetScore(c.snap).score, tier: c.tier || CLASS[c.cls].tier }); });
    var byTier = { safe: [], medium: [], risky: [] }; pool.forEach(function (c) { byTier[c.tier].push(c); });
    ['safe', 'medium', 'risky'].forEach(function (t) { byTier[t].sort(function (a, b) { return rankOf(b, f) - rankOf(a, f) || (a.key < b.key ? -1 : 1); }); });
    // boş grupların payı riski ARTIRMAZ: riskli boşsa → orta (yoksa güvenli), orta boşsa → güvenli; güvenli de yoksa nakit (katılım hesabı)
    var cashBp = 0, DOWN = { risky: ['medium', 'safe'], medium: ['safe'], safe: [] };
    ['risky', 'medium', 'safe'].forEach(function (t) {
      if (!(tiers[t] > 0) || byTier[t].length) return;
      var to = DOWN[t].filter(function (o) { return byTier[o].length; })[0];
      if (to) { tiers[to] += tiers[t]; notes.push(TIER_LABEL[t] + ' grup için uygun araç yok: payı (%' + (tiers[t] / 100) + ') daha düşük riskli ' + TIER_LABEL[to].toLowerCase() + ' gruba aktarıldı (risk artırılmaz).'); }
      else { cashBp += tiers[t]; notes.push(TIER_LABEL[t] + ' grup için uygun araç yok (sınıf kapalı ya da veri yok): payı (%' + (tiers[t] / 100) + ') nakitte (katılım hesabı) bekler.'); }
      tiers[t] = 0;
    });
    // grup başına varlık sayısı (pay oranında, en az 1)
    var active = ['safe', 'medium', 'risky'].filter(function (t) { return tiers[t] > 0 && byTier[t].length; }), n = Math.min(f.count, pool.length), slots = {};
    // en az: grubun payını tek varlık sınırıyla taşıyacak kadar (⌈pay / sınır⌉); en çok: varlık başına en az %3 pay kalacak kadar
    var capS = f.maxSingleBp, maxS = {};
    active.forEach(function (t) { maxS[t] = Math.min(byTier[t].length, Math.max(1, Math.floor(tiers[t] / 300))); slots[t] = Math.min(maxS[t], Math.max(1, Math.ceil(tiers[t] / capS))); });
    var need = active.reduce(function (s, t) { return s + slots[t]; }, 0);
    if (need > n) { notes.push('Varlık sayısı ' + n + ' → ' + need + ': tek varlık sınırına (%' + (capS / 100) + ') uymak için gerekli.'); n = need; }
    var left = n - need;
    var DIVF = { safe: 0.3, medium: 1, risky: 2 }; // riskli grupta şirket/varlık özgü risk yüksek → daha çok varlıkla çeşitlendir; güvenli grupta (para piyasası) çok sayıda benzer fon gereksiz
    while (left > 0) { var bestT = null, bestV = -1; active.forEach(function (t) { if (slots[t] >= maxS[t]) return; var v = DIVF[t] * tiers[t] / (slots[t] + 1); if (v > bestV) { bestV = v; bestT = t; } }); if (!bestT) break; slots[bestT]++; left--; }
    // seçim: sektör/tür çeşitliliği (BIST en fazla 2 aynı sektör, ETF en fazla 2, kripto en fazla 2)
    var picks = [];
    active.forEach(function (t) {
      var got = [], sec = {}, cnt = {};
      byTier[t].forEach(function (c) {
        if (got.length >= slots[t]) return;
        var sk = c.cls === 'bist' ? 'sec:' + (c.sector || '?') : c.cls === 'usstock' ? 'usec:' + (c.sector || '?') : c.cls === 'fund' ? 'fund:' + (c.fundType || '?') : null;
        if (sk && (sec[sk] || 0) >= (c.cls === 'fund' ? 1 : 2)) return;
        if ((c.cls === 'etf' || c.cls === 'crypto' || c.cls === 'fx') && (cnt[c.cls] || 0) >= 2) return;
        if (c.cls === 'usstock' && (cnt.usstock || 0) >= 3) return; // tek ülke/kur riskini sınırla
        var gl = isGoldLike(c); if (gl && (cnt.goldLike || 0) >= (slots[t] <= 3 ? 1 : 2)) return; // aynı altın riskini birkaç fonla tekrarlama
        if (sk) sec[sk] = (sec[sk] || 0) + 1; cnt[c.cls] = (cnt[c.cls] || 0) + 1; if (gl) cnt.goldLike = (cnt.goldLike || 0) + 1; got.push(c);
      });
      // yeterli çeşitli aday yoksa kalanlardan doldur
      byTier[t].forEach(function (c) { if (got.length < slots[t] && got.indexOf(c) < 0) got.push(c); });
      picks = picks.concat(got);
    });
    // en az minNowBp kadar "şimdi alınabilir" hedefi: bekleyen en zayıf seçimi aynı gruptaki alınabilir adayla değiştir
    function isNow(c) { return c.entry.code === 'now' || c.entry.code === 'trail'; }
    var swaps = 0;
    for (var guard = 0; guard < 10 && f.preferZone; guard++) {
      var nowShare = picks.filter(isNow).length / Math.max(1, picks.length); if (nowShare * 10000 >= f.minNowBp) break;
      var waitP = picks.filter(function (c) { return !isNow(c); }).sort(function (a, b) { return rankOf(a, f) - rankOf(b, f); }), done = false;
      for (var wi = 0; wi < waitP.length && !done; wi++) {
        var w = waitP[wi], alt = byTier[w.tier].filter(function (c) { return isNow(c) && picks.indexOf(c) < 0; })[0];
        if (alt) { picks[picks.indexOf(w)] = alt; swaps++; done = true; }
      }
      if (!done) break;
    }
    if (swaps) notes.push(swaps + ' bekleyen varlık, aynı gruptaki şu an alım bölgesinde olan varlıkla değiştirildi (hemen alınabilir pay hedefi %' + (f.minNowBp / 100) + ').');
    var nowCnt = picks.filter(isNow).length;
    if (f.preferZone && picks.length && nowCnt / picks.length * 10000 < f.minNowBp) warnings.push({ level: 'info', code: 'few-now', text: 'Şu an alım bölgesinde yeterli varlık yok: ' + picks.length + ' varlığın ' + nowCnt + '\'i hemen alınabilir. Bekleyenlerin payı "bekleyen nakit" olarak tutulur ve seviyeye gelince takipte gösterilir.' });
    // ağırlıklar: grup içinde (skor − 30) × alım bölgesi (×1,15) × oynaklık uyarlaması (√(sınıf tabanı / oynaklık), 0,6–1,5)
    var pos = [];
    active.forEach(function (t) {
      var g = picks.filter(function (c) { return c.tier === t; }); if (!g.length) return;
      var raw = g.map(function (c) { var base = Math.max(5, (c.score || 0) - 30), z = isNow(c) ? 1.15 : 1, bv = CLASS[c.cls].baseVol, va = num(c.vol1y) && c.vol1y > 0 && bv > 0 ? clamp(Math.sqrt(bv / c.vol1y), 0.6, 1.5) : 1; return base * z * va; });
      var w = largestRemainder(raw, tiers[t]); g.forEach(function (c, i) { pos.push(Object.assign({}, c, { weightBp: w[i] })); });
    });
    // tek varlık sınırı (su doldurma, grup içinde): sınırı aşan pay önce aynı gruptakilere; yer yoksa daha düşük riskli gruba; o da yoksa nakit — risk hiçbir zaman artmaz
    var cap = f.maxSingleBp, capCash = 0;
    function fill(list, amt) { for (var it = 0; it < 20 && amt > 0; it++) { var room = list.filter(function (p) { return p.weightBp < cap; }); if (!room.length) break; var add = largestRemainder(room.map(function (p) { return p.weightBp || 1; }), amt); amt = 0; room.forEach(function (p, i) { p.weightBp += add[i]; if (p.weightBp > cap) { amt += p.weightBp - cap; p.weightBp = cap; } }); } return amt; }
    ['risky', 'medium', 'safe'].forEach(function (t) {
      var g = pos.filter(function (p) { return p.tier === t; }), over = 0;
      g.forEach(function (p) { if (p.weightBp > cap) { over += p.weightBp - cap; p.weightBp = cap; } });
      over = fill(g, over);
      DOWN[t].forEach(function (o) { if (over > 0) over = fill(pos.filter(function (p) { return p.tier === o; }), over); });
      if (over > 0) { capCash += over; }
    });
    if (capCash) { cashBp += capCash; notes.push('Tek varlık sınırı (%' + (cap / 100) + ') nedeniyle %' + r1(capCash / 100) + ' nakitte (katılım hesabı) kaldı; daha fazla varlık seçersen dağıtılır.'); }
    // döviz payı sınırı (Yalnız TL + istisna)
    if (R.fxCapBp != null) {
      var fxW = pos.filter(function (p) { return isForeign(p.cls); }).reduce(function (s, p) { return s + p.weightBp; }, 0);
      if (fxW > R.fxCapBp) {
        var exc = fxW - R.fxCapBp, fxP = pos.filter(function (p) { return isForeign(p.cls); }), cut = largestRemainder(fxP.map(function (p) { return p.weightBp; }), exc);
        fxP.forEach(function (p, i) { p.weightBp -= cut[i]; });
        var restFx = fill(pos.filter(function (p) { return !isForeign(p.cls) && p.tier !== 'risky'; }), exc); restFx = fill(pos.filter(function (p) { return !isForeign(p.cls); }), restFx); cashBp += restFx;
        notes.push('Dövize bağlı pay %' + (fxW / 100) + ' → %' + (R.fxCapBp / 100) + ' (TL ağırlıklı kural); fark TL araçlara aktarıldı.');
      }
    }
    // toplam kontrolü (yuvarlama) — fark en büyük paya
    var sum = pos.reduce(function (s, p) { return s + p.weightBp; }, 0) + cashBp;
    if (sum !== 10000) { if (pos.length) { var big = pos.reduce(function (m, p) { return p.weightBp > m.weightBp ? p : m; }); if (big.weightBp + 10000 - sum <= cap || !cashBp) big.weightBp += 10000 - sum; else cashBp += 10000 - sum; } else cashBp = 10000; }
    pos = pos.filter(function (p) { return p.weightBp > 0; }).sort(function (a, b) { return ['safe', 'medium', 'risky'].indexOf(a.tier) - ['safe', 'medium', 'risky'].indexOf(b.tier) || b.weightBp - a.weightBp; });
    if (!pos.length) warnings.push({ level: 'danger', code: 'empty', text: 'Filtrelere uyan varlık bulunamadı: en düşük skor, likidite veya sektör filtrelerini gevşet.' });
    var tFinal = { safe: 0, medium: 0, risky: 0 }; pos.forEach(function (p) { tFinal[p.tier] += p.weightBp; });
    return { filters: f, tiers: tFinal, tierTarget: { safe: tm[0], medium: tm[1], risky: tm[2] }, glide: AN.GLIDE_FOR_RISK[f.risk], positions: pos, cashBp: cashBp, notes: notes, warnings: warnings, info: R.info, excluded: FC.excluded, poolSize: pool.length };
  }

  /* ---------- Sanal alım (almış gibi) ---------- */
  function floorStep(x, step) { if (!(x > 0)) return 0; var k = Math.floor(x / step + 1e-9); var d = step < 1 ? Math.round(-Math.log10(step)) : 0; return +(k * step).toFixed(d); }
  function toTL(price, cur, usdtry) { if (cur === 'USD') return num(usdtry) ? price * usdtry : null; return price; }
  function curOf(p) { return p.cur === 'FX' ? 'TRY' : p.cur; } // döviz anahtarlarının fiyatı zaten TL (fx:USD = USD/TL)
  /* amountK: kuruş (null → yalnızca model ağırlıklar). usdtry: oluşturma anındaki USD/TL. Dönen: pozisyonlar + nakit. */
  function allocate(draft, amountK, usdtry, nowIso) {
    var out = { positions: [], cashK: 0, pendingK: 0, investedK: 0, amountK: num(amountK) && amountK > 0 ? Math.round(amountK) : null, usdtry: usdtry || null, notes: [] };
    var budgets = out.amountK ? largestRemainder(draft.positions.map(function (p) { return p.weightBp; }).concat([draft.cashBp]), out.amountK) : null;
    draft.positions.forEach(function (p, i) {
      var e = p.entry || {}, cur = curOf(p), price = num(p.price) ? p.price : p.snap && p.snap.price, pTL = toTL(price, cur, usdtry), step = CLASS[p.cls].step;
      var q = { key: p.key, name: p.name, cls: p.cls, tier: p.tier, cur: cur, sector: p.sector || null, weightBp: p.weightBp, score: p.score, conf: p.snap ? p.snap.confidence : null,
        parts: assetScore(p.snap).parts.map(function (x) { return { k: x.k, s: x.s, w: x.w }; }), halal: p.halal ? { status: p.halal.status, label: p.halal.label, reason: p.halal.reason } : null,
        entry: { code: e.code, label: e.label, buyLo: e.buyLo, buyHi: e.buyHi, stop: e.stop, t1: e.t1, t2: e.t2, tMain: e.tMain, rrNow: e.rrNow, plan: e.plan, why: e.why },
        price0: price, price0TL: pTL, priceAt: p.priceAt || nowIso, priceSrc: p.priceSrc || null, vol1y: num(p.vol1y) ? p.vol1y : null, ret1y: num(p.ret1y) ? p.ret1y : null,
        status: 'model', units: 0, costK: 0, budgetK: 0, limit: null, filledAt: null, fillPrice: null, events: [] };
      if (budgets) {
        var b = budgets[i]; q.budgetK = b;
        var buyNow = e.code === 'now' || e.code === 'trail';
        if (!num(pTL) || !(pTL > 0)) { q.status = 'pending'; q.limit = null; out.pendingK += b; q.note = 'Fiyat/kur alınamadı: tutar bekleyen nakitte'; }
        else if (buyNow) {
          var u = floorStep(b / 100 / pTL, step), cost = Math.round(u * pTL * 100);
          if (!(u > 0)) { q.status = 'cash'; out.cashK += b; q.note = 'Ayrılan tutar 1 adede yetmiyor (fiyat ' + fmt(price) + '): nakitte kaldı'; }
          else { q.status = 'held'; q.units = u; q.costK = cost; q.filledAt = nowIso; q.fillPrice = price; q.fillTL = pTL; out.investedK += cost; out.cashK += b - cost; }
        } else if (num(e.buyHi) && e.code !== 'none' && e.code !== 'broken') {
          q.status = 'pending'; q.limit = e.buyHi; var lTL = toTL(e.buyHi, cur, usdtry); q.plannedUnits = lTL ? floorStep(b / 100 / lTL, step) : 0; out.pendingK += b;
        } else { q.status = 'pending'; q.limit = null; out.pendingK += b; q.note = e.code === 'broken' ? 'Yapı bozuldu: yeni dip ve seviye oluşunca yeniden analiz et' : 'Alım seviyesi hesaplanamadı: izlemede'; }
      }
      out.positions.push(q);
    });
    if (budgets) out.cashK += budgets[budgets.length - 1];
    return out;
  }

  /* ---------- Değerleme ---------- */
  // quotes: { key: { price (yerel para), at } }, usdtry: güncel USD/TL
  function valuate(P, quotes, usdtry) {
    quotes = quotes || {}; var rows = [], heldK = 0, costK = 0, pendK = 0, modelRet = 0, modelW = 0, missing = [];
    (P.positions || []).forEach(function (p) {
      var q = quotes[p.key], price = q && num(q.price) ? q.price : null, pTL = price != null ? toTL(price, p.cur, usdtry) : null, r = { key: p.key, price: price, priceTL: pTL, at: q && q.at };
      if (price == null) missing.push(p.name);
      if (p.status === 'held') {
        r.costK = p.costK; costK += p.costK;
        if (pTL != null) { r.valueK = Math.round(p.units * pTL * 100); r.pnlK = r.valueK - p.costK; r.pnlPct = p.costK ? r.pnlK / p.costK : null; } else { r.valueK = p.costK; r.stale = true; }
        heldK += r.valueK;
      } else if (p.status === 'pending' || p.status === 'cash') { r.valueK = p.budgetK; pendK += p.status === 'pending' ? p.budgetK : 0; }
      if (num(p.price0) && price != null && p.price0 > 0) { var p0 = toTL(p.price0, p.cur, P.usdtry0), p1 = pTL; r.ret = p0 && p1 ? p1 / p0 - 1 : price / p.price0 - 1; if (p.entry && (p.entry.code === 'now' || p.entry.code === 'trail')) { modelRet += p.weightBp * r.ret; modelW += p.weightBp; } }
      if (p.status === 'held' && r.valueK != null) r.distStop = p.entry && num(p.entry.stop) && price ? price / p.entry.stop - 1 : null;
      rows.push(r);
    });
    var cashK = P.cashK || 0, totalK = P.amountK ? heldK + pendK + cashK : null, pnlK = P.amountK ? totalK - P.amountK : null;
    var heldCash = (P.positions || []).filter(function (p) { return p.status === 'cash'; }).reduce(function (s, p) { return s + p.budgetK; }, 0);
    if (P.amountK) { totalK = heldK + pendK + cashK; pnlK = totalK - P.amountK; void heldCash; }
    return { rows: rows, heldK: heldK, costK: costK, pendingK: pendK, cashK: cashK, totalK: totalK, pnlK: pnlK, pnlPct: P.amountK && pnlK != null ? pnlK / P.amountK : null,
      heldPnlK: heldK - costK, heldPnlPct: costK ? (heldK - costK) / costK : null, modelRet: modelW ? modelRet / 10000 : null, modelCover: modelW / 10000, missing: missing };
  }

  /* ---------- Bekleyen emirler ve stop/hedef olayları (günlük mumlarla) ---------- */
  // bars: [{d,o,h,l,c}] artan; sinceYmd: bu tarihten SONRAKİ mumlar (oluşturma günü içi belirsiz olduğu için sayılmaz); usdMap: { d: USD/TL }
  function scanFill(p, bars, sinceYmd, usdMap, usdNow, live) {
    if (p.status !== 'pending' || !num(p.limit)) return null;
    for (var i = 0; i < (bars || []).length; i++) {
      var b = bars[i]; if (!(b.d > sinceYmd)) continue;
      var lo = num(b.l) ? b.l : b.c; if (!num(lo)) continue;
      if (lo <= p.limit) { var px = num(b.o) && b.o < p.limit ? b.o : p.limit, fx = p.cur === 'USD' ? (usdMap && usdMap[b.d]) || usdNow : 1; return { d: b.d, price: px, fx: fx, via: 'mum' }; }
    }
    if (live && num(live.price) && live.price <= p.limit) return { d: live.d || null, price: live.price, fx: p.cur === 'USD' ? usdNow : 1, via: 'anlık' };
    return null;
  }
  function applyFill(P, key, fill) {
    var p = (P.positions || []).filter(function (x) { return x.key === key; })[0]; if (!p || p.status !== 'pending' || !fill || !num(fill.price) || !num(fill.fx)) return false;
    var pTL = fill.price * (p.cur === 'USD' ? fill.fx : 1), u = floorStep(p.budgetK / 100 / pTL, CLASS[p.cls].step), cost = Math.round(u * pTL * 100);
    if (!(u > 0)) return false;
    p.status = 'held'; p.units = u; p.costK = cost; p.fillPrice = fill.price; p.fillTL = pTL; p.filledAt = fill.d ? fill.d + 'T18:00:00+03:00' : new Date().toISOString(); p.fillVia = fill.via;
    P.cashK = (P.cashK || 0) + (p.budgetK - cost); p.events = (p.events || []).concat([{ t: 'fill', d: fill.d, p: fill.price, via: fill.via }]).slice(-20);
    return true;
  }
  function scanEvents(p, bars) {
    if (p.status !== 'held' || !p.entry) return [];
    var since = String(p.filledAt || '').slice(0, 10), ev = [], seen = {};
    (bars || []).forEach(function (b) {
      if (!(b.d > since)) return; var lo = num(b.l) ? b.l : b.c, hi = num(b.h) ? b.h : b.c;
      if (!seen.stop && num(p.entry.stop) && num(lo) && lo <= p.entry.stop) { seen.stop = 1; ev.push({ t: 'stop', d: b.d, p: p.entry.stop }); }
      if (!seen.t1 && num(p.entry.t1) && num(hi) && hi >= p.entry.t1) { seen.t1 = 1; ev.push({ t: 't1', d: b.d, p: p.entry.t1 }); }
      if (!seen.t2 && num(p.entry.t2) && num(hi) && hi >= p.entry.t2) { seen.t2 = 1; ev.push({ t: 't2', d: b.d, p: p.entry.t2 }); }
    });
    return ev;
  }

  /* ---------- Portföy analiz skoru (0-100) ---------- */
  var PSCORE_W = { quality: 35, diversification: 20, riskFit: 15, drawdown: 10, timing: 10, liquidity: 5, halal: 5 };
  var PSCORE_LABEL = { quality: 'Varlık kalitesi (ağırlıklı skor)', diversification: 'Çeşitlendirme (korelasyon dahil)', riskFit: 'Oynaklık — profile uyum', drawdown: 'En büyük düşüş — profile uyum', timing: 'Zamanlama (alım bölgesi + risk/ödül)', liquidity: 'Likidite', halal: 'Helal uyum' };
  // inp: { positions:[{weightBp, score, liq, halal, entry, cls}], cashBp, risk:{vol, mdd, nEffCorr}|null, profileRisk }
  function portfolioScore(inp) {
    var P = (inp.positions || []).filter(function (p) { return p.weightBp > 0; }), W = P.reduce(function (s, p) { return s + p.weightBp; }, 0), S = {};
    function put(k, v, ev) { S[k] = { k: k, label: PSCORE_LABEL[k], w: PSCORE_W[k], score: v == null ? null : Math.round(clamp(v, 0, 100)), ev: ev }; }
    if (W > 0) {
      var sw = 0, ss = 0; P.forEach(function (p) { if (num(p.score)) { sw += p.weightBp; ss += p.weightBp * p.score; } });
      put('quality', sw / W >= 0.5 ? ss / sw : null, sw ? 'Skoru olan varlıkların ağırlıklı ortalaması ' + Math.round(ss / sw) + ' (ağırlığın %' + Math.round(sw / W * 100) + '\'i skorlu)' : 'Varlık skoru yok');
      var hhi = P.reduce(function (s, p) { var w = p.weightBp / W; return s + w * w; }, 0), nEff = 1 / hhi, nUse = inp.risk && num(inp.risk.nEffCorr) ? Math.min(nEff, inp.risk.nEffCorr) : nEff;
      put('diversification', interp(nUse, [[1, 10], [2, 35], [3, 55], [5, 80], [8, 100]]), 'Etkin varlık sayısı ' + r1(nEff) + (inp.risk && num(inp.risk.nEffCorr) ? ' · korelasyona göre ' + r1(inp.risk.nEffCorr) : ' · korelasyon hesaplanmadı'));
      var cap = AN.PROFILE_CAPS[inp.profileRisk || 'medium'];
      if (inp.risk && num(inp.risk.vol)) put('riskFit', interp(inp.risk.vol / cap.vol, [[0.8, 100], [1, 85], [1.5, 45], [2.2, 10]]), 'Yıllık oynaklık %' + r1(inp.risk.vol * 100) + ' (profil sınırı %' + Math.round(cap.vol * 100) + ')'); else put('riskFit', null, 'Fiyat geçmişi yok');
      if (inp.risk && num(inp.risk.mdd)) put('drawdown', interp(Math.abs(inp.risk.mdd) / cap.dd, [[0.8, 100], [1, 85], [1.5, 45], [2.2, 10]]), 'Son 1 yılın en büyük düşüşü %' + r1(Math.abs(inp.risk.mdd) * 100) + ' (profil sınırı %' + Math.round(cap.dd * 100) + ')'); else put('drawdown', null, 'Fiyat geçmişi yok');
      var nowW = 0, rrs = []; P.forEach(function (p) { var c = p.entry && p.entry.code; if (c === 'now' || c === 'trail') nowW += p.weightBp; if (p.entry && num(p.entry.rrNow)) rrs.push(clamp(p.entry.rrNow, 0, 5)); });
      var rrAvg = rrs.length ? rrs.reduce(function (s, x) { return s + x; }, 0) / rrs.length : null;
      put('timing', interp(nowW / W, [[0, 20], [0.3, 55], [0.5, 75], [0.8, 100]]) * 0.75 + (rrAvg == null ? 15 : interp(rrAvg, [[0.5, 0], [1.5, 15], [3, 25]])), 'Hemen alınabilir pay %' + Math.round(nowW / W * 100) + (rrAvg != null ? ' · ortalama risk/ödül ' + r1(rrAvg) : ''));
      var lw = 0, ls = 0; P.forEach(function (p) { if (num(p.liq)) { lw += p.weightBp; ls += p.weightBp * p.liq; } });
      put('liquidity', lw / W >= 0.3 ? ls / lw : null, lw ? 'Ağırlıklı likidite alt skoru ' + Math.round(ls / lw) : 'Likidite verisi yok');
      var hv = { uygun: 0, supheli: 0, uygun_degil: 0, bilinmiyor: 0 }; P.forEach(function (p) { var s = p.halal && p.halal.status; hv[s in hv ? s : 'bilinmiyor'] += p.weightBp / W; });
      var hs = 100 * hv.uygun + 50 * hv.supheli + 30 * hv.bilinmiyor; if (hv.uygun_degil > 0) hs = Math.min(hs, 40);
      put('halal', hs, 'Uygun %' + Math.round(hv.uygun * 100) + ' · şüpheli %' + Math.round(hv.supheli * 100) + ' · bilinmiyor %' + Math.round(hv.bilinmiyor * 100));
    } else Object.keys(PSCORE_W).forEach(function (k) { put(k, null, 'Varlık yok'); });
    var used = 0, sum = 0, missing = []; Object.keys(PSCORE_W).forEach(function (k) { if (num(S[k].score)) { used += PSCORE_W[k]; sum += PSCORE_W[k] * S[k].score; } else missing.push(PSCORE_LABEL[k]); });
    var coverage = used / 100, total = used && coverage >= 0.5 && num(S.quality.score) ? Math.round(sum / used) : null;
    return { total: total, grade: total == null ? '—' : total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : total >= 40 ? 'D' : 'E', parts: Object.keys(PSCORE_W).map(function (k) { return S[k]; }), coverage: coverage, missing: missing,
      reason: total == null ? 'Veri yetersiz: ' + (missing.join(', ') || 'skor kapsamı %50\'nin altında') : null };
  }

  /* ---------- Risk istatistikleri ---------- */
  // seriesList: TL'ye çevrilmiş [{d,c}] dizileri; weights: aynı sırada ağırlıklar (bp)
  function riskStats(seriesList, weights) {
    if (!seriesList.length) return { error: 'Fiyat geçmişi yok' };
    var pr = AN.portfolioRisk(seriesList, weights); if (pr.error) return pr;
    var out = { vol: pr.vol, mdd: pr.mdd, nEffCorr: pr.nEffCorr, days: pr.days, from: pr.from, to: pr.to, corr: pr.corr };
    out.var95m = num(pr.vol) ? 1.645 * pr.vol * Math.sqrt(21 / 252) : null; // 1 aylık %95 parametrik riske maruz değer (normal dağılım varsayımı)
    out.mddEst = num(pr.vol) ? Math.max(Math.abs(pr.mdd || 0), 2 * pr.vol * Math.sqrt(1)) : null; // kaba üst tahmin: max(geçmiş düşüş, 2σ yıllık)
    return out;
  }
  function assetStats(bars) { // 1 yıllık oynaklık ve getiri (kapanışlar)
    var c = (bars || []).map(function (b) { return b.c; }).filter(num).slice(-253); if (c.length < 60) return { vol1y: null, ret1y: null };
    return { vol1y: TA.annVol(c, 252), ret1y: c.length >= 250 ? c[c.length - 1] / c[0] - 1 : null };
  }

  /* ---------- Yeniden dengeleme ve uyarılar ---------- */
  function rebalance(P, V) {
    var out = [], tot = 0; if (!P.amountK || !V || V.totalK == null) return out;
    tot = V.totalK;
    (P.positions || []).forEach(function (p, i) {
      var r = V.rows[i]; if (!r || r.valueK == null) return;
      var cur = p.status === 'held' ? r.valueK / tot * 10000 : 0, tgt = p.weightBp, d = cur - tgt;
      if (p.status === 'held' && Math.abs(d) >= 500) out.push({ key: p.key, name: p.name, cur: Math.round(cur), tgt: tgt, d: Math.round(d), text: d > 0 ? 'Hedefin %' + r1(d / 100) + ' üstünde: yeni parayı diğer varlıklara yönlendir veya kısmi kâr al.' : 'Hedefin %' + r1(-d / 100) + ' altında: yeni parayla tamamla.' });
    });
    return out;
  }
  function alertsOf(P, V) {
    var a = [];
    (P.positions || []).forEach(function (p, i) {
      var r = V && V.rows[i];
      (p.events || []).forEach(function (e) { if (e.t === 'stop') a.push({ level: 'danger', text: p.name.split(' — ')[0] + ': stop seviyesi (' + fmt(e.p) + ') ' + e.d + ' tarihinde görüldü — planı gözden geçir.' }); if (e.t === 't1') a.push({ level: 'ok', text: p.name.split(' — ')[0] + ': 1. hedef (' + fmt(e.p) + ') ' + e.d + ' tarihinde görüldü — kısmi kâr / stopu maliyete çek.' }); });
      if (p.status === 'pending' && r && num(r.price) && num(p.limit) && r.price <= p.limit) a.push({ level: 'ok', text: p.name.split(' — ')[0] + ': fiyat alım seviyesine geldi (' + fmt(r.price) + ' ≤ ' + fmt(p.limit) + ').' });
      if (p.status === 'pending' && r && num(r.price) && p.entry && num(p.entry.stop) && r.price <= p.entry.stop) a.push({ level: 'warn', text: p.name.split(' — ')[0] + ': fiyat planın stopunun altına indi; bekleyen emir geçersiz olabilir — yeniden analiz et.' });
      if (p.halal && p.halal.status !== 'uygun') a.push({ level: 'warn', text: p.name.split(' — ')[0] + ': helal durumu "' + (p.halal.label || p.halal.status) + '".' });
    });
    if (V && V.missing && V.missing.length) a.push({ level: 'warn', text: 'Güncel fiyat alınamadı: ' + V.missing.slice(0, 5).join(', ') + ' (son bilinen değer kullanıldı).' });
    return a;
  }

  /* ---------- Saklama (state.labPortfolios) ---------- */
  var KEY_RE = /^(bist|tefas|cg|metal|fx|us|td|cash):[A-Za-z0-9._\-]{1,40}$/;
  function nOr(x, d) { return num(x) ? x : (d === undefined ? null : d); }
  function str(x, max) { return typeof x === 'string' ? x.slice(0, max || 120) : null; }
  function cleanEntry(e) { e = e || {}; return { code: ['now', 'wait', 'trail', 'broken', 'none'].indexOf(e.code) >= 0 ? e.code : 'none', label: str(e.label, 140), buyLo: nOr(e.buyLo), buyHi: nOr(e.buyHi), stop: nOr(e.stop), t1: nOr(e.t1), t2: nOr(e.t2), tMain: nOr(e.tMain), rrNow: nOr(e.rrNow), plan: str(e.plan, 20), why: str(e.why, 300) }; }
  function cleanPos(p) {
    if (!p || typeof p.key !== 'string' || !KEY_RE.test(p.key) || !CLASS[p.cls]) return null;
    var o = { key: p.key, name: str(p.name, 100) || p.key, cls: p.cls, tier: ['safe', 'medium', 'risky'].indexOf(p.tier) >= 0 ? p.tier : CLASS[p.cls].tier, cur: ['TRY', 'USD'].indexOf(p.cur) >= 0 ? p.cur : 'TRY', sector: str(p.sector, 60),
      weightBp: Number.isInteger(p.weightBp) && p.weightBp >= 0 && p.weightBp <= 10000 ? p.weightBp : 0, score: num(p.score) ? Math.round(clamp(p.score, 0, 100)) : null, conf: nOr(p.conf),
      parts: Array.isArray(p.parts) ? p.parts.slice(0, 8).filter(function (x) { return x && typeof x.k === 'string' && num(x.s); }).map(function (x) { return { k: x.k.slice(0, 20), s: x.s, w: nOr(x.w, 0) }; }) : [],
      halal: p.halal && typeof p.halal === 'object' ? { status: ['uygun', 'supheli', 'uygun_degil', 'bilinmiyor'].indexOf(p.halal.status) >= 0 ? p.halal.status : 'bilinmiyor', label: str(p.halal.label, 60), reason: str(p.halal.reason, 200) } : null,
      entry: cleanEntry(p.entry), price0: nOr(p.price0), price0TL: nOr(p.price0TL), priceAt: str(p.priceAt, 40), priceSrc: str(p.priceSrc, 120), vol1y: nOr(p.vol1y), ret1y: nOr(p.ret1y),
      status: ['model', 'held', 'pending', 'cash'].indexOf(p.status) >= 0 ? p.status : 'model', units: num(p.units) && p.units >= 0 ? p.units : 0,
      costK: Number.isInteger(p.costK) && p.costK >= 0 ? p.costK : 0, budgetK: Number.isInteger(p.budgetK) && p.budgetK >= 0 ? p.budgetK : 0, limit: nOr(p.limit), plannedUnits: nOr(p.plannedUnits),
      filledAt: str(p.filledAt, 40), fillPrice: nOr(p.fillPrice), fillTL: nOr(p.fillTL), fillVia: str(p.fillVia, 10), note: str(p.note, 200),
      events: Array.isArray(p.events) ? p.events.slice(-20).filter(function (e) { return e && ['fill', 'stop', 't1', 't2'].indexOf(e.t) >= 0; }).map(function (e) { return { t: e.t, d: str(e.d, 10), p: nOr(e.p), via: str(e.via, 10) }; }) : [] };
    if (o.status === 'held' && !(o.units > 0)) o.status = o.budgetK ? 'cash' : 'model';
    return o;
  }
  function cleanOne(x) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[A-Za-z0-9_\-]{4,40}$/.test(x.id)) return null;
    var o = { v: VERSION, id: x.id, name: (str(x.name, 60) || 'Portföy').trim() || 'Portföy', createdAt: str(x.createdAt, 40), updatedAt: str(x.updatedAt, 40), filters: cleanFilters(x.filters),
      amountK: Number.isInteger(x.amountK) && x.amountK > 0 ? x.amountK : null, usdtry0: nOr(x.usdtry0), cashK: Number.isInteger(x.cashK) && x.cashK >= 0 ? x.cashK : 0,
      tiers: x.tiers && typeof x.tiers === 'object' ? { safe: nOr(x.tiers.safe, 0), medium: nOr(x.tiers.medium, 0), risky: nOr(x.tiers.risky, 0) } : { safe: 0, medium: 0, risky: 0 }, cashBp: Number.isInteger(x.cashBp) ? x.cashBp : 0, glide: str(x.glide, 20),
      positions: (Array.isArray(x.positions) ? x.positions : []).slice(0, MAX_POS).map(cleanPos).filter(Boolean),
      history: (Array.isArray(x.history) ? x.history : []).filter(function (h) { return h && /^\d{4}-\d{2}-\d{2}$/.test(h.d) && (num(h.v) || num(h.r)); }).slice(-MAX_HISTORY).map(function (h) { return { d: h.d, v: num(h.v) ? Math.round(h.v) : null, r: nOr(h.r) }; }),
      score: x.score && typeof x.score === 'object' ? { total: num(x.score.total) ? x.score.total : null, grade: str(x.score.grade, 2), at: str(x.score.at, 40), parts: Array.isArray(x.score.parts) ? x.score.parts.slice(0, 10).filter(function (p) { return p && typeof p.k === 'string'; }).map(function (p) { return { k: p.k.slice(0, 20), label: str(p.label, 80), w: nOr(p.w, 0), score: nOr(p.score), ev: str(p.ev, 200) }; }) : [], reason: str(x.score.reason, 300), coverage: nOr(x.score.coverage) } : null,
      risk: x.risk && typeof x.risk === 'object' ? { vol: nOr(x.risk.vol), mdd: nOr(x.risk.mdd), var95m: nOr(x.risk.var95m), mddEst: nOr(x.risk.mddEst), nEffCorr: nOr(x.risk.nEffCorr), days: nOr(x.risk.days), cagr: nOr(x.risk.cagr), worst12: nOr(x.risk.worst12), best12: nOr(x.risk.best12), btMdd: nOr(x.risk.btMdd), from: str(x.risk.from, 10), to: str(x.risk.to, 10) } : null,
      notes: Array.isArray(x.notes) ? x.notes.slice(0, 12).map(function (n) { return str(n, 300); }).filter(Boolean) : [], dataNote: str(x.dataNote, 400) };
    var hist = {}; o.history.forEach(function (h) { hist[h.d] = h; }); o.history = Object.keys(hist).sort().map(function (d) { return hist[d]; });
    return o;
  }
  function cleanList(list) { var seen = {}; return (Array.isArray(list) ? list : []).map(cleanOne).filter(function (x) { if (!x || seen[x.id]) return false; seen[x.id] = 1; return true; }).slice(0, MAX_PORTFOLIOS); }
  function newId(rand) { return 'lp' + Date.now().toString(36) + (rand || Math.random).call(null).toString(36).slice(2, 7); }
  /* Taslak + sanal alım → saklanacak kayıt */
  function makeRecord(draft, alloc, meta) {
    meta = meta || {};
    var rec = { v: VERSION, id: meta.id || newId(), name: meta.name || 'Portföy', createdAt: meta.at, updatedAt: meta.at, filters: draft.filters, amountK: alloc.amountK, usdtry0: alloc.usdtry, cashK: alloc.cashK,
      tiers: draft.tiers, cashBp: draft.cashBp, glide: draft.glide, positions: alloc.positions, history: [], score: meta.score || null, risk: meta.risk || null, notes: (draft.notes || []).slice(0, 12), dataNote: meta.dataNote || null };
    return cleanOne(rec);
  }
  function addHistory(P, ymd, V) { var h = (P.history || []).filter(function (x) { return x.d !== ymd; }); h.push({ d: ymd, v: V.totalK != null ? V.totalK : null, r: V.modelRet }); P.history = h.slice(-MAX_HISTORY); return P; }
  function compare(list, valuations) {
    return (list || []).map(function (P, i) {
      var V = valuations && valuations[i], held = P.positions.filter(function (p) { return p.status === 'held'; }).length;
      return { id: P.id, name: P.name, createdAt: P.createdAt, score: P.score ? P.score.total : null, grade: P.score ? P.score.grade : '—', amountK: P.amountK, totalK: V ? V.totalK : null, pnlPct: V ? (P.amountK ? V.pnlPct : V.modelRet) : null,
        vol: P.risk ? P.risk.vol : null, mdd: P.risk ? P.risk.mdd : null, n: P.positions.length, held: held, pending: P.positions.filter(function (p) { return p.status === 'pending'; }).length, profile: P.filters.profile };
    });
  }
  return { VERSION: VERSION, CLASS: CLASS, TIER_LABEL: TIER_LABEL, PROFILES: PROFILES, SECTORS_TR: SECTORS_TR, PSCORE_W: PSCORE_W, PSCORE_LABEL: PSCORE_LABEL, FX_CAP_BP: FX_CAP_BP, MAX_PORTFOLIOS: MAX_PORTFOLIOS,
    US_ETF: US_ETF, classOfKey: classOfKey, isForeign: isForeign, fundTier: fundTier, fundTierByVol: fundTierByVol, isGoldName: isGoldName, isGoldLike: isGoldLike, sectorTr: sectorTr, defaultFilters: defaultFilters, applyProfile: applyProfile, profileMatches: profileMatches, cleanFilters: cleanFilters, resolveFilters: resolveFilters,
    assetScore: assetScore, entryStatus: entryStatus, liqOk: liqOk, filterCandidates: filterCandidates, build: build, allocate: allocate, floorStep: floorStep, valuate: valuate, scanFill: scanFill, applyFill: applyFill, scanEvents: scanEvents,
    portfolioScore: portfolioScore, riskStats: riskStats, assetStats: assetStats, rebalance: rebalance, alertsOf: alertsOf, cleanList: cleanList, cleanOne: cleanOne, makeRecord: makeRecord, addHistory: addHistory, compare: compare, newId: newId, largestRemainder: largestRemainder };
});
