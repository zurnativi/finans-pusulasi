/* importparse.js — Excel/CSV/PDF/OCR metinlerinden işlem çıkarma, doğrulama, kategori önerisi, mükerrer tespiti. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./money.js'));
  else root.ImportParse = factory(root.Money);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var TR_MONTHS = { 'ocak': 1, 'oca': 1, 'şubat': 2, 'şub': 2, 'subat': 2, 'mart': 3, 'mar': 3, 'nisan': 4, 'nis': 4, 'mayıs': 5, 'may': 5, 'mayis': 5,
    'haziran': 6, 'haz': 6, 'temmuz': 7, 'tem': 7, 'ağustos': 8, 'ağu': 8, 'agustos': 8, 'eylül': 9, 'eyl': 9, 'eylul': 9, 'ekim': 10, 'eki': 10,
    'kasım': 11, 'kas': 11, 'kasim': 11, 'aralık': 12, 'ara': 12, 'aralik': 12 };

  function trLower(s) { return String(s || '').toLocaleLowerCase('tr-TR'); }
  /* Karşılaştırma için: Türkçe küçük harf + ı→i (MIGROS → migros) */
  function fold(s) { return trLower(s).replace(/ı/g, 'i').replace(/\u0307/g, ''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isValidYmd(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false;
    var dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return d <= dim;
  }
  function fix2(y) { return y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y; }

  /* Tarihi "YYYY-AA-GG" biçimine çevirir; geçersizse null. Türkiye biçimi önceliklidir: GG.AA.YYYY */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number') { // Excel seri numarası (1900 sistemi)
      if (v < 20000 || v > 80000) return null;
      var dt = new Date(Math.round((v - 25569) * 86400000));
      return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    }
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s))) {
      var y = +m[1], mo = +m[2], d = +m[3];
      return isValidYmd(y, mo, d) ? y + '-' + pad(mo) + '-' + pad(d) : null;
    }
    if ((m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})(?!\d)/.exec(s))) {
      var d2 = +m[1], mo2 = +m[2], y2 = fix2(+m[3]);
      return isValidYmd(y2, mo2, d2) ? y2 + '-' + pad(mo2) + '-' + pad(d2) : null;
    }
    if ((m = /^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\.?\s+(\d{4})/.exec(s))) {
      var mo3 = TR_MONTHS[trLower(m[2])];
      if (mo3 && isValidYmd(+m[3], mo3, +m[1])) return m[3] + '-' + pad(mo3) + '-' + pad(+m[1]);
    }
    return null;
  }

  /* ---------- Kategori önerisi ---------- */
  var CATEGORY_RULES = [
    ['Transfer', ['tesekkur', 'teşekkür', 'kart ödemesi', 'kart borcu ödeme', 'hesaplar arası', 'virman']],
    ['Gelir', ['maaş', 'maas', 'ücret ödemesi', 'salary', 'gelen havale', 'gelen eft', 'gelen fast', 'kira geliri', 'prim', 'ikramiye']],
    ['Market', ['migros', 'a101', 'bim ', 'bim/', 'şok ', 'sok market', 'carrefour', 'macro', 'file market', 'hakmar', 'kim market', 'onur market', 'market', 'bakkal', 'manav', 'kasap', 'getir büyük', 'tarım kredi']],
    ['Yeme-içme', ['yemeksepeti', 'getir yemek', 'trendyol yemek', 'restoran', 'restaurant', 'cafe', 'kafe', 'kahve', 'starbucks', 'burger', 'pizza', 'döner', 'lokanta', 'pastane', 'simit']],
    ['Ulaşım', ['opet', 'shell', 'petrol ofisi', ' po ', 'bp ', 'total', 'aytemiz', 'akaryakıt', 'istanbulkart', 'metro', 'otobüs', 'uber', 'bitaksi', 'taksi', 'otopark', 'hgs', 'ogs', 'pegasus', 'thy', 'türk hava', 'ajet', 'tcdd', 'marti']],
    ['Faturalar', ['turkcell', 'vodafone', 'türk telekom', 'turk telekom', 'superonline', 'türknet', 'igdaş', 'igdas', 'başkentgaz', 'enerjisa', 'ck enerji', 'elektrik', 'doğalgaz', 'dogalgaz', 'iski', 'aski', 'su idaresi', 'fatura', 'aidat']],
    ['Kira/Konut', ['kira', 'emlak', 'site yönetim']],
    ['Sağlık', ['eczane', 'hastane', 'klinik', 'diş', 'medikal', 'optik', 'sağlık']],
    ['Giyim', ['lc waikiki', 'lcw', 'defacto', 'koton', 'zara', 'h&m', 'mavi', 'boyner', 'flo', 'colin', 'giyim', 'ayakkabı']],
    ['Abonelik/Eğlence', ['netflix', 'spotify', 'youtube', 'disney', 'exxen', 'blutv', 'amazon prime', 'apple.com', 'google play', 'steam', 'sinema', 'playstation']],
    ['Alışveriş', ['trendyol', 'hepsiburada', 'amazon', 'n11', 'teknosa', 'mediamarkt', 'vatan', 'ikea', 'koçtaş', 'bauhaus', 'çiçeksepeti']],
    ['Eğitim', ['okul', 'kurs', 'üniversite', 'kitap', 'd&r', 'kırtasiye', 'udemy']],
    ['Bağış/Zekat', ['bağış', 'bagis', 'zekat', 'sadaka', 'vakıf', 'dernek', 'kızılay']],
    ['Nakit çekim', ['atm', 'nakit çekim', 'para çekme']],
    ['Transfer', ['tesekkur', 'teşekkür', 'kart ödeme', 'kart odeme', 'borç ödeme', 'hesaplar arası', 'havale', 'eft', 'fast', 'virman', 'transfer']],
    ['Banka masrafı', ['masraf', 'komisyon', 'kart aidatı', 'bsmv', 'kkdf']]
  ];
  var CATEGORIES = CATEGORY_RULES.map(function (r) { return r[0]; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).concat(['Diğer']);
  /* Türkçe duyarlı, tam kelime eşleşmesi. "taksi" artık "TAKSİT" içinde eşleşmez; kelimeye gelen yaygın ekler ("kirası", "marketler") kabul edilir.
   * Önce taksit ibareleri ("TAKSİT 3/6", "(1/4)", "3. taksit") açıklamadan çıkarılır: kategori işyerine göre belirlenir. */
  function catFold(x) { return fold(x).replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u'); }
  var SFX = '(?:lari|leri|lar|ler|si|su|sı|nin|nun|in|un|dan|den|tan|ten|da|de|ta|te|ya|ye|a|e|i|u)?';
  var kwCache = {};
  function kwRe(kw) {
    if (kwCache[kw]) return kwCache[kw];
    var k = catFold(kw).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return (kwCache[kw] = new RegExp('(^|[^a-z0-9])' + k + SFX + '(?=$|[^a-z0-9])'));
  }
  function stripInstallment(d) {
    return d.replace(/\btaksit(?:li|i|ler)?\b\s*\d{0,2}\s*\/?\s*\d{0,2}/g, ' ').replace(/\(\s*\d{1,2}\s*\/\s*\d{1,2}\s*\)/g, ' ').replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, ' ').replace(/\s+/g, ' ');
  }
  function suggestCategory(desc, amount) {
    var d = ' ' + stripInstallment(catFold(desc)) + ' ';
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var rule = CATEGORY_RULES[i];
      if (rule[0] === 'Gelir' && amount < 0) continue;
      for (var j = 0; j < rule[1].length; j++) if (kwRe(rule[1][j]).test(d)) return rule[0];
    }
    return amount > 0 ? 'Gelir' : 'Diğer';
  }

  /* ---------- Kredi kartı ekstresi tespiti ----------
   * İpuçları: "EKSTRE", "SON ÖDEME", "HESAP KESİM", "DÖNEM BORCU", "ASGARİ ÖDEME", "ÖDEME - TEŞEKKÜR", maskeli kart numarası (5528 79** **** 1234).
   * En az iki ipucu (veya maskeli kart no + bir ipucu) → kart ekstresi. */
  function detectCardStatement(text) {
    var t = catFold(text || ''), hits = [];
    [['ekstre', /ekstre/], ['son ödeme', /son\s*odeme/], ['hesap kesim', /hesap\s*kesim|kesim\s*tarihi/], ['dönem borcu', /donem\s*borcu/], ['asgari ödeme', /asgari\s*odeme/],
      ['ödeme-teşekkür', /odeme\s*[-–—]?\s*tesekkur/], ['kredi kartı', /kredi\s*karti/]].forEach(function (x) { if (x[1].test(t)) hits.push(x[0]); });
    if (/\b\d{4}[\s-]?(?:\d{2}|[*xX]{2})[*xX]{2}[\s-]?[*xX]{4}[\s-]?\d{4}\b|[*xX]{4}[\s-]?[*xX]{4}[\s-]?[*xX]{4}[\s-]?\d{4}|\b\d{6}[*xX]{6}\d{4}\b/.test(String(text || ''))) hits.push('maskeli kart no');
    return { isCard: hits.length >= 2, hits: hits };
  }
  /* Ekstre satırlarının işareti: harcamalar artı yazılmışsa (çoğunluk artı) çevrilmesi gerekir */
  function looksPositiveExpenses(rows) {
    var pos = 0, neg = 0, posSum = 0, negSum = 0;
    rows.forEach(function (r) { if (!Number.isInteger(r.amount) || r.amount === 0) return; if (r.amount > 0) { pos++; posSum += r.amount; } else { neg++; negSum -= r.amount; } });
    return pos > neg || (pos === neg && posSum > negSum);
  }
  function isCardPayment(desc) { var d = catFold(desc); return /odeme\s*[-–—]?\s*tesekkur|tesekkur\s*ederiz|kart\s*(borcu\s*)?odeme|hesaptan\s*odeme|otomatik\s*odeme/.test(d); }

  /* ---------- Mükerrer tespiti (aynı tarih + aynı tutar + aynı açıklama) ---------- */
  function normDesc(s) { return fold(s).replace(/[^a-z0-9çğıöşü]+/g, ' ').trim(); }
  function dupKey(t) { return (t.date || '') + '|' + t.amount + '|' + normDesc(t.description); }
  function looseKey(t) { return (t.date || '') + '|' + t.amount; }
  /* existing: kayıtlı işlemler (her hesaptan). Aynı tarih+tutar+açıklama → mükerrer (seçilmez).
   * Aynı tarih+tutar ama farklı açıklama/hesap → "olası mükerrer" uyarısı (seçili kalır, kullanıcı karar verir).
   * Farklı hesaptan aynı tutar (ör. kart ekstresi + banka dökümünde aynı ödeme) da bu yolla işaretlenir. */
  function markDuplicates(rows, existing) {
    var seen = {}, loose = {};
    (existing || []).forEach(function (t) { seen[dupKey(t)] = 'existing'; if (t.date && Number.isInteger(t.amount)) (loose[looseKey(t)] = loose[looseKey(t)] || []).push(t); });
    rows.forEach(function (r) {
      var k = dupKey(r);
      r.possibleDup = null;
      if (seen[k] === 'existing') r.duplicate = 'Kayıtlı bir işlemle aynı (tarih+tutar+açıklama)';
      else if (seen[k] === 'batch') r.duplicate = 'Bu dosyada aynı satır birden fazla var';
      else {
        r.duplicate = null; seen[k] = 'batch';
        var lk = r.date && Number.isInteger(r.amount) ? loose[looseKey(r)] : null;
        if (lk && lk.length) r.possibleDup = 'Aynı gün aynı tutarda kayıtlı işlem var: "' + String(lk[0].description || '').slice(0, 40) + '"' + (lk[0].accountId ? ' (başka bir hesapta)' : '') + '. Aynı işlemse seçimi kaldır.';
      }
    });
    return rows;
  }

  /* ---------- Satır doğrulama ---------- */
  function validateRow(r, todayYmd) {
    var errors = [], warnings = [];
    if (!r.date) errors.push('Tarih geçersiz');
    else if (todayYmd && r.date > todayYmd) warnings.push('Tarih gelecekte');
    if (r.amount == null || !Number.isInteger(r.amount)) errors.push('Tutar geçersiz');
    else if (r.amount === 0) errors.push('Tutar sıfır');
    else if (Math.abs(r.amount) > 1000000000) warnings.push('Çok büyük tutar (10 milyon TL üstü), kontrol et');
    if (!r.description || !String(r.description).trim()) warnings.push('Açıklama boş');
    if (r.duplicate) warnings.push('Mükerrer olabilir');
    else if (r.possibleDup) warnings.push('Olası mükerrer');
    if (r.amountWarn && r.amountWarn.length) r.amountWarn.forEach(function (w) { warnings.push(w); });
    r.errors = errors; r.warnings = warnings;
    return r;
  }

  /* ---------- Tablo (Excel/CSV) sütun tespiti ---------- */
  var HDR = {
    date: ['tarih', 'işlem tarihi', 'islem tarihi', 'date', 'valör', 'valor'],
    desc: ['açıklama', 'aciklama', 'işlem', 'islem', 'description', 'detay', 'işyeri', 'isyeri', 'ürün', 'urun', 'merchant', 'alıcı'],
    amount: ['tutar', 'tutarı', 'miktar', 'amount', 'işlem tutarı', 'fiyat'],
    debit: ['borç', 'borc', 'çıkan', 'cikan', 'gider', 'debit', 'harcama'],
    credit: ['alacak', 'giren', 'gelir', 'credit', 'yatan']
  };
  function scoreHeader(cell, keys) {
    var c = trLower(cell).trim(); if (!c) return 0;
    var best = 0;
    keys.forEach(function (k) { if (c === k) best = Math.max(best, 3); else if (c.indexOf(k) >= 0) best = Math.max(best, 2); });
    if (/bakiye|balance/.test(c)) return 0; // bakiye sütunu tutar değildir
    return best;
  }
  function detectColumns(rows) {
    var limit = Math.min(rows.length, 30), best = null;
    for (var i = 0; i < limit; i++) {
      var row = rows[i] || [], map = { headerRow: i, date: -1, desc: -1, amount: -1, debit: -1, credit: -1 }, score = 0;
      ['date', 'desc', 'amount', 'debit', 'credit'].forEach(function (f) {
        var bs = 0;
        row.forEach(function (cell, ci) {
          var sc = scoreHeader(cell, HDR[f]);
          var taken = ['date', 'desc', 'amount', 'debit', 'credit'].some(function (g) { return g !== f && map[g] === ci; });
          if (sc > bs && !taken) { bs = sc; map[f] = ci; }
        });
        score += bs;
      });
      if (map.date >= 0 && (map.amount >= 0 || map.debit >= 0 || map.credit >= 0) && (!best || score > best.score)) { map.score = score; best = map; }
    }
    if (best) return best;
    // Başlık yoksa: içerikten tahmin et
    var sample = rows.slice(0, 20), cols = Math.max.apply(null, sample.map(function (r) { return (r || []).length; }).concat([0]));
    var g = { headerRow: -1, date: -1, desc: -1, amount: -1, debit: -1, credit: -1, score: 0 };
    for (var c = 0; c < cols; c++) {
      var dates = 0, nums = 0, texts = 0;
      sample.forEach(function (r) { var v = r && r[c]; if (v == null || v === '') return; if (parseDate(v)) dates++; else if (M.parse(v) != null) nums++; else texts++; });
      if (g.date < 0 && dates >= sample.length / 2) g.date = c;
      else if (g.amount < 0 && nums >= sample.length / 2) g.amount = c;
      else if (g.desc < 0 && texts >= sample.length / 2) g.desc = c;
    }
    return g;
  }
  /* sign: 1 => tutarlar olduğu gibi (negatif gider), -1 => pozitifler gider (kredi kartı ekstresi gibi) */
  function rowsFromTable(rows, map, sign) {
    sign = sign || 1;
    var out = [];
    for (var i = map.headerRow + 1; i < rows.length; i++) {
      var r = rows[i] || [];
      if (!r.some(function (c) { return c != null && String(c).trim() !== ''; })) continue;
      var amount = null;
      var aw = [];
      if (map.amount >= 0) { var pi = M.parseInfo(typeof r[map.amount] === 'string' ? r[map.amount] : r[map.amount]); var a = pi.value; aw = pi.warnings; if (a != null) amount = a * sign; }
      if (amount == null && (map.debit >= 0 || map.credit >= 0)) {
        var d = map.debit >= 0 ? M.parse(r[map.debit]) : null, c = map.credit >= 0 ? M.parse(r[map.credit]) : null;
        if (d || c) amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
      }
      var rawDate = map.date >= 0 ? r[map.date] : null;
      var desc = map.desc >= 0 ? String(r[map.desc] == null ? '' : r[map.desc]).trim() : '';
      if (isTotalLine(desc) || (rawDate == null && amount == null)) continue;
      if (!parseDate(rawDate) && amount == null) continue;
      out.push({ date: parseDate(rawDate), rawDate: rawDate == null ? '' : String(rawDate), description: desc, amount: amount, source: 'tablo', amountWarn: aw.length ? aw : undefined });
    }
    return out;
  }
  function isTotalLine(s) { return /^(genel\s+)?toplam|^dönem borcu|^devreden|^önceki bakiye|^total/i.test(trLower(String(s || '')).trim()); }

  /* ---------- Serbest metin (PDF ekstre / OCR) satır ayrıştırma ----------
   * Satır başında tarih, satırda en az bir tutar olan satırları işlem sayar. Birden fazla tutar varsa ilki işlem tutarı,
   * sonuncusu bakiye olabilir (uyarı eklenir). */
  var AMOUNT_RE = /[-−+]?\(?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})\)?(?:\s?(?:TL|₺))?(?:\s?[-+BA](?![A-Za-zÇĞİÖŞÜçğıöşü]))?/g;
  var DATE_START_RE = /^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\.?\s+\d{4})/;
  function parseTextLines(text, sign) {
    sign = sign || 1;
    var lines = String(text || '').split(/\r?\n/), out = [], totals = [];
    lines.forEach(function (line) {
      var l = line.replace(/\s+/g, ' ').trim(); if (!l) return;
      var tl = trLower(l);
      var amtMatches = l.match(AMOUNT_RE) || [];
      if (/(genel toplam|toplam tutar|dönem borcu|toplam borç|^toplam|ödenecek tutar|toplam:)/.test(tl) && amtMatches.length) {
        var tv = M.parse(amtMatches[amtMatches.length - 1].replace(/\s/g, ''));
        if (tv != null) totals.push({ label: l.slice(0, 60), amount: Math.abs(tv) });
        return;
      }
      var dm = DATE_START_RE.exec(l); if (!dm) return;
      var date = parseDate(dm[1]); if (!date) return;
      var rest = l.slice(dm[0].length).trim();
      // ikinci bir tarih (valör) varsa atla
      var dm2 = DATE_START_RE.exec(rest); if (dm2 && parseDate(dm2[1])) rest = rest.slice(dm2[0].length).trim();
      var amts = [], re = new RegExp(AMOUNT_RE.source, 'g'), mm;
      while ((mm = re.exec(rest))) {
        var v = M.parse(mm[0].replace(/\s/g, ''));
        if (v != null && /[.,]\d{1,2}\)?(\s?(TL|₺))?(\s?[-+BA])?$/.test(mm[0].trim())) amts.push({ v: v, idx: mm.index, raw: mm[0] });
      }
      if (!amts.length) return;
      var first = amts[0];
      var desc = rest.slice(0, first.idx).trim().replace(/\s+[-–]\s*$/, '');
      var row = { date: date, rawDate: dm[1], description: desc, amount: first.v * sign, source: 'metin', rawLine: l };
      if (amts.length > 1) row.note = 'Satırda ' + amts.length + ' tutar var; ilki alındı (diğeri bakiye olabilir)';
      out.push(row);
    });
    return { rows: out, totals: totals };
  }

  /* ---------- Fiş (OCR metni) ayrıştırma ----------
   * Türk yazar kasa fişi düzeni: üstte işyeri + adres + tarih/saat, ortada "ÜRÜN  %KDV  *TUTAR" kalemleri,
   * altta TOPKDV / TOPLAM / ödeme şekli / KDV dökümü / Z-EKÜ-MERSİS. Kalemler ilk TOPKDV/TOPLAM satırına kadar okunur;
   * sonrası (ödeme, KDV tablosu) asla kalem sayılmaz. "2 AD X 22,50" gibi miktar satırları atlanır. */
  var CHAINS = [['bim', 'BİM'], ['a101', 'A101'], ['a 101', 'A101'], ['migros', 'Migros'], ['sok market', 'ŞOK'], ['sok marketler', 'ŞOK'], ['carrefour', 'CarrefourSA'],
    ['metro grosmarket', 'Metro'], ['macrocenter', 'Macrocenter'], ['file market', 'File'], ['hakmar', 'Hakmar'], ['onur market', 'Onur Market'], ['bizim toptan', 'Bizim Toptan'],
    ['happy center', 'Happy Center'], ['mopas', 'Mopaş'], ['kim market', 'Kim Market'], ['tarim kredi', 'Tarım Kredi'], ['gratis', 'Gratis'], ['watsons', 'Watsons'],
    ['rossmann', 'Rossmann'], ['eve ', 'EVE'], ['koctas', 'Koçtaş'], ['teknosa', 'Teknosa'], ['mediamarkt', 'MediaMarkt'], ['opet', 'Opet'], ['shell', 'Shell'],
    ['petrol ofisi', 'Petrol Ofisi'], ['total', 'Total'], ['bp ', 'BP'], ['eczane', 'Eczane'], ['starbucks', 'Starbucks'], ['burger king', 'Burger King'], ['mcdonald', "McDonald's"]];
  var MARKET_CHAINS = /^(BİM|A101|Migros|ŞOK|CarrefourSA|Metro|Macrocenter|File|Hakmar|Onur Market|Bizim Toptan|Happy Center|Mopaş|Kim Market|Tarım Kredi)$/;
  function asciiFold(s) { return fold(s).replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u'); }
  function cleanOcrLine(l) {
    return String(l).replace(/[\u2018\u2019\u201c\u201d`´]/g, "'").replace(/\s*[—–-]+\s*(?=\*)/g, ' ').replace(/[—–]/g, '-').replace(/\s+/g, ' ')
      // "57,:50" "57 ,50" "57. 50" → "57,50"
      .replace(/(\d)\s?([,.])\s?[:;']?\s?(\d{2})(?!\d)/g, '$1$2$3')
      // "*34 50" (virgül okunmamış, yıldızlı tutar) → "*34,50"
      .replace(/(\*\s?\d{1,6}) (\d{2})\s*$/, '$1,$2')
      // satır sonunda "TL" / "₺" / "#" gürültüsü
      .replace(/\s*(TL|₺|#)\s*$/i, '')
      .trim();
  }
  var RC_AMOUNT_END = /([-−]?\s?[*xX¥#]?\s?[-−]?(?:\d{1,3}(?:\.\d{3})+|\d{1,7}),\d{2}|[-−]?\s?[*¥#]?\s?[-−]?\d{1,7}\.\d{2})\s*$/;
  var RC_TOTAL = /^(genel )?t[o0]p(l|i|1)am\b|^(genel )?toplam|^tutar$|^odenecek|^toplam tutar/;
  var RC_STOP = /^(genel )?t[o0]p(l|i|1)am|^topkdv|^top ?kdv|^kdv ?top|^ara ?toplam|^toplam kdv|^kdv ?(orani|matrah|tutari)|^matrah/;
  var RC_SKIP = /(kdv|ara ?toplam|nakit|kredi|banka|kart|para ustu|degisim|fis ?no|z ?no|eku|mersis|vergi|v\.? ?d\.?|vkn|tckn|tel[:. ]|saat|iade|odenen|bakiye|puan|bonus|toplam|termin|onay|provizyon|batch|merchant|isyeri|tutar)/;
  var RC_QTY = /^\s*\d+([.,]\d+)?\s*(ad|adet|ad\.|kg|gr|g|lt|l|pk|pkt)?\s*[x×*]\s*\d/i;
  var RC_DATE = /(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{2,4})(?!\d)/;
  function detectMerchant(lines) {
    var head = lines.slice(0, 8);
    for (var i = 0; i < head.length; i++) {
      var a = ' ' + asciiFold(head[i]).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
      for (var j = 0; j < CHAINS.length; j++) {
        var k = CHAINS[j][0].trim();
        if (new RegExp('(^|\\s)' + k.replace(/ /g, '\\s?') + '(\\s|$)').test(a)) return { name: CHAINS[j][1], known: true };
      }
    }
    for (var n = 0; n < head.length; n++) { var t = head[n].replace(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9 .&'-]/g, '').trim(); if ((t.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length >= 3) return { name: t.slice(0, 40), known: false }; }
    return { name: '', known: false };
  }
  function findReceiptDate(lines) {
    // Önce "TARİH" yazan satır, sonra herhangi bir satır
    var ordered = lines.filter(function (l) { return /tar[i1l]h|tar\.|date/.test(asciiFold(l)); }).concat(lines);
    for (var i = 0; i < ordered.length; i++) {
      var re = new RegExp(RC_DATE.source, 'g'), m;
      while ((m = re.exec(ordered[i]))) { var d = parseDate(m[1] + '.' + m[2] + '.' + m[3]); if (d) return { date: d, raw: m[0] }; }
    }
    return { date: null, raw: '' };
  }
  /* Gölge/eğim yüzünden OCR fişi iki sütun gibi okuyabilir: önce k adet ürün adı, sonra k adet yalnız-tutar satırı.
   * Böyle ardışık blokları satır satır yeniden eşleştirir ("YUMURTA" + "S1 *45,00"). */
  function hasEndAmount(l) { return RC_AMOUNT_END.test(l); }
  function letterCount(s) { return (String(s).match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length; }
  function isAmountOnly(l) { var m = RC_AMOUNT_END.exec(l); return !!m && letterCount(l.slice(0, m.index)) < 2; }
  function isLabelOnly(l) { return !hasEndAmount(l) && letterCount(l) >= 2; }
  function pairColumns(lines) {
    var out = lines.slice(), i = 0;
    while (i < out.length) {
      if (!isAmountOnly(out[i])) { i++; continue; }
      var a0 = i; while (i < out.length && isAmountOnly(out[i])) i++;
      var k = i - a0, l1 = a0; while (l1 > 0 && isLabelOnly(out[l1 - 1])) l1--;
      var L = a0 - l1;
      if (k >= 2 && L >= k) {
        var labels = out.slice(a0 - k, a0), amts = out.slice(a0, i);
        var merged = labels.map(function (lab, j) { return lab + ' ' + amts[j]; });
        out.splice(a0 - k, 2 * k, merged[0]); out.splice.apply(out, [a0 - k + 1, 0].concat(merged.slice(1)));
        i = a0;
      }
    }
    return out;
  }
  function parseReceiptText(text) {
    var lines = pairColumns(String(text || '').split(/\r?\n/).map(cleanOcrLine).filter(Boolean));
    var mer = detectMerchant(lines), dt = findReceiptDate(lines);
    var date = dt.date, total = null, items = [], stopped = false, sawStar = false;
    lines.forEach(function (l) { if (/\*\s?\d+[.,]\d{2}\s*$/.test(l)) sawStar = true; });
    lines.forEach(function (l, idx) {
      var f = asciiFold(l).replace(/^[^a-z0-9%*]+/, '');
      var am = RC_AMOUNT_END.exec(l);
      var v = am ? M.parse(am[1].replace(/[*xX¥#\s]/g, '').replace('−', '-')) : null;
      if (RC_TOTAL.test(f) && !/(ara ?toplam|topkdv|kdv)/.test(f)) {
        if (v != null && (total == null || stopped === 'kdv')) total = Math.abs(v);
        stopped = true; return;
      }
      if (RC_STOP.test(f)) { if (!stopped) stopped = 'kdv'; return; }
      if (stopped) {
        // ARA TOPLAM ile TOPLAM arasındaki indirim satırları (Migros, A101 vb.) toplamı düşürür
        if (stopped === 'kdv' && v != null && v !== 0 && /(indirim|iskonto|kampanya)/.test(f) && !/(toplam|kdv)/.test(f)) {
          var dd = l.slice(0, am.index).replace(/[\s.*:_-]+$/, '').trim();
          items.push({ date: date, rawDate: dt.raw, description: dd.slice(0, 80) || 'İndirim', amount: Math.abs(v), source: 'OCR', rawLine: l, note: 'İndirim: toplamdan düşülür', lineNo: idx });
        }
        return;
      }
      if (v == null || v === 0) return;
      if (RC_QTY.test(l) && !/[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(l.replace(/\b(AD|ADET|KG|GR|LT|PK|PKT)\b/gi, ''))) return;
      if (RC_SKIP.test(f)) return;
      var desc = l.slice(0, am.index)
        .replace(/[\s&|¥$§#@(){}\[\]<>]+$/, '').replace(/\s+[%¥&]\s?\d{1,2}\s*$/, '').replace(/\s+(%|S|5|8|X|&|¥)\s?(0|1|8|10|18|20)\s*$/, '').replace(/[\s&|(){}\[\]<>]+$/, '').replace(/[*xX]\s*\d+([.,]\d+)?\s*$/, '')
        .replace(/\s+[&%¥$§#@|]+\d{0,2}$/, '').replace(/[\s.*:_|-]+$/, '').replace(/^[\s.*:_|-]+/, '').trim();
      var letters = (desc.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
      if (letters < 2) return;
      if (RC_DATE.test(desc) && desc.length < 14) return;
      // İndirim satırı tutarı azaltır
      var isDisc = /(indirim|iskonto|kampanya|ind\.)/.test(asciiFold(desc));
      // Yıldızlı tutar düzeni olan fişte yıldızsız satırlar şüphelidir: alınır ama not düşülür
      var star = /\*\s?[-−]?\d/.test(am[1]);
      items.push({ date: date, rawDate: dt.raw, description: desc.slice(0, 80), amount: isDisc ? Math.abs(v) : -Math.abs(v), source: 'OCR', rawLine: l,
        note: isDisc ? 'İndirim: toplamdan düşülür' : (sawStar && !star ? 'Kontrol et: tutar yıldızsız okundu' : '') , lineNo: idx });
    });
    // Çoğu kalemin sonunda aynı kısa sayı/simge varsa (KDV oranı "%1"in "5" okunması gibi) hepsinden at
    var tails = {}; items.forEach(function (it) { var m = /\s(\S{1,2})$/.exec(it.description); if (m && letterCount(m[1]) === 0) tails[m[1]] = (tails[m[1]] || 0) + 1; });
    Object.keys(tails).forEach(function (t) { if (tails[t] >= 2 && tails[t] >= items.length * 0.3) items.forEach(function (it) { if (it.description.slice(-t.length - 1) === ' ' + t) it.description = it.description.slice(0, -t.length - 1).trim(); }); });
    var category = mer.known && MARKET_CHAINS.test(mer.name) ? 'Market' : null;
    items.forEach(function (it) { if (!it.date) it.date = date; if (mer.name) it.merchant = mer.name; if (category) it.category = category; });
    var itemsSum = items.reduce(function (s, it) { return s - it.amount; }, 0);
    return { rows: items, docTotal: total, date: date, rawDate: dt.raw, merchant: mer.name, merchantKnown: mer.known, category: category,
      itemsSum: itemsSum, matches: total != null && itemsSum === total };
  }
  /* Fişten satır çıkmazsa veya kalem toplamı tutmazsa kullanıcıya her zaman düzenlenebilir bir satır bırak. */
  function receiptFallbackRows(rec, todayYmd) {
    var desc = (rec.merchant ? rec.merchant + ' alışverişi' : 'Fiş alışverişi');
    var fromDoc = rec.docTotal != null;
    return [{ date: rec.date || todayYmd || null, rawDate: rec.rawDate || '', description: desc,
      amount: fromDoc ? -Math.abs(rec.docTotal) : null, source: 'OCR', category: rec.category || null,
      note: fromDoc ? 'Fişteki TOPLAM’dan — kalemlerin tek tek toplamı değil' : 'Tutarı fişten bakıp yaz',
      manual: !fromDoc, fromDocTotal: fromDoc }];
  }

  /* ---------- Toplam kontrolü ---------- */
  /* opts.expectExpenses: belge harcama belgesi (kart ekstresi / fiş). Bu durumda Transfer dışı gelir satırları giderlerden fazlaysa
   * işaretler şüphelidir (ör. harcamalar gelir sayılmış): "Tutuyor" asla gösterilmez. */
  function totalsCheck(rows, docTotal, opts) {
    opts = opts || {};
    var sel = rows.filter(function (r) { return r.include && Number.isInteger(r.amount); });
    var income = 0, expense = 0, rowSum = 0;
    sel.forEach(function (r) {
      rowSum = M.add(rowSum, r.amount);
      if (r.amount >= 0) income = M.add(income, r.amount); else expense = M.add(expense, -r.amount);
    });
    // computed daima seçili satırlardan gelir; belgedeki toplam asla buraya kopyalanmaz.
    // Karışık gelir/giderde belgedeki toplama en yakın olan (gider toplamı veya net) gösterilir.
    var net = M.sub(income, expense);
    var absNet = net < 0 ? -net : net;
    var computed, computedIsNet = false;
    if (income === 0 || expense === 0) computed = expense > 0 ? expense : income;
    else if (docTotal != null) {
      var adExp = expense >= docTotal ? M.sub(expense, docTotal) : M.sub(docTotal, expense);
      var adNet = absNet >= docTotal ? M.sub(absNet, docTotal) : M.sub(docTotal, absNet);
      // Net yalnızca gerçekten daha yakınsa (en fazla yarısı kadar fark) veya birebir tutuyorsa gösterilir.
      computedIsNet = adNet === 0 || (adNet < adExp && adNet * 2 <= adExp);
      computed = computedIsNet ? absNet : expense;
    } else { computed = absNet; computedIsNet = true; }
    var res = { count: sel.length, income: income, expense: expense, net: net, rowSum: rowSum, computed: computed,
      computedIsNet: computedIsNet, fromDocTotal: sel.filter(function (r) { return r.fromDocTotal; }).length };
    if (docTotal != null) {
      // Belge toplamı ya giderlerin toplamıdır ya da (kart ekstresinde ödemeler düşülmüş) net tutardır; ikisinden biri tutarsa doğru.
      var cmp = expense > 0 ? expense : income;
      var d1 = M.sub(cmp, docTotal), d2 = M.sub(absNet, docTotal);
      res.docTotal = docTotal; res.match = d1 === 0 || (income > 0 && expense > 0 && d2 === 0);
      res.diff = res.match ? 0 : M.sub(computed, docTotal); res.byNet = d1 !== 0 && res.match;
    }
    if (opts.expectExpenses && sel.length) {
      // Şüpheli işaret: gelir görünen (Transfer dışı) satırlar giderden çok/fazla, ya da kart ödemesi ("ödeme - teşekkür") eksi yazılmış
      var ntInc = 0, posN = 0, negN = 0, payNeg = false;
      sel.forEach(function (r) { if (r.amount > 0 && r.category !== 'Transfer') { ntInc = M.add(ntInc, r.amount); posN++; } else if (r.amount < 0) { negN++; if (isCardPayment(r.description)) payNeg = true; } });
      if ((ntInc > 0 && ntInc >= expense) || (posN > negN) || payNeg) res.suspicious = 'Bu bir harcama belgesi (kart ekstresi/fiş) ama satırların çoğu GELİR görünüyor. Harcamalar eksi (−) olmalı. "Seçililerde gelir ↔ gider çevir" ile düzelt.';
    }
    if (res.suspicious) { res.matchRaw = res.match; res.match = false; }
    return res;
  }

  /* ---------- Yapay zekâdan gelen JSON'u satırlara çevir ---------- */
  function rowsFromAiJson(text) {
    var s = String(text || '');
    var start = s.indexOf('{'), startArr = s.indexOf('[');
    var obj = null;
    var cand = [];
    if (start >= 0) cand.push(s.slice(start, s.lastIndexOf('}') + 1));
    if (startArr >= 0) cand.push(s.slice(startArr, s.lastIndexOf(']') + 1));
    for (var i = 0; i < cand.length && !obj; i++) { try { obj = JSON.parse(cand[i]); } catch (e) { /* devam */ } }
    if (!obj) throw new Error('Yapay zekâ yanıtı JSON olarak okunamadı');
    var list = Array.isArray(obj) ? obj : (obj.transactions || obj.items || obj.islemler || []);
    var rows = list.map(function (t) {
      var amt = M.parse(t.amount != null ? t.amount : t.tutar);
      var type = trLower(t.type || t.tur || '');
      if (amt != null && amt > 0 && /(gider|expense|harcama|debit|borç)/.test(type)) amt = -amt;
      return { date: parseDate(t.date || t.tarih || obj.date || obj.tarih), rawDate: String(t.date || t.tarih || obj.date || ''), description: String(t.description || t.aciklama || t.açıklama || t.name || '').trim(),
        amount: amt, source: 'yapay zekâ' };
    });
    var total = obj.total != null ? M.parse(obj.total) : (obj.toplam != null ? M.parse(obj.toplam) : null);
    return { rows: rows, docTotal: total != null ? Math.abs(total) : null, merchant: obj.merchant || obj.isyeri || '' };
  }

  return { parseDate: parseDate, suggestCategory: suggestCategory, CATEGORIES: CATEGORIES, markDuplicates: markDuplicates, dupKey: dupKey,
    validateRow: validateRow, detectCardStatement: detectCardStatement, looksPositiveExpenses: looksPositiveExpenses, isCardPayment: isCardPayment, stripInstallment: stripInstallment, detectColumns: detectColumns, rowsFromTable: rowsFromTable, parseTextLines: parseTextLines, totalsCheck: totalsCheck,
    rowsFromAiJson: rowsFromAiJson, parseReceiptText: parseReceiptText, receiptFallbackRows: receiptFallbackRows, cleanOcrLine: cleanOcrLine, fold: fold, trLower: trLower, isValidYmd: isValidYmd };
});
