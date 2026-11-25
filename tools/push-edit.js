#!/usr/bin/env node
/* push-edit.js — v8.7.0 "Uzaktan düzenleme kutusu" kutu (yönetici) tarafı. Kullanıcının cihazına, onun hiçbir şey yapmasına gerek kalmadan düzenleme gönderir.
 * Kullanım:
 *   node tools/push-edit.js init                  anahtar dosyası yoksa üretir (0600) ve GitHub sırrı FINANS_INBOX_KEY'i ayarlar; Gist numarasını bulup kaydeder
 *   node tools/push-edit.js push DOSYA [--id ID] [--title BAŞLIK] [--no-run]
 *        DOSYA: aracı kurum geçmiş dosyası (finans-pusulasi-araci-kurum → broker-replace) ya da hazır düzenleme (finans-pusulasi-duzenleme)
 *   node tools/push-edit.js check [--id ID] [--run]  cihazın "uygulandı" kaydını (bg/inbox-ack.enc.json) okur; çıkış kodu: 0 uygulandı, 2 bekliyor, 1 hata
 *   node tools/push-edit.js clear                 Gist'teki bekleyen düzenleme dosyasını kaldırır
 * Sırlar yalnız ortamdan/dosyadan okunur ve ASLA yazdırılmaz: FINANS_INBOX_KEY (ya da FINANS_INBOX_KEY_FILE, varsayılan ~/.config/finans-pusulasi/inbox.key),
 * FINANS_GIST_ID (ya da ~/.config/finans-pusulasi/inbox.json). GitHub erişimi: kutudaki `gh` oturumu. */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var BG = require('../js/bgwatch.js'), IB = require('../js/inbox.js');
var REPO = process.env.FINANS_REPO || 'zurnativi/finans-pusulasi';
var CONF_DIR = path.join(os.homedir(), '.config', 'finans-pusulasi');
var KEY_FILE = process.env.FINANS_INBOX_KEY_FILE || path.join(CONF_DIR, 'inbox.key'), CONF_FILE = path.join(CONF_DIR, 'inbox.json');
var GH = process.env.FINANS_GH || 'gh';

function die(m, code) { console.error('✗ ' + m); process.exit(code == null ? 1 : code); }
function arg(name) { var i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }
function flag(name) { return process.argv.indexOf(name) > 0; }
function gh(args, input) {
  var r = cp.spawnSync(GH, args, { input: input == null ? undefined : input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error('gh çalıştırılamadı: ' + r.error.message);
  if (r.status !== 0) { var e = new Error('gh ' + args.slice(0, 3).join(' ') + ' → ' + String(r.stderr || r.stdout).trim().slice(-300)); e.out = r.stdout; e.err = r.stderr; throw e; }
  return r.stdout;
}
function readConf() { try { return JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')); } catch (e) { return {}; } }
function writeConf(c) { fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(CONF_FILE, JSON.stringify(c, null, 2), { mode: 0o600 }); }
function keyText() {
  if ((process.env.FINANS_INBOX_KEY || '').trim()) return process.env.FINANS_INBOX_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { return null; }
}
function key() {
  var t = keyText(); if (!t) die('Anahtar yok: önce `node tools/push-edit.js init` çalıştır (ya da FINANS_INBOX_KEY ortam değişkenini ayarla).');
  var k; try { k = BG.unb64u(t); } catch (e) { k = null; } if (!k || k.length !== 32) die('Anahtar biçimi hatalı (32 bayt base64url olmalı).'); return k;
}
function findGist() {
  if (process.env.FINANS_GIST_ID) return process.env.FINANS_GIST_ID.trim();
  var c = readConf(); if (c.gist) return c.gist;
  var list = JSON.parse(gh(['api', '/gists?per_page=100']));
  var hit = list.filter(function (g) { return !g.public && g.files && g.files[BG.GIST_FILE]; });
  if (hit.length !== 1) die(hit.length ? 'Birden çok portföy Gist\'i var; FINANS_GIST_ID ile seç.' : 'Portföy izleme Gist\'i bulunamadı (uygulamada Arka plan izleme açık mı? kutudaki gh hesabı aynı mı?).');
  c.gist = hit[0].id; writeConf(c); return c.gist;
}
function tsi(iso) { var t = Date.parse(iso); if (!isFinite(t)) return String(iso || '—'); return new Date(t + 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' TSİ'; }

function cmdInit() {
  fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
  var made = false;
  if (!keyText() || flag('--force')) { fs.writeFileSync(KEY_FILE, BG.b64u(BG.newKey()) + '\n', { mode: 0o600 }); made = true; }
  fs.chmodSync(KEY_FILE, 0o600); key();
  if (made || flag('--set-secret') || flag('--force')) { gh(['secret', 'set', 'FINANS_INBOX_KEY', '-R', REPO], keyText()); console.log('✓ GitHub sırrı FINANS_INBOX_KEY ayarlandı (değer yazdırılmadı).'); }
  else console.log('• Anahtar zaten var; sır yeniden ayarlanmadı (gerekirse --set-secret).');
  var g = findGist(); console.log('✓ Anahtar dosyası: ' + KEY_FILE + ' (0600) · Gist bulundu (' + g.slice(0, 6) + '…)');
}
function buildEdit(file) {
  var o; try { o = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die('Dosya okunamadı/JSON değil: ' + e.message); }
  if (o && o.format === IB.FORMAT) { if (arg('--id')) o.id = arg('--id'); if (arg('--title')) o.title = arg('--title'); return o; }
  if (o && o.format === 'finans-pusulasi-araci-kurum') {
    var base = path.basename(file).replace(/\.json$/i, '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 50);
    return { format: IB.FORMAT, version: IB.VERSION, id: arg('--id') || (base + '-' + Date.now().toString(36)), title: arg('--title') || ((o.broker || 'Aracı kurum') + ' geçmişi'), createdAt: new Date().toISOString(), ops: [{ op: 'broker-replace', file: o }] };
  }
  die('Tanınmayan dosya biçimi (aracı kurum geçmişi ya da düzenleme dosyası olmalı).');
}
function cmdPush() {
  var file = process.argv[3]; if (!file) die('Dosya ver: push DOSYA');
  var edit = buildEdit(file), errs = IB.errors(edit); if (errs.length) die('Düzenleme geçersiz: ' + errs.slice(0, 5).join(' · '));
  var K = key(), gist = findGist();
  return BG.kidOf(K).then(function (kin) { return BG.seal(K, edit, kin); }).then(function (env) {
    var body = { files: {} }; body.files[IB.GIST_FILE] = { content: JSON.stringify(env) };
    gh(['api', '-X', 'PATCH', '/gists/' + gist, '--input', '-'], JSON.stringify(body));
    var c = readConf(); c.last = { id: edit.id, title: edit.title || '', at: new Date().toISOString(), ops: edit.ops.length }; writeConf(c);
    console.log('✓ Şifreli düzenleme Gist\'e yüklendi · numara: ' + edit.id + ' · işlem: ' + edit.ops.map(function (x) { return x.op; }).join(', '));
    if (!flag('--no-run')) { gh(['workflow', 'run', 'market-portfolio.yml', '-R', REPO]); console.log('✓ market-portfolio iş akışı başlatıldı (cihaza aktarım ≈1–3 dk). Cihaz uygulamayı açınca uygulanır.'); }
  });
}
function readBranchFile(rel) {
  try { var j = JSON.parse(gh(['api', '/repos/' + REPO + '/contents/' + rel + '?ref=market-data'])); return j && typeof j.content === 'string' ? Buffer.from(j.content, 'base64').toString('utf8') : null; }
  catch (e) { if (/404|Not Found/.test(e.message)) return null; throw e; }
}
function cmdCheck() {
  var K = key(), want = arg('--id') || (readConf().last || {}).id || null;
  if (flag('--run')) { gh(['workflow', 'run', 'market-portfolio.yml', '-R', REPO]); console.log('• İş akışı başlatıldı; sonuç birkaç dakika sonra görünür.'); }
  var pending = readBranchFile(IB.PATH), raw = readBranchFile(IB.ACK_PATH);
  if (!raw) { console.log('• Henüz onay dosyası yok (iş akışı FINANS_INBOX_KEY ile hiç çalışmadı).'); console.log('• Cihaza aktarılmış bekleyen düzenleme: ' + (pending ? 'VAR' : 'yok')); process.exit(2); }
  return BG.open(K, JSON.parse(raw)).then(function (ack) {
    console.log('Onay dosyası: ' + tsi(ack.generatedAt) + (ack.run ? ' · çalışma ' + ack.run : '') + ' · cihaz yükü: ' + tsi(ack.payloadAt));
    console.log('Aktarım: ' + ack.relay.status + (ack.relay.editId ? ' (' + ack.relay.editId + ')' : '') + (ack.relay.errors ? ' · hatalar: ' + ack.relay.errors.join(' · ') : ''));
    console.log('Cihaza aktarılmış bekleyen düzenleme: ' + (pending ? 'VAR' : 'yok'));
    (ack.applied || []).slice(-10).forEach(function (a) { console.log((a.ok ? '  ✓ ' : '  ✗ ') + a.id + ' · ' + tsi(a.at) + ' · ' + (a.ok ? (a.lines || []).join(' · ') : a.error)); });
    if (!want) return process.exit(0);
    var hit = (ack.applied || []).filter(function (a) { return a.id === want; })[0];
    if (!hit) { console.log('→ ' + want + ': cihaz henüz uygulamadı (uygulama açılınca uygulanır; ardından onay bir sonraki iş akışında görünür).'); process.exit(2); }
    console.log('→ ' + want + ': ' + (hit.ok ? 'UYGULANDI ✓' : 'UYGULANMADI ✗ ' + hit.error)); process.exit(hit.ok ? 0 : 1);
  }, function (e) { die('Onay dosyası açılamadı: ' + e.message); });
}
function cmdClear() {
  var gist = findGist(), body = { files: {} }; body.files[IB.GIST_FILE] = null;
  try { gh(['api', '-X', 'PATCH', '/gists/' + gist, '--input', '-'], JSON.stringify(body)); console.log('✓ Bekleyen düzenleme Gist\'ten kaldırıldı.'); } catch (e) { die(e.message); }
}
var cmd = process.argv[2];
Promise.resolve().then(function () {
  if (cmd === 'init') return cmdInit(); if (cmd === 'push') return cmdPush(); if (cmd === 'check') return cmdCheck(); if (cmd === 'clear') return cmdClear();
  console.log('Kullanım: node tools/push-edit.js init | push DOSYA [--id ID] [--title BAŞLIK] [--no-run] | check [--id ID] [--run] | clear'); process.exit(cmd ? 1 : 0);
}).catch(function (e) { die(String(e && e.message || e)); });
