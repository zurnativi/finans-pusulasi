/* news.js — Haber başlıklarını puanlar, konulara ayırır, tekrarları birleştirir ve portföydeki varlıklarla eşler. SAF ve deterministik (testli).
 * Puanlama kuralları tools/news_rules.json'dan üretilir (js/newsrules.js); Python tarafı (iş akışı uyarıları) aynı kuralı kullanır — tests/run-tests-v8.js aynılığı doğrular.
 * Önemli: bu bir ANAHTAR KELİME kuralıdır, yapay zekâ değil. Her puanın nedeni (hangi kelime, hangi kademe) gösterilir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./newsrules.js'));
  else root.News = factory(root.NewsRules);
})(typeof self !== 'undefined' ? self : this, function (RULES) {
  'use strict';
  var MAP = { 'İ': 'I', 'I': 'I', 'ı': 'I', 'i': 'I', 'Ş': 'S', 'ş': 'S', 'Ç': 'C', 'ç': 'C', 'Ğ': 'G', 'ğ': 'G', 'Ö': 'O', 'ö': 'O', 'Ü': 'U', 'ü': 'U', '’': "'", '‘': "'", '´': "'", '`': "'" };
  /* Türkçe → ASCII BÜYÜK harf (Python tarafındaki F.fold ile aynı) */
  function fold(t) { return String(t == null ? '' : t).replace(/[İIıiŞşÇçĞğÖöÜü’‘´`]/g, function (c) { return MAP[c]; }).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function isAl(c) { return (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); }
  /* Anahtar kelime, katlanmış metinde TAM KELİME olarak geçiyor mu? (önünde/arkasında harf-rakam yok) */
  function hasWord(f, kw) {
    var k = fold(kw), from = 0, i;
    while ((i = f.indexOf(k, from)) >= 0) {
      var before = i > 0 ? f.charAt(i - 1) : '', after = f.charAt(i + k.length);
      if (!(before && isAl(before)) && !(after && isAl(after))) return true;
      from = i + 1;
    }
    return false;
  }
  function scoreTitle(title, rules) {
    rules = rules || RULES; var f = fold(title), sc = 0, why = [], tiers = [];
    var hard = false;
    rules.tiers.forEach(function (t) {
      for (var j = 0; j < t.kw.length; j++) if (hasWord(f, t.kw[j])) { sc += t.w; why.push(t.kw[j]); tiers.push({ id: t.id, why: t.why, kw: t.kw[j], w: t.w }); if (t.hard) hard = true; break; }
    });
    return { score: sc, why: why, tiers: tiers, hard: hard };
  }
  function topicsOf(title, rules) {
    rules = rules || RULES; var f = fold(title);
    return (rules.topics || []).filter(function (t) { return t.kw.some(function (k) { return hasWord(f, k); }); }).map(function (t) { return t.id; });
  }
  function topicLabel(id, rules) { var t = ((rules || RULES).topics || []).filter(function (x) { return x.id === id; })[0]; return t ? t.label : id; }
  /* Kritik = yüksek puan + "sert" kademe (kriz/karar) + doğrulama (resmî kurum VEYA en az 2 ayrı kaynak). Tek kaynaklı haber en fazla "yüksek" olur. */
  function levelOf(score, rules, hard, corroborated) { rules = rules || RULES; if (score >= rules.criticalAt && hard && corroborated) return 'critical'; if (score >= rules.highAt && (hard || corroborated)) return 'high'; return score >= rules.mediumAt ? 'medium' : 'low'; }
  var LEVEL_TR = { critical: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük', info: 'Bilgi' };
  /* Önem puanı (0-100): kural puanı + resmî kaynak payı + aynı olayı veren bağımsız kaynak sayısı payı; haber eskidikçe sönümlenir.
   * Sönüm yalnız görünüm sırası içindir; "kritik" etiketi haberin kendi niteliğinden gelir. */
  function importance(item, nowMs, rules) {
    rules = rules || RULES; var s = scoreTitle(item.t, rules), sc = s.score, notes = s.tiers.map(function (x) { return x.why + ' (“' + x.kw + '”, +' + x.w + ')'; });
    if (item.o) { sc += rules.officialBonus; notes.push('resmî kurum duyurusu (' + item.o + ', +' + rules.officialBonus + ')'); }
    var nsrc = (item.srcs && item.srcs.length) || 1;
    if (nsrc >= 3 && s.score > 0) { sc += 10; notes.push(nsrc + ' ayrı kaynakta aynı haber (+10)'); }
    sc = Math.min(100, sc);
    var corr = !!item.o || nsrc >= (rules.corroborate || 2);
    if (sc >= rules.criticalAt && s.hard && !corr) notes.push('tek kaynak: doğrulanana kadar “kritik” sayılmadı');
    var at = item.a ? Date.parse(item.a) : NaN, ageH = isFinite(at) && nowMs ? Math.max(0, (nowMs - at) / 3600000) : null;
    return { score: sc, level: levelOf(sc, rules, s.hard, corr), hard: s.hard, corroborated: corr, notes: notes, topics: topicsOf(item.t, rules), ageH: ageH, rank: sc * (ageH == null ? 1 : Math.max(0.35, 1 - ageH / 96)) };
  }
  /* KAP bildirimi: puan kelimeden değil, bildirimin kendi etiketinden (tools/fetch_market_data.py kap_tag) gelir. Resmî kaynak olduğu için doğrulama gerekmez. */
  var KAP_SCORE = { 'Dikkat: hukuki/idari': 60, 'Sermaye işlemi': 40, 'Kâr payı': 40, 'Pay geri alımı': 35, 'Yeni iş / sözleşme': 40, 'Özel durum açıklaması': 30, 'Finansal rapor': 30 };
  function kapImportance(tag, nowMs, at) {
    var sc = KAP_SCORE[tag] != null ? KAP_SCORE[tag] : 15, t = at ? Date.parse(at) : NaN, ageH = isFinite(t) && nowMs ? Math.max(0, (nowMs - t) / 3600000) : null;
    return { score: sc, level: sc >= 55 ? 'high' : sc >= 30 ? 'medium' : 'low', notes: ['KAP bildirimi: ' + tag + ' (+' + sc + ', resmî kaynak)'], topics: ['company'], ageH: ageH, rank: sc * (ageH == null ? 1 : Math.max(0.35, 1 - ageH / 96)), hard: false, corroborated: true };
  }
  /* ---------- Tekrar birleştirme: aynı bağlantı veya başlık benzerliği (Jaccard ≥ 0,6) ---------- */
  var STOP = {}; (RULES.stop || []).forEach(function (w) { STOP[w] = 1; });
  function tokens(title) { var o = {}; fold(title).replace(/[^A-Z0-9' ]/g, ' ').split(' ').forEach(function (w) { w = w.replace(/'.*$/, ''); if (w.length >= 3 && !STOP[w]) o[w] = 1; }); return Object.keys(o); }
  function jacc(a, b) { if (!a.length || !b.length) return 0; var sb = {}; b.forEach(function (x) { sb[x] = 1; }); var inter = 0; a.forEach(function (x) { if (sb[x]) inter++; }); return inter / (a.length + b.length - inter); }
  /* items: {t,u,s,a,r,o?}. Dönüş: birleştirilmiş liste; her öğede srcs[{s,u,a}] ve n. Temsilci: resmî > en erken. */
  function dedupe(items, thr) {
    thr = thr == null ? (RULES.similar || 0.6) : thr; var out = [], byUrl = {}, inv = Object.create(null), fmap = Object.create(null);
    items.slice().sort(function (x, y) { return (x.a || '') < (y.a || '') ? -1 : 1; }).forEach(function (it) {
      if (!it || !it.t) return;
      if (it.u && byUrl[it.u]) return;
      // v8.8.2 hız: kelime → öğe ters dizini; yalnız ortak kelimesi olan öğelerle Jaccard hesaplanır, katlanmış başlık bir kez hesaplanır.
      // Sonuç eskisiyle birebir aynı (ilk eşleşen = en küçük sıra): önceden her çift için fold + küme kurulumu → varlık sayfasında ~1,3 sn donma.
      var tk = tokens(it.t), ft = null, best = Infinity, counts = Object.create(null), cand = [];
      tk.forEach(function (w) { var L = inv[w]; if (L) for (var j = 0; j < L.length; j++) { var ix = L[j]; if (counts[ix] === undefined) { counts[ix] = 0; cand.push(ix); } counts[ix]++; } });
      cand.forEach(function (ix) { var inter = counts[ix], nb = out[ix]._tk.length; if (ix < best && tk.length && nb && inter / (tk.length + nb - inter) >= thr) best = ix; });
      if (tk.length >= 4) { ft = fold(it.t); var FL = fmap[ft]; if (FL) FL.forEach(function (ix) { var c = out[ix]; if (ix < best && c._tk.length >= 4 && c._f === ft) best = ix; }); }
      var hit = best < Infinity ? out[best] : null;
      if (hit) {
        if (!hit.srcs.some(function (x) { return x.s === it.s; })) hit.srcs.push({ s: it.s, u: it.u, a: it.a });
        if (it.o && !hit.o) { hit.o = it.o; hit.t = it.t; hit.u = it.u; hit.s = it.s; hit.a = it.a || hit.a; hit._f = ft !== null ? ft : fold(it.t); (fmap[hit._f] = fmap[hit._f] || []).push(best); }
      } else {
        var c2 = Object.assign({}, it), at = out.length; c2._tk = tk; c2._f = ft !== null ? ft : fold(it.t); c2.srcs = [{ s: it.s, u: it.u, a: it.a }]; out.push(c2);
        tk.forEach(function (w) { (inv[w] = inv[w] || []).push(at); }); (fmap[c2._f] = fmap[c2._f] || []).push(at);
      }
      if (it.u) byUrl[it.u] = 1;
    });
    out.forEach(function (c) { c.n = c.srcs.length; delete c._tk; delete c._f; });
    return out.sort(function (x, y) { return (x.a || '') < (y.a || '') ? 1 : -1; });
  }
  /* ---------- Portföy eşleştirme ----------
   * Bir varlık grubunun hangi konulardan etkilendiği (genel iktisat çerçevesi; tahmin değil, ilişkilendirmedir). */
  var GROUPS = {
    tr_equity: { label: 'BIST / katılım hisseleri', short: 'TR hisse' },
    us_equity: { label: 'ABD helal ETF\'leri', short: 'ABD hisse' },
    gold: { label: 'Altın', short: 'Altın' },
    crypto: { label: 'Kripto', short: 'Kripto' },
    tr_income: { label: 'TL katılım hesabı / sukuk (faiz-enflasyon duyarlı)', short: 'TL getirili' },
    other: { label: 'Diğer', short: 'Diğer' }
  };
  var CLS_GROUP = { katilim_stock: 'tr_equity', katilim_fund: 'tr_equity', halal_etf: 'us_equity', gold: 'gold', crypto: 'crypto', cash: 'tr_income', sukuk: 'tr_income', other: 'other' };
  var TOPIC_GROUPS = {
    rates_tr: ['tr_equity', 'tr_income'], rates_us: ['us_equity', 'gold', 'crypto', 'tr_equity'], rates_eu: ['us_equity', 'gold'],
    inflation: ['tr_income', 'gold', 'tr_equity'], macro_us: ['us_equity', 'gold', 'crypto'], politics_tr: ['tr_equity', 'tr_income', 'gold'],
    geo: ['gold', 'tr_equity', 'us_equity', 'crypto'], rating: ['tr_equity', 'tr_income'], gold: ['gold'], fx: ['tr_income', 'gold', 'tr_equity'],
    crypto: ['crypto'], equity_tr: ['tr_equity'], equity_us: ['us_equity'], energy: ['tr_equity', 'us_equity']
  };
  function groupOf(h) { return CLS_GROUP[(h.cls || (h.asset && h.asset.cls) || 'other')] || 'other'; }
  var GENERIC = { KATILIM: 1, FONU: 1, FON: 1, HISSE: 1, ALTIN: 1, GRUP: 1, TEKNOLOJI: 1, BANKASI: 1, SANAYI: 1, TICARET: 1, HOLDING: 1, YATIRIM: 1, PORTFOY: 1, EMTIA: 1, ETF: 1, KIRA: 1, SERTIFIKASI: 1, SUKUK: 1, HESABI: 1, NAKIT: 1, DEGISKEN: 1, ENDEKS: 1, BIST: 1, ANONIM: 1, SIRKETI: 1 };
  /* holdings: [{key,name,sym,cls,value}] — value kuruş. Dönüş: [{h, kind:'direct'|'topic', why}] */
  function aliasesOf(h) {
    var a = {}; if (h.sym && String(h.sym).length >= 3) a[fold(h.sym)] = 1;
    fold(h.name || '').replace(/[^A-Z0-9 ]/g, ' ').split(' ').forEach(function (w) { if (w.length >= 5 && !GENERIC[w]) a[w] = 1; });
    return Object.keys(a);
  }
  function matchHoldings(item, holdings, rules) {
    rules = rules || RULES; var f = fold(item.t), out = [], tps = (item.imp && item.imp.topics) || topicsOf(item.t, rules);
    (holdings || []).forEach(function (h) {
      if (!(h.value > 0)) return;
      var direct = aliasesOf(h).filter(function (al) { return hasWord(f, al); })[0];
      if (direct) { out.push({ h: h, kind: 'direct', why: 'Başlıkta “' + direct + '” geçiyor' }); return; }
      var g = groupOf(h), tp = tps.filter(function (t) { return (TOPIC_GROUPS[t] || []).indexOf(g) >= 0; })[0];
      if (tp) out.push({ h: h, kind: 'topic', why: topicLabel(tp, rules) + ' haberi → ' + GROUPS[g].short + ' varlığın' });
    });
    return out;
  }
  /* Bir haberin portföye etkisi: doğrudan eşleşme varsa öncelik; yoksa konu üzerinden etkilenen toplam pay (bp) */
  function exposure(matches, total) {
    var seen = {}, v = 0, direct = false; (matches || []).forEach(function (m) { if (!seen[m.h.key || m.h.name]) { seen[m.h.key || m.h.name] = 1; v += m.h.value; if (m.kind === 'direct') direct = true; } });
    return { value: v, bp: total > 0 ? Math.round(v * 10000 / total) : 0, direct: direct, n: Object.keys(seen).length };
  }
  /* Tek geçişte: puanla + eşleştir + sırala. */
  function process(items, holdings, nowMs, rules) {
    rules = rules || RULES; var total = (holdings || []).reduce(function (s, h) { return s + (h.value > 0 ? h.value : 0); }, 0);
    var kaps = items.filter(function (x) { return x.kap; }), rest = items.filter(function (x) { return !x.kap; });
    var out = dedupe(rest).map(function (it) {
      it.imp = importance(it, nowMs, rules); it.matches = matchHoldings(it, holdings, rules); it.exp = exposure(it.matches, total);
      it.mine = it.matches.length > 0; return it;
    });
    kaps.forEach(function (k) {
      var h = (holdings || []).filter(function (x) { return x.key === k.kap.key; })[0];
      var it = Object.assign({}, k, { srcs: [{ s: 'KAP', u: k.u, a: k.a }], n: 1, imp: kapImportance(k.kap.tag, nowMs, k.a) });
      it.matches = h ? [{ h: h, kind: 'direct', why: 'KAP bildirimi — elindeki hisse (' + k.kap.sym + ')' }] : []; it.exp = exposure(it.matches, total); it.mine = !!h; out.push(it);
    });
    return out.sort(function (x, y) { return (x.a || '') < (y.a || '') ? 1 : -1; });
  }
  return { fold: fold, hasWord: hasWord, scoreTitle: scoreTitle, topicsOf: topicsOf, topicLabel: topicLabel, levelOf: levelOf, importance: importance, tokens: tokens, jacc: jacc, dedupe: dedupe,
    GROUPS: GROUPS, CLS_GROUP: CLS_GROUP, TOPIC_GROUPS: TOPIC_GROUPS, groupOf: groupOf, aliasesOf: aliasesOf, matchHoldings: matchHoldings, exposure: exposure, kapImportance: kapImportance, process: process, LEVEL_TR: LEVEL_TR, RULES: RULES };
});
