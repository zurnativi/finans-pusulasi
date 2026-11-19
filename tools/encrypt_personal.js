#!/usr/bin/env node
/* Kişisel veri paketini şifreler: node tools/encrypt_personal.js <düz-yedek.json> [çıktı=data/kisisel-veri.enc.json]
 * Parola YALNIZCA FINANS_DATA_PASSWORD ortam değişkeninden okunur; ekrana yazılmaz, dosyaya yazılmaz.
 * Düz yedek dosyası depoya ASLA konmaz (depo dışında tut). Çıktı: yalnızca şifreli metin (herkese açık depoya konabilir). */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var CB = require('../js/cryptobox.js'), PD = require('../js/personal.js');
var ITER = 6000000; // yüksek tur: herkese açık depoda çevrimdışı tahmin saldırısını yavaşlatır (masaüstü ~1 sn, telefon ~2–5 sn; uygulama dosyadaki tur sayısını okur, en çok 10.000.000)
var inp = process.argv[2], out = process.argv[3] || path.join(__dirname, '..', 'data', 'kisisel-veri.enc.json');
var pass = process.env.FINANS_DATA_PASSWORD;
if (!inp) { console.error('Kullanım: node tools/encrypt_personal.js <düz-yedek.json> [çıktı]'); process.exit(2); }
if (!pass) { console.error('FINANS_DATA_PASSWORD ortam değişkeni tanımlı değil.'); process.exit(2); }
// Çıktı herkese açık depoya konacağından zayıf parola reddedilir (6 haneli PIN dakikalar içinde kırılır). Yalnızca yerel deneme için FINANS_ALLOW_WEAK=1.
function weak(p) { var cls = [/[a-zçğıöşü]/, /[A-ZÇĞİÖŞÜ]/, /\d/, /[^A-Za-z0-9çğıöşüÇĞİÖŞÜ]/].filter(function (r) { return r.test(p); }).length; return p.length < 12 || /^\d+$/.test(p) || (p.length < 16 && cls < 2); }
if (weak(pass) && process.env.FINANS_ALLOW_WEAK !== '1') { console.error('REDDEDİLDİ: parola zayıf (en az 12 karakter, rakamdan ibaret olmasın; öneri: 4–5 rastgele kelime veya 16+ karakter). Düz yedek şifrelenmedi.'); process.exit(3); }
if (path.resolve(inp).indexOf(path.resolve(path.join(__dirname, '..')) + path.sep) === 0) { console.error('Düz yedek dosyası depo klasörünün içinde olamaz.'); process.exit(2); }
var obj = JSON.parse(fs.readFileSync(inp, 'utf8')), bundleId = crypto.randomBytes(8).toString('hex');
CB.encryptJson(obj, pass, { iter: ITER, meta: { kind: PD.KIND, bundleId: bundleId, createdAt: new Date().toISOString(), app: 'Finans Pusulası' } }).then(function (env) {
  return PD.unlock(env, pass).then(function (back) { // yazmadan önce gidiş-dönüş doğrulaması
    delete back.personalBundleId; var a = JSON.parse(JSON.stringify(obj)); delete a.exportedAt; delete a.app;
    var c1 = PD.counts(back), c2 = PD.counts(a); if (JSON.stringify(c1) !== JSON.stringify(c2)) throw new Error('Gidiş-dönüş doğrulaması başarısız');
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(env));
    console.log('Yazıldı: ' + out + ' (' + fs.statSync(out).size + ' bayt, PBKDF2 ' + ITER + ' tur, paket ' + bundleId + ')');
  });
}).catch(function (e) { console.error('Hata: ' + e.message); process.exit(1); });
