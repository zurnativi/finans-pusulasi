/* v8.2 testleri: arka plan portföy izleme — şifreleme (AES-256-GCM, dolgu, kurcalama), kurulum dizgesi, yük sadeleştirme (gizlilik + hesap eşitliği),
 * kontrol motoru (örnek veri, tekilleştirme, eski yük), iş betiği (sahte Gist + yerel ntfy sunucusu; günlükte düz metin/sır yok), publish.py yalnız bg/ + silme.
 * Çalıştırma: node tests/run-tests-v82.js (run-tests.js de çalıştırır). Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), cp = require('child_process');
  var BG = require('../js/bgwatch.js'), S = require('../js/sample.js'), AN = require('../js/analysis.js'), NT = require('../js/notify.js'), SN = require('../js/snapshot.js');
  var ROOT = path.join(__dirname, '..'), tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function rejects(p, code, msg) { return p.then(function () { throw new Error(msg || 'hata bekleniyordu'); }, function (e) { if (code && e.code !== code) throw new Error((msg || '') + ' kod ' + e.code + ' ≠ ' + code + ': ' + e.message); return e; }); }
  var NOW = Date.parse('2026-11-18T09:00:00Z'), TODAY = BG.tsiYmd(NOW), YM = TODAY.slice(0, 7);
  function example() { return S.exampleState(YM, TODAY); }
  function personal() { // örnek olmayan, kişisel veri taşıyan sentetik durum (sızıntı testleri için)
    var s = example(); s.isExample = false; s.nwExample = false; s.exampleRevision = undefined;
    s.transactions.push({ id: 'zz1', date: TODAY, amount: 123400, desc: 'GİZLİ-HARCAMA-AÇIKLAMASI', accountId: s.accounts[0].id, cat: 'market' });
    s.trades.forEach(function (t) { t.note = 'GİZLİ-İŞLEM-NOTU'; });
    s.installments.forEach(function (t) { t.description = 'GİZLİ-TAKSİT'; });
    s.incomes.forEach(function (x) { x.name = 'GİZLİ-GELİR-ADI'; }); s.expenses.forEach(function (x) { x.name = 'GİZLİ-GİDER-ADI'; });
    s._sync = { token: 'ghp_GIZLITOKEN', gistId: 'abc' };
    return s;
  }
  function secretSet(key, gist, topic) { return BG.makeSetup({ key: key, gist: gist, topic: topic }); }
  var GID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  /* ---------- 1. Şifreleme ---------- */
  test('Şifreleme: AES-GCM gidiş-dönüş, her seferinde farklı iv, doğru anahtar gerekli', function () {
    var key = BG.newKey(), obj = { a: 1, b: 'çğıöşü ₺', arr: [1, 2, 3] }; ok(key.length === 32);
    return BG.kidOf(key).then(function (kid) { return Promise.all([BG.seal(key, obj, kid), BG.seal(key, obj, kid)]).then(function (e) {
      ok(e[0].iv !== e[1].iv && e[0].ct !== e[1].ct, 'iv/şifreli metin farklı olmalı'); eq(e[0].format, 'finans-pusulasi-bg');
      return BG.open(key, e[0]).then(function (o) { eq(o, obj); return rejects(BG.open(BG.newKey(), e[0]), 'BAD_KEY', 'yanlış anahtar'); });
    }); });
  });
  test('Şifreleme: kurcalama (ct, iv, kid/AAD) ve biçim hataları reddedilir', function () {
    var key = BG.newKey(); return BG.kidOf(key).then(function (kid) { return BG.seal(key, { x: 1 }, kid).then(function (e) {
      var t1 = Object.assign({}, e, { ct: e.ct.slice(0, 10) + (e.ct[10] === 'A' ? 'B' : 'A') + e.ct.slice(11) }), t2 = Object.assign({}, e, { kid: '0000000000000000' }), t3 = Object.assign({}, e, { iv: e.iv.replace(/^./, e.iv[0] === 'A' ? 'B' : 'A') });
      return Promise.all([rejects(BG.open(key, t1), 'BAD_KEY'), rejects(BG.open(key, t2), 'BAD_KEY'), rejects(BG.open(key, t3), 'BAD_KEY'), rejects(BG.open(key, { format: 'x' })), rejects(BG.open(key, null))]);
    }); });
  });
  test('Şifreleme: zarf boyutu 16 KiB kademeli (portföy büyüklüğü sızmaz), anahtar uzunluğu zorunlu', function () {
    var key = BG.newKey(); return BG.kidOf(key).then(function (kid) {
      var sizes = [{ a: 1 }, { a: 'x'.repeat(500) }, example()].map(function (o) { return BG.seal(key, o, kid).then(function (e) { return Buffer.from(e.ct, 'base64').length; }); });
      return Promise.all(sizes).then(function (z) { z.forEach(function (n) { ok((n - 16) % 16384 === 0, 'kademe: ' + n); }); eq(z[0], z[1], 'küçük yükler aynı boyutta'); });
    });
  });

  /* ---------- 2. Kurulum dizgesi ---------- */
  test('Kurulum dizgesi: üret/ayrıştır; bozuk dizgeler anlaşılır hatayla reddedilir', function () {
    var key = BG.newKey(), topic = BG.newTopic(), s = secretSet(key, GID, topic); ok(s.indexOf('FPBG1.') === 0);
    var p = BG.parseSetup('  ' + s + '\n'); eq(Array.from(p.key), Array.from(key)); eq(p.gist, GID); eq(p.topic, topic);
    ok(NT.TOPIC_RE.test(topic) && topic.length >= 17, 'konu adı'); ok(BG.newTopic() !== BG.newTopic(), 'konu adları rastgele');
    [['', /biçimi/], ['abc', /biçimi/], ['FPBG1.' + s.slice(6, 30), /çözülemedi/], ['FPBG1.' + BG.b64u(Buffer.from('{"v":1,"k":"AAAA","g":"zz"}')), /geçersiz/]].forEach(function (c) { try { BG.parseSetup(c[0]); throw new Error('hata bekleniyordu: ' + c[0]); } catch (e) { ok(c[1].test(e.message), 'ileti: ' + e.message); } });
    ['bad', '', null].forEach(function (g) { try { BG.makeSetup({ key: key, gist: g, topic: topic }); throw new Error('Gist doğrulanmadı'); } catch (e) { ok(/Gist/.test(e.message)); } });
    try { BG.makeSetup({ key: new Uint8Array(5), gist: GID }); throw new Error('anahtar uzunluğu'); } catch (e) { ok(/32/.test(e.message)); }
    try { BG.makeSetup({ key: key, gist: GID, topic: 'a b' }); throw new Error('konu'); } catch (e) { ok(/konu/.test(e.message)); }
  });

  /* ---------- 3. Yük sadeleştirme ---------- */
  test('Yük: yalnızca beyaz listedeki alanlar; işlem/serbest metin/senkron izi/token ASLA yok', function () {
    var s = personal(), p = BG.slice(s, NOW, 'Chrome'), txt = JSON.stringify(p);
    ['transactions', 'recurring', 'transfers', 'cpi', 'limits', '_sync', 'exampleRevision'].forEach(function (k) { ok(!(k in p.state), k + ' yükte olmamalı'); });
    ['GİZLİ-HARCAMA', 'GİZLİ-İŞLEM', 'GİZLİ-TAKSİT', 'GİZLİ-GELİR', 'GİZLİ-GİDER', 'ghp_', 'GIZLITOKEN'].forEach(function (w) { ok(txt.indexOf(w) < 0, 'sızıntı: ' + w); });
    Object.keys(p.state).forEach(function (k) { ok(BG.KEEP.indexOf(k) >= 0, 'beyaz liste dışı: ' + k); });
    ok(p.state.assets.length === s.assets.length && p.state.trades.length === s.trades.length, 'varlıklar eksiksiz'); ok(s.transactions.length > 0 && 'transactions' in s, 'kaynak durum değişmemeli');
    ok(s.trades[0].note === 'GİZLİ-İŞLEM-NOTU', 'slice kaynağı değiştirmemeli');
  });
  test('Yük: sadeleştirilmiş durumdan hesaplanan portföy/sağlık/risk, tam durumla BİREBİR aynı', function () {
    var s = personal(), p = BG.slice(s, NOW, 'x');
    function sig(c) { return JSON.stringify({ pos: c.pos.map(function (q) { return [q.name, q.valueTL, q.tier, q.halal]; }), em: c.an.emergency, ta: c.an.targetAlloc, ca: c.an.currentAlloc, risk: c.risk.items.map(function (r) { return [r.id, r.level, r.text]; }), ok: c.risk.ok, sm: [c.sm.feesTL, c.sm.boughtTL], nw: c.an.assets.netWorth }); }
    var a = BG.calcOf(s, TODAY, YM), b = BG.calcOf(p.state, TODAY, YM); eq(sig(b), sig(a));
    eq(AN.health(BG.healthInput(p.state, b)).total, AN.health(BG.healthInput(s, a)).total);
  });
  test('Yük: bildirim ayarları temizlenir; itme kipi ve test isteği taşınır', function () {
    var s = personal(); s.notifSettings = { cats: { portfolio: { on: true, min: 'high' } }, quiet: { on: true, from: '23:00', to: '07:00' }, evil: '<script>' };
    var p = BG.slice(s, NOW, 'x', { pushMode: 'generic', testPush: { id: 't1', at: 5 } }); eq(p.pushMode, 'generic'); eq(p.testPush.id, 't1'); ok(!('evil' in p.state.notifSettings));
    eq(BG.slice(s, NOW, 'x', { pushMode: 'zzz' }).pushMode, 'detail');
  });

  /* ---------- 4. Bildirim gövdesi ---------- */
  test('ntfy gövdesi: TL tutarları silinir; "genel" kipte yalnız önem+kategori; satış emri dili yok', function () {
    eq(BG.redact('Bakiye 1.250.000 TL ve ₺ 45.000,50 ile 3 milyon ₺ arası'), 'Bakiye [tutar] ve [tutar] ile [tutar] arası');
    var it = { sev: 'high', cat: 'portfolio', title: 'ASELS: görünüm zayıfladı (12.000 TL)', body: 'Skor 40; yeni alım yapma.' };
    var d = BG.pushMessage(it, 'detail'), g = BG.pushMessage(it, 'generic');
    ok(d.title.indexOf('TL') < 0 && /ASELS/.test(d.title)); ok(!/ASELS/.test(g.title + g.message), 'genel kipte varlık adı yok'); ok(/uygulamasını aç/i.test(g.message));
    ok(!/\b(sat|SAT)\b/.test(d.title + d.message + g.title + g.message), 'otomatik satış emri dili olmamalı'); eq(BG.pushMessage({ sev: 'critical', cat: 'risk', title: 'x', body: 'y' }, 'detail').priority, 5);
  });

  /* ---------- 5. Kontrol motoru ---------- */
  function snapFor(key, over) { return Object.assign({ key: key, name: key + ' — test', at: new Date(NOW).toISOString(), total: 70, stance: { code: 'neutral', label: 'Nötr', hold: { code: 'hold', label: 'Tut', why: [] } }, price: 100, lastDate: TODAY, halalOk: true, plans: {} }, over || {}); }
  function chk(payload, o) { return BG.check(payload, { feed: { items: [] } }, Object.assign({ now: NOW, refresh: false, snapOf: function () { return Promise.resolve(null); } }, o || {})); }
  test('Kontrol: örnek veriyle çalışır, hata yok, sağlık skoru/kalemler var, bildirim GÖNDERİLECEKLER boş değil ama örnekte gönderim işte engellenir', function () {
    return chk(BG.slice(example(), NOW, 't')).then(function (r) { var x = r.res; eq(x.status, 'ok'); eq(x.errors, []); ok(x.isExample === true); ok(x.health && x.health.total > 0 && x.positions.length > 5); ok(x.netWorth > 0); ok(x.settings && x.settings.pushMode === 'detail'); });
  });
  test('Kontrol: eski yük (>30 gün) "payload_old" olarak işaretlenir, uydurma sonuç yok', function () {
    var p = BG.slice(personal(), NOW - 40 * 86400000, 't'); return chk(p).then(function (r) { eq(r.res.status, 'payload_old'); ok(!r.res.health); ok(r.res.errors[0].indexOf('güncellenmedi') > 0); });
  });
  test('Kontrol: seviye alarmı tetiklenir; fiyat alınamazsa durum "hata" olarak raporlanır, sessiz geçilmez', function () {
    var s = personal(); s.analysis = { alerts: [{ id: 'al1', key: 'bist:ASELS', name: 'ASELS', sym: 'ASELS', cur: 'TRY', price: 90, dir: 'below', label: 'Destek', refPrice: 100, createdAt: '2026-11-01T00:00:00Z', triggeredAt: null, firedPrice: null, firedSource: null, lastPrice: null, lastAt: null, lastSource: null }] };
    var p = BG.slice(s, NOW, 't');
    return chk(p, { quoteOf: function () { return Promise.resolve({ price: 88, at: new Date(NOW).toISOString(), source: 'test' }); } }).then(function (r) {
      eq(r.res.alertsFired.length, 1); eq(r.res.alertsFired[0].id, 'al1'); eq(r.res.alertsState[0].firedPrice, 88);
      return chk(p, { quoteOf: function () { return Promise.reject(new Error('ağ yok')); } }).then(function (r2) { eq(r2.res.alertsFired.length, 0); eq(r2.res.alertsChecked.errors.length, 1); });
    });
  });
  test('Kontrol: analiz zayıflaması/yorulma uyarısı — ilk çalışmada yağmur yok, sonra tek sefer, tekrar çalışınca tekrar etmez (tekilleştirme)', function () {
    var p = BG.slice(personal(), NOW, 't'), key = 'bist:ASELS', good = snapFor(key), bad = snapFor(key, { total: 45, stance: { code: 'weak', label: 'Zayıf', hold: { code: 'trim', label: 'Kısmi azalt', why: ['Direnç', 'RSI'] } } });
    function run(sn, prev, now) { return chk(p, { now: now || NOW, prev: prev, snapOf: function (k) { return Promise.resolve(k === key ? sn : null); } }); }
    return run(bad, null).then(function (r1) { ok(r1.deliver.filter(function (i) { return i.sev !== 'critical'; }).length === 0, 'ilk çalışmada yalnız kritikler'); return run(good, r1.res); }).then(function (r2) {
      eq(r2.deliver.filter(function (i) { return /^an:/.test(i.id); }).length, 0);
      return run(bad, r2.res, NOW + 20 * 60000).then(function (r3) {
        var ids = r3.deliver.map(function (i) { return i.id; }).filter(function (i) { return /^an:/.test(i); }).sort(); ok(ids.some(function (i) { return /^an:trim:/.test(i); }) && ids.some(function (i) { return /^an:weak:/.test(i); }) && ids.some(function (i) { return /^an:drop:/.test(i); }), 'trim+weak+drop: ' + ids);
        r3.deliver.forEach(function (i) { var m = BG.pushMessage(i, 'detail'); ok(!/satış emri[^d]|SAT\b/.test(m.title + m.message) || /değildir/.test(m.message), 'satış emri dili'); });
        return run(bad, r3.res, NOW + 40 * 60000).then(function (r4) { eq(r4.deliver.filter(function (i) { return /^an:/.test(i.id); }).length, 0, 'tekrar bildirim yok'); ok(r4.res.items.some(function (i) { return /^an:trim:/.test(i.id); }), 'uyarı kutuda görünür kalır'); });
      });
    });
  });
  test('Kontrol: piyasa geneli (herkese açık) uyarılar sonuçta görünür ama arka plan portföy bildirimi olarak ÇİFT gönderilmez', function () {
    var p = BG.slice(personal(), NOW, 't'), data = { feed: { items: [] }, alerts: { generatedAt: new Date(NOW).toISOString(), items: [{ id: 'srv-1', cat: 'market', sev: 'critical', title: 'Piyasa şoku testi', body: 'x', at: new Date(NOW).toISOString(), href: null }] } };
    return BG.check(p, data, { now: NOW, refresh: false, snapOf: function () { return Promise.resolve(null); }, prev: { log: NT.cleanLog(null), analysis: {} } }).then(function (r) {
      ok(r.res.items.some(function (i) { return i.id === 'srv-1'; }), 'görünür'); ok(!r.deliver.some(function (i) { return i.id === 'srv-1'; }), 'çift bildirim yok');
    });
  });
  test('Kontrol: yalnızca ELDEKİ varlıklar için stop/düşüş uyarısı (izleme listesi stop uyarısı üretmez)', function () {
    var s = personal(); s.analysis = { watchlist: [{ key: 'bist:THYAO', name: 'THYAO' }] }; var p = BG.slice(s, NOW, 't');
    var below = snapFor('bist:THYAO', { price: 50, plans: { conservative: { stop: 60, stopLabel: 'test' } } });
    return chk(p, { snapOf: function (k) { return Promise.resolve(k === 'bist:THYAO' ? below : null); } }).then(function (r) { ok(!r.res.log.items.some(function (i) { return /^stop:bist:THYAO/.test(i.id); })); ok(r.res.analysis['bist:THYAO'], 'izleme listesi analizi sonuçta'); });
  });
  test('Ödeme hatırlatmaları: yüke yalnız hatırlatma listesi girer (tutar/ad işlem listesi değil); arka planda vade yaklaşınca/geçince uyarı, ödenince kalkar, tekrar bildirim yok', function () {
    var st = personal(), p = BG.slice(st, NOW, 't'); ok(Array.isArray(p.reminders) && p.reminders.length > 0, 'örnek durumda yaklaşan ödeme var'); ok(!('recurring' in p.state) && !('transactions' in p.state));
    p.reminders.forEach(function (r) { ok(/^(recurring|card|sinking):/.test(r.id) && /^\d{4}-\d\d-\d\d$/.test(r.date) && Number.isInteger(r.remind) && Number.isSafeInteger(r.amount) && r.amount >= 0, 'biçim ' + r.id); });
    function ymd(plus) { return new Date(NOW + 3 * 3600000 + plus * 86400000).toISOString().slice(0, 10); }
    var base = BG.slice(personal(), NOW, 't'); base.reminders = [
      { id: 'recurring:r1:' + ymd(2), kind: 'recurring', title: 'Kira', date: ymd(2), amount: 1500000, remind: 3 }, { id: 'recurring:r2:' + ymd(20), kind: 'recurring', title: 'Uzak', date: ymd(20), amount: 100, remind: 3 },
      { id: 'card:c1:' + ymd(-2), kind: 'card', title: 'Kart — son ödeme', date: ymd(-2), amount: 99900, remind: 3 }, { id: 'recurring:r3:' + ymd(0), kind: 'recurring', title: 'Fatura', date: ymd(0), amount: 5000, remind: 3 }, { id: 'recurring:r4:' + ymd(-30), kind: 'recurring', title: 'Çok eski', date: ymd(-30), amount: 5000, remind: 3 }];
    return chk(base, { prev: { log: NT.cleanLog(null), analysis: {} } }).then(function (r1) {
      var pay = r1.res.items.filter(function (i) { return i.cat === 'payment'; }); eq(pay.map(function (i) { return i.title; }).sort(), ['Fatura — bugün son gün', 'Kart — son ödeme — ödeme günü geçti (2 gün)', 'Kira — 2 gün sonra'].sort());
      eq(pay.filter(function (i) { return i.sev === 'high'; }).length, 2); eq(pay.filter(function (i) { return i.sev === 'medium'; }).length, 1);
      ok(r1.res.reminders.length === 5 && r1.res.reminders.filter(function (x) { return x.level === 'later'; }).length === 1, 'sonuçta tüm hatırlatma satırları (uzak olan "later")');
      pay.forEach(function (i) { ok(!/\d[\d.]*,\d\d\s*TL|\d+\s*TL/.test(i.title + i.body), 'bildirim metninde tutar yok'); ok(/Ödendi/.test(i.body)); });
      var cur = r1.res; base.reminders = base.reminders.slice(0, 1); // diğerleri ödendi → cihaz yeni yük yükledi
      return chk(base, { prev: cur }).then(function (r2) {
        eq(r2.deliver.filter(function (i) { return i.cat === 'payment'; }).length, 0, 'aynı hatırlatma tekrar bildirilmez');
        var all = r2.res.log.items.filter(function (i) { return i.cat === 'payment'; }); ok(all.filter(function (i) { return i.resolvedAt; }).length === 2, 'ödenen (listeden düşen) hatırlatmalar çözüldü'); eq(r2.res.items.filter(function (i) { return i.cat === 'payment'; }).length, 1);
      });
    });
  });
  test('Bildirim ayarı: "Ödeme hatırlatması" kategorisi varsayılan açık (orta ve üstü) ve ayardan kapatılabilir', function () {
    var S2 = NT.cleanSettings(null); eq(S2.cats.payment, { on: true, push: 'medium' }); ok(NT.CATS.payment && NT.CAT_HELP.payment);
    var off = NT.cleanSettings({ cats: { payment: { on: false, push: 'off' } } }); eq(off.cats.payment.on, false);
  });

  /* ---------- 6. İş betiği (Actions'ta çalışan Node adımı) ---------- */
  function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fpbg-')); }
  function ntfyServer(statusFn) {
    var got = [], srv = http.createServer(function (req, res) { var b = ''; req.on('data', function (d) { b += d; }); req.on('end', function () { var st = statusFn ? statusFn(got.length) : 200; if (st === 200) got.push(JSON.parse(b)); res.statusCode = st; res.end('{}'); }); });
    return new Promise(function (ok2) { srv.listen(0, '127.0.0.1', function () { ok2({ srv: srv, got: got, url: 'http://127.0.0.1:' + srv.address().port + '/' }); }); });
  }
  function runJob(env, md, out) {
    return new Promise(function (res) {
      var c = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'portfolio_job.js'), md, out], { env: Object.assign({}, process.env, { BG_NO_NET: '1', BG_NOW: new Date(NOW).toISOString(), GITHUB_ACTIONS: '' }, env) }), buf = '';
      c.stdout.on('data', function (d) { buf += d; }); c.stderr.on('data', function (d) { buf += d; }); c.on('close', function (code) { res({ code: code, log: buf }); });
    });
  }
  function setupJob(state, opts) {
    var dir = tmp(), key = BG.newKey(), topic = BG.newTopic(), md = path.join(dir, 'md'), out = path.join(dir, 'out'), gist = path.join(dir, 'gist.json');
    fs.mkdirSync(path.join(md, 'analysis'), { recursive: true });
    return BG.kidOf(key).then(function (kid) { return BG.seal(key, BG.slice(state, NOW, 'Test', opts), kid); }).then(function (env) {
      fs.writeFileSync(gist, JSON.stringify(env)); return { dir: dir, key: key, topic: topic, md: md, out: out, gist: gist, setup: secretSet(key, GID, topic), kid: env.kid, env: env };
    });
  }
  function readRes(j, file) { var env = JSON.parse(fs.readFileSync(path.join(j.out, 'bg', 'results.enc.json'), 'utf8')); return BG.open(j.key, env).then(function (r) { return { r: r, env: env, raw: fs.readFileSync(path.join(j.out, 'bg', 'results.enc.json'), 'utf8') }; }); }
  function writeSnap(md, key, snap) { fs.writeFileSync(path.join(md, 'analysis', SN.fileOf(key) + '.json'), JSON.stringify(snap)); }

  test('İş: PORTFOLIO_KEY yoksa hiçbir şey yapmaz (çıkış 0, dosya yok); geçersizse uyarı verir ama akışı bozmaz', function () {
    var dir = tmp(); return runJob({ PORTFOLIO_KEY: '' }, dir, path.join(dir, 'o')).then(function (a) { eq(a.code, 0); ok(!fs.existsSync(path.join(dir, 'o'))); return runJob({ PORTFOLIO_KEY: 'saçma' }, dir, path.join(dir, 'o')).then(function (b) { eq(b.code, 0); ok(/geçersiz/.test(b.log)); }); });
  });
  test('İş (örnek veri + test bildirimi): çözer, şifreli sonuç yazar; tek test bildirimi; ikinci çalışmada tekrar yok; günlükte ve sonuç dosyasında düz metin/sır YOK', function () {
    return setupJob(example(), { testPush: { id: 'tp1', at: NOW } }).then(function (j) { return ntfyServer().then(function (n) {
      var env = { PORTFOLIO_KEY: j.setup, BG_GIST_FILE: j.gist, NTFY_URL: n.url, GITHUB_ACTIONS: '1' };
      return runJob(env, j.md, j.out).then(function (a) {
        eq(a.code, 0, a.log); eq(n.got.length, 1); eq(n.got[0].topic, j.topic); ok(/zincir çalışıyor/.test(n.got[0].title));
        return readRes(j).then(function (x) {
          eq(x.r.status, 'ok'); eq(x.r.kid, j.kid); eq(x.r.testAck.id, 'tp1'); ok(x.r.isExample); eq(x.r.ntfy.skippedExample, true);
          // Düz metin sızıntı taraması: günlük + şifreli dosya
          var secrets = [BG.b64u(j.key), j.setup, j.topic, GID], names = x.r.positions.map(function (p) { return p.name; }).concat(['Katılım', 'Kira sertifikası']);
          var vis = a.log.split('\n').filter(function (l) { return l.indexOf('::add-mask::') !== 0; }).join('\n'); secrets.forEach(function (sv) { ok(vis.indexOf(sv) < 0, 'günlükte sır'); ok(x.raw.indexOf(sv) < 0, 'sonuç dosyasında sır'); });
          names.forEach(function (nm) { ok(vis.indexOf(nm) < 0, 'günlükte varlık adı: ' + nm); ok(x.raw.indexOf(nm) < 0, 'şifresiz sonuç sızıntısı: ' + nm); });
          ok(/::add-mask::/.test(a.log), 'sırlar maskelenmeli'); ok(a.log.split('::add-mask::').length >= 4, 'anahtar, dizge, gist, konu maskelenmeli');
          ok(!fs.existsSync(path.join(j.out, '.delete')));
          // 2. çalışma: önceki sonuç md içinde
          fs.mkdirSync(path.join(j.md, 'bg'), { recursive: true }); fs.copyFileSync(path.join(j.out, 'bg', 'results.enc.json'), path.join(j.md, 'bg', 'results.enc.json'));
          return runJob(env, j.md, j.out).then(function (b) { eq(b.code, 0, b.log); eq(n.got.length, 1, 'test bildirimi tekrar gönderilmemeli'); n.srv.close(); return readRes(j).then(function (y) { eq(y.r.testAck.id, 'tp1'); }); });
        });
      });
    }); });
  });
  test('İş: kişisel veriyle — taze analiz zayıflığında tek ntfy, aynı olay tekrar gönderilmez; ntfy hatasında sonraki çalışmada yeniden dener; genel kipte varlık adı yok', function () {
    var key = 'bist:ASELS'; return setupJob(personal(), { pushMode: 'generic' }).then(function (j) { var fail = true; return ntfyServer(function () { return fail ? 500 : 200; }).then(function (n) {
      var env = { PORTFOLIO_KEY: j.setup, BG_GIST_FILE: j.gist, NTFY_URL: n.url };
      function step(snap, now) { writeSnap(j.md, key, snap); env.BG_NOW = new Date(now).toISOString(); return runJob(env, j.md, j.out).then(function (a) { eq(a.code, 0, a.log); fs.mkdirSync(path.join(j.md, 'bg'), { recursive: true }); fs.copyFileSync(path.join(j.out, 'bg', 'results.enc.json'), path.join(j.md, 'bg', 'results.enc.json')); return a; }); }
      var t1 = NOW, t2 = NOW + 20 * 60000, t3 = NOW + 40 * 60000, t4 = NOW + 60 * 60000;
      var good = snapFor(key, { at: new Date(t1).toISOString() }), bad = function (t) { return snapFor(key, { at: new Date(t).toISOString(), total: 40, stance: { code: 'veryweak', label: 'Çok zayıf', hold: { code: 'trim', label: 'x', why: ['a'] } } }); };
      return step(good, t1).then(function () { eq(n.got.length, 0); return step(bad(t2), t2); }).then(function () { eq(n.got.length, 0, 'sunucu 500 → gönderilemedi'); return readRes(j); }).then(function (x) {
        ok(x.r.ntfy.failed >= 1 && x.r.pending.length >= 1, 'bekleyenler saklanmalı'); fail = false; return step(bad(t3), t3);
      }).then(function () { ok(n.got.length >= 1, 'yeniden denendi'); var cnt = n.got.length; n.got.forEach(function (g) { ok(!/ASELS|zayıf/i.test(g.title + g.message) || /Portföy uyarısı/.test(g.title), 'genel kip'); ok(/uygulamasını aç/i.test(g.message)); eq(g.topic, j.topic); });
        return step(bad(t4), t4).then(function () { eq(n.got.length, cnt, 'aynı olay yeniden gönderilmemeli'); n.srv.close(); });
      });
    }); });
  });
  test('İş: anahtar uyuşmazlığı → "key_mismatch" (uygulama bunu açıklar); bozuk yük → "bad_payload"; kod 1 yalnızca gerçek hatada', function () {
    return setupJob(example()).then(function (j) { var other = BG.newKey(); return BG.kidOf(other).then(function (k2) {
      var env = { PORTFOLIO_KEY: secretSet(other, GID, j.topic), BG_GIST_FILE: j.gist };
      return runJob(env, j.md, j.out).then(function (a) { eq(a.code, 0, a.log); return BG.open(other, JSON.parse(fs.readFileSync(path.join(j.out, 'bg', 'results.enc.json'), 'utf8'))); }).then(function (r) { eq(r.status, 'key_mismatch'); eq(r.kid, k2); ok(r.payloadKid === j.kid && r.kid !== r.payloadKid);
        var bad = JSON.parse(fs.readFileSync(j.gist, 'utf8')); bad.kid = k2; bad.ct = bad.ct.slice(0, 20) + 'AAAA' + bad.ct.slice(24); fs.writeFileSync(j.gist, JSON.stringify(bad));
        return runJob(env, j.md, j.out).then(function (b) { eq(b.code, 1); return BG.open(other, JSON.parse(fs.readFileSync(path.join(j.out, 'bg', 'results.enc.json'), 'utf8'))); }).then(function (r2) { eq(r2.status, 'bad_payload'); });
      });
    }); });
  });
  test('İş: Gist silinmişse (izleme kapatıldı) uzaktaki şifreli sonuç silinmek üzere işaretlenir; başka hiçbir yol değil', function () {
    return setupJob(example()).then(function (j) { fs.unlinkSync(j.gist); return runJob({ PORTFOLIO_KEY: j.setup, BG_GIST_FILE: j.gist }, j.md, j.out).then(function (a) { eq(a.code, 0, a.log); eq(fs.readFileSync(path.join(j.out, '.delete'), 'utf8').trim(), 'bg/results.enc.json'); ok(!fs.existsSync(path.join(j.out, 'bg'))); }); });
  });

  /* ---------- 7. Depo/akış denetimi ---------- */
  test('Akış: market-portfolio.yml sır yoksa kapalı, tek eşzamanlılık grubu, günlükte yazdırma yok; PORTFOLIO_KEY yalnızca izinli adımlarda', function () {
    var y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'market-portfolio.yml'), 'utf8');
    ok(/steps\.gate\.outputs\.on == '1'/.test(y) && /group: market-data-portfolio/.test(y)); ok(/cancel-in-progress: false/.test(y));
    ok(!/echo\s+"?\$\{?K\b|printenv|\benv\s*\||set -x|ACTIONS_STEP_DEBUG/.test(y), 'sır yazdırılmamalı');
    var envUses = (y.match(/PORTFOLIO_KEY: \$\{\{ secrets\.PORTFOLIO_KEY \}\}/g) || []).length; eq(envUses, 1, 'yalnız iş adımında'); ok(/tools\/portfolio_job\.js/.test(y));
    fs.readdirSync(path.join(ROOT, '.github', 'workflows')).forEach(function (f) { var t = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8'); if (f === 'market-portfolio.yml') return; var m = t.match(/PORTFOLIO_KEY/g) || []; ok(m.length <= 2, f + ': PORTFOLIO_KEY yalnız publish adımında (env satırı)'); });
    ok(/market-portfolio/.test(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'keepalive.yml'), 'utf8')), 'keepalive listesinde');
  });
  test('Depo: istemci kodunda/depoda sır yok (ghp_/github_pat_ belirteci, anahtar, gerçek konu adı)', function () {
    var bad = []; (function walk(d) { fs.readdirSync(d).forEach(function (f) { if (f === 'node_modules' || f === '.git') return; var p = path.join(d, f), st = fs.statSync(p); if (st.isDirectory()) return walk(p); if (!/\.(js|html|css|md|yml|py|json|webmanifest|svg)$/.test(f)) return; var t = fs.readFileSync(p, 'utf8'); if (/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|FPBG1\.[A-Za-z0-9_-]{40,}/.test(t)) bad.push(p); }); })(ROOT);
    eq(bad, []);
  });
  test('Yayın: publish.py "portfolio" işi yalnız bg/ yazar, .delete ile yalnız kendi yolunu siler (python testi)', function () {
    var r = cp.spawnSync('python3', [path.join(ROOT, 'tests', 'test_publish.py')], { encoding: 'utf8' }); ok(r.status === 0, (r.stdout || '') + (r.stderr || '')); ok(/portfolio/i.test(fs.readFileSync(path.join(ROOT, 'tests', 'test_publish.py'), 'utf8')), 'portfolio testleri mevcut');
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.2 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
