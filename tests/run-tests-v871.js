/* v8.7.1 testleri: uzaktan düzenlemede "tüm varlıkları temizle" (holdings-wipe) + aracı kurum geçmişi — altın dahil tüm varlıklar, alım-satımlar, stoplar,
 * uyarılar ve fiyat geçmişi silinir, bütçe durur; yalnız ilk işlem olabilir; eski sürümün tanımadığı işlem yeni sürümde yeniden denenir; iş akışı yeni yola yazar,
 * eski yolu siler; yeni sürüm kendiliğinden devreye girer (yazarken yenilemez). Ağ gerekmez. */
(function () {
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  var S = require('../js/sample.js'), BG = require('../js/bgwatch.js'), IB = require('../js/inbox.js');
  var ROOT = path.join(__dirname, '..'), tests = [], NOW = Date.parse('2026-11-25T05:00:00Z'), GID = 'abcdef0123456789abcdef0123456789';
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'koşul sağlanmadı'); }
  function eq(a, b, msg) { var A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' beklenen ' + B + ', gelen ' + A); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var n = 0; function uid() { return 'id' + (++n); }
  function seeded() {
    var s = S.emptyState('2026-11'); s.isExample = false;
    s.accounts.push({ id: 'acc1', name: 'Maaş hesabı', type: 'bank', currency: 'TRY', balance: 3103682, emergency: true, inNetWorth: true });
    s.transactions.push({ id: 'tx1', date: '2026-11-02', description: 'Market', amount: -18459, category: 'Market', source: 'elle', accountId: 'acc1' });
    s.assets = [
      { id: 'a-ktv', name: 'KTV fonu', symbol: 'KTV', cls: 'sukuk', risk: 'safe', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV' },
      { id: 'a-gold', name: 'Fiziki gram altın', symbol: 'ALTIN', cls: 'gold', risk: 'medium', emergency: false, value: 0, tracking: 'trades', currency: 'TRY', lot: 'fraction', priceKey: 'metal:XAU' }
    ];
    s.trades = [
      { id: 't1', assetId: 'a-ktv', date: '2026-09-30', side: 'buy', qty: 25000000000, price: 7996840, fee: 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' },
      { id: 't3', assetId: 'a-gold', date: '2024-01-15', side: 'buy', qty: 11100000000, price: 2720000000, fee: 0, currency: 'TRY', fxRate: null, note: '', source: 'elle' }
    ];
    s.prices = { 'metal:XAU': { points: [{ d: '2026-11-20', p: 5800000000 }] }, 'tefas:KTV': { points: [{ d: '2026-11-20', p: 8300000 }] } };
    s.analysis = { watchlist: [], profile: {}, alerts: [{ id: 'al1', key: 'metal:XAU', level: 1, dir: 'below' }], stopLog: [{ id: 's1' }], stopState: { 'metal:XAU': { x: 1 } } };
    return S.validateState(clone(s));
  }
  function broker() {
    return { format: 'finans-pusulasi-araci-kurum', version: 1, broker: 'Midas', source: 'test',
      assets: [{ symbol: 'KTV', name: 'KTV', cls: 'sukuk', risk: 'safe', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KTV' }, { symbol: 'KPC', name: 'KPC', cls: 'sukuk', risk: 'safe', currency: 'TRY', lot: 'fraction', priceKey: 'tefas:KPC' }],
      trades: [{ symbol: 'KTV', date: '2026-11-03', side: 'buy', qty: 71690000000, price: 8228300, fee: 0, currency: 'TRY', fxRate: null }, { symbol: 'KPC', date: '2026-11-04', side: 'buy', qty: 12200000000, price: 20334000, fee: 0, currency: 'TRY', fxRate: null }] };
  }
  function edit(ops, id) { return { format: IB.FORMAT, version: 1, id: id || 'midas-only-test', title: 'Yalnız Midas', ops: ops || [{ op: 'holdings-wipe' }, { op: 'broker-replace', file: broker() }] }; }

  test('Temizle + Midas: altın dahil tüm varlıklar, alım-satımlar, uyarılar, stop kayıtları ve fiyat geçmişi silinir; yalnız dosyadakiler kalır; bütçe durur', function () {
    var s = seeded(), before = clone(s), lines = IB.apply(s, edit(), uid); s = S.validateState(clone(s));
    eq(s.assets.map(function (a) { return a.symbol; }).sort(), ['KPC', 'KTV']); ok(!s.assets.some(function (a) { return a.symbol === 'ALTIN'; }), 'altın silindi');
    eq(s.trades.length, 2); ok(!s.trades.some(function (t) { return t.assetId === 'a-gold' || t.assetId === 'a-ktv'; }), 'eski kayıtlar yok');
    eq(s.analysis.alerts, []); eq(s.analysis.stopLog, []); eq(s.analysis.stopState, {}); ok(!s.prices['metal:XAU'], 'altın fiyat geçmişi silindi');
    eq(s.accounts, before.accounts); eq(s.transactions, before.transactions);
    ok(/^Tüm varlıklar temizlendi: 2 varlık, 2 alım-satım/.test(lines[0]), lines[0]); ok(/2 varlık \(2 yeni, 0 güncellendi\)/.test(lines[1]), lines[1]);
  });
  test('Biçim: holdings-wipe yalnız ilk işlem, ek alan almaz; tek başına da geçerli', function () {
    eq(IB.errors(edit()), []); eq(IB.errors(edit([{ op: 'holdings-wipe' }])), []);
    ok(IB.errors(edit([{ op: 'broker-replace', file: broker() }, { op: 'holdings-wipe' }])).some(function (m) { return /ilk işlem/.test(m); }));
    ok(IB.errors(edit([{ op: 'holdings-wipe', keep: ['ALTIN'] }])).some(function (m) { return /ek alan/.test(m); }));
    var ex = seeded(); ex.isExample = true; ok(!IB.preview(ex, edit()).ok, 'örnek veriye uygulanmaz');
  });
  test('Yeniden deneme: eski sürümün başarısız kaydı yeni sürümde engel değil; aynı sürümde başarısız ya da başarılı kayıt engel', function () {
    ok(!IB.done([{ id: 'x-123', ok: false, ver: null }], 'x-123'), 'eski sürüm (ver yok) başarısızı yeniden denenir');
    ok(!IB.done([{ id: 'x-123', ok: false, ver: '8.7.0' }], 'x-123'));
    ok(IB.done([{ id: 'x-123', ok: false, ver: IB.APP_VERSION }], 'x-123')); ok(IB.done([{ id: 'x-123', ok: true }], 'x-123'));
    eq(IB.ackList([{ id: 'x-123', ok: true, ver: '8.7.2' }])[0].ver, '8.7.2'); eq(IB.APP_VERSION, '8.9.0');
  });
  function runJob(env, md, out) {
    return new Promise(function (res) {
      var c = cp.spawn(process.execPath, [path.join(ROOT, 'tools', 'portfolio_job.js'), md, out], { env: Object.assign({}, process.env, { BG_NO_NET: '1', BG_NOW: new Date(NOW).toISOString(), GITHUB_ACTIONS: '' }, env) }), buf = '';
      c.stdout.on('data', function (d) { buf += d; }); c.stderr.on('data', function (d) { buf += d; }); c.on('close', function (code) { res({ code: code, log: buf }); });
    });
  }
  test('İş akışı: yeni yola (bg/inbox.v2.enc.json) yazar, eski yolu (bg/inbox.enc.json) siler; temizleme düzenlemesi cihaz anahtarıyla açılır', function () {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp871-')), key = BG.newKey(), kin = BG.newKey(), md = path.join(dir, 'md'), out = path.join(dir, 'out'), gist = path.join(dir, 'g.json'), inb = path.join(dir, 'i.json'), kid;
    fs.mkdirSync(path.join(md, 'analysis'), { recursive: true });
    return BG.kidOf(key).then(function (k) { kid = k; return BG.seal(key, BG.slice(seeded(), NOW, 'T', { inboxAck: [{ id: 'midas-2026-11-25', at: 'x', ok: true, lines: [] }] }), kid); }).then(function (env) { fs.writeFileSync(gist, JSON.stringify(env)); return BG.kidOf(kin); })
      .then(function (kk) { return BG.seal(kin, edit(null, 'midas-only-2026-11-25'), kk); }).then(function (e) { fs.writeFileSync(inb, JSON.stringify(e));
        return runJob({ PORTFOLIO_KEY: BG.makeSetup({ key: key, gist: GID, topic: '' }), BG_GIST_FILE: gist, BG_GIST_INBOX_FILE: inb, FINANS_INBOX_KEY: BG.b64u(kin) }, md, out); })
      .then(function (a) {
        ok(/durum=relayed/.test(a.log), a.log); eq(IB.PATH, 'bg/inbox.v2.enc.json'); ok(fs.existsSync(path.join(out, IB.PATH)));
        ok(fs.readFileSync(path.join(out, '.delete'), 'utf8').split('\n').indexOf('bg/inbox.enc.json') >= 0, 'eski yol silinir');
        return BG.open(key, JSON.parse(fs.readFileSync(path.join(out, IB.PATH), 'utf8'))).then(function (ed) { eq(ed.ops[0].op, 'holdings-wipe'); eq(ed.id, 'midas-only-2026-11-25'); });
      });
  });
  test('Sürüm geçişi: sw.js kurulunca kendiliğinden devreye girer; sayfa yazılırken yenilemez, "Yeni sürüm yüklendi — Yenile" der; görünür olunca güncelleme denetler', function () {
    var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    ok(/c\.addAll\([\s\S]*?\)\.then\(function \(\) \{ return self\.skipWaiting\(\); \}\)/.test(sw), 'önbellek dolunca skipWaiting');
    ok(/self\.clients\.claim\(\)/.test(sw) && /VERSION = '8\.9\.0'/.test(sw));
    ok(/function busy\(\)/.test(app) && /if \(busy\(\)\) \{ swapPrompt\(\); return; \} reloading = true; location\.reload\(\);/.test(app));
    ok(/Yeni sürüm yüklendi\. Verilerin etkilenmez\./.test(app) && /reg\.update\(\)/.test(app));
  });
  function run() {
    return tests.reduce(function (p, t) { return p.then(function (rs) { return Promise.resolve().then(t.fn).then(function () { rs.push({ name: t.name, ok: true }); return rs; }, function (e) { rs.push({ name: t.name, ok: false, err: e && e.message || String(e) }); return rs; }); }); }, Promise.resolve([]));
  }
  module.exports = { run: run, test: test };
  if (require.main === module) run().then(function (results) {
    var passed = results.filter(function (r) { return r.ok; }).length;
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : '  → ' + r.err)); });
    console.log('\n' + passed + '/' + results.length + ' v8.7.1 testi geçti'); if (passed !== results.length) process.exit(1);
  });
})();
