# Finans Pusulası — v2.0

Bütçe, birikim ve **helal (faizsiz)** yatırım planı için kişisel finans uygulaması.
Tamamen senin cihazında çalışır, ücretli hiçbir sisteme bağlı değildir, tek klasör hâlinde her yere taşınabilir.

- **Sade görünüm:** finans bilmeyen biri de anlar.
- **Detaylı görünüm:** formüller, oranlar, enflasyonlu/enflasyonsuz değerler, varsayımlar.
- **Hatasız hesap:** tüm para hesapları tam sayı **kuruş** ile yapılır (0,1 + 0,2 = 0,3; ondalık hata yok). 63 otomatik birim testi + tarayıcıda uçtan uca testler var.

## 1. Nasıl açılır?

1. Klasörü (veya `finans-app.zip` dosyasını açıp içindeki klasörü) bilgisayarına kopyala.
2. `index.html` dosyasına çift tıkla. Chrome, Edge, Firefox veya Safari'de açılır. Kurulum, internet veya hesap gerekmez.
3. İlk açılışta **ÖRNEK VERİ** yüklenir (üstte turuncu bantla belirtilir). Hazır olduğunda **"Örnek veriyi temizle"** ile sil ve kendi rakamlarını gir; ya da örnek rakamların üzerine yazıp **"Bunlar artık benim verilerim"** de.

> Not: Veriler, açtığın tarayıcıya ve adrese bağlıdır. Dosyadan açtığın sürümle internete koyduğun sürüm ayrı veri tutar; birinden diğerine geçerken **yedek al → geri yükle** yap.

## 2. Bölümler

| Bölüm | Ne işe yarar |
|---|---|
| Özet | Net varlık, aylık artan para, acil durum fonu, hedef ilerlemesi, "Bu ay ne yapmalıyım?", risk dağılımı (hedef ve şu an), aylık yatırım planı, 3 senaryolu gelecek tahmini |
| Bütçe › Plan | Gelirler, sabit/değişken giderler, bu ay gerçekleşen harcamalar (kumbara payı ve bu ayın taksitleri otomatik satır olarak eklenir) |
| Bütçe › Harcama sınırları | Kategori başına aylık sınır, ilerleme çubuğu, %80'de uyarı, %100'ü aşınca alarm, ay sonu tahmini |
| Bütçe › Aylık karşılaştırma | Bu ay ↔ geçen ayın aynı dönemi ↔ geçen ay tamamı ↔ son 3 ay ortalaması; kategori bazında 6 aylık eğilim grafiği ve kısa yorumlar |
| Bütçe › Yıllık giderler (kumbara) | Kasko, MTV, bayram, tatil gibi yıllık giderler için "her ay ne kadar ayırmalıyım" ve ilerleme |
| Ödemeler › Yaklaşanlar | Önümüzdeki 30 gün (ve gecikmiş) düzenli ödemeler, kart son ödeme günleri, yıllık giderler; sekmede rozet; isteğe bağlı tarayıcı bildirimi |
| Ödemeler › Düzenli ödemeler | Kira, fatura, abonelik: aylık / yıllık / her N ayda bir; beklenen kayıtlar **onayla** oluşturulur |
| Ödemeler › Kartlar ve taksitler | Kesim ve son ödeme günü, ekstre borcu, ödeme (transfer olarak), limit kullanımı, taksit planları, gelecek 12 ayın taksit yükü |
| Hesaplar | Banka, katılım, nakit, kredi kartı, altın hesapları; TL/USD/EUR/gram altın; hesaplar arası transfer; kurlar ve kur tarihi; TL cinsinden net varlık |
| Varlıklar ve hedef | Birikimler (nakit/katılım hesabı, altın, katılım fonu, sukuk, helal ETF, katılım hissesi), borçlar, hedef (tutar + tarih) |
| İşlemler | Tüm harcama/gelir kayıtları, elle ekleme, arama, kategori düzeltme |
| Veri ekle | Excel/CSV, PDF ekstre, fotoğraf/fiş/ekran görüntüsü (sürükle-bırak veya Ctrl+V ile yapıştır) |
| Yapay zekâ asistanı | İstediğin yapay zekâyı seç, verilerine göre Türkçe soru sor |
| Ayarlar ve yedek | Yedek al/geri yükle, CSV indir, acil fon süresi, enflasyon ve senaryo varsayımları |

### Hesap mantığı (özet)
- **Aylık artan para** = gelir − sabit gider − değişken gider.
- **Acil durum fonu hedefi** = aylık toplam gider × ay sayısı (varsayılan 6). "Acil fon" işaretli varlıklar sayılır.
- **Bu ayın planı:** Acil fon eksikse artan paranın %50'si (ayarlanabilir) acil fona, kalanı hedef dağılıma göre güvenli/orta/riskli araçlara. Dağıtım kuruşu kuruşuna yapılır; parçaların toplamı her zaman artan paraya eşittir.
- **Risk dağılımı (süzülme yolu):** Hedefe 60+ ay: %40 güvenli / %35 orta / %25 riskli → 36 ay: 55/30/15 → 12 ay: 80/20/0 → hedef ayı: %100 güvenli. Aradaki aylarda doğrusal geçiş.
- **Gelecek tahmini:** Bugünün parasıyla (reel). Kötümser/temel/iyimser senaryolar için yıllık **reel** getiri varsayımları (Ayarlar > Detaylı görünüm'den değiştirilebilir). Nominal değer = reel × (1 + enflasyon)^yıl. Gerçek piyasa fiyatı içermez.
- **Harcama sınırı:** harcanan × 100 ≥ sınır × 80 → "yaklaşıyor"; harcanan > sınır → "aşıldı" (tam sayı karşılaştırma, yuvarlama yok). Henüz kaydı oluşmamış düzenli ödemeler "beklenen" olarak ayrıca gösterilir.
- **Düzenli ödemeler ve çift sayım:** Bir kayıt; aynı yön, ±7 gün, tutar farkı en fazla max(1 TL, %10) ve aynı kategori veya ortak açıklama kelimesi varsa düzenli ödemeyle eşleşir. Eşleşen kayıt varsa yenisi oluşturulmaz; "oluştur" iki kez basılsa da aynı ay için tek kayıt olur. Sonradan ekstre/CSV'den gerçek işlem gelirse, otomatik oluşturulan beklenen kaydın **yerine geçer**.
- **Taksit:** toplam tutar taksitlere kuruşu kuruşuna bölünür (artan kuruş ilk taksitlere); parçaların toplamı her zaman toplama eşittir. Gelecek taksitler net varlıktan düşülür; bu ayın taksitleri bütçede sabit gider olur. Ekstrede "TAKSİT 3/6", "3/12 TK", "(1/4)" gibi ifadeler tanınır.
- **Kart son ödeme günü:** son ödeme günü kesim gününden büyükse aynı ay, değilse sonraki ay. Ayın 31'i gibi günler kısa aylarda ayın son gününe çekilir.
- **Yıllık gider kumbarası:** aylık pay = (hedef − biriken) ÷ son tarihe kalan ay (en az 1). Bu ay ayrıldıysa pay bir sonraki aya kadar sabit kalır. Toplam aylık pay bütçede sabit gider olarak sayılır.
- **Aylık karşılaştırma:** bu ayın bugüne kadarki harcaması geçen ayın **aynı günlerine** kadar olanla karşılaştırılır (yarım ay ile tam ay karşılaştırılmaz). Yorumlar en az %10 ve 100 TL fark varsa üretilir.
- **Döviz ve altın:** tutarlar en küçük birimde tutulur (sent, 0,01 gram). TL karşılığı = miktar × senin girdiğin kur. Kur girilmemişse TL karşılığı "kur yok" görünür, uydurulmaz. Kurun kaç gün önce girildiği gösterilir.
- **Transfer:** hesaplar arası para geçişi (kart ödemesi dahil) gelir/gider sayılmaz; iki hesabın bakiyesini değiştirir. Silinince bakiyeler geri alınır.
- **Helal kuralı:** Yalnızca katılım hesabı, kira sertifikası (sukuk), altın, katılım fonları, katılım endeksi hisseleri ve SPUS/HLAL gibi helal ETF'ler önerilir. Faizli ürün önerilmez. Ürünün danışma kurulu onayını ayrıca kontrol et.

## 3. Belgeden veri aktarma — hiçbir şey onaysız kaydedilmez

1. **Veri ekle** bölümünde dosyayı seç/sürükle (ekran görüntüsünü Ctrl+V ile de yapıştırabilirsin).
2. **Kontrol et ve onayla** tablosu açılır. Her satırda: tarih, açıklama, tutar, önerilen kategori ve durum (uygun / hata / uyarı).
   - Tarih ve tutar doğrulanır (ör. 31.02 kabul edilmez).
   - **Mükerrer tespiti:** aynı tarih + tutar + açıklama daha önce kaydedildiyse veya dosyada iki kez geçiyorsa satır işaretlenir ve varsayılan olarak seçilmez.
   - **Toplam kontrolü:** belgedeki toplam (fiş TOPLAM'ı, ekstre dönem borcu) okunan satırlarla kuruşu kuruşuna karşılaştırılır.
   - Toplu işlemler: gelir↔gider çevirme, tek işlemde birleştirme (ör. fişin kalemlerini tek satır yapmak), toplu tarih/kategori.
3. **Onayla ve kaydet**e basınca kaydedilir. Hatalı satır seçiliyken kaydetme düğmesi kapalıdır. Kaydettikten sonra 7 saniye içinde "Geri al" yapılabilir.

| Kaynak | Nasıl okunur | İnternet |
|---|---|---|
| Excel (.xlsx/.xls/.ods), CSV | SheetJS ile; sütunlar (tarih, açıklama, tutar veya borç/alacak) otomatik bulunur, yanlışsa elle eşleştirilir. Türkçe karakterli (Windows-1254) CSV desteklenir | Gerekmez |
| PDF ekstre (metinli) | pdf.js ile metin çıkarılır, satırlar tarih+tutar kuralıyla ayrıştırılır | Gerekmez |
| Taranmış PDF, fotoğraf, fiş, ekran görüntüsü | **Yapay zekâ** (seçtiğin sağlayıcı, en iyi sonuç) veya **ücretsiz OCR** (Tesseract.js) | Gerekir (OCR ilk seferde ~10 MB dil dosyası indirir) |

Kredi kartı ekstrelerinde harcamalar artı yazılır: "Kredi kartı ekstresi" kutusunu işaretle veya tabloda "gelir ↔ gider çevir" kullan.
Kart borcu ödemesi gibi **Transfer** kategorisindeki işlemler, çift sayılmasın diye aylık gelir/gider toplamlarına katılmaz.
Ekstreyi aktarırken **"Bu belge hangi karta ait?"** seçilirse işlemler karta bağlanır, taksitli satırlardan taksit planı oluşturulabilir (toplam = taksit × taksit sayısı, tahmini) ve kartın ekstre borcu belgedeki dönem borcuyla güncellenir. Belge toplamı, ödemeler düşülmüş net tutarla da kontrol edilir.
Denemek için `ornek-dosyalar/` klasöründe örnek CSV, Excel, PDF (taksitli ekstre dahil) ve fiş görseli var.

## 4. Yapay zekâ anahtarı ekleme

**Yapay zekâ asistanı** bölümünde sağlayıcıyı seç, anahtarı yapıştır, "Bağlantıyı test et"e bas.

| Sağlayıcı | Ücret | Anahtar | Not |
|---|---|---|---|
| Google Gemini | Ücretsiz katman | https://aistudio.google.com/apikey | Önerilen başlangıç; fotoğraf okur |
| Groq | Ücretsiz katman | https://console.groq.com/keys | Çok hızlı |
| OpenRouter | Ücretsiz modeller (`:free`) + ücretli | https://openrouter.ai/keys | Tek anahtarla yüzlerce model (OpenAI, Claude, Grok dahil) |
| Ollama | Tamamen ücretsiz, internetsiz | https://ollama.com/download | Bilgisayarında çalışır; `OLLAMA_ORIGINS="*"` ile başlat |
| OpenAI (ChatGPT) | Ücretli | https://platform.openai.com/api-keys | |
| Anthropic (Claude) | Ücretli | https://console.anthropic.com/settings/keys | |
| xAI (Grok) | Ücretli | https://console.x.ai | |

- **Anahtarlar yalnızca bu cihazda** (tarayıcı depolamasında) durur; yedek dosyasına girmez, yalnızca seçtiğin sağlayıcıya istek atarken kullanılır. Ortak bilgisayarda işin bitince "Bu anahtarı sil".
- Kasım 2026 testinde tüm sağlayıcılara tarayıcıdan (dosyadan açıkken de) erişilebiliyordu. Bir sağlayıcı ileride tarayıcı erişimini (CORS) kapatırsa aynı modeli **OpenRouter** üzerinden kullan.
- Model adları zamanla değişir: "Modelleri listele" ile güncel listeyi çek, kutudan seç.
- "Verilerimin özetini gönder" açıkken soruyla birlikte bütçe/varlık/hedef **özeti** gider (tam işlem listesi değil). Ne gönderildiğini "Gönderilecek özeti gör" ile görebilirsin.

## 5. Yedekleme (önemli)

- **Ayarlar ve yedek > Yedek indir** → `finans-yedek-YYYY-AA-GG.json`. Ayda en az bir kez al; Google Drive, USB vb. bir yere koy.
- **Yedekten geri yükle:** dosya önce sıkı kontrol edilir; bozuksa hiçbir şey değişmez. Geçerliyse ne yükleneceği gösterilir ve onay istenir.
- Tarayıcı verilerini (çerez/site verisi) silersen uygulama verisi de silinir. Yedek bu yüzden önemli.
- İşlemleri Excel'de açmak için **İşlemleri Excel/CSV olarak indir**.
- Yedek; hesaplar, transferler, kurlar, sınırlar, düzenli ödemeler, taksitler ve yıllık giderleri de içerir. Her alan sıkı kontrol edilir (ör. silinmiş hesaba transfer, aynı ay için iki kez oluşturulmuş düzenli kayıt, geçersiz kur tarihi reddedilir).

### Veri sürümü (şema) ve eski veriler
- Veri biçimi sürümü: **şema 2**. v1.0'dan kalan veri ilk açılışta otomatik ve güvenle dönüştürülür; dönüştürmeden önceki hâli tarayıcıda `finans-pusulasi:v1-oncesi-yedek` adıyla saklanır.
- Eski (v1) yedek dosyaları geri yüklenebilir; yüklenirken dönüştürülür. Uygulamanın bilmediği daha yeni bir şemadaki yedek, veri bozulmasın diye reddedilir.

## 6. İnternete ücretsiz koyma (telefondan da aç)

Uygulama derleme gerektirmez; klasör olduğu gibi yayınlanır. Verilerin yine **yalnızca senin tarayıcında** kalır (site sadece dosyaları sunar).

### GitHub Pages
1. https://github.com adresinde ücretsiz hesap aç → **New repository** (ör. `finans-pusulasi`). Gizlilik istiyorsan repo Private olabilir (Pages için ücretsiz planda Public gerekir; uygulamada kişisel veri yoktur, veri tarayıcında durur).
2. **Add file > Upload files** → klasörün *içindeki* tüm dosyaları (index.html, css, js, vendor, tests, ...) sürükle → **Commit**.
3. **Settings > Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
4. 1–2 dakika sonra adres: `https://KULLANICIADI.github.io/finans-pusulasi/`

### Cloudflare Pages
1. https://dash.cloudflare.com → **Workers & Pages > Create > Pages > Upload assets**.
2. Proje adı ver, klasörü sürükle → **Deploy**. Adres: `https://PROJE.pages.dev`

İnternetten açınca telefonda tarayıcı menüsünden **"Ana ekrana ekle"** diyerek uygulama gibi kullanabilirsin.

## 7. Testler

- Tarayıcıda: `tests/tests.html` dosyasını aç (veya Ayarlar > Detaylı görünüm > "Hesap testlerini çalıştır").
- Komut satırında (Node.js varsa): `node tests/run-tests.js` → 63 test (para, bütçe, içe aktarma, kur, taksit, kart, sınır, düzenli ödeme eşleştirme ve çift sayım, kumbara, karşılaştırma, v1→v2 dönüştürme, yedek doğrulama).
- Uçtan uca testler (Chrome, dosyadan ve http'den, 390 px mobil) ayrı bir klasörde Playwright ile çalıştırıldı; konsol hatası yok.

## 8. Klasör yapısı

```
index.html            Uygulama
css/style.css         Tasarım (açık/koyu tema, mobil uyumlu)
js/money.js           Kuruş hassasiyetinde para işlemleri, TR/EN sayı okuma
js/calc.js            Bütçe, acil fon, süzülme yolu, aylık plan, projeksiyon
js/ledger.js          Hesaplar, döviz/altın, transfer, sınırlar, düzenli ödemeler, kart ve taksit, kumbara, aylık karşılaştırma
js/importparse.js     Tarih/tutar ayrıştırma, sütun tespiti, PDF/OCR satırları, kategori, mükerrer
js/sample.js          Örnek veri, boş durum, şema dönüştürme (v1→v2), yedek doğrulama
js/store.js           IndexedDB + localStorage saklama
js/ai.js              Yapay zekâ sağlayıcıları (resmi REST API'ler)
js/app.js             Arayüz
vendor/               SheetJS (Apache-2.0), pdf.js (Apache-2.0) — yerel kopya, CDN gerekmez
tests/                Otomatik testler (fixture-v1.js: dönüştürme testi için gerçek v1 verisi)
ornek-dosyalar/       Denemelik CSV, Excel, PDF, fiş görseli (hepsi örnek veri)
```

## Sınırlamalar (v2)
- Piyasa fiyatı ve döviz/altın kuru otomatik çekilmez; kurları sen girersin (örnek verideki kurlar örnektir). Kur eskidikçe uyarı gösterilir.
- Hesap bakiyeleri elle girilir; transferler bakiyeyi değiştirir, sıradan harcama kayıtları değiştirmez (bankayla mutabakat yapılmaz).
- Hatırlatma bildirimleri yalnızca uygulama açıkken (günde en fazla bir kez) gösterilir; arka planda push bildirimi yoktur.
- Ekstreden oluşturulan taksit planının toplamı tahminidir (taksit × sayı); gerekirse Kartlar sekmesinde düzelt. Taksit tanıma, ekstredeki yazım biçimine bağlıdır.
- Kumbaraya "ayrılan" para ayrı bir hesaba taşınmaz; birikim/net varlık içinde görünmeye devam eder.
- Ay seçme kutusunun ay adları tarayıcının diline göre görünür.
- Ücretsiz OCR, el yazısı ve bulanık fotoğraflarda zayıftır; bu durumda yapay zekâ ile oku. Her durumda kontrol tablosundan geçer.
- HEIC (iPhone) fotoğrafları tarayıcıda açılamaz; JPG çek veya ekran görüntüsü kullan.
- Cihazlar arası otomatik eşitleme yok; yedek dosyasıyla taşınır.

Bu uygulama bir planlama aracıdır, yatırım tavsiyesi değildir.
