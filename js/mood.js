/* mood.js — "Duygu durumu" kartı: portföy verisinden (düşüş, oynaklık, seri, plana uzaklık) olası duygusal baskıyı çıkarır ve kanıta dayalı rehberlik üretir. SAF (testli).
 * İLKELER: (1) Verilerden çıkarım bir TAHMİNDİR; kullanıcının kendi hissi esastır (check-in). (2) Hiçbir koşulda "sat" demez; duygudan doğan işlem yerine plana ve kurala yönlendirir.
 * (3) Örnek veride düşüş hesaplanmaz (sentetik geçmiş). (4) Atıflar doğrulanmış kaynaklardır; sayılar yalnızca kaynağında yazdığı kadardır. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mood = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var REFS = [
    { id: 'kt79', cite: 'Kahneman & Tversky (1979). Prospect Theory: An Analysis of Decision under Risk. Econometrica 47(2): 263–291.', url: 'https://doi.org/10.2307/1914185', claim: 'Kayıplar aynı büyüklükteki kazançlardan daha ağır hissedilir (kayıptan kaçınma).' },
    { id: 'bt95', cite: 'Benartzi & Thaler (1995). Myopic Loss Aversion and the Equity Premium Puzzle. Quarterly Journal of Economics 110(1): 73–92.', url: 'https://doi.org/10.2307/2118511', claim: 'Portföyü sık kontrol etmek kayıp hissini büyütür; uzun vadeli getiriyi tutmayı zorlaştırır.' },
    { id: 'od98', cite: 'Odean (1998). Are Investors Reluctant to Realize Their Losses? Journal of Finance 53(5): 1775–1798.', url: 'https://doi.org/10.1111/0022-1082.00072', claim: 'Yatırımcılar kazananı erken satıp kaybedeni tutma eğilimindedir (elde tutma/satma sapması).' },
    { id: 'bo00', cite: 'Barber & Odean (2000). Trading Is Hazardous to Your Wealth. Journal of Finance 55(2): 773–806.', url: 'https://doi.org/10.1111/0022-1082.00226', claim: 'Çok işlem yapan bireysel yatırımcıların net getirisi daha düşüktür; aşırı özgüven işlem sıklığını artırır.' },
    { id: 'dalbar', cite: 'DALBAR (2026). Quantitative Analysis of Investor Behavior (QAIB), 2026 raporu basın bülteni.', url: 'https://www.dalbar.com/press-release/dalbars-2026-qaib-report-shows-narrower-investor-gap-amid-a-complex-and-volatile-market-year/', claim: 'ABD’de ortalama hisse yatırımcısı 2025’te %17,16 kazandı, S&P 500 %17,88 (fark 72 baz puan); 2024’te fark 848 baz puandı (%16,54 ve %25,02). Şirketin kendi yöntemidir; çeşitli eleştiriler vardır.' },
    { id: 'vanguard', cite: 'Vanguard (2025 güncellemesi). Putting a value on your value: Quantifying Vanguard Advisor’s Alpha.', url: 'https://advisors.vanguard.com/content/dam/fas/pdfs/IARCQAA.pdf', claim: 'Davranışsal koçluğun katkısı “200 baz puana kadar veya fazlası” olarak tahmin edilir; her yıl garanti değil, düzensizdir ve kişiden kişiye çok değişir.' }
  ];
  var MOODS = { calm: 'Sakin', fear: 'Kaygılı / korkulu', anger: 'Kızgın / hayal kırıklığı', regret: 'Pişman', fomo: 'Heyecanlı / FOMO', over: 'Aşırı özgüvenli', unsure: 'Kararsız' };
  var TIPS = {
    fear: ['24 saat kuralı: azaltma/satma düşüncesini bir gün beklet; yarın aynı fikirdeysen ve plan gerektiriyorsa “analizden sonra gözden geçir” adımını izle.', 'Fiyat bakma sıklığını azalt: sık kontrol kayıp hissini büyütür (Benartzi–Thaler).', 'Bu para ne zaman lazım? Vaden uzunsa geçici düşüş planını bozmaz; kısaysa riskli pay zaten planda küçük olmalıdır.', 'Acil fon tamamsa zorunlu satış riskin yoktur; değilse önce onu tamamla.', 'Düşüşün nedenine bak: piyasa geneli mi, senin varlığına özel mi? Haberler → Akış’ta kaynaklı habere bak, sosyal medyaya değil.'],
    fomo: ['Plan dışı alım yapma: yükselen bir varlığı kovalamak ortalama getiriyi düşüren yaygın bir davranıştır (Barber–Odean; DALBAR).', 'Riskli varlık payın üst sınırı aşıldıysa yeni alım yerine kuralına göre dengeleme gözden geçir.', 'Satın almadan önce 24 saat bekle ve “bu varlığı bugünkü fiyatla da planıma koyar mıydım?” diye sor.', 'Aşırı hareketlerde Varlık analizi’ndeki güven ve veri uyarılarını oku.'],
    regret: ['Kararı sonuçla değil sürece göre değerlendir: o gün elindeki bilgiyle makul muydu?', 'Karar günlüğü tut (tarih, gerekçe, vade, çıkış koşulu); gelecekte pişmanlığı azaltır.', 'Kaybı telafi için risk alma: “kaybı çıkarma” dürtüsü kayıptan kaçınmanın tipik sonucudur (Kahneman–Tversky).'],
    anger: ['Öfke ve hayal kırıklığında işlem yapma; bir gün geçtikten sonra plana dön.', 'Kontrol edebildiklerine odaklan: tasarruf oranı, maliyetler, çeşitlendirme, acil fon.'],
    over: ['Çok işlem getiriyi düşürür (Barber–Odean); işlem sayını ve maliyetini kontrol et.', 'Tek varlık ve riskli varlık limitlerini yeniden oku; limit aşımı varsa kuralına göre dengeleme düşün.', 'Kazandığın bir dönem beceriyle şansı ayırt etmeyi zorlaştırır; sonuçları ölçütle (benchmark) karşılaştır.'],
    unsure: ['Karar vermek zorunda değilsin: plan, vade ve acil fon sağlamsa “hiçbir şey yapma” da geçerli bir karardır.', 'Aşağıdaki kontrol listesini yukarıdan aşağı yürü.'],
    calm: ['Bu iyi bir durum; planı ve ritmi sürdür. Kuralına göre düzenli kontrol (aylık) yeterlidir.']
  };
  function std(a) { if (a.length < 3) return null; var m = a.reduce(function (s, x) { return s + x; }, 0) / a.length; return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1)); }
  function metrics(nw, nowYmd) {
    if (!nw || nw.length < 5) return null;
    var last = nw[nw.length - 1], peak = nw[0]; nw.forEach(function (p) { if (p.v >= peak.v) peak = p; });
    function back(days) { var cutoff = new Date(Date.parse(last.d + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10), ref = null; for (var i = nw.length - 1; i >= 0; i--) if (nw[i].d <= cutoff) { ref = nw[i]; break; } return ref; }
    var r30 = back(30), r90 = back(90), rets = []; for (var i = 1; i < nw.length; i++) if (nw[i - 1].v > 0) rets.push((nw[i].v - nw[i - 1].v) / nw[i - 1].v);
    var streak = 0; for (var j = nw.length - 1; j > 0 && nw[j].v < nw[j - 1].v; j--) streak++;
    var recent = rets.slice(-30), sd = std(recent);
    return { n: nw.length, from: nw[0].d, to: last.d, dd: peak.v > 0 ? (peak.v - last.v) / peak.v : 0, peakDate: peak.d, peakV: peak.v, lastV: last.v, chg30: r30 && r30.v > 0 ? (last.v - r30.v) / r30.v : null, chg90: r90 && r90.v > 0 ? (last.v - r90.v) / r90.v : null, vol30: sd, streakDown: streak };
  }
  function stateOf(m, planGapBp, riskyOverBp) {
    if (!m) return { id: 'nodata', label: 'Veri yetersiz' };
    if (m.dd >= 0.10 || (m.chg30 != null && m.chg30 <= -0.08)) return { id: 'stress', label: 'Baskı altında' };
    if (m.dd >= 0.05 || (m.chg30 != null && m.chg30 <= -0.04) || m.streakDown >= 5) return { id: 'watch', label: 'Dikkatli' };
    if ((m.chg30 != null && m.chg30 >= 0.15) || (riskyOverBp != null && riskyOverBp > 0 && m.chg30 != null && m.chg30 >= 0.08)) return { id: 'euphoria', label: 'Coşkulu' };
    return { id: 'calm', label: 'Sakin' };
  }
  var LEVEL = { low: 'düşük', mid: 'orta', high: 'yüksek' };
  function emotions(m, st, ci, planGapBp) {
    var out = [];
    if (st.id === 'stress' || st.id === 'watch') out.push({ id: 'fear', label: 'Korku / panik satışı dürtüsü', level: st.id === 'stress' ? 'high' : 'mid', why: m.dd >= 0.05 ? 'Zirveden %' + (m.dd * 100).toFixed(1).replace('.', ',') + ' düşüş' + (m.streakDown >= 3 ? ', ' + m.streakDown + ' kayıtlık düşüş serisi' : '') + '. Kayıplar kazançlardan ağır hissedilir (Kahneman–Tversky 1979).' : 'Son 30 günde belirgin düşüş.' });
    if (st.id === 'stress') out.push({ id: 'regret', label: 'Pişmanlık / “keşke satsaydım”', level: 'mid', why: 'Düşüş dönemlerinde yaygındır; kararı sonuçla değil süreçle değerlendirmek gerekir.' });
    if (st.id === 'euphoria') { out.push({ id: 'fomo', label: 'FOMO — kaçırma korkusu', level: 'mid', why: 'Son 30 günde %' + (m.chg30 * 100).toFixed(1).replace('.', ',') + ' artış. Yükselişte alıma yönelmek getiriyi düşüren yaygın davranıştır (Barber–Odean 2000; DALBAR).' }); out.push({ id: 'over', label: 'Aşırı özgüven', level: 'mid', why: 'Kazanç dönemleri becerinin payını abartmayı kolaylaştırır.' }); }
    if (planGapBp != null && planGapBp >= 1000) out.push({ id: 'unsure', label: 'Plana uzaklık / kararsızlık', level: planGapBp >= 2000 ? 'high' : 'mid', why: 'Hedef dağılımdan en büyük sapma %' + (planGapBp / 100).toFixed(0) + ' puan.' });
    if (!out.length) out.push({ id: 'calm', label: 'Belirgin duygusal baskı sinyali yok', level: 'low', why: 'Düşüş, oynaklık ve seri eşiklerin altında.' });
    return out;
  }
  /* Geçmiş toparlanma bağlamı: şu anki düşüşe benzer derinlikteki geçmiş epizotlar (gerçek veri; n ile) */
  function recoveryFacts(rec, dd) {
    var facts = []; if (!rec || !rec.assets) return facts;
    ['XU100', 'SPX', 'XAUUSD', 'BTCUSD'].forEach(function (k) {
      var a = rec.assets[k]; if (!a || !a.thr) return; var t10 = a.thr['10'], t20 = a.thr['20'];
      if (t10 && t10.n) facts.push({ k: k, label: a.label, text: a.label + ' (' + a.from.slice(0, 4) + '–' + a.to.slice(0, 4) + '): %10+ düşüş ' + t10.n + ' kez; toparlanma (önceki zirveyi yeniden görme) medyan ' + t10.medianDaysToRecover + ' gün, en uzunu ' + t10.maxDaysToRecover + ' gün' + (t20 && t20.n ? '. %20+ düşüş ' + t20.n + ' kez, medyan ' + (t20.medianDaysToRecover != null ? t20.medianDaysToRecover + ' gün' : '—') : '') + '.', n: t10.n, src: { name: 'Yahoo Finance günlük kapanışlar (resmî olmayan); TL/USD nominal', url: a.url || rec.url || null, at: rec.generatedAt } });
    });
    if (dd != null && dd >= 0.05 && rec.assets.XU100 && rec.assets.XU100.thr['10']) {
      var eps = rec.assets.XU100.thr['10'].episodes || [], lo = dd * 0.7, hi = dd * 1.4, sim = eps.filter(function (e) { return -e.depth >= lo && -e.depth <= hi && e.daysToRecover != null; });
      if (sim.length) { var d = sim.map(function (e) { return e.daysToRecover; }).sort(function (a, b) { return a - b; }); facts.unshift({ k: 'sim', label: 'Benzer derinlik', text: 'BIST 100’de senin düşüşüne benzer derinlikte (%' + Math.round(lo * 100) + '–%' + Math.round(hi * 100) + ') ' + sim.length + ' geçmiş düşüş vardı; zirveyi yeniden görme süresi ortanca ' + d[Math.floor(d.length / 2)] + ' gün' + (sim.length <= 5 ? ' (n ≤ 5: küçük örnek, kesin çıkarım yapma)' : '') + '. Senin portföyün BIST 100 değildir; bu yalnızca bağlamdır.', n: sim.length, src: { name: 'Yahoo Finance (resmî olmayan), nominal', url: rec.assets.XU100.url || rec.url || null, at: rec.generatedAt } }); }
    }
    return facts;
  }
  function checklist(inp) {
    var L = [], em = inp.emergency, R = inp.risk || [], by = function (id) { return R.filter(function (x) { return x.id === id; })[0]; };
    L.push(em ? { id: 'emergency', text: 'Acil durum fonu tamam mı?', status: em.shortfall > 0 ? 'warn' : 'ok', detail: em.shortfall > 0 ? 'Eksik var — zorunlu satış riskini azaltmak için önce bunu tamamla.' : 'Tamam: zorunlu satış baskısı yok.', href: '#butce' } : { id: 'emergency', text: 'Acil durum fonu tamam mı?', status: 'na', detail: 'Hesaplanamadı.' });
    var lim = ['maxAsset', 'maxRisky', 'concentration'].map(by).filter(Boolean), bad = lim.filter(function (x) { return x.level !== 'ok'; });
    L.push({ id: 'limits', text: 'Tek varlık / riskli varlık sınırları içinde miyim?', status: !lim.length ? 'na' : bad.length ? 'warn' : 'ok', detail: bad.length ? bad.map(function (x) { return x.title; }).join('; ') + ' — kuralına göre dengelemeyi gözden geçir.' : 'Sınırlar içinde.', href: '#portfoy/risk' });
    if (inp.planGapBp != null) L.push({ id: 'plan', text: 'Hedef dağılıma yakın mıyım?', status: inp.planGapBp >= 1000 ? 'warn' : 'ok', detail: 'En büyük sapma %' + (inp.planGapBp / 100).toFixed(0) + ' puan' + (inp.planGapBp >= 1000 ? ' — yeni parayı eksik kalan gruba yönlendirmek en düşük maliyetli yoldur.' : '.'), href: '#portfoy/dagilim' });
    var hal = by('halal'); if (hal) L.push({ id: 'halal', text: 'Tüm varlıklar helal uygun mu?', status: hal.level === 'ok' ? 'ok' : 'warn', detail: hal.text, href: '#portfoy/varliklar' });
    L.push({ id: 'horizon', text: 'Bu parayı en az vade sonuna kadar kullanmayacak mıyım?', status: 'ask', detail: 'Evetse geçici düşüş planı değiştirmez. Hayırsa, ihtiyaç tarihini plana yaz.' });
    L.push({ id: 'wait', text: '24 saat bekledim mi?', status: 'ask', detail: 'Duygusal anda alım/satım yerine bir gün bekle; yarın aynı gerekçe geçerliyse karar daha sağlıklıdır.' });
    L.push({ id: 'source', text: 'Kararımı kaynaklı habere/veriye mi, sosyal medyaya mı dayandırıyorum?', status: 'ask', detail: 'Haberler bölümünde kaynak ve saat her başlıkta var.', href: '#haberler' });
    return L;
  }
  /* inp: {nw, isExample, nwSynthetic, targetAlloc, currentAlloc, emergency, risk, recovery, checkins} */
  function assess(inp) {
    var real = !inp.isExample && !inp.nwSynthetic, m = real ? metrics(inp.nw) : null, gap = null, overBp = null;
    if (inp.targetAlloc && inp.currentAlloc) { gap = 0; ['safe', 'medium', 'risky'].forEach(function (k) { gap = Math.max(gap, Math.abs((inp.currentAlloc[k] || 0) - (inp.targetAlloc[k] || 0))); }); overBp = (inp.currentAlloc.risky || 0) - (inp.targetAlloc.risky || 0); }
    var st = stateOf(m, gap, overBp), em = real || st.id !== 'nodata' ? emotions(m || {}, st, inp.checkins, gap) : [];
    if (!m) em = gap != null && gap >= 1000 ? emotions({}, { id: 'calm' }, null, gap).filter(function (x) { return x.id !== 'calm'; }) : [];
    var last = (inp.checkins || []).slice(-1)[0], tips = last && TIPS[last.m] ? TIPS[last.m] : st.id === 'stress' || st.id === 'watch' ? TIPS.fear : st.id === 'euphoria' ? TIPS.fomo : TIPS.calm;
    var notice = null;
    if (inp.isExample || inp.nwSynthetic) notice = 'Örnek verinin net varlık geçmişi sentetiktir; düşüş/oynaklık hesaplanmaz. Kendi verini girince bu kart gerçek geçmişinle çalışır.';
    else if (!m) notice = 'Düşüş ve oynaklık için en az 5 günlük net varlık kaydı gerekir (uygulamayı açtığın her gün bir kayıt eklenir).';
    var mismatch = null;
    if (last && (inp.today == null || last.d === inp.today)) {
      if ((last.m === 'fear' || last.m === 'anger' || last.m === 'regret') && (st.id === 'calm' || st.id === 'nodata') && m) mismatch = 'Verilerin sakin görünüyor ama sen ' + MOODS[last.m].toLowerCase() + ' hissediyorsun. Bu fark çoğu zaman haber/sosyal medya etkisidir; kontrol listesine ve kaynaklı habere bak.';
      if (last.m === 'calm' && (st.id === 'stress')) mismatch = 'Sakin olman iyi; yine de portföyün zirveden belirgin geride — planın ve acil fonun sağlam olduğunu kontrol listesiyle doğrula.';
    }
    return { state: st, metrics: m, gapBp: gap, emotions: em, tips: tips, checklist: checklist(inp), facts: recoveryFacts(inp.recovery, m ? m.dd : null), refs: REFS, notice: notice, mismatch: mismatch, last: last || null };
  }
  function addCheckin(list, mood, ymd, note, dd, nowMs) {
    if (!MOODS[mood]) return list || [];
    var o = (list || []).filter(function (x) { return x.d !== ymd; }); o.push({ d: ymd, m: mood, t: nowMs || 0, note: note ? String(note).slice(0, 200) : undefined, dd: dd != null && isFinite(dd) ? Math.round(dd * 1000) / 1000 : undefined });
    return o.sort(function (a, b) { return a.d < b.d ? -1 : 1; }).slice(-200);
  }
  function cleanMood(x) {
    var o = { checkins: [] }; if (!x || typeof x !== 'object') return o;
    (Array.isArray(x.checkins) ? x.checkins : []).forEach(function (c) { if (c && /^\d{4}-\d{2}-\d{2}$/.test(c.d) && MOODS[c.m]) o.checkins.push({ d: c.d, m: c.m, t: +c.t || 0, note: typeof c.note === 'string' ? c.note.slice(0, 200) : undefined, dd: Number.isFinite(+c.dd) ? +c.dd : undefined }); });
    o.checkins = o.checkins.sort(function (a, b) { return a.d < b.d ? -1 : 1; }).slice(-200); return o;
  }
  return { REFS: REFS, MOODS: MOODS, TIPS: TIPS, metrics: metrics, stateOf: stateOf, emotions: emotions, recoveryFacts: recoveryFacts, checklist: checklist, assess: assess, addCheckin: addCheckin, cleanMood: cleanMood };
});
