#!/usr/bin/env node
/* precompute.js — Sunucu tarafı analiz anlık görüntüleri (v8.1). GitHub Actions'ta çalışır.
 * Tarayıcıdaki AYNI modüller kullanılır (mdata.js yükleme, analysis.js, snapshot.js): sonuçlar birebir aynıdır (tests/run-tests-v81.js + e2e eşitlik testi).
 * Kullanım: node tools/precompute.js <OUT_DIR> [--set=bist|crypto|all]
 *   OUT_DIR: market-data çıktı klasörü (içindeki bist/, index/, macro/, us/ dosyaları okunur; analysis/*.json yazılır).
 * Ortam: WATCH_SYMBOLS (isteğe bağlı, Actions değişkeni: ASELS,THYAO,... → evrene eklenir; PORTFÖY TUTARI/ADEDİ ASLA kullanılmaz),
 *        PRIVATE_DIR (varsayılan /tmp/fp-private: izleme listesine özel uyarılar — herkese açık çıktıya YAZILMAZ), PRECOMPUTE_NO_NET=1 (testte ağ yok).
 * Gizlilik: kullanıcının portföyü sunucuda yoktur; anlık görüntüler yalnız herkese açık piyasa verisinden üretilir. */
'use strict';
var fs = require('fs'), path = require('path');
var OUT = process.argv[2] || 'market-data-out';
var SET = (process.argv.filter(function (a) { return a.indexOf('--set=') === 0; })[0] || '--set=all').slice(6);
var PRIVATE = process.env.PRIVATE_DIR || '/tmp/fp-private';
var NOW = new Date(process.env.PRECOMPUTE_NOW || Date.now());
var RAW = 'https://raw.githubusercontent.com/zurnativi/finans-pusulasi/market-data/';

require('./nodefetch.js').install(OUT, { noNet: process.env.PRECOMPUTE_NO_NET === '1' });
var MD = require('../js/mdata.js'), AN = require('../js/analysis.js'), SN = require('../js/snapshot.js');

function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8')); } catch (e) { return null; } }
function writeJson(rel, o) { var p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }

var CRYPTO = ['cg:bitcoin', 'cg:ethereum', 'cg:solana', 'cg:binancecoin', 'cg:ripple', 'cg:cardano', 'cg:dogecoin', 'cg:chainlink'];
var STATIC = ['idx:XU100', 'idx:XKTUM', 'idx:XK050', 'metal:XAU', 'metal:XAG', 'fx:USD', 'fx:EUR', 'us:SPUS', 'us:HLAL', 'us:SPSK', 'us:SPRE', 'us:SPTE', 'us:SPWO', 'us:UMMA', 'us:ISDW', 'us:ISDU', 'us:ISDE', 'us:HIWO',
  'tefas:KTV', 'tefas:KTN']; // örnek portföyün fonları (herkese açık TEFAS verisi)
function universe() {
  if (SET === 'crypto') return CRYPTO.slice();
  var ix = readJson('index.json') || {}, kat = (ix.katilim && ix.katilim.members) || {}, have = {}; (ix.bist || []).forEach(function (b) { have[b.s] = 1; });
  var keys = (kat.XK050 || []).filter(function (s) { return have[s]; }).map(function (s) { return 'bist:' + s; });
  ['ASELS', 'EREGL'].forEach(function (s) { if (have[s] && keys.indexOf('bist:' + s) < 0) keys.push('bist:' + s); }); // örnek portföy hisseleri
  (process.env.WATCH_SYMBOLS || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean).forEach(function (s) { if (have[s] && keys.indexOf('bist:' + s) < 0) keys.push('bist:' + s); });
  var avail = { idx: {}, us: {} }; (ix.index || []).forEach(function (s) { avail.idx[s] = 1; }); (ix.us || []).forEach(function (s) { avail.us[s] = 1; });
  STATIC.forEach(function (k) { var a = k.split(':')[0], s = k.slice(a.length + 1); if ((a === 'idx' && !avail.idx[s]) || (a === 'us' && !avail.us[s])) return; keys.push(k); });
  if (SET === 'all') keys = keys.concat(CRYPTO);
  return keys.filter(function (k, i) { return keys.indexOf(k) === i; });
}
function withTimeout(p, ms, label) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error(label + ': zaman aşımı')); }, ms); p.then(function (x) { clearTimeout(t); res(x); }, function (e) { clearTimeout(t); rej(e); }); }); }
function one(key) { return SN.analyzeKey(MD, AN, key, NOW.toISOString()); }
function pool(items, n, fn) { var i = 0, res = []; return new Promise(function (done) { var act = 0; function next() { if (i >= items.length && act === 0) return done(res); while (act < n && i < items.length) { (function (it) { act++; fn(it).then(function (r) { res.push(r); }, function (e) { res.push({ key: it, error: String(e && e.message || e).slice(0, 160) }); }).then(function () { act--; next(); }); })(items[i++]); } } next(); }); }

/* ---- uyarılar: bir önceki anlık görüntüye göre değişim (piyasa geneli; herkese açık) ---- */
var BENCH = { 'idx:XU100': 'BIST 100', 'idx:XKTUM': 'Katılım Tüm', 'metal:XAU': 'Gram altın', 'cg:bitcoin': 'Bitcoin' };
function changeAlerts(snaps, prevSnaps) {
  var out = [];
  snaps.forEach(function (s) {
    var o = prevSnaps[s.key]; if (!o || s.blocked || o.blocked || s.total == null || o.total == null) return;
    var big = BENCH[s.key] != null, d = s.total - o.total, weak = { weak: 1, veryweak: 1 };
    var name = BENCH[s.key] || String(s.name).split(' — ')[0];
    if (big && d <= -15) out.push({ id: 'an:score:' + s.key + ':' + NOW.toISOString().slice(0, 13), sev: 'high', cat: 'analysis', title: name + ' analiz skoru düştü: ' + o.total + ' → ' + s.total, body: 'Durum: ' + (s.stance && s.stance.label) + '. Güven ' + s.confidence + '/100. Kaynak: sunucu analizi (' + (s.source && s.source.label) + ').', url: null, assets: [s.key] });
    if (big && !weak[o.stance && o.stance.code] && s.stance && weak[s.stance.code]) out.push({ id: 'an:stance:' + s.key + ':' + NOW.toISOString().slice(0, 10), sev: 'high', cat: 'analysis', title: name + ': görünüm zayıfladı', body: s.stance.label + ' (skor ' + s.total + '). Neden: ' + (s.stance.why || []).slice(0, 2).join(' · '), url: null, assets: [s.key] });
  });
  return out;
}
/* ---- izleme listesine özel (özel) uyarılar: yalnız ntfy için, herkese açık dosyaya yazılmaz ---- */
function watchAlerts(snaps) {
  var w = (process.env.WATCH_SYMBOLS || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean), out = [];
  snaps.forEach(function (s) {
    var sy = s.key.split(':')[1]; if (w.indexOf(String(sy).toUpperCase()) < 0 || s.blocked || !s.plans || !s.halalOk) return;
    var p = s.plans.conservative; if (!p || s.price == null) return;
    if (p.stop != null && s.price < p.stop) out.push({ id: 'watch:stop:' + s.key + ':' + p.stop + ':' + s.lastDate, sev: 'high', title: sy + ': fiyat analiz stop seviyesinin altında', body: 'Son ' + s.price + ' < seviye ' + p.stop + ' (' + (s.source && s.source.label) + '). Satış kararı için önce yeni analiz ve kendi planını gözden geçir.' });
    var t1 = (p.targets || []).filter(function (t) { return !t.minor; })[0];
    if (t1 && s.price >= t1.p) out.push({ id: 'watch:tgt:' + s.key + ':' + t1.p + ':' + s.lastDate, sev: 'high', title: sy + ': ilk hedef seviyesine ulaştı', body: 'Son ' + s.price + ' ≥ hedef ' + t1.p + '. "Sat" demek için yorgunluk kanıtı gerekir; analiz sayfasında yeni durumu kontrol et.' });
  });
  return out;
}

function main() {
  var t0 = Date.now(), keys = universe(), prevIdx = readJson('analysis/index.json') || { items: [] }, prevSnaps = {};
  prevIdx.items.forEach(function (r) { var s = readJson('analysis/' + SN.fileOf(r.key) + '.json'); if (s) prevSnaps[r.key] = s; });
  console.log('precompute', SET, keys.length, 'varlık');
  return pool(keys, +(process.env.CONCURRENCY || 4), function (k) { return withTimeout(one(k), 90000, k); }).then(function (res) {
    var ok = res.filter(function (r) { return !r.error; }), fail = res.filter(function (r) { return r.error; });
    ok.forEach(function (s) { writeJson('analysis/' + SN.fileOf(s.key) + '.json', s); });
    // Başarısız olanın önceki anlık görüntüsü KORUNUR (eski zaman damgasıyla; uydurma yenileme yok)
    var items = ok.map(SN.row);
    prevIdx.items.forEach(function (r) { if (!ok.some(function (s) { return s.key === r.key; }) && (SET === 'all' || (SET === 'crypto') === (r.key.indexOf('cg:') === 0))) items.push(Object.assign({ stale: true }, r)); });
    var alerts = changeAlerts(ok, prevSnaps);
    var st = { generatedAt: NOW.toISOString(), set: SET, ok: ok.length, failed: fail.map(function (f) { return f.key + ': ' + f.error; }), seconds: Math.round((Date.now() - t0) / 1000), alerts: alerts.length };
    writeJson('analysis/_run-' + SET + '.json', st);
    fs.mkdirSync(PRIVATE, { recursive: true }); fs.writeFileSync(path.join(PRIVATE, 'analysis-alerts.json'), JSON.stringify(alerts)); fs.writeFileSync(path.join(PRIVATE, 'watch-alerts.json'), JSON.stringify(watchAlerts(ok)));
    console.log(JSON.stringify(st).slice(0, 1200));
    if (ok.length < Math.max(1, Math.floor(keys.length * 0.5))) { console.error('HATA: varlıkların yarısından azı analiz edilebildi'); process.exitCode = 2; }
  });
}
if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
module.exports = { universe: universe, changeAlerts: changeAlerts, watchAlerts: watchAlerts, one: one };
