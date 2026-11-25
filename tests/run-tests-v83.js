/* v8.3 testleri: şifreli kişisel veri paketi — şifreleme gidiş-dönüş, yanlış parola/kurcalama reddi, örnek verinin tamamen değişmesi,
 * "zaten uygulandı" atlama, güncelleme teklifi, şifreleme betiği (zayıf parola reddi, düz metin sızıntısı yok), depo/önbellek denetimi.
 * Çalıştırma: node tests/run-tests-v83.js (run-tests.js de çalıştırır). Ağ gerekmez. Test parolası yalnızca bu dosyadadır, gerçek parola değildir. */
(function () {
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  var CB = require('../js/cryptobox.js'), S = require('../js/sample.js'), PD = require('../js/personal.js');
  var ROOT = path.join(__dirname, '..'), tests = [], TESTPASS = 'test-parolasi-Uzun-ve-guclu-42';
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function rejects(p, code, msg) { return p.then(function () { throw new Error(msg || 'hata bekleniyordu'); }, function (e) { if (code && e.code !== code) throw new Error((msg || '') + ' kod ' + e.code + ' ≠ ' + code + ': ' + e.message); return e; }); }
  var ITER = 100000; // testte hızlı (üretimde 2.000.000)

  function realState() { // sentetik "gerçek" yedek (örnek değil, kişisel gizli işaretlerle)
    var s = S.emptyState(); s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'GİZLİ-HESAP-ADI', type: 'bank', currency: 'TRY', balance: 1234567, openingBalance: 1234567, openingDate: '2026-01-01' });
    s.incomes.push({ id: 'i1', name: 'GİZLİ-GELİR', amount: 7670947 }); s.expenses.push({ id: 'e1', name: 'Kira', type: 'fixed', amount: 1500000 });
    s.transactions.push({ id: 't1', date: '2026-11-01', amount: -123400, desc: 'GİZLİ-HARCAMA-AÇIKLAMASI', accountId: 'acc1', cat: 'market', source: 'ekstre' });
    s.exportedAt = '2026-11-18T10:00:00Z'; s.app = 'Finans Pusulası';
    return S.validateState(s);
  }
  function bundleOf(obj, pass, id) { return CB.encryptJson(obj, pass, { iter: ITER, meta: { kind: PD.KIND, bundleId: id || 'a1b2c3d4e5f60718', createdAt: '2026-11-18T10:00:00Z' } }); }
  function restoreInto(state, obj) { Object.keys(state).forEach(function (k) { delete state[k]; }); Object.keys(obj).forEach(function (k) { state[k] = obj[k]; }); return state; } // app.js restoreState ile aynı

  test('Paket: şifrele → aç gidiş-dönüş; veri birebir, paket kimliği eklenir, şifreli metinde düz metin yok', function () {
    var src = realState(); return bundleOf(src, TESTPASS).then(function (env) {
      ok(PD.validEnvelope(env)); eq(env.alg, 'AES-256-GCM'); eq(env.kdf.name, 'PBKDF2'); ok(env.kdf.iter >= 100000);
      var raw = JSON.stringify(env); ok(raw.indexOf('GİZLİ') < 0 && raw.indexOf('transactions') < 0 && raw.indexOf('Kira') < 0, 'düz metin sızmamalı');
      return PD.unlock(env, TESTPASS).then(function (o) {
        eq(o.personalBundleId, 'a1b2c3d4e5f60718'); ok(!('exportedAt' in o) && !('app' in o));
        eq(o.transactions, src.transactions); eq(o.accounts, src.accounts); eq(PD.counts(o), PD.counts(src)); eq(o.isExample, false);
      });
    });
  });
  test('Paket: tuz ve IV her şifrelemede rastgele (aynı veri, aynı parola → farklı çıktı)', function () {
    var src = realState(); return Promise.all([bundleOf(src, TESTPASS), bundleOf(src, TESTPASS)]).then(function (e) {
      ok(e[0].kdf.salt !== e[1].kdf.salt && e[0].iv !== e[1].iv && e[0].ct !== e[1].ct); eq(CB.unb64(e[0].kdf.salt).length, 16); eq(CB.unb64(e[0].iv).length, 12);
    });
  });
  test('Yanlış parola reddedilir (BAD_PASSWORD), boş parola da; doğru parola sonra yine çalışır', function () {
    return bundleOf(realState(), TESTPASS).then(function (env) {
      return rejects(PD.unlock(env, 'yanlis-parola-123456'), 'BAD_PASSWORD').then(function () { return rejects(PD.unlock(env, ''), 'BAD_PASSWORD'); })
        .then(function () { return rejects(PD.unlock(env, TESTPASS + ' '), 'BAD_PASSWORD', 'sondaki boşluk farklı parola'); }).then(function () { return PD.unlock(env, TESTPASS); }).then(function (o) { ok(o.transactions.length === 1); });
    });
  });
  test('Kurcalama: şifreli metin / IV / tuz / tur sayısı değişirse açılmaz; biçim dışı paket geçersiz', function () {
    return bundleOf(realState(), TESTPASS).then(function (env) {
      function mut(f) { var c = JSON.parse(JSON.stringify(env)); f(c); return c; }
      var flip = function (s) { return s.slice(0, 8) + (s[8] === 'A' ? 'B' : 'A') + s.slice(9); };
      return Promise.all([rejects(PD.unlock(mut(function (c) { c.ct = flip(c.ct); }), TESTPASS), 'BAD_PASSWORD'), rejects(PD.unlock(mut(function (c) { c.iv = flip(c.iv); }), TESTPASS), 'BAD_PASSWORD'),
        rejects(PD.unlock(mut(function (c) { c.kdf.salt = flip(c.kdf.salt); }), TESTPASS), 'BAD_PASSWORD'), rejects(PD.unlock(mut(function (c) { c.kdf.iter = 100001; }), TESTPASS), 'BAD_PASSWORD'),
        rejects(PD.unlock(mut(function (c) { delete c.bundleId; }), TESTPASS), 'BAD_DATA'), rejects(PD.unlock(mut(function (c) { c.kind = 'x'; }), TESTPASS), 'BAD_DATA'), rejects(PD.unlock(null, TESTPASS), 'BAD_DATA')]);
    });
  });
  test('Paket örnek veri içeriyorsa / doğrulanamıyorsa uygulanmaz (BAD_DATA), cihazdaki veri değişmez', function () {
    var ex = S.exampleState('2026-11', '2026-11-18'), bad = realState(); bad.accounts[0].balance = 1.5;
    return Promise.all([bundleOf(ex, TESTPASS), bundleOf(bad, TESTPASS)]).then(function (e) { return Promise.all([rejects(PD.unlock(e[0], TESTPASS), 'BAD_DATA'), rejects(PD.unlock(e[1], TESTPASS), 'BAD_DATA')]); });
  });
  test('Örnek veri tamamen değişir: karar "first", geri yükleme sonrası örnek izi kalmaz, sayılar paketle aynı', function () {
    var st = S.exampleState('2026-11', '2026-11-18'); ok(PD.isSampleOrEmpty(st)); ok(PD.sampleLeftovers(st).length > 0, 'örnekte iz var');
    return bundleOf(realState(), TESTPASS).then(function (env) {
      eq(PD.decide(st, env, null, null), 'first');
      return PD.unlock(env, TESTPASS).then(function (o) {
        restoreInto(st, o); eq(PD.sampleLeftovers(st), []); eq(st.isExample, false); ok(!st.nwExample); eq(st.transactions.length, 1); eq(st.accounts.length, 1);
        ok(!JSON.stringify(st).includes('örnek'), 'örnek kaynağı kalmamalı'); S.validateState(JSON.parse(JSON.stringify(st)));
        eq(PD.decide(st, env, null, null), 'none', 'uygulanmış paket tekrar sorulmaz (state.personalBundleId)');
      });
    });
  });
  test('Boş cihaz (veri yok) → "first"; gerçek veri varsa → "update" (sessizce üzerine yazılmaz)', function () {
    return bundleOf(realState(), TESTPASS).then(function (env) {
      eq(PD.decide(S.emptyState(), env, null, null), 'first'); eq(PD.decide(null, env, null, null), 'first');
      var mine = S.emptyState(); mine.isExample = false; mine.transactions.push({ id: 'x', date: '2026-11-02', amount: -100, desc: 'benim', accountId: 'a', cat: 'market' }); mine.accounts.push({ id: 'a', name: 'H', type: 'bank', currency: 'TRY', balance: 0 });
      eq(PD.decide(mine, env, null, null), 'update'); ok(!PD.isSampleOrEmpty(mine));
    });
  });
  test('Zaten uygulandı → atlanır: cihaz izi, durum izi, bu oturumda "geç" ve geçersiz paket', function () {
    return bundleOf(realState(), TESTPASS, '0011223344556677').then(function (env) {
      var st = S.exampleState('2026-11', '2026-11-18');
      eq(PD.decide(st, env, '0011223344556677', null), 'none', 'cihaz izi'); eq(PD.decide(st, env, 'baska-paket', null), 'first', 'başka paket kimliği yeniden sorar');
      eq(PD.decide(st, env, null, '0011223344556677'), 'none', 'geç'); var s2 = S.exampleState('2026-11', '2026-11-18'); s2.personalBundleId = '0011223344556677'; eq(PD.decide(s2, env, null, null), 'none', 'durum izi');
      eq(PD.decide(st, { format: 'x' }, null, null), 'none'); eq(PD.decide(st, null, null, null), 'none');
    });
  });
  test('Cihaz izi parola içermez: yalnızca paket kimliği tutulur (kod incelemesi)', function () {
    var src = fs.readFileSync(path.join(ROOT, 'js', 'personal.js'), 'utf8');
    ok(!/localStorage\.setItem\([^)]*pass/i.test(src) && !/sessionStorage\.setItem\([^)]*pass/i.test(src) && !/console\.\w+\([^)]*pass/i.test(src), 'parola depolanmaz/yazdırılmaz');
    ok(/markApplied\(env\.bundleId\)/.test(src));
  });

  /* ---------- Şifreleme betiği ---------- */
  function runTool(pass, extra) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp83-')), inp = path.join(dir, 'duz.json'), out = path.join(dir, 'cikti.enc.json');
    fs.writeFileSync(inp, JSON.stringify(realState()));
    var env = Object.assign({}, process.env, extra || {}); delete env.FINANS_DATA_PASSWORD; if (pass != null) env.FINANS_DATA_PASSWORD = pass;
    var r = cp.spawnSync('node', [path.join(ROOT, 'tools', 'encrypt_personal.js'), inp, out], { encoding: 'utf8', env: env });
    return { r: r, out: out, dir: dir };
  }
  test('Betik: parola yalnızca ortam değişkeninden; yoksa ve zayıfsa (6 haneli PIN, kısa) reddeder, çıktı üretmez', function () {
    var a = runTool(null); ok(a.r.status === 2 && !fs.existsSync(a.out));
    ['123456', 'kisa', 'sadece-rakam-yok1'.slice(0, 11), '12345678901234567'].forEach(function (p) { var b = runTool(p); ok(b.r.status === 3, 'zayıf reddedilmeli: ' + p.length + ' karakter'); ok(!fs.existsSync(b.out)); ok((b.r.stdout + b.r.stderr).indexOf(p) < 0, 'parola yazdırılmamalı'); });
  });
  test('Betik: güçlü parolayla şifreler (6.000.000 tur), geri açılır, çıktı/günlükte parola ve düz metin yok', function () {
    var t = runTool(TESTPASS); ok(t.r.status === 0, t.r.stderr); var env = JSON.parse(fs.readFileSync(t.out, 'utf8'));
    eq(env.kdf.iter, 6000000); ok(PD.validEnvelope(env)); ok(/^[0-9a-f]{16}$/.test(env.bundleId));
    var all = t.r.stdout + t.r.stderr + fs.readFileSync(t.out, 'utf8'); ok(all.indexOf(TESTPASS) < 0 && all.indexOf('GİZLİ') < 0 && all.indexOf('transactions') < 0);
    return PD.unlock(env, TESTPASS).then(function (o) { eq(o.transactions[0].desc, 'GİZLİ-HARCAMA-AÇIKLAMASI'); return rejects(PD.unlock(env, 'yanlis-parola-123456'), 'BAD_PASSWORD'); });
  });
  test('Betik: depo klasörünün içindeki düz yedeği reddeder (yanlışlıkla commit edilmesin)', function () {
    var inp = path.join(ROOT, 'tests', '_gecici-duz.json'); fs.writeFileSync(inp, '{}');
    try { var r = cp.spawnSync('node', [path.join(ROOT, 'tools', 'encrypt_personal.js'), inp, path.join(os.tmpdir(), 'x.enc.json')], { encoding: 'utf8', env: Object.assign({}, process.env, { FINANS_DATA_PASSWORD: TESTPASS }) }); eq(r.status, 2); }
    finally { fs.unlinkSync(inp); }
  });

  /* ---------- Depo / önbellek denetimi ---------- */
  test('Depo: data/ yalnızca şifreli paket içerir; varsa geçerli, ≥1.000.000 tur, düz metin izi yok', function () {
    var d = path.join(ROOT, 'data'); if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach(function (f) { eq(f, 'kisisel-veri.enc.json', 'data/ içinde yalnızca şifreli paket olmalı'); });
    var raw = fs.readFileSync(path.join(d, 'kisisel-veri.enc.json'), 'utf8'), env = JSON.parse(raw);
    ok(PD.validEnvelope(env)); ok(env.kdf.iter >= 6000000, 'tur sayısı'); eq(env.alg, 'AES-256-GCM');
    ['"transactions"', '"accounts"', 'Ziraat', 'amount', 'isExample'].forEach(function (m) { ok(raw.indexOf(m) < 0, 'düz metin izi: ' + m); });
    return rejects(PD.unlock(env, 'yanlis-parola-123456'), 'BAD_PASSWORD');
  });
  test('Depo: düz kişisel yedek dosyası (gercek-veri / finans-yedek) hiçbir yerde izlenmiyor', function () {
    var out = cp.spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }); if (out.status !== 0) return;
    var bad = out.stdout.split('\n').filter(function (f) { return /gercek-veri|finans-yedek|finans-pusulasi-.*\.json$/.test(f) || (/^data\//.test(f) && !/kisisel-veri\.enc\.json$/.test(f)); }); eq(bad, []);
  });
  test('Sürüm: index.html ve sw.js 8.7.4; personal.js hem sayfada hem çevrimdışı kabukta; paket dosyası önbelleğe alınmaz', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(/js\/personal\.js\?v=8\.7\.4/.test(idx)); ok(idx.indexOf('8.2.1') < 0 && /VERSION = '8\.7\.4'/.test(sw)); ok(/'personal'/.test(sw));
    ok(idx.indexOf('personal.js') < idx.indexOf('js/app.js'), 'app.js\'ten önce yüklenmeli');
    ok(!/kisisel-veri/.test(sw), 'SW paketi önbelleğe almamalı (sürümsüz URL, ?v= yok)'); ok(/cache: 'no-store'/.test(fs.readFileSync(path.join(ROOT, 'js', 'personal.js'), 'utf8')));
  });
  test('Paket getirme: 404/ağ hatası/geçersiz içerik → null (uygulama normal açılır)', function () {
    var f1 = function () { return Promise.resolve({ ok: false }); }, f2 = function () { return Promise.reject(new Error('net')); }, f3 = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ a: 1 }); } }); };
    return Promise.all([PD.fetchBundle(f1), PD.fetchBundle(f2), PD.fetchBundle(f3)]).then(function (r) { eq(r, [null, null, null]); });
  });


  /* ---------- v8.4.0: Net varlık dökümü ---------- */
  var L = require('../js/ledger.js'), C = require('../js/calc.js'), PF = require('../js/portfolio.js');
  function nwState() { // gerçek veriye benzer: yatırımlar + banka + kart borcu + gelecek taksit
    var s = S.emptyState(); s.isExample = false;
    s.accounts.push({ id: 'bk', name: 'Banka', type: 'bank', currency: 'TRY', balance: 3103682, inNetWorth: true, emergency: true });
    s.accounts.push({ id: 'kk', name: 'Kart', type: 'card', currency: 'TRY', balance: -3523397, inNetWorth: true, card: { statementDay: 14, dueDay: 24, limit: 20000000, statementDebt: 3523397, statementYm: '2026-11', paid: 0, remindDays: 3 } });
    s.assets.push({ id: 'a1', name: 'Altın', cls: 'gold', risk: 'medium', value: 83250000, tracking: 'manual', currency: 'TRY' }, { id: 'a2', name: 'Fon', cls: 'katilim_fund', risk: 'safe', value: 5114788, tracking: 'manual', currency: 'TRY' });
    s.installments.push({ id: 'i1', cardId: 'kk', description: 'Araç', category: 'Ulaşım', total: 16000000, count: 9, firstYm: '2026-08' });
    return S.validateState(s);
  }
  test('Net varlık dökümü: yatırım + nakit = toplam birikim; − kart borcu − gelecek taksit = net varlık; uygulamadaki net varlıkla birebir aynı', function () {
    var s = nwState(), T = '2026-11-18', b = L.netWorthBreakdown(s, T), an = C.analyze(L.effectiveState(s, T), '2026-11');
    eq(b.investments, 83250000 + 5114788); eq(b.cash, 3103682); eq(b.gross, b.investments + b.cash); eq(b.cardDebt, 3523397);
    ok(b.futureInstallments > 0, 'gelecek taksit var'); eq(b.debts, b.cardDebt + b.futureInstallments + b.otherDebts); eq(b.net, b.gross - b.debts);
    eq(b.gross, an.assets.total, 'toplam birikim = Portföy Yönetimi kartı'); eq(b.debts, an.assets.debts); eq(b.net, an.assets.netWorth, 'net varlık = Ana sayfa');
  });
  test('Net varlık dökümü: hesap kuru yoksa dışarıda kalır ve söylenir; diğer borçlar ayrı satır; kartın artı bakiyesi nakit sayılır', function () {
    var s = nwState(), T = '2026-11-18'; s.accounts.push({ id: 'usd', name: 'Dolar', type: 'cash', currency: 'USD', balance: 10000, inNetWorth: true }); s.debts.push({ id: 'd1', name: 'Borç', amount: 100000 });
    var b = L.netWorthBreakdown(S.validateState(s), T), an = C.analyze(L.effectiveState(s, T), '2026-11'); eq(b.missingRates, ['Dolar']); eq(b.otherDebts, 100000); eq(b.net, an.assets.netWorth);
  });
  test('Net varlık dökümü: ekranda satırlar ve açıklama var (Ana sayfa) ve Portföy kartı net varlığa yönlendirir', function () {
    var app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), pui = fs.readFileSync(path.join(ROOT, 'js', 'portfolio-ui.js'), 'utf8');
    ok(/Net varlık nasıl hesaplandı\?/.test(app) && /netWorthBreakdownHtml\)/.test(app) && /Gelecek taksitler/.test(app) && /Kredi kartı borcu/.test(app) && /Toplam birikim/.test(app));
    ok(/Acil fon dahil değildir/.test(pui) && /banka nakdi ve borçlar dahil değildir/.test(pui));
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.3 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
