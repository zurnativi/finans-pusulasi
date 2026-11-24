/* sessions.js — Piyasa seansı takvimi ve rapor saatleri (v8.5). SAF (testli); tarayıcıda ve Node'da (GitHub Actions) aynı kod.
 * BIST: TSİ (UTC+3, yaz saati yok). Rapor: 09:30 açılış öncesi · 13:30 seans ortası · 18:30 kapanış sonrası; arife (yarım gün, 13:00 kapanış): 09:30 · 11:30 · 13:30.
 * ABD (NYSE): America/New_York (yaz saati kuralı: Mart'ın 2. pazarı → Kasım'ın 1. pazarı). Rapor: açılıştan 30 dk önce 09:00 ET · seans ortası 12:45 ET · kapanıştan
 * 30 dk sonra 16:30 ET; erken kapanış (13:00 ET) günlerinde 09:00 · 11:15 · 13:30 ET. Kripto (elinde varsa): her gün 09:00 · 15:00 · 21:00 TSİ.
 * Tatil listeleri: Borsa İstanbul "Pay Piyasası 2026 Yılı Tatil Tablosu" (04.12.2025 duyurusu) ve 2027 için 2429 sayılı Kanun + Diyanet takvimi (BIST tablosu
 * yayımlanınca teyit edilmeli); NYSE resmi tatil/erken kapanış tablosu (nyse.com/markets/hours-calendars, 2026–2027). Listede olmayan yıl için uyarı döner. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sessions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var BIST_CLOSED = { // tam gün kapalı (hafta içi)
    '2026-01-01': 'Yılbaşı', '2026-03-20': 'Ramazan Bayramı', '2026-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı', '2026-05-01': 'Emek ve Dayanışma Günü', '2026-05-19': 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı',
    '2026-05-27': 'Kurban Bayramı', '2026-05-28': 'Kurban Bayramı', '2026-05-29': 'Kurban Bayramı', '2026-07-15': 'Demokrasi ve Milli Birlik Günü', '2026-10-29': 'Cumhuriyet Bayramı',
    '2027-01-01': 'Yılbaşı', '2027-03-09': 'Ramazan Bayramı', '2027-03-10': 'Ramazan Bayramı', '2027-03-11': 'Ramazan Bayramı', '2027-04-23': 'Ulusal Egemenlik ve Çocuk Bayramı',
    '2027-05-17': 'Kurban Bayramı', '2027-05-18': 'Kurban Bayramı', '2027-05-19': 'Kurban Bayramı / 19 Mayıs', '2027-07-15': 'Demokrasi ve Milli Birlik Günü', '2027-08-30': 'Zafer Bayramı', '2027-10-29': 'Cumhuriyet Bayramı'
  };
  var BIST_HALF = { '2026-03-19': 'Ramazan Bayramı arifesi', '2026-05-26': 'Kurban Bayramı arifesi', '2026-10-28': 'Cumhuriyet Bayramı arifesi', '2027-03-08': 'Ramazan Bayramı arifesi', '2027-10-28': 'Cumhuriyet Bayramı arifesi' };
  var NYSE_CLOSED = {
    '2026-01-01': 'New Year\'s Day', '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': 'Washington\'s Birthday', '2026-04-03': 'Good Friday', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
    '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
    '2027-01-01': 'New Year\'s Day', '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': 'Washington\'s Birthday', '2027-03-26': 'Good Friday', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
    '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)'
  };
  var NYSE_EARLY = { '2026-11-27': 'Şükran Günü ertesi (13:00 ET kapanış)', '2026-12-24': 'Noel arifesi (13:00 ET kapanış)', '2027-11-26': 'Şükran Günü ertesi (13:00 ET kapanış)' };
  var YEARS = { 2026: 1, 2027: 1 };
  var MARKETS = {
    bist: { label: 'Borsa İstanbul', short: 'BIST', tz: 'TSİ', group: 'BIST hisseleri, altın ve TEFAS fonları' },
    us: { label: 'ABD (NYSE/Nasdaq)', short: 'ABD', tz: 'ET', group: 'ABD hisse/ETF (SPUS, SPWO…)' },
    crypto: { label: 'Kripto (7/24)', short: 'Kripto', tz: 'TSİ', group: 'Kripto paralar (elinde varsa)' }
  };
  var SLOT_LABEL = { pre: 'Açılış öncesi', mid: 'Seans ortası', post: 'Kapanış sonrası' };
  var CRYPTO_LABEL = { pre: 'Sabah', mid: 'Öğleden sonra', post: 'Akşam' };
  var SLOT_FOCUS = { pre: 'Beklentiler ve izlenecek seviyeler', mid: 'Ne hareket etti, neden', post: 'Gün özeti ve yarının planı' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymdUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function addDays(ymd, n) { return ymdUTC(parseYmd(ymd) + n * 86400000); }
  function dow(ymd) { return new Date(parseYmd(ymd)).getUTCDay(); }
  function nthSunday(y, m, n) { var d = new Date(Date.UTC(y, m, 1)), first = (7 - d.getUTCDay()) % 7; return 1 + first + (n - 1) * 7; }
  /* ABD doğu saati farkı (dk): yaz saati 2. pazar Mart 02:00 yerel → 1. pazar Kasım 02:00 yerel */
  function nyOffsetMin(ms) {
    var y = new Date(ms).getUTCFullYear();
    var start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7), end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6); // 02:00 EST = 07:00Z; 02:00 EDT = 06:00Z
    return ms >= start && ms < end ? -240 : -300;
  }
  function tsiYmd(ms) { return ymdUTC(ms + 180 * 60000); }
  function nyYmd(ms) { return ymdUTC(ms + nyOffsetMin(ms) * 60000); }
  function localYmd(market, ms) { return market === 'us' ? nyYmd(ms) : tsiYmd(ms); }
  /* Yerel saat (HH:MM) → UTC ms */
  function tsiToMs(ymd, hm) { return parseYmd(ymd) + (+hm.slice(0, 2) * 60 + +hm.slice(3, 5) - 180) * 60000; }
  function nyToMs(ymd, hm) { var guess = parseYmd(ymd) + (+hm.slice(0, 2) * 60 + +hm.slice(3, 5) + 300) * 60000; var off = nyOffsetMin(guess); return parseYmd(ymd) + (+hm.slice(0, 2) * 60 + +hm.slice(3, 5) - off) * 60000; }
  function fmtTsi(ms) { var d = new Date(ms + 180 * 60000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function fmtTsiFull(ms) { var d = new Date(ms + 180 * 60000); return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }

  function dayInfo(market, ymd) {
    var wd = dow(ymd), y = +ymd.slice(0, 4), known = !!YEARS[y];
    if (market === 'crypto') return { open: true, half: false, reason: null, known: true };
    if (wd === 0 || wd === 6) return { open: false, half: false, reason: 'Hafta sonu', known: known };
    if (market === 'bist') { if (BIST_CLOSED[ymd]) return { open: false, half: false, reason: BIST_CLOSED[ymd], known: known }; if (BIST_HALF[ymd]) return { open: true, half: true, reason: BIST_HALF[ymd] + ' — yarım gün (13:00 kapanış)', known: known }; }
    if (market === 'us') { if (NYSE_CLOSED[ymd]) return { open: false, half: false, reason: 'NYSE tatili: ' + NYSE_CLOSED[ymd], known: known }; if (NYSE_EARLY[ymd]) return { open: true, half: true, reason: NYSE_EARLY[ymd], known: known }; }
    return { open: true, half: false, reason: null, known: known };
  }
  function isTradingDay(market, ymd) { return dayInfo(market, ymd).open; }
  /* Bir piyasanın o (yerel) gündeki seans saatleri ve 3 rapor saati */
  function sessionOf(market, ymd) {
    var di = dayInfo(market, ymd); if (!di.open) return null;
    if (market === 'bist') {
      var close = di.half ? '13:00' : '18:00';
      return { market: market, ymd: ymd, half: di.half, reason: di.reason, known: di.known, openMs: tsiToMs(ymd, '10:00'), closeMs: tsiToMs(ymd, close), local: { open: '10:00', close: close },
        slots: [{ slot: 'pre', hm: '09:30' }, { slot: 'mid', hm: di.half ? '11:30' : '13:30' }, { slot: 'post', hm: di.half ? '13:30' : '18:30' }].map(function (s) { return mk(market, ymd, s.slot, tsiToMs(ymd, s.hm), s.hm, di); }) };
    }
    if (market === 'us') {
      var c2 = di.half ? '13:00' : '16:00';
      return { market: market, ymd: ymd, half: di.half, reason: di.reason, known: di.known, openMs: nyToMs(ymd, '09:30'), closeMs: nyToMs(ymd, c2), local: { open: '09:30', close: c2 },
        slots: [{ slot: 'pre', hm: '09:00' }, { slot: 'mid', hm: di.half ? '11:15' : '12:45' }, { slot: 'post', hm: di.half ? '13:30' : '16:30' }].map(function (s) { return mk(market, ymd, s.slot, nyToMs(ymd, s.hm), s.hm, di); }) };
    }
    return { market: market, ymd: ymd, half: false, reason: null, known: true, openMs: tsiToMs(ymd, '00:00'), closeMs: tsiToMs(ymd, '23:59'), local: { open: '00:00', close: '24:00' },
      slots: [{ slot: 'pre', hm: '09:00' }, { slot: 'mid', hm: '15:00' }, { slot: 'post', hm: '21:00' }].map(function (s) { return mk(market, ymd, s.slot, tsiToMs(ymd, s.hm), s.hm, di); }) };
  }
  function mk(market, ymd, slot, ms, hm, di) {
    return { id: market + ':' + ymd + ':' + slot, market: market, ymd: ymd, slot: slot, atMs: ms, localHm: hm, tsi: fmtTsi(ms), label: (market === 'crypto' ? CRYPTO_LABEL : SLOT_LABEL)[slot], focus: SLOT_FOCUS[slot], half: !!di.half, note: di.reason || null, known: di.known };
  }
  function slotsAround(market, ms, daysBack, daysFwd) {
    var out = [], base = localYmd(market, ms);
    for (var d = -(daysBack || 0); d <= (daysFwd || 0); d++) { var s = sessionOf(market, addDays(base, d)); if (s) out = out.concat(s.slots); }
    return out.sort(function (a, b) { return a.atMs - b.atMs; });
  }
  /* Şu an üretilmesi gereken raporlar: rapor saatinden en çok earlyMin önce ile lateMin sonrası arasında (zamanlayıcı gecikmesine dayanıklı). */
  function dueSlots(ms, opts) {
    opts = opts || {}; var early = (opts.earlyMin == null ? 10 : opts.earlyMin) * 60000, late = (opts.lateMin == null ? 100 : opts.lateMin) * 60000, mk2 = opts.markets || ['bist', 'us', 'crypto'];
    var out = [];
    mk2.forEach(function (m) { slotsAround(m, ms, 1, 1).forEach(function (s) { if (ms >= s.atMs - early && ms <= s.atMs + late) out.push(s); }); });
    return out;
  }
  /* Son (geçmiş) rapor saati */
  function latestSlot(market, ms) { var list = slotsAround(market, ms, 12, 0).filter(function (s) { return s.atMs <= ms + 10 * 60000; }); return list.length ? list[list.length - 1] : null; }
  function nextSlot(market, ms) { var list = slotsAround(market, ms, 0, 12).filter(function (s) { return s.atMs > ms; }); return list.length ? list[0] : null; }
  function marketState(market, ms) {
    if (market === 'crypto') return { open: true, label: '7/24 açık' };
    var y = localYmd(market, ms), s = sessionOf(market, y);
    if (s && ms >= s.openMs && ms < s.closeMs) return { open: true, label: 'Seans açık (' + s.local.open + '–' + s.local.close + ' ' + MARKETS[market].tz + ')', half: s.half };
    if (s && ms < s.openMs) return { open: false, label: 'Açılış bekleniyor (' + s.local.open + ' ' + MARKETS[market].tz + ')' };
    var di = dayInfo(market, y); return { open: false, label: s ? 'Seans kapandı' : (di.reason || 'Kapalı') };
  }
  function idOf(market, ymd, slot) { return market + ':' + ymd + ':' + slot; }
  function parseId(id) { var m = /^(bist|us|crypto):(\d{4}-\d{2}-\d{2}):(pre|mid|post)$/.exec(id || ''); if (!m) return null; var s = sessionOf(m[1], m[2]); var sl = s && s.slots.filter(function (x) { return x.slot === m[3]; })[0]; return sl || null; }
  /* Grup: bir varlık anahtarı hangi seansın raporuna girer? */
  function marketOfKey(key) {
    var p = String(key || '').split(':')[0];
    if (p === 'us' || p === 'td') return 'us';
    if (p === 'cg') return 'crypto';
    if (p === 'bist' || p === 'tefas' || p === 'metal' || p === 'fx' || p === 'idx') return 'bist';
    return 'bist';
  }
  /* Kullanıcıya gösterilecek saat tablosu (TSİ): kış (EST) ve yaz (EDT) için ABD saatleri ayrı */
  function scheduleTable() {
    var w = '2026-12-01', s = '2026-07-01';
    function row(m, ymd) { var x = sessionOf(m, ymd); return x ? x.slots.map(function (sl) { return { slot: sl.slot, label: sl.label, local: sl.localHm, tsi: sl.tsi }; }) : []; }
    return [
      { market: 'bist', label: 'BIST + altın + TEFAS fonları', when: 'BIST iş günleri', slots: row('bist', w), note: 'Arife (yarım gün): 09:30 · 11:30 · 13:30 TSİ. Fon fiyatları akşam açıklanır.' },
      { market: 'us', label: 'ABD (SPUS, SPWO…) — kış (Kasım–Mart)', when: 'NYSE iş günleri', slots: row('us', w), note: 'Kapanış sonrası raporu gece yarısından sonra (ertesi gün 00:30 TSİ).' },
      { market: 'us', label: 'ABD — yaz saati (Mart–Kasım)', when: 'NYSE iş günleri', slots: row('us', s), note: 'Yaz saatinde ABD saatleri TSİ\'ye 1 saat yaklaşır. Erken kapanış (13:00 ET) günleri kışın: 17:00 · 19:15 · 21:30 TSİ.' },
      { market: 'crypto', label: 'Kripto (elinde varsa)', when: 'Her gün', slots: row('crypto', w), note: 'Elinde kripto yoksa bu rapor üretilmez.' }
    ];
  }
  function holidaysOf(market, fromYmd, days) {
    var out = []; for (var i = 0; i < (days || 60); i++) { var y = addDays(fromYmd, i), di = dayInfo(market, y); if (di.reason && di.reason !== 'Hafta sonu') out.push({ ymd: y, reason: di.reason, half: di.half }); }
    return out;
  }
  return { MARKETS: MARKETS, SLOT_LABEL: SLOT_LABEL, SLOT_FOCUS: SLOT_FOCUS, BIST_CLOSED: BIST_CLOSED, BIST_HALF: BIST_HALF, NYSE_CLOSED: NYSE_CLOSED, NYSE_EARLY: NYSE_EARLY,
    nyOffsetMin: nyOffsetMin, tsiYmd: tsiYmd, nyYmd: nyYmd, localYmd: localYmd, tsiToMs: tsiToMs, nyToMs: nyToMs, fmtTsi: fmtTsi, fmtTsiFull: fmtTsiFull, addDays: addDays,
    dayInfo: dayInfo, isTradingDay: isTradingDay, sessionOf: sessionOf, slotsAround: slotsAround, dueSlots: dueSlots, latestSlot: latestSlot, nextSlot: nextSlot, marketState: marketState,
    idOf: idOf, parseId: parseId, marketOfKey: marketOfKey, scheduleTable: scheduleTable, holidaysOf: holidaysOf };
});
