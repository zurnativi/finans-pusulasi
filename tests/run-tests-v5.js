/* v5 testleri: şifreleme, eşitleme birleştirme/çakışma, kilit, temettü/bedelsiz hesapları, fiyat kaynakları, v3→v4 taşıma.
 * Çalıştırma: node tests/run-tests-v5.js  (tarayıcıda: tests/tests.html — Web Crypto gerektirir) */
(function (root) {
  var isNode = typeof module === 'object' && module.exports;
  var M = isNode ? require('../js/money.js') : root.Money;
  var S = isNode ? require('../js/sample.js') : root.Sample;
  var PF = isNode ? require('../js/portfolio.js') : root.Portfolio;
  var PR = isNode ? require('../js/prices.js') : root.Prices;
  var P = isNode ? require('../js/importparse.js') : root.ImportParse;
  var CB = isNode ? require('../js/cryptobox.js') : root.CryptoBox;
  var SM = isNode ? require('../js/syncmerge.js') : root.SyncMerge;
  var SY = isNode ? require('../js/sync.js') : root.Sync;
  var LK = isNode ? require('../js/lock.js') : root.LockCore;
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function rejects(p, re) { return p.then(function () { throw new Error('hata bekleniyordu'); }, function (e) { if (re && !re.test(e.message)) throw new Error('beklenmeyen hata: ' + e.message); }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var FAST = 100000; // testlerde PBKDF2 tur sayısı düşük (gerçekte 600.000)

  /* ---------- Şifreleme ---------- */
  test('Şifreleme gidiş-dönüş (gzip, Türkçe karakter, büyük veri)', function () {
    var obj = { ad: 'Çağrı Şükrü İğdır', n: 123456789, list: [] }; for (var i = 0; i < 2000; i++) obj.list.push({ i: i, t: 'işlem ' + i });
    return CB.encryptJson(obj, 'uzun bir parola 123', { iter: FAST }).then(function (env) {
      ok(CB.isEnvelope(env), 'zarf'); eq(env.format, CB.FORMAT); ok(JSON.stringify(env).indexOf('Çağrı') < 0 && JSON.stringify(env).indexOf('işlem') < 0, 'açık metin sızmadı');
      return CB.decryptJson(env, 'uzun bir parola 123').then(function (back) { eq(back, obj); });
    });
  });
  test('Yanlış parola ve bozulmuş veri reddedilir', function () {
    return CB.encryptJson({ a: 1 }, 'doğru parola', { iter: FAST }).then(function (env) {
      var bad = clone(env); var ct = CB.unb64(bad.ct); ct[5] ^= 1; bad.ct = CB.b64(ct);
      return Promise.all([rejects(CB.decryptJson(env, 'yanlış parola'), /Parola|anahtar/), rejects(CB.decryptJson(bad, 'doğru parola'), /Parola|bozul/)]);
    });
  });
  test('Her şifrelemede yeni tuz ve IV; anahtar önbelleği aynı sonucu verir', function () {
    var cache = {};
    return Promise.all([CB.encryptJson({ a: 1 }, 'p@rola-uzun', { iter: FAST }), CB.encryptJson({ a: 1 }, 'p@rola-uzun', { iter: FAST, keyCache: cache })]).then(function (r) {
      ok(r[0].iv !== r[1].iv && r[0].kdf.salt !== r[1].kdf.salt && r[0].ct !== r[1].ct, 'rastgelelik');
      return CB.decryptJson(r[1], 'p@rola-uzun', cache).then(function (b) { eq(b, { a: 1 }); });
    });
  });
  test('Varsayılan PBKDF2 en az 600.000 tur; düşük tur reddedilir', function () {
    ok(CB.DEFAULT_ITER >= 600000); ok(LK.ITER >= 600000);
    return CB.encryptJson({ a: 1 }, 'parola-parola', { iter: FAST }).then(function (env) { env.kdf.iter = 10; return rejects(CB.decryptJson(env, 'parola-parola')); });
  });

  /* ---------- Kilit ---------- */
  test('PIN kuralları: kısa, tekrar eden, sıralı reddedilir', function () {
    ok(LK.checkSecret('12345', 'pin')); ok(LK.checkSecret('111111', 'pin')); ok(LK.checkSecret('123456', 'pin')); ok(LK.checkSecret('987654', 'pin')); ok(LK.checkSecret('12a456', 'pin'));
    eq(LK.checkSecret('480317', 'pin'), null); ok(LK.checkSecret('kısa', 'password')); eq(LK.checkSecret('uzun parola', 'password'), null);
  });
  test('Kilit: oluştur → aç → yanlış PIN → PIN değiştir (veri anahtarı aynı)', function () {
    var made, data;
    return LK.create('480317', 'pin', { iter: FAST }).then(function (m) {
      made = m; ok(JSON.stringify(m.cfg).indexOf('480317') < 0, 'PIN saklanmaz');
      return CB.seal(m.key, new TextEncoder().encode('gizli veri'));
    }).then(function (sealed) {
      data = sealed;
      return rejects(LK.unlock(made.cfg, '000000'), /PIN yanlış/);
    }).then(function () { return LK.changeSecret(made.cfg, '480317', 'yeni parola 1', 'password'); }).then(function (cfg2) {
      eq(cfg2.kind, 'password');
      return rejects(LK.unlock(cfg2, '480317')).then(function () { return LK.unlock(cfg2, 'yeni parola 1'); });
    }).then(function (u) { return CB.openBytes(u.key, data); }).then(function (bytes) { eq(new TextDecoder().decode(bytes), 'gizli veri'); });
  });
  test('Biyometrik (PRF) sarma: doğru PRF açar, yanlış PRF açamaz', function () {
    var prf = CB.rand(32), wrong = CB.rand(32), made;
    return LK.create('parola-1234', 'password', { iter: FAST }).then(function (m) { made = m; return LK.bioWrap(m.raw, prf); }).then(function (wrap) {
      made.cfg.bio = { wrap: wrap, credId: 'x' };
      return LK.bioUnlock(made.cfg, prf);
    }).then(function (u) { eq(CB.b64(u.raw), CB.b64(made.raw)); return rejects(LK.bioUnlock(made.cfg, wrong), /Biyometrik/); });
  });
  test('Deneme sınırı: 5 hatadan sonra artan bekleme, en fazla 15 dk', function () {
    eq(LK.waitMs(4), 0); eq(LK.waitMs(5), 30000); eq(LK.waitMs(8), 60000); eq(LK.waitMs(100), 15 * 60000);
  });

  /* ---------- Eşitleme birleştirme ---------- */
  function base() {
    var s = S.emptyState(); s.isExample = false;
    s.transactions = [{ id: 't1', date: '2026-11-01', description: 'Market', amount: -10000, category: 'Market' }, { id: 't2', date: '2026-11-02', description: 'Kira', amount: -500000, category: 'Kira' }];
    s.limits = { Market: 300000 };
    return s;
  }
  function edit(prev, fn, ms) { var next = clone(prev); fn(next); SM.stamp(prev, next, ms); return next; }
  test('stamp: değişen kayıt damgalanır, silinen için iz kalır', function () {
    var a = base(); SM.stamp(null, a, 0);
    var b = edit(a, function (s) { s.transactions[0].amount = -12000; s.transactions.splice(1, 1); s.limits.Market = 350000; }, 1000);
    eq(b._sync.stamps['transactions:t1'], 1000); eq(b._sync.tomb['transactions:t2'], 1000); eq(b._sync.stamps['limits:Market'], 1000);
    ok(!b._sync.stamps['transactions:t2'], 'silinenin damgası kalkar');
  });
  test('merge: farklı kayıtlarda değişiklikler iki tarafa da geçer, veri kaybolmaz', function () {
    var a = base(); SM.stamp(null, a, 0);
    var A = edit(a, function (s) { s.transactions.push({ id: 't3', date: '2026-11-05', description: 'Kitap', amount: -4000, category: 'Eğitim' }); }, 2000);
    var B = edit(a, function (s) { s.transactions[1].amount = -550000; s.limits.Ulaşım = 100000; }, 2100);
    var m = SM.merge(A, B, 1000);
    eq(m.conflicts.length, 0);
    eq(m.state.transactions.map(function (t) { return t.id; }).sort(), ['t1', 't2', 't3']);
    eq(m.state.transactions.find(function (t) { return t.id === 't2'; }).amount, -550000);
    eq(m.state.limits, { Market: 300000, Ulaşım: 100000 });
    ok(m.changedLocal && m.needPush);
    S.validateState(clone(m.state));
  });
  test('merge: aynı kayıt iki cihazda değişirse çakışma, yenisi kazanır, diğeri saklanır', function () {
    var a = base(); SM.stamp(null, a, 0);
    var A = edit(a, function (s) { s.transactions[0].amount = -11111; }, 3000);
    var B = edit(a, function (s) { s.transactions[0].amount = -22222; }, 3500);
    var m = SM.merge(A, B, 1000);
    eq(m.conflicts.length, 1); eq(m.conflicts[0].kept, 'remote'); eq(m.conflicts[0].local.amount, -11111);
    eq(m.state.transactions[0].amount, -22222);
    var back = SM.applyVersion(clone(m.state), m.conflicts[0].key, m.conflicts[0].local); eq(back.transactions[0].amount, -11111, 'diğer sürüm geri alınabilir');
  });
  test('merge: çakışmayı kazanan sürüm diğer cihaza yeni çakışma yaratmadan geçer', function () {
    var a = base(); SM.stamp(null, a, 0);
    var A = edit(a, function (s) { s.limits.Market = 400000; }, 2000);   // A değiştirir
    var B = edit(a, function (s) { s.limits.Market = 800000; }, 2500);   // B de (daha yeni)
    // A önce eşitler (bulutta B yok), sonra B eşitler: çakışma B'de, B'nin sürümü kazanır
    var mB = SM.merge(B, A, 1000, 4000); eq(mB.conflicts.length, 1); eq(mB.state.limits.Market, 800000);
    // A sonra eşitler (taban = A'nın 3000'deki eşitlemesi): sessizce B'nin kazanan sürümünü alır
    var mA = SM.merge(A, mB.state, 3000, 5000); eq(mA.conflicts.length, 0); eq(mA.state.limits.Market, 800000);
  });
  test('merge: silme iki yöne yayılır (silme izi), silme×değiştirme çakışmasında kayıt korunur', function () {
    var a = base(); SM.stamp(null, a, 0);
    var A = edit(a, function (s) { s.transactions.splice(1, 1); }, 4000);
    var m1 = SM.merge(a, A, 1000); eq(m1.state.transactions.map(function (t) { return t.id; }), ['t1']);
    var m2 = SM.merge(A, a, 1000); eq(m2.state.transactions.map(function (t) { return t.id; }), ['t1'], 'eski kopya silineni geri getirmez');
    var B = edit(a, function (s) { s.transactions[1].amount = -600000; }, 4500);
    var m3 = SM.merge(A, B, 1000);
    ok(m3.state.transactions.some(function (t) { return t.id === 't2' && t.amount === -600000; }), 'değiştirilen kayıt korunur');
    eq(m3.conflicts.length, 1);
  });
  test('merge: fiyat serileri nokta nokta birleşir, ilk eşitlemede farklar çakışma olarak gösterilir', function () {
    var a = base(), b = base();
    a.prices = { 'fx:USD': { cur: 'TRY', points: [{ d: '2026-11-01', p: 40000000, src: 'a' }] } };
    b.prices = { 'fx:USD': { cur: 'TRY', points: [{ d: '2026-11-02', p: 40100000, src: 'b' }] } };
    b.transactions[0].amount = -9999;
    var m = SM.merge(a, b, 0);
    eq(m.state.prices['fx:USD'].points.map(function (p) { return p.d; }), ['2026-11-01', '2026-11-02']);
    eq(m.conflicts.length, 1); ok(/geçmişi yok/.test(m.conflicts[0].reason));
  });
  test('merge: örnek veriyle birleştirilen tüm durum doğrulamadan geçer', function () {
    var a = S.exampleState(), b = clone(a); SM.stamp(null, a, 0); SM.stamp(null, b, 0);
    var B = edit(b, function (s) { s.trades = s.trades.slice(1); }, 5000);
    var m = SM.merge(a, B, 1000); S.validateState(clone(m.state)); eq(m.state.trades.length, a.trades.length - 1);
  });

  /* ---------- Sync.run (sahte Gist, ağ yok) ---------- */
  function fakeClient() {
    var store = { id: null, content: null, calls: [] };
    return { store: store, user: function () { return Promise.resolve({ login: 'test' }); },
      find: function () { store.calls.push('find'); return Promise.resolve(store.id); },
      read: function (id) { store.calls.push('read'); return Promise.resolve({ content: store.content }); },
      create: function (c) { store.calls.push('create'); store.id = 'g1'; store.content = c; return Promise.resolve({ id: 'g1' }); },
      update: function (id, c) { store.calls.push('update'); store.content = c; return Promise.resolve({ id: id }); } };
  }
  function V(s) { return S.validateState(s); }
  test('Sync.run: ilk cihaz yükler (şifreli), ikinci cihaz çeker, sonra değişiklikler birleşir', function () {
    var cl = fakeClient(), cache1 = {}, cache2 = {}, pass = 'ortak eşitleme parolası';
    var d1 = base(); SM.stamp(null, d1, 0);
    var d2 = S.exampleState();
    return SY.run({ local: d1, cfg: { pass: pass }, client: cl, validate: V, keyCache: cache1, startMs: 1000 }).then(function (r1) {
      eq(r1.action, 'created'); ok(cl.store.content.indexOf('Market') < 0 && cl.store.content.indexOf('Kira') < 0, 'bulutta açık metin yok');
      return SY.run({ local: d2, cfg: { pass: pass }, client: cl, validate: V, keyCache: cache2, startMs: 2000 });
    }).then(function (r2) {
      eq(r2.action, 'pulled-replace', 'örnek verili yeni cihaz buluttakini alır'); eq(r2.state.transactions.length, 2);
      var d2b = edit(r2.state, function (s) { s.transactions.push({ id: 't9', date: '2026-11-09', description: 'Fatura', amount: -70000, category: 'Faturalar' }); }, 3000);
      return SY.run({ local: d2b, cfg: { pass: pass, gistId: 'g1', lastSyncAt: 2000 }, client: cl, validate: V, keyCache: cache2, startMs: 3100 });
    }).then(function (r3) {
      eq(r3.action, 'merged'); ok(r3.pushed, 'birleşen veri yüklendi');
      var d1b = edit(d1, function (s) { s.limits.Market = 400000; }, 3200);
      return SY.run({ local: d1b, cfg: { pass: pass, gistId: 'g1', lastSyncAt: 1000 }, client: cl, validate: V, keyCache: cache1, startMs: 4000 });
    }).then(function (r4) {
      eq(r4.conflicts.length, 0); ok(r4.state.transactions.some(function (t) { return t.id === 't9'; }), 'diğer cihazın kaydı geldi'); eq(r4.state.limits.Market, 400000);
    });
  });
  test('Sync.run: yanlış eşitleme parolası anlaşılır hata verir, veri değişmez', function () {
    var cl = fakeClient(), d1 = base();
    return SY.run({ local: d1, cfg: { pass: 'birinci parola' }, client: cl, validate: V, keyCache: {}, startMs: 1 }).then(function () {
      return rejects(SY.run({ local: d1, cfg: { pass: 'başka parola!', gistId: 'g1' }, client: cl, validate: V, keyCache: {}, startMs: 2 }), /parola/i);
    });
  });
  test('GistClient: gizli gist açar, token yalnızca Authorization başlığında', function () {
    var seen = [];
    function f(url, o) { seen.push({ url: url, o: o }); var body = o.method === 'POST' ? { id: 'abc', public: false, updated_at: 'x' } : []; return Promise.resolve({ ok: true, status: o.method === 'POST' ? 201 : 200, text: function () { return Promise.resolve(JSON.stringify(body)); } }); }
    var c = SY.GistClient('ghp_test', f);
    return c.create('{}').then(function (r) {
      eq(r.id, 'abc'); var req = seen[0]; eq(JSON.parse(req.o.body).public, false); eq(req.o.headers.Authorization, 'Bearer ghp_test'); ok(req.url.indexOf('ghp_test') < 0);
    });
  });
  test('GitHub hata mesajları Türkçe', function () { ok(/token|anahtar/i.test(SY.httpError(401, {}, '/user').message)); });

  /* ---------- Temettü, bedelsiz, bedelli ---------- */
  function T(o) { var t = { id: S.uid(), assetId: 'a1', date: '2026-01-10', side: 'buy', qty: 0, price: 0, fee: 0, currency: 'TRY', fxRate: null, note: '', source: '' }; Object.keys(o).forEach(function (k) { t[k] = o[k]; }); return t; }
  var Q = PF.QS || 100000000, PP = PF.PS || 1000000;
  test('Bedelsiz %100: adet ikiye katlanır, toplam maliyet aynı, ortalama yarıya iner', function () {
    var lg = PF.ledger([T({ qty: 100 * Q, price: 50 * PP, fee: 0 }), T({ date: '2026-03-01', side: 'split', ratioBp: 10000 })]);
    eq(lg.units, 200 * Q); eq(lg.costTL, 500000); eq(lg.avgPrice, 25 * PP); eq(lg.splits, 1); eq(lg.realizedTL, 0);
  });
  test('Bedelsiz %50 küsuratlı adet aşağı yuvarlanır; birleşme (−50) adedi yarıya indirir', function () {
    eq(PF.splitAdded(3 * Q, 5000), 1.5 * Q); eq(PF.splitAdded(1, 5000), 0); eq(PF.splitAdded(10 * Q, -5000), -5 * Q);
    var lg = PF.ledger([T({ qty: 10 * Q, price: 10 * PP }), T({ date: '2026-02-01', side: 'split', ratioBp: -5000 })]);
    eq(lg.units, 5 * Q); eq(lg.costTL, 10000);
  });
  test('Temettü: net (brüt − stopaj − masraf) gerçekleşen kâra eklenir; maliyet/adet değişmez', function () {
    var lg = PF.ledger([T({ qty: 300 * Q, price: 40 * PP }), T({ date: '2026-05-20', side: 'div', amount: 24000, withholding: 2400, fee: 100 })]);
    eq(lg.units, 300 * Q); eq(lg.costTL, 1200000); eq(lg.divTL, 21500); eq(lg.withholdingTL, 2400); eq(lg.divGrossTL, 24000); eq(lg.realizedTL, 21500);
    ok(PF.ledger([T({ side: 'div', amount: 100 })]).errors.length === 1, 'adetsiz temettü uyarı verir');
  });
  test('Bedelli: alış gibi maliyete eklenir; satış sonrası kâr doğru', function () {
    var lg = PF.ledger([T({ qty: 100 * Q, price: 20 * PP }), T({ date: '2026-02-01', side: 'rights', qty: 50 * Q, price: 1 * PP }), T({ date: '2026-04-01', side: 'sell', qty: 150 * Q, price: 15 * PP })]);
    eq(lg.rights, 1); eq(lg.units, 0); eq(lg.realizedTL, 225000 - 205000);
  });
  test('Getiri: temettü nakit çıkışı (−), bedelsiz akış değil; XIRR/TWR bedelsizden etkilenmez', function () {
    eq(PF.tradeFlow(T({ side: 'div', amount: 1000, withholding: 100 })), -900); eq(PF.tradeFlow(T({ side: 'split', ratioBp: 10000 })), 0); eq(PF.tradeFlow(T({ side: 'rights', qty: Q, price: PP })), 100);
    function st(withSplit) {
      var s = S.emptyState(); s.isExample = false;
      s.assets = [{ id: 'a1', name: 'Hisse', symbol: 'HSS', cls: 'katilim_stock', risk: 'risky', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'whole', priceKey: null, withinTierBp: null, goalId: null, halal: { status: 'uygun', note: '', source: '', date: null } }];
      s.trades = [T({ date: '2026-01-02', qty: 100 * Q, price: 10 * PP })];
      var pts = [{ d: '2026-01-02', p: 10 * PP }, { d: '2026-06-01', p: 12 * PP }];
      if (withSplit) { s.trades.push(T({ date: '2026-06-02', side: 'split', ratioBp: 10000 })); pts.push({ d: '2026-06-02', p: 6 * PP }, { d: '2026-11-01', p: 6.6 * PP }); }
      else pts.push({ d: '2026-06-02', p: 12 * PP }, { d: '2026-11-01', p: 13.2 * PP });
      s.prices = { 'm:a1': { cur: 'TRY', points: pts } };
      return s;
    }
    var a = PF.returnsReport(st(false), '2026-11-01'), b = PF.returnsReport(st(true), '2026-11-01');
    eq(a.valueNow, b.valueNow, 'aynı değer'); eq(a.flows.length, 1); eq(b.flows.length, 1, 'bedelsiz akış eklemez');
    ok(Math.abs(a.twr.period - b.twr.period) < 1e-9 && Math.abs(a.xirr - b.xirr) < 1e-9, 'getiri aynı');
    var c = st(false); c.trades.push(T({ date: '2026-07-01', side: 'div', amount: 10000, withholding: 1000 }));
    var r = PF.returnsReport(c, '2026-11-01'); eq(r.flows.length, 2); eq(r.flows[1].amount, -9000); ok(r.xirr > a.xirr, 'temettü getiriyi artırır');
  });
  test('Doğrulama: temettü/bedelsiz kuralları ve örnek veride temettü + bedelsiz var', function () {
    var ex = S.exampleState(); S.validateState(clone(ex));
    ok(ex.trades.some(function (t) { return t.side === 'div'; }) && ex.trades.some(function (t) { return t.side === 'split'; }));
    var bad = clone(ex); bad.trades.find(function (t) { return t.side === 'div'; }).withholding = 99999999;
    var threw = false; try { S.validateState(bad); } catch (e) { threw = true; } ok(threw, 'stopaj > brüt reddedilir');
    var bad2 = clone(ex); bad2.trades.find(function (t) { return t.side === 'split'; }).ratioBp = 0;
    threw = false; try { S.validateState(bad2); } catch (e) { threw = true; } ok(threw, 'oran 0 reddedilir');
  });

  /* ---------- Taşıma ---------- */
  test('v3 → v4 taşıma: kayıtlar aynen kalır, _sync ve yedek hatırlatma eklenir', function () {
    var v4 = S.exampleState(), v3 = clone(v4); v3.schema = 3; delete v3._sync; delete v3.settings.backupReminderDays;
    v3.trades = v3.trades.filter(function (t) { return t.side === 'buy' || t.side === 'sell'; });
    var out = S.validateState(clone(v3));
    eq(out.schema, S.SCHEMA_VERSION); eq(out.migratedFrom, 3); eq(out._sync, { stamps: {}, tomb: {} }); eq(out.settings.backupReminderDays, 7); eq(out.trades.length, v3.trades.length);
  });

  /* ---------- Fiyat kaynakları ---------- */
  test('TEFAS ara servis ayrıştırıcı (KTV) ve hatalı yanıt', function () {
    var r = PR.parseTefasApi({ code: 'KTV', name: 'KUVEYT TÜRK', price: 8.326309, date: '2026-11-13', active: true, history: [{ date: '2026-11-12', price: 8.318599 }, { date: '2026-11-13', price: 8.326309 }] }, 'KTV');
    eq(r.p, 8326309); eq(r.date, '2026-11-13'); eq(r.history.length, 2);
    var threw = false; try { PR.parseTefasApi({ error: 'Fon bulunamadı: ZZZ' }, 'ZZZ'); } catch (e) { threw = /bulunamadı/.test(e.message); } ok(threw);
    threw = false; try { PR.parseTefasApi({ code: 'AFA', price: 1, date: '2026-11-13' }, 'KTV'); } catch (e) { threw = true; } ok(threw, 'başka fon reddedilir');
  });
  test('TradingView BIST ayrıştırıcı', function () {
    var r = PR.parseTradingView({ totalCount: 2, data: [{ s: 'BIST:ASELS', d: [345.5, 'TRY', 1794589347, 'Aselsan'] }, { s: 'BIST:XYZ', d: [1, 'TRY', 0] }] }, ['ASELS']);
    eq(Object.keys(r), ['ASELS']); eq(r.ASELS.p, 345500000); eq(r.ASELS.currency, 'TRY'); eq(r.ASELS.date, '2026-11-13');
    eq(JSON.parse(PR.tvBody(['ASELS'])).symbols.tickers, ['BIST:ASELS']);
  });
  test('Fiyat anahtarları: tefas:/bist: TL, geçersiz kod reddedilir', function () {
    eq(PF.keyInfo('tefas:KTV').cur, 'TRY'); eq(PF.keyInfo('bist:ASELS').kind, 'stock'); eq(PF.keyInfo('tefas:K'), null); eq(PF.keyInfo('bist:asels'), null);
  });
  test('Yapıştırılan/OCR fiyat listesi: kod + fiyat, yüzde değişim atlanır', function () {
    var r = PF.parsePriceText('Fon Kodu Fiyat\nKTV 8,326309 %0,09\nASELS  345,50 TL\n13.11.2026 KTN 3,2514\nEREGL: 32.70 +1,2%\nTHYAO 1.234,50 -0,5%\nboş satır yok', P.parseDate);
    eq(r.map(function (x) { return [x.symbol, x.price, x.date]; }), [['KTV', 8326309, null], ['ASELS', 345500000, null], ['KTN', 3251400, '2026-11-13'], ['EREGL', 32700000, null], ['THYAO', 1234500000, null]]);
  });

  function run() {
    var results = [], chain = Promise.resolve();
    tests.forEach(function (t) {
      chain = chain.then(function () { return Promise.resolve().then(t.fn); }).then(function () { results.push({ name: t.name, ok: true }); }, function (e) { results.push({ name: t.name, ok: false, err: e && e.message }); });
    });
    return chain.then(function () { return results; });
  }
  if (isNode) {
    module.exports = { run: run };
    if (require.main === module) run().then(function (results) {
      var passed = results.filter(function (r) { return r.ok; }).length;
      results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
      console.log('\n' + passed + '/' + results.length + ' v5 testi geçti');
      if (passed !== results.length) process.exit(1);
    });
  } else root.runV5Tests = run;
})(typeof self !== 'undefined' ? self : this);
