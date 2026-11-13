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
  function suggestCategory(desc, amount) {
    var d = ' ' + fold(desc) + ' ';
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var rule = CATEGORY_RULES[i];
      if (rule[0] === 'Gelir' && amount < 0) continue;
      for (var j = 0; j < rule[1].length; j++) if (d.indexOf(fold(rule[1][j])) >= 0) return rule[0];
    }
    return amount > 0 ? 'Gelir' : 'Diğer';
  }

  /* ---------- Mükerrer tespiti (aynı tarih + aynı tutar + aynı açıklama) ---------- */
  function normDesc(s) { return fold(s).replace(/[^a-z0-9çğıöşü]+/g, ' ').trim(); }
  function dupKey(t) { return (t.date || '') + '|' + t.amount + '|' + normDesc(t.description); }
  function markDuplicates(rows, existing) {
    var seen = {};
    (existing || []).forEach(function (t) { seen[dupKey(t)] = 'existing'; });
    rows.forEach(function (r) {
      var k = dupKey(r);
      if (seen[k] === 'existing') r.duplicate = 'Kayıtlı bir işlemle aynı (tarih+tutar+açıklama)';
      else if (seen[k] === 'batch') r.duplicate = 'Bu dosyada aynı satır birden fazla var';
      else { r.duplicate = null; seen[k] = 'batch'; }
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
      if (map.amount >= 0) { var a = M.parse(r[map.amount]); if (a != null) amount = a * sign; }
      if (amount == null && (map.debit >= 0 || map.credit >= 0)) {
        var d = map.debit >= 0 ? M.parse(r[map.debit]) : null, c = map.credit >= 0 ? M.parse(r[map.credit]) : null;
        if (d || c) amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
      }
      var rawDate = map.date >= 0 ? r[map.date] : null;
      var desc = map.desc >= 0 ? String(r[map.desc] == null ? '' : r[map.desc]).trim() : '';
      if (isTotalLine(desc) || (rawDate == null && amount == null)) continue;
      if (!parseDate(rawDate) && amount == null) continue;
      out.push({ date: parseDate(rawDate), rawDate: rawDate == null ? '' : String(rawDate), description: desc, amount: amount, source: 'tablo' });
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
   * Tarih metnin herhangi bir yerinde olabilir; kalemler satır sonunda tutar olan satırlardır. KDV/ara toplam/ödeme satırları atlanır. */
  var RECEIPT_SKIP = /(kdv|topkdv|ara ?toplam|toplam|nakit|kredi|kart|para üstü|para ustu|değişim|degisim|fiş no|fis no|z no|ekü|eku|mersis|vergi|v\.d|tel[:. ]|saat|iade tutar|indirim toplam|ödenen|odenen|bakiye|puan)/;
  function parseReceiptText(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) {
      // Sık OCR gürültüsü: "57,:50" → "57,50", "57 ,50" → "57,50"
      return l.replace(/\s+/g, ' ').replace(/(\d)\s?([,.])\s?[:;']?\s?(\d{2})(?!\d)/g, '$1$2$3').trim();
    }).filter(Boolean);
    var date = null, total = null, items = [], merchant = lines.length ? lines[0].slice(0, 60) : '';
    var dre = /(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/;
    lines.forEach(function (l) {
      var f = fold(l);
      if (!date) { var dm = dre.exec(l); if (dm && parseDate(dm[1])) date = parseDate(dm[1]); }
      var am = /([-−]?\*?\s?(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2})\s*(?:TL|₺)?\s*$/.exec(l);
      if (!am) return;
      var v = M.parse(am[1].replace(/[*\s]/g, ''));
      if (v == null) return;
      if (/(^|\s)(genel )?toplam/.test(f) && !/(ara ?toplam|topkdv|kdv)/.test(f)) { if (total == null || Math.abs(v) > total) total = Math.abs(v); return; }
      if (RECEIPT_SKIP.test(f)) return;
      var desc = l.slice(0, am.index).replace(/[*xX]\s*\d+([.,]\d+)?\s*$/, '').replace(/\s+(%|S|5)\s?(1|8|10|18|20)\s*$/, '').replace(/%\s*\d+\s*$/, '').trim();
      if (!desc || dre.test(desc) && desc.length < 12) return;
      items.push({ date: date, rawDate: '', description: desc, amount: -Math.abs(v), source: 'OCR' });
    });
    items.forEach(function (it) { if (!it.date) it.date = date; });
    return { rows: items, docTotal: total, date: date, merchant: merchant };
  }

  /* ---------- Toplam kontrolü ---------- */
  function totalsCheck(rows, docTotal) {
    var sel = rows.filter(function (r) { return r.include && Number.isInteger(r.amount); });
    var income = 0, expense = 0;
    sel.forEach(function (r) { if (r.amount >= 0) income = M.add(income, r.amount); else expense = M.add(expense, -r.amount); });
    var res = { count: sel.length, income: income, expense: expense, net: M.sub(income, expense) };
    if (docTotal != null) {
      // Belge toplamı ya giderlerin toplamıdır ya da (kart ekstresinde ödemeler düşülmüş) net tutardır; ikisinden biri tutarsa doğru.
      var cmp = expense > 0 ? expense : income, absNet = res.net < 0 ? -res.net : res.net;
      var d1 = M.sub(cmp, docTotal), d2 = M.sub(absNet, docTotal);
      res.docTotal = docTotal; res.match = d1 === 0 || (income > 0 && expense > 0 && d2 === 0);
      res.diff = res.match ? 0 : d1; res.byNet = d1 !== 0 && res.match;
    }
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
    validateRow: validateRow, detectColumns: detectColumns, rowsFromTable: rowsFromTable, parseTextLines: parseTextLines, totalsCheck: totalsCheck,
    rowsFromAiJson: rowsFromAiJson, parseReceiptText: parseReceiptText, fold: fold, trLower: trLower, isValidYmd: isValidYmd };
});
