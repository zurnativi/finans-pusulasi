/* history.js — v8.4: Değişiklik geçmişi (denetim izi) ve geri alma.
 * Her kayıt değişikliğinde (mutate) önceki ve sonraki hâl karşılaştırılır; eklenen / silinen / değişen kayıtlar alan alan
 * (eski → yeni) saklanır. Herhangi bir geçmiş kayıt tek tek geri alınabilir; geri alma yalnızca o alanlar o kayıttan beri
 * değişmediyse yapılır (çakışma varsa hiçbir şey değişmez, açıkça söylenir). Geri alınan hâl yine tam doğrulamadan geçer
 * (ör. alış silmenin geri alınması sonraki satışı aşırı yapıyorsa reddedilir). Geçmiş yalnızca bu cihazda tutulur. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChangeLog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LISTS = {
    trades: 'Alım-satım', transactions: 'İşlem', transfers: 'Transfer', installments: 'Taksit', recurring: 'Düzenli ödeme',
    assets: 'Varlık', accounts: 'Hesap', goals: 'Hedef', incomes: 'Gelir', expenses: 'Gider', debts: 'Borç', sinkingFunds: 'Yıllık gider'
  };
  var MAX_ENTRIES = 300, MAX_CHANGES = 60;
  /* Türetilen / iç alanlar: geçmişe yazılmaz (ör. alım-satımla izlenen varlığın değeri fiyattan hesaplanır) */
  function skipField(list, rec, f) {
    if (f.charAt(0) === '_' || f === 'editedAt') return true;
    if (list === 'assets' && rec && rec.tracking === 'trades' && (f === 'value' || f === 'valueBasis')) return true;
    return false;
  }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function getF(rec, f) { var p = f.split('.'); return p.length === 2 ? (isObj(rec[p[0]]) ? rec[p[0]][p[1]] : undefined) : rec[f]; }
  function setF(rec, f, v) { var p = f.split('.'); if (p.length === 2) { if (!isObj(rec[p[0]])) rec[p[0]] = {}; if (v === undefined) delete rec[p[0]][p[1]]; else rec[p[0]][p[1]] = v; } else if (v === undefined) delete rec[f]; else rec[f] = v; }
  function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function byId(arr) { var m = {}; (Array.isArray(arr) ? arr : []).forEach(function (x, i) { if (x && x.id != null) m[x.id] = { rec: x, i: i }; }); return m; }
  function labelOf(list, rec, state) {
    if (!rec) return '';
    if (list === 'trades') {
      var a = state && (state.assets || []).find(function (x) { return x.id === rec.assetId; });
      var side = { buy: 'alış', sell: 'satış', div: 'temettü', split: 'bedelsiz', rights: 'bedelli' }[rec.side] || rec.side;
      return (a ? String(a.symbol || a.name).slice(0, 40) : '?') + ' ' + side + ' ' + (rec.date || '');
    }
    if (list === 'transfers') return 'Transfer ' + (rec.date || '');
    if (list === 'transactions') return (rec.description || 'İşlem') + ' ' + (rec.date || '');
    return String(rec.name || rec.description || rec.id || '').slice(0, 80);
  }
  /* Önceki ve sonraki durum arasındaki kayıt farkları */
  function diff(before, after) {
    var out = [];
    if (!before || !after) return out;
    Object.keys(LISTS).forEach(function (list) {
      var b = byId(before[list]), a = byId(after[list]);
      Object.keys(b).forEach(function (id) {
        if (!a[id]) { out.push({ list: list, id: id, op: 'del', label: labelOf(list, b[id].rec, before), rec: clone(b[id].rec), index: b[id].i }); return; }
        var ob = b[id].rec, nb = a[id].rec, fields = [];
        var keys = {}; Object.keys(ob).concat(Object.keys(nb)).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).forEach(function (f) {
          if (skipField(list, nb, f) || same(ob[f], nb[f])) return;
          if (isObj(ob[f]) && isObj(nb[f])) { // iç içe nesne (ör. kart bilgileri): alt alan alan yazılır ("card.paid")
            var sk = {}; Object.keys(ob[f]).concat(Object.keys(nb[f])).forEach(function (k) { sk[k] = 1; });
            Object.keys(sk).forEach(function (k) { if (!same(ob[f][k], nb[f][k])) fields.push({ f: f + '.' + k, old: clone(ob[f][k]), new: clone(nb[f][k]) }); });
          } else fields.push({ f: f, old: clone(ob[f]), new: clone(nb[f]) });
        });
        if (fields.length) out.push({ list: list, id: id, op: 'edit', label: labelOf(list, nb, after), fields: fields });
      });
      Object.keys(a).forEach(function (id) { if (!b[id]) out.push({ list: list, id: id, op: 'add', label: labelOf(list, a[id].rec, after), rec: clone(a[id].rec), index: a[id].i }); });
    });
    return out;
  }
  /* Geçmiş kaydı: çok büyük toplu değişikliklerde (ör. yedek geri yükleme) yalnızca sayılar tutulur, tek tek geri alınamaz */
  function makeEntry(changes, msg, at) {
    var e = { id: 'h' + Date.parse(at || new Date().toISOString()).toString(36) + Math.random().toString(36).slice(2, 6), at: at || new Date().toISOString(), msg: String(msg || '').slice(0, 200) };
    if (changes.length > MAX_CHANGES) {
      var counts = {}; changes.forEach(function (c) { var k = c.list + ':' + c.op; counts[k] = (counts[k] || 0) + 1; });
      e.bulk = true; e.counts = counts; e.n = changes.length;
    } else e.changes = changes;
    return e;
  }
  function push(log, entry) { var l = (Array.isArray(log) ? log : []).concat([entry]); return l.length > MAX_ENTRIES ? l.slice(l.length - MAX_ENTRIES) : l; }
  /* Bir geçmiş kaydını geri alır (yerinde, state üzerinde). Çakışmada hiçbir şey değiştirmeden hata fırlatır. */
  function revert(state, entry) {
    if (!entry || entry.bulk || !Array.isArray(entry.changes)) throw new Error('Bu toplu değişiklik tek tek geri alınamaz; Ayarlar → Otomatik kopyalar\'dan önceki hâle dönebilirsin.');
    if (entry.reverted) throw new Error('Bu değişiklik zaten geri alındı.');
    var conflicts = [];
    entry.changes.forEach(function (c) {
      var arr = state[c.list] || [], cur = arr.find(function (x) { return x.id === c.id; });
      if (c.op === 'add') { if (cur && !same(stripSkip(c.list, cur), stripSkip(c.list, c.rec))) conflicts.push(LISTS[c.list] + ' "' + c.label + '" eklendikten sonra değişmiş'); }
      else if (c.op === 'del') { if (cur) conflicts.push(LISTS[c.list] + ' "' + c.label + '" zaten yeniden var'); }
      else if (c.op === 'edit') {
        if (!cur) conflicts.push(LISTS[c.list] + ' "' + c.label + '" artık yok (silinmiş)');
        else c.fields.forEach(function (fd) { if (!same(getF(cur, fd.f), fd.new)) conflicts.push(LISTS[c.list] + ' "' + c.label + '" → ' + fd.f + ' sonradan yeniden değişmiş'); });
      }
    });
    if (conflicts.length) throw new Error('Geri alınamadı, çünkü kayıt sonradan değişti: ' + conflicts.slice(0, 3).join('; ') + '. Önce daha yeni değişiklikleri geri al.');
    entry.changes.slice().reverse().forEach(function (c) {
      if (!Array.isArray(state[c.list])) state[c.list] = [];
      var arr = state[c.list];
      if (c.op === 'add') state[c.list] = arr.filter(function (x) { return x.id !== c.id; });
      else if (c.op === 'del') { var i = Math.max(0, Math.min(arr.length, c.index != null ? c.index : arr.length)); arr.splice(i, 0, clone(c.rec)); }
      else if (c.op === 'edit') { var cur = arr.find(function (x) { return x.id === c.id; }); c.fields.forEach(function (fd) { setF(cur, fd.f, clone(fd.old)); }); }
    });
    return entry.changes.length;
  }
  function stripSkip(list, rec) { var o = {}; Object.keys(rec || {}).forEach(function (k) { if (!skipField(list, rec, k)) o[k] = rec[k]; }); return o; }
  /* Ekranda okunur alan adları */
  var FIELD = {
    date: 'tarih', description: 'açıklama', amount: 'tutar', category: 'kategori', accountId: 'hesap', name: 'ad', qty: 'adet', price: 'fiyat', fee: 'toplam komisyon/masraf',
    feeParts: 'komisyon kırılımı', side: 'işlem türü', fxRate: 'kur', note: 'not', balance: 'bakiye', total: 'toplam', count: 'taksit sayısı', firstYm: 'ilk ay', cardId: 'kart',
    target: 'hedef tutar', targetYm: 'hedef ay', shareBp: 'pay', withholding: 'stopaj', ratioBp: 'oran', fromId: 'nereden', toId: 'nereye', amountFrom: 'giden tutar', amountTo: 'gelen tutar',
    active: 'aktif', day: 'gün', freq: 'sıklık', startYm: 'başlangıç', endYm: 'bitiş', risk: 'risk', emergency: 'acil fon', priceKey: 'fiyat kaynağı', symbol: 'sembol', type: 'tür',
    direction: 'yön', inNetWorth: 'net varlığa say', card: 'kart bilgileri', paidApplied: 'ödemeye sayılan', edited: 'düzeltme izi'
  };
  var SUB = { paid: 'ödenen', statementDebt: 'ekstre borcu', limit: 'limit', statementDay: 'kesim günü', dueDay: 'son ödeme günü', statementYm: 'ekstre ayı', remindDays: 'hatırlatma', commission: 'komisyon', tax: 'BSMV/vergi', other: 'diğer masraf' };
  function fieldLabel(f) { var p = String(f).split('.'); if (p.length === 2) return (FIELD[p[0]] || p[0]) + ' → ' + (SUB[p[1]] || p[1]); return FIELD[f] || f; }
  return { LISTS: LISTS, MAX_ENTRIES: MAX_ENTRIES, MAX_CHANGES: MAX_CHANGES, diff: diff, makeEntry: makeEntry, push: push, revert: revert, fieldLabel: fieldLabel, labelOf: labelOf };
});
