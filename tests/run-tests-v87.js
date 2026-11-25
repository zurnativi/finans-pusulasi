/* v8.7.0 testleri: uzaktan düzenleme kutusu — düzenleme biçimi, uygulama (aracı kurum değiştirme: altın/bütçe durur; varlık alanı değiştirme),
 * örnek veriye uygulanmaz, uygulandı listesi, yüke yalnız kısa onay girer, iş akışı aktarımı (kutu anahtarı → cihaz anahtarı, onay dosyası, uygulanınca silme,
 * günlükte numara/sır yok), kutu betiği (sahte gh: şifreli Gist yüklemesi, onay okuma, sır yazdırmama), arayüz bağlantıları ve sürüm 8.7.0. Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  var S = require('../js/sample.js'), PF = require('../js/portfolio.js'), BG = require('../js/bgwatch.js'), IB = require('../js/inbox.js');
  var ROOT = path.join(__dirname, '..'), tests = [], NOW = Date.parse('2026-11-25T05:00:00Z'), GID = 'abcdef0123456789abcdef0123456789';
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var n = 0; function uid() { return 'id' + (++n); }
  function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fpib-')); }

  function seeded() {
    var s = S.emptyState('2026-11'); s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'Maaş hesabı', type: 'bank', currency: 'TRY', balance: 3103682, emergency: true, inNetWorth: true });
    s.transactions.push({ id: 'tx1', date: '2026-11-02', description: 'Market', amount: -18459, category: 'Market', source: 'elle', accountId: 'acc1' });
    s.assets = [
      { id: 'a-ktv', name: 'KTV fonu', symbol: 'KTV', cls: 'sukuk', risk: 'safe', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV', halal: { status: 'uygun', note: '', source: '', date: null } },
      { id: 'a-gold', name: 'Fiziki gram altın', symbol: 'ALTIN', cls: 'gold', risk: 'medium', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'metal:XAU' }
    ];
    s.trades = [
      { id: 't1', assetId: 'a-ktv', date: '2026-09-30', side: 'buy', qty: 25000000000, price: 7996840, fee: 0, currency: 'TRY', fxRate: null, note: 'eski', source: 'elle' },
      { id: 't3', assetId: 'a-gold', date: '2024-01-15', side: 'buy', qty: 11100000000, price: 2720000000, fee: 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' }
    ];
    return S.validateState(clone(s));
  }
  function broker() {
    return { format: 'finans-pusulasi-araci-kurum', version: 1, broker: 'Midas', source: 'test',
      assets: [
        { symbol: 'KTV', name: 'KTV', cls: 'sukuk', risk: 'safe', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV' },
        { symbol: 'DRVN', name: 'DRVN', cls: 'other', risk: 'risky', currency: 'USD', lot: 'whole', priceKey: null, halal: { status: 'bilinmiyor', note: '', source: '', date: null } }
      ],
      trades: [
        { symbol: 'KTV', date: '2026-11-03', time: '15:34:42', side: 'buy', qty: 71690000000, price: 8228300, fee: 0, currency: 'TRY', fxRate: null },
        { symbol: 'DRVN', date: '2026-02-08', side: 'buy', qty: 200000000, price: 15000000, fee: 150, currency: 'USD', fxRate: 435000 },
        { symbol: 'DRVN', date: '2026-03-31', side: 'sell', qty: 200000000, price: 14000000, fee: 150, currency: 'USD', fxRate: 440000 }
      ] };
  }
  function edit(id, ops) { return { format: IB.FORMAT, version: 1, id: id || 'midas-test-1', title: 'Midas işlemleri', ops: ops || [{ op: 'broker-replace', file: broker() }] }; }

  /* ---------- 1. Biçim ---------- */
  test('Biçim: geçerli düzenleme hatasız; yanlış biçim/numara/işlem/alan reddedilir', function () {
    eq(IB.errors(edit()), []);
    ok(IB.errors({ format: 'x' }).length === 1);
    ok(IB.errors(edit('a b')).some(function (m) { return /numara/.test(m); }));
    ok(IB.errors(edit('ok-id', [{ op: 'rm-rf' }])).some(function (m) { return /bilinmeyen/.test(m); }));
    ok(IB.errors(edit('ok-id', [{ op: 'asset-set', symbol: 'KTV', set: { value: 5 } }])).some(function (m) { return /değiştirilemez/.test(m); }));
    ok(IB.errors(edit('ok-id', [{ op: 'asset-set', symbol: 'KTV', set: { halal: { status: 'belki' } } }])).some(function (m) { return /helal/.test(m); }));
    var bad = broker(); bad.trades[0].qty = -1; ok(IB.errors(edit('ok-id', [{ op: 'broker-replace', file: bad }])).some(function (m) { return /adet/.test(m); }));
    ok(IB.errors(edit('ok-id', [])).length > 0);
  });

  /* ---------- 2. Uygulama ---------- */
  test('Uygula: aracı kurum değiştirme — dosyadaki varlıkların alım-satımı değişir, altın ve bütçe durur; özet Türkçe', function () {
    var s = seeded(), before = clone(s), lines = IB.apply(s, edit(), uid);
    s = S.validateState(clone(s));
    var gold = s.assets.filter(function (a) { return a.symbol === 'ALTIN'; })[0]; ok(gold, 'altın durur');
    eq(s.trades.filter(function (t) { return t.assetId === gold.id; }).length, 1); eq(s.trades.filter(function (t) { return t.assetId === gold.id; })[0].qty, 11100000000);
    eq(s.accounts, before.accounts); eq(s.transactions, before.transactions);
    var ktv = s.trades.filter(function (t) { return t.assetId === 'a-ktv'; }); eq(ktv.length, 1); eq(ktv[0].qty, 71690000000);
    ok(s.assets.some(function (a) { return a.symbol === 'DRVN'; }));
    ok(/Midas: 3 alım-satım, 2 varlık \(1 yeni, 1 güncellendi\), 1 açık pozisyon/.test(lines[0]), lines[0]);
  });
  test('Uygula: asset-set ile helal etiketi/ad/risk; bilinmeyen sembol ve örnek veri reddedilir; önizleme durumu değiştirmez', function () {
    var s = seeded(); IB.apply(s, edit(), uid);
    var e2 = edit('drvn-helal', [{ op: 'asset-set', symbol: 'drvn', set: { halal: { status: 'supheli', note: 'tarama bekliyor', source: 'Zoya', date: '2026-11-25' }, risk: 'risky' } }]);
    var snap = JSON.stringify(s), pv = IB.preview(s, e2); ok(pv.ok); eq(JSON.stringify(s), snap, 'önizleme değiştirmez');
    var l = IB.apply(s, e2, uid); var d = s.assets.filter(function (a) { return a.symbol === 'DRVN'; })[0];
    eq(d.halal, { status: 'supheli', note: 'tarama bekliyor', source: 'Zoya', date: '2026-11-25' }); ok(/DRVN: risk, helal: Şüpheli/.test(l[0]), l[0]);
    var p3 = IB.preview(s, edit('yok-1', [{ op: 'asset-set', symbol: 'YOKBU', set: { name: 'x' } }])); ok(!p3.ok && /bulunamadı/.test(p3.error));
    var ex = seeded(); ex.isExample = true; var p4 = IB.preview(ex, edit()); ok(!p4.ok && /örnek veri/.test(p4.error));
  });
  test('Uygulandı listesi: tekrar yok, en çok 20, kısa alanlar; seen', function () {
    var l = []; for (var i = 0; i < 25; i++) l = IB.record(l, { id: 'edit-' + i, at: 'x', ok: true, lines: ['a'] });
    eq(l.length, 20); eq(l[0].id, 'edit-5'); l = IB.record(l, { id: 'edit-10', at: 'y', ok: false, error: 'z' }); eq(l.length, 20); eq(l[19].id, 'edit-10'); ok(IB.seen(l, 'edit-10') && !IB.seen(l, 'edit-1'));
    eq(IB.ackList([{ id: 'bad id' }, null, { id: 'good-1', lines: [] }]).map(function (a) { return a.id; }), ['good-1']);
  });
  test('Yük: onay listesi yalnız verilince girer (bütçe ayrıntısı yine girmez)', function () {
    var s = seeded(), p = BG.slice(s, NOW, 'T', {}); ok(!('inboxAck' in p));
    var p2 = BG.slice(s, NOW, 'T', { inboxAck: [{ id: 'a-1', at: 'x', ok: true, lines: [] }] }); eq(p2.inboxAck.length, 1); ok(!p2.state.transactions);
  });

  /* ---------- 3. İş akışı aktarımı ---------- */
  function runJob(env, md, out) {
    return new Promise(function (res) {
      var c = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'portfolio_job.js'), md, out], { env: Object.assign({}, process.env, { BG_NO_NET: '1', BG_NOW: new Date(NOW).toISOString(), GITHUB_ACTIONS: '' }, env) }), buf = '';
      c.stdout.on('data', function (d) { buf += d; }); c.stderr.on('data', function (d) { buf += d; }); c.on('close', function (code) { res({ code: code, log: buf }); });
    });
  }
  function setup(state, ackList) {
    var dir = tmp(), key = BG.newKey(), kin = BG.newKey(), md = path.join(dir, 'md'), out = path.join(dir, 'out'), gist = path.join(dir, 'gist.json'), inb = path.join(dir, 'inbox.json');
    fs.mkdirSync(path.join(md, 'analysis'), { recursive: true });
    var j = { dir: dir, key: key, kin: kin, md: md, out: out, gist: gist, inb: inb, setup: BG.makeSetup({ key: key, gist: GID, topic: '' }) };
    return BG.kidOf(key).then(function (kid) { j.kid = kid; return BG.seal(key, BG.slice(state, NOW, 'Test', { inboxAck: ackList }), kid); }).then(function (env) {
      fs.writeFileSync(gist, JSON.stringify(env)); return BG.kidOf(kin);
    }).then(function (kk) { j.kidIn = kk; return BG.seal(kin, edit('midas-gizli-numara-1'), kk); }).then(function (e) { fs.writeFileSync(inb, JSON.stringify(e)); return j; });
  }
  function envOf(j, extra) { return Object.assign({ PORTFOLIO_KEY: j.setup, BG_GIST_FILE: j.gist, BG_GIST_INBOX_FILE: j.inb, FINANS_INBOX_KEY: BG.b64u(j.kin) }, extra || {}); }
  function readEnc(j, rel, key) { return BG.open(key, JSON.parse(fs.readFileSync(path.join(j.out, rel), 'utf8'))); }

  test('İş: kutu düzenlemesi cihaz anahtarıyla yeniden şifrelenir (bg/inbox.enc.json); onay dosyası kutu anahtarıyla; günlükte numara/sır yok', function () {
    return setup(seeded(), []).then(function (j) { return runJob(envOf(j, { GITHUB_ACTIONS: '1' }), j.md, j.out).then(function (a) {
      ok(/uzaktan düzenleme: durum=relayed uygulandı_kaydı=0/.test(a.log), a.log);
      ok(a.log.indexOf('midas-gizli-numara-1') < 0, 'numara günlükte yok'); ok(a.log.indexOf('::add-mask::' + BG.b64u(j.kin)) >= 0, 'anahtar maskelenir');
      ok(a.log.replace('::add-mask::' + BG.b64u(j.kin), '').indexOf(BG.b64u(j.kin)) < 0, 'anahtar başka yerde yok');
      var envIn = JSON.parse(fs.readFileSync(path.join(j.out, IB.PATH), 'utf8')); eq(envIn.kid, j.kid);
      ok(fs.readFileSync(path.join(j.out, IB.PATH), 'utf8').indexOf('Midas') < 0, 'düz metin yok');
      return readEnc(j, IB.PATH, j.key).then(function (ed) { eq(ed.id, 'midas-gizli-numara-1'); eq(ed.ops[0].file.trades.length, 3); return readEnc(j, IB.ACK_PATH, j.kin); }).then(function (ack) {
        eq(ack.relay.status, 'relayed'); eq(ack.applied, []); ok(ack.payloadAt);
        return BG.open(j.key, JSON.parse(fs.readFileSync(path.join(j.out, IB.ACK_PATH), 'utf8'))).then(function () { throw new Error('cihaz anahtarıyla açılmamalı'); }, function () { /* beklenen */ });
      });
    }); });
  });
  test('İş: cihaz uyguladıysa (yükte onay) bekleyen dosya silinir ve onay kutuya geçer; FINANS_INBOX_KEY yoksa hiçbir şey yapılmaz; yanlış zarf → silinir', function () {
    return setup(seeded(), [{ id: 'midas-gizli-numara-1', at: '2026-11-25T05:01:00Z', ok: true, lines: ['Midas: 3 alım-satım'] }]).then(function (j) {
      return runJob(envOf(j), j.md, j.out).then(function (a) {
        ok(/durum=acked uygulandı_kaydı=1/.test(a.log), a.log); ok(!fs.existsSync(path.join(j.out, IB.PATH)));
        ok(fs.readFileSync(path.join(j.out, '.delete'), 'utf8').split('\n').indexOf(IB.PATH) >= 0);
        return readEnc(j, IB.ACK_PATH, j.kin).then(function (ack) { eq(ack.applied[0].id, 'midas-gizli-numara-1'); eq(ack.applied[0].ok, true); });
      }).then(function () {
        var out2 = path.join(j.dir, 'out2'); return runJob(envOf(j, { FINANS_INBOX_KEY: '' }), j.md, out2).then(function (b) { ok(!fs.existsSync(path.join(out2, IB.PATH)) && !fs.existsSync(path.join(out2, IB.ACK_PATH)) && !fs.existsSync(path.join(out2, '.delete'))); ok(fs.existsSync(path.join(out2, BG.RESULT_PATH)), b.log); });
      }).then(function () {
        var out3 = path.join(j.dir, 'out3'); return runJob(envOf(j, { FINANS_INBOX_KEY: BG.b64u(BG.newKey()) }), j.md, out3).then(function (c) { ok(/durum=bad_box_envelope/.test(c.log), c.log); ok(!fs.existsSync(path.join(out3, IB.PATH))); });
      });
    });
  });

  /* ---------- 4. Kutu betiği (sahte gh) ---------- */
  function fakeGh(dir, ackEnv) {
    var log = path.join(dir, 'gh.log'), stub = path.join(dir, 'gh');
    fs.writeFileSync(path.join(dir, 'ack.json'), ackEnv ? JSON.stringify({ content: Buffer.from(JSON.stringify(ackEnv)).toString('base64') }) : '');
    fs.writeFileSync(stub, '#!/usr/bin/env node\nvar fs=require("fs"),a=process.argv.slice(2),inp="";try{inp=fs.readFileSync(0,"utf8")}catch(e){}\n' +
      'fs.appendFileSync(' + JSON.stringify(log) + ',JSON.stringify({a:a,inp:inp})+"\\n");\n' +
      'if(a[0]==="api"&&/inbox-ack/.test(a[1]||"")){var t=fs.readFileSync(' + JSON.stringify(path.join(dir, 'ack.json')) + ',"utf8");if(!t){console.error("HTTP 404 Not Found");process.exit(1)}process.stdout.write(t);process.exit(0)}\n' +
      'if(a[0]==="api"&&/contents\\/bg\\/inbox(\\.v2)?\\.enc/.test(a[1]||"")){console.error("HTTP 404 Not Found");process.exit(1)}\n' +
      'process.stdout.write("{}");\n', { mode: 0o755 });
    return { stub: stub, log: log, calls: function () { return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []; } };
  }
  function runBox(args, env) { var r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'push-edit.js')].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, env) }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; }

  test('Kutu betiği: init anahtar üretir (0600), sırrı stdin ile ayarlar, değeri yazdırmaz; push şifreli yükler ve iş akışını başlatır', function () {
    var dir = tmp(), g = fakeGh(dir), kf = path.join(dir, 'k', 'inbox.key'), home = path.join(dir, 'home');
    var env = { FINANS_GH: g.stub, FINANS_INBOX_KEY_FILE: kf, FINANS_GIST_ID: GID, HOME: home, FINANS_INBOX_KEY: '' };
    fs.mkdirSync(path.dirname(kf)); var r = runBox(['init'], env); eq(r.code, 0, r.out);
    var k = fs.readFileSync(kf, 'utf8').trim(); eq(BG.unb64u(k).length, 32); eq(fs.statSync(kf).mode & 0o777, 0o600); ok(r.out.indexOf(k) < 0, 'anahtar yazdırılmaz');
    var sec = g.calls().filter(function (c) { return c.a[0] === 'secret'; })[0]; eq(sec.a.slice(0, 3), ['secret', 'set', 'FINANS_INBOX_KEY']); eq(sec.inp, k); ok(sec.a.join(' ').indexOf(k) < 0, 'anahtar komut satırında değil');
    var f = path.join(dir, 'midas.json'); fs.writeFileSync(f, JSON.stringify(broker()));
    var p = runBox(['push', f, '--id', 'midas-2026-11-25'], env); eq(p.code, 0, p.out); ok(p.out.indexOf(k) < 0);
    var calls = g.calls(), patch = calls.filter(function (c) { return c.a[0] === 'api' && c.a[2] === 'PATCH'; })[0]; eq(patch.a[3], '/gists/' + GID);
    ok(calls.some(function (c) { return c.a[0] === 'workflow' && c.a[2] === 'market-portfolio.yml'; }));
    var body = JSON.parse(patch.inp), env2 = JSON.parse(body.files[IB.GIST_FILE].content); ok(patch.inp.indexOf('Midas') < 0, 'Gist\'e düz metin gitmez');
    ok(Object.keys(body.files).length === 1, 'cihazın dosyasına dokunulmaz');
    return BG.open(BG.unb64u(k), env2).then(function (ed) { eq(ed.id, 'midas-2026-11-25'); eq(ed.ops[0].op, 'broker-replace'); eq(IB.errors(ed), []); });
  });
  test('Kutu betiği: check onayı çözer — uygulandıysa çıkış 0, bekliyorsa 2; geçersiz dosya push edilmez', function () {
    var dir = tmp(), kin = BG.newKey(), home = path.join(dir, 'home');
    return BG.kidOf(kin).then(function (kk) { return BG.seal(kin, { v: 1, kind: 'finans-inbox-ack', generatedAt: '2026-11-25T05:10:00Z', run: '1', payloadAt: '2026-11-25T05:05:00Z', relay: { status: 'acked', editId: 'midas-2026-11-25', errors: null }, applied: [{ id: 'midas-2026-11-25', at: '2026-11-25T05:04:00Z', ok: true, lines: ['Midas: 54 alım-satım'], error: null }] }, kk); }).then(function (ackEnv) {
      var g = fakeGh(dir, ackEnv), env = { FINANS_GH: g.stub, FINANS_INBOX_KEY: BG.b64u(kin), FINANS_GIST_ID: GID, HOME: home };
      var r = runBox(['check', '--id', 'midas-2026-11-25'], env); eq(r.code, 0, r.out); ok(/UYGULANDI ✓/.test(r.out) && /08:10 TSİ/.test(r.out), r.out); ok(r.out.indexOf(BG.b64u(kin)) < 0);
      var r2 = runBox(['check', '--id', 'baska-1'], env); eq(r2.code, 2, r2.out);
      var bad = path.join(dir, 'bad.json'), b = broker(); b.trades[0].price = 0; fs.writeFileSync(bad, JSON.stringify(b));
      var r3 = runBox(['push', bad], env); eq(r3.code, 1); ok(/geçersiz/.test(r3.out)); ok(!g.calls().some(function (c) { return c.a[2] === 'PATCH'; }));
    });
  });

  /* ---------- 5. Arayüz ve sürüm ---------- */
  test('Arayüz: açılışta/arka planda kutu okunur; önce otomatik kopya sonra mutate (Geri al); uygulandı kaydı + yükleme; kart', function () {
    var ui = fs.readFileSync(path.join(ROOT, 'js', 'bgwatch-ui.js'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    ok(/function pullInbox\(\)/.test(ui) && /X\.render\(\); pullInbox\(\); return r;/.test(ui), 'sonuç çekilince kutu da okunur');
    ok(/env\.kid !== cfg\.kid\) return null; return BG\.open\(keyOf\(\), env\)\.then\(applyEdit\)/.test(ui));
    ok(/IB\.done\(inbox\.applied, edit\.id\)/.test(ui), 'aynı numara iki kez uygulanmaz');
    var iSnap = ui.indexOf("X.snapshot('Uzaktan düzenleme öncesi: '"), iMut = ui.indexOf('X.mutate(function (s) { try { lines = IB.apply(s, edit, X.uid)'); ok(iSnap > 0 && iMut > iSnap, 'önce kopya, sonra uygulama');
    ok(/window\.Store\.setSecret\('bgwatch-inbox', inbox\)/.test(ui) && /saveInbox\(\)\.then\(function \(\) \{ return upload\('auto'\); \}\)/.test(ui));
    ok(/inboxAck: IB \? IB\.ackList\(inbox\.applied\) : \[\]/.test(ui) && /function sigText\(p\)/.test(ui));
    ok(/Uzaktan düzenlemeler/.test(ui) && /wizardOn\(\) \+ inboxCard\(\)/.test(ui));
    ok(/mutate: mutate, uid: S\.uid, snapshot: function \(r\)/.test(app), 'app.js mutate/uid/snapshot verir');
  });
  test('Akış/depo: market-portfolio.yml FINANS_INBOX_KEY yalnız iş adımında; betiklerde sır yok; publish yalnız bg/', function () {
    var y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'market-portfolio.yml'), 'utf8');
    eq((y.match(/FINANS_INBOX_KEY: \$\{\{ secrets\.FINANS_INBOX_KEY \}\}/g) || []).length, 1);
    ok(IB.PATH.indexOf('bg/') === 0 && IB.ACK_PATH.indexOf('bg/') === 0);
    var box = fs.readFileSync(path.join(ROOT, 'tools', 'push-edit.js'), 'utf8'); ok(!/console\.(log|error)\([^;]*(keyText\(\)|process\.env\.FINANS_INBOX_KEY)/.test(box));
  });
  test('Sürüm: index.html ve sw.js 8.8.3; inbox.js bgwatch.js\'ten önce ve çevrimdışı kabukta', function () {
    var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(/VERSION = '8\.8\.3'/.test(sw)); ok(idx.indexOf('js/app.js?v=8.8.3') > 0); ok(idx.indexOf('8.7.1') < 0);
    var a = idx.indexOf('js/inbox.js?v=8.8.3'), b = idx.indexOf('js/bgwatch.js?v=8.8.3'), c = idx.indexOf('js/portfolio.js?v=8.8.3'); ok(a > c && b > a);
    ok(/'inbox', 'bgwatch', 'bgwatch-ui'/.test(sw));
  });

  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.7.0 testi geçti');
    if (passed !== results.length) process.exit(1);
  });
})();
