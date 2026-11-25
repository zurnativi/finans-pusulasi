/* inbox.js — v8.7.0 "Uzaktan düzenleme kutusu". Tarayıcıda ve Node'da AYNI kod çalışır (saf mantık, testli).
 * Akış: düzenleme (bu biçimde JSON) kutu tarafında FINANS_INBOX_KEY ile şifrelenip gizli Gist'e (finans-inbox.box.enc.json) konur →
 * market-portfolio iş akışı onu çözüp cihazın anahtarıyla (PORTFOLIO_KEY) yeniden şifreler ve market-data dalına bg/inbox.enc.json olarak yazar →
 * uygulama açılınca/arka planda okur, daha önce uygulanmadıysa önce otomatik kopya alır, sonra uygular ("Geri al" açık) → uygulandı bilgisi
 * cihazın şifreli yüküne girer → iş akışı onu bg/inbox-ack.enc.json olarak (FINANS_INBOX_KEY ile şifreli) yazar.
 * Bu dosyada sır yok. Desteklenen işlemler: broker-replace (🏦 Aracı kurum geçmişini uygula ile aynı mantık), asset-set (ad / helal etiketi / risk). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio.js'));
  else root.Inbox = factory(root.Portfolio);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';
  var FORMAT = 'finans-pusulasi-duzenleme', VERSION = 1, GIST_FILE = 'finans-inbox.box.enc.json', PATH = 'bg/inbox.v2.enc.json', LEGACY_PATH = 'bg/inbox.enc.json', ACK_PATH = 'bg/inbox-ack.enc.json';
  var ID_RE = /^[A-Za-z0-9._:-]{4,80}$/, MAX_OPS = 50, KEEP_ACK = 20;
  var RISKS = { safe: 1, medium: 1, risky: 1 };
  var OPS = { 'holdings-wipe': 1, 'broker-replace': 1, 'asset-set': 1 }; // v8.7.1: holdings-wipe (Tüm varlıkları temizle ile aynı: bütçe durur)
  var APP_VERSION = '8.8.1';

  function str(x, n) { return typeof x === 'string' && x.length <= n; }
  function findAsset(state, sym) { var f = PF.fold(sym); return (state.assets || []).filter(function (a) { return a && a.symbol && PF.fold(a.symbol) === f; })[0] || null; }

  /* Biçim denetimi (duruma bakmadan). Hata listesi döner; boşsa biçim doğru. */
  function errors(edit) {
    var e = [];
    if (!edit || typeof edit !== 'object' || edit.format !== FORMAT) return ['Düzenleme biçimi tanınmadı'];
    if (edit.version !== VERSION) e.push('Desteklenmeyen düzenleme sürümü: ' + edit.version);
    if (typeof edit.id !== 'string' || !ID_RE.test(edit.id)) e.push('Düzenleme numarası hatalı');
    if (edit.title != null && !str(edit.title, 120)) e.push('Başlık hatalı');
    if (!Array.isArray(edit.ops) || !edit.ops.length || edit.ops.length > MAX_OPS) { e.push('İşlem listesi boş veya çok uzun'); return e; }
    edit.ops.forEach(function (op, i) {
      var n = 'İşlem ' + (i + 1);
      if (!op || !OPS[op.op]) { e.push(n + ': bilinmeyen işlem'); return; }
      if (op.op === 'holdings-wipe') { if (i !== 0) e.push(n + ': tüm varlıkları temizle yalnız ilk işlem olabilir'); if (Object.keys(op).some(function (k) { return k !== 'op'; })) e.push(n + ': temizleme işlemi ek alan almaz'); return; }
      if (op.op === 'broker-replace') { PF.brokerFileErrors(op.file).slice(0, 5).forEach(function (m) { e.push(n + ': ' + m); }); return; }
      if (op.op === 'asset-set') {
        if (!str(op.symbol, 12) || !op.symbol) e.push(n + ': sembol hatalı');
        var s = op.set; if (!s || typeof s !== 'object' || !Object.keys(s).length) { e.push(n + ': değiştirilecek alan yok'); return; }
        Object.keys(s).forEach(function (k) {
          if (k === 'name') { if (!str(s.name, 80) || !s.name.trim()) e.push(n + ': ad hatalı'); }
          else if (k === 'risk') { if (!RISKS[s.risk]) e.push(n + ': risk hatalı'); }
          else if (k === 'halal') {
            var h = s.halal; if (!h || typeof h !== 'object' || !PF.HALAL[h.status]) e.push(n + ': helal etiketi hatalı');
            else if ((h.note != null && !str(h.note, 300)) || (h.source != null && !str(h.source, 120)) || (h.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(h.date))) e.push(n + ': helal etiketi ayrıntısı hatalı');
          } else e.push(n + ': bu alan değiştirilemez (' + String(k).slice(0, 20) + ')');
        });
      }
    });
    return e;
  }

  /* Uygula: state yerinde değişir; hata olursa fırlatır (çağıran önceki hâle döner). Türkçe özet satırları döner. */
  function apply(state, edit, uid) {
    var e = errors(edit); if (e.length) throw new Error(e.slice(0, 3).join(' · '));
    if (state.isExample) throw new Error('Uygulamada örnek veri var; düzenleme gerçek veriye uygulanır');
    var lines = [];
    edit.ops.forEach(function (op) {
      if (op.op === 'holdings-wipe') {
        var w = PF.wipeHoldings(state);
        lines.push('Tüm varlıklar temizlendi: ' + w.assets + ' varlık, ' + w.trades + ' alım-satım, ' + w.stops + ' stop, ' + w.alerts + ' uyarı silindi; bütçe duruyor');
      } else if (op.op === 'broker-replace') {
        var p = PF.applyBrokerImport(state, op.file, uid), open = p.rows.filter(function (r) { return r.open; });
        lines.push(p.broker + ': ' + p.trades + ' alım-satım, ' + p.rows.length + ' varlık (' + p.added + ' yeni, ' + p.replaced + ' güncellendi), ' + open.length + ' açık pozisyon' + (p.kept.length ? '; ' + p.kept.length + ' varlık dokunulmadı' : ''));
      } else if (op.op === 'asset-set') {
        var a = findAsset(state, op.symbol); if (!a) throw new Error(op.symbol + ': varlık bulunamadı');
        var ch = [];
        if (op.set.name != null) { a.name = op.set.name.trim(); ch.push('ad'); }
        if (op.set.risk != null) { a.risk = op.set.risk; ch.push('risk'); }
        if (op.set.halal != null) { var h = op.set.halal; a.halal = { status: h.status, note: h.note || '', source: h.source || '', date: h.date || null }; ch.push('helal: ' + PF.HALAL[h.status].label); }
        lines.push(a.symbol + ': ' + ch.join(', '));
      }
    });
    return lines;
  }
  /* Önizleme: kopyada dener, durum değişmez. */
  function preview(state, edit, uid) {
    var c = JSON.parse(JSON.stringify(state));
    try { return { ok: true, lines: apply(c, edit, uid || function () { return 'p' + Math.random().toString(36).slice(2); }) }; } catch (x) { return { ok: false, error: String(x.message || x).slice(0, 300) }; }
  }
  /* Cihazdaki "uygulandı" kayıtları (en yeni sonda, en çok 20). Yüke yalnız bu kısa liste girer. */
  function ackList(list) {
    return (Array.isArray(list) ? list : []).filter(function (a) { return a && typeof a.id === 'string' && ID_RE.test(a.id); }).slice(-KEEP_ACK).map(function (a) {
      return { id: a.id, at: String(a.at || '').slice(0, 30), ok: !!a.ok, lines: (a.lines || []).slice(0, 10).map(function (l) { return String(l).slice(0, 300); }), error: a.error ? String(a.error).slice(0, 300) : null, undone: !!a.undone, ver: a.ver ? String(a.ver).slice(0, 12) : null };
    });
  }
  function seen(list, id) { return (list || []).some(function (a) { return a && a.id === id; }); }
  /* Yeniden denenmez mi? Başarılı kayıt ya da AYNI sürümde başarısız kayıt varsa evet (eski sürümün tanımadığı işlem yeni sürümde yeniden denenir). */
  function done(list, id, ver) { return (list || []).some(function (a) { return a && a.id === id && (a.ok || a.ver === (ver || APP_VERSION)); }); }
  function record(list, rec) { var l = ackList(list).filter(function (a) { return a.id !== rec.id; }); l.push(rec); return ackList(l); }

  return { FORMAT: FORMAT, VERSION: VERSION, GIST_FILE: GIST_FILE, PATH: PATH, LEGACY_PATH: LEGACY_PATH, ACK_PATH: ACK_PATH, APP_VERSION: APP_VERSION, done: done, ID_RE: ID_RE, errors: errors, apply: apply, preview: preview, ackList: ackList, seen: seen, record: record };
});
