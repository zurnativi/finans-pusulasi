# Finans Pusulası — v6.0

Bütçe, birikim ve **helal (faizsiz)** yatırım planı için kişisel finans uygulaması.
Tamamen senin cihazında çalışır, ücretli hiçbir sisteme bağlı değildir, tek klasör hâlinde her yere taşınabilir.

Üç alan: **Bütçe** (gelir, gider, ödemeler, hesaplar), **Portföy Yönetimi** (alım-satım, dengeleme, getiri, hedefler, risk, fiyatlar) ve **Portföy Analizi** (yakında). **Ana sayfa** üçünün sade özetini gösterir.

- **Sade görünüm:** finans bilmeyen biri de anlar.
- **Detaylı görünüm:** formüller, oranlar, enflasyonlu/enflasyonsuz değerler, varsayımlar.
- **Hatasız hesap:** tüm para hesapları tam sayı **kuruş** ile yapılır (0,1 + 0,2 = 0,3; ondalık hata yok). 160 otomatik birim testi + tarayıcıda uçtan uca testler var.
- **Canlı grafikler (v4):** Ana sayfa, Bütçe ve Portföy Yönetimi açılışında hareketli, dokunmatik grafikler: net varlık eğrisi (1A/3A/6A/1Y/Tümü), birikim halkası, gelir → gider → birikim akışı, hedef halkaları, 6 aylık gelir/harcama çubukları, sayılarda sayaç animasyonu. Üzerine gelince ya da dokununca kuruşu kuruşuna tutar görünür; veri değişince grafik yumuşak geçişle anında güncellenir. Sistem "hareketi azalt" ayarında animasyonlar kapanır.
- **Yedek, eşitleme ve kilit (v5):** ana sayfada görsel "Veri güvenliği" kutuları (son yedek halkası, eşitleme, kilit, kalıcı depo) ve tek dokunuşla **💾 Yedeği indir**; haftalık (ayarlanabilir) yedek hatırlatması; otomatik kopyalar (son 10 sürüm, geri yüklenebilir); **uçtan uca şifreli cihazlar arası eşitleme** (kendi GitHub hesabındaki gizli Gist, ücretsiz); isteğe bağlı **PIN/parola kilidi** (veri cihazda şifreli, hareketsizlikte otomatik kilit, destekleyen cihazda parmak izi/yüz ile açma).
- **Temettü, bedelsiz, bedelli (v5):** yeni işlem türleri kâr/zarara, maliyete ve getiri hesabına (XIRR/TWR) doğru girer.
- **Otomatik TEFAS ve BIST fiyatı (v5):** TEFAS fonları ücretsiz bir TEFAS veri servisinden, BIST hisseleri TradingView'in herkese açık tarayıcısından (15 dk gecikmeli) çekilir; olmazsa liste yapıştır / ekran görüntüsünden oku / ✎ ile tek dokunuşla düzelt.

### v6.0 — denetim düzeltmeleri
- **Kart ekstresi doğru kaydedilir:** ekstre otomatik tanınır (ekstre, son ödeme, hesap kesim, dönem borcu, asgari, "ödeme-teşekkür", maskeli kart no — en az ikisi). Artı yazılmış harcamalar gidere (−) çevrilir, "ödeme / teşekkür" satırları **Transfer** sayılır (kart seçildiğinde de). Kontrol tablosunda tutarlar renklidir (▲ gelir yeşil, ▼ gider kırmızı, ⇄ transfer gri). İşaretler şüpheliyse (harcama belgesinde gelir ağırlıklı) yeşil "Tutuyor" **asla** gösterilmez; kaydetmeden önce ayrıca uyarılır.
- **Acil fon:** "tamam" yalnızca eksik gerçekten 0 iken yazılır; yatırım yokken "dağılım sapmış" önerisi verilmez. **Tek risk kuralı:** acil fon dolmadan riskli alım ne ana sayfada ne Portföy/Dengeleme'de önerilir (`Calc.riskyBlocked`). Gelecek tahmini de acil fon payını (Ayarlar) kullanır.
- **Taşma koruması:** çok uzak hedef / çok yüksek enflasyonda tutarlar "çok büyük (10 trilyon TL üstü)" yazılır; hiçbir ekran çökmez, bir bölüm hata verse bile hedefler düzenlenebilir kalır.
- **Örnek veri gerçek verinin üzerine yazılmaz:** eşitleme açıkken "Örnek veriyi yükle" reddedilir; gerçek kayıt varsa iki kez onay + önce otomatik kopya. Eşitleme, örnek veriyi buluttaki gerçek verinin üzerine hiçbir modda göndermez.
- **Anahtarlar şifreli:** yapay zekâ, Twelve Data ve eşitleme anahtarları IndexedDB'de şifreli durur (kilit açıksa PIN'den türeyen anahtarla, kapalıysa tarayıcının dışa aktarılamayan cihaz anahtarıyla). Eski açık metin anahtarlar ilk açılışta taşınır (önce şifreli kopya yazılır, sonra eski silinir).
- **Ana sayfa sadeleşti:** önce grafikler, en önemli 3 öneri; Bütçe özeti, Risk/yatırım planı ve Gelecek tahmini katlanır bölümlerde (detaylı görünümde açık). Sade görünümde teknik terimler yerine günlük Türkçe; terimler detaylı görünümde/ipuçlarında.
- **Mobil:** 360–390 px'te Düzenli ödemeler, Hesaplar, taksit, transfer ve varlık tabloları kart satırlarına dönüşür; akış grafiği etiketleri kesilmez; dokunmatikte ?, ✎ ve onay kutuları en az 40 px.
- **Portföy:** başlıkta gerçek kazanç (yatırdığın para hariç), değer değişimi ikincil. Getiri: alımlar − satışlar − temettüler ayrı; küçük yüzdeler 2 haneli (+%0,13). Varsayılan helal kıyas **Katılım 50 (KATLM)** — ücretsiz otomatik kaynak olmadığından geçmişi Fiyatlar'dan elle/CSV ile girilir; **Katılım Tüm (XKTUM)** TradingView'den otomatik gelir. BIST 100 (faizli şirketler dahil) yalnızca detaylı görünümde.
- **Küçükler:** Türkçe yüzde ekleri (%52'si, %14'ü); gelecek tarihli içe aktarma satırları varsayılan seçilmez; "-1,234" ve "1.234,567" uyarıyla okunur; farklı hesapta aynı gün + aynı tutar "olası mükerrer" uyarısı; dengeleme adedi varlık türüne göre yuvarlanır (hisse/fon tam, altın 0,01, kripto 0,000001); Sınırlar'da tek "Ay sonu tahmini"; renk kontrastı ≥ 4,5:1 (açık/koyu).
- **Çevrimdışı ve güvenlik:** servis çalışanı (`sw.js`, sürümlü önbellek) internet yokken uygulamayı açar; yeni sürümde "Yeni sürüm hazır — Yenile" sorar (kendiliğinden geçmez); yalnızca http(s)'te kaydedilir, dosyadan açılışta kaydedilmez. İçerik Güvenlik Politikası (CSP) yalnızca kullanılan ücretsiz kaynaklara izin verir. Kilit deneme sayacı hem localStorage'da hem IndexedDB'de tutulur (biri silinince sıfırlanmaz).
- Şema değişmedi (v4); taşıma gerekmedi. Gizli anahtar taşıması ayrı ve geri alınabilir sırayla yapılır.

## 1. Nasıl açılır?

1. Klasörü (veya `finans-app.zip` dosyasını açıp içindeki klasörü) bilgisayarına kopyala.
2. `index.html` dosyasına çift tıkla. Chrome, Edge, Firefox veya Safari'de açılır. Kurulum, internet veya hesap gerekmez.
3. İlk açılışta **ÖRNEK VERİ** yüklenir (üstte turuncu bantla belirtilir). Hazır olduğunda **"Örnek veriyi temizle"** ile sil ve kendi rakamlarını gir; ya da örnek rakamların üzerine yazıp **"Bunlar artık benim verilerim"** de. Resmi örnek veri genişlerse, yalnızca hâlâ "örnek" işaretli kayıtlarda **"Örnek veriyi yenile"** (veya otomatik yenileme) yeni seti getirir; "benim verilerim" dediğin veya kendi girdiğin verinin üzerine asla yazılmaz.

> Not: Veriler, açtığın tarayıcıya ve adrese bağlıdır. Dosyadan açtığın sürümle internete koyduğun sürüm ayrı veri tutar; birinden diğerine geçerken **yedek al → geri yükle** yap.

## 2. Bölümler

| Bölüm | Ne işe yarar |
|---|---|
| Ana sayfa | Üç alan kartı (Bütçe / Portföy Yönetimi / Portföy Analizi), portföy uyarıları, bütçe özeti: net varlık, aylık artan para, acil fon, hedefler, "Bu ay ne yapmalıyım?", aylık yatırım planı, 3 senaryolu gelecek tahmini |
| **Bütçe** › Plan | Gelirler, sabit/değişken giderler, bu ay gerçekleşen harcamalar (kumbara payı ve bu ayın taksitleri otomatik satır olarak eklenir) |
| Bütçe › Harcama sınırları | Kategori başına aylık sınır, ilerleme çubuğu, %80'de uyarı, %100'ü aşınca alarm, ay sonu tahmini |
| Bütçe › Aylık karşılaştırma | Bu ay ↔ geçen ayın aynı dönemi ↔ geçen ay tamamı ↔ son 3 ay ortalaması; 6 aylık eğilim |
| Bütçe › Yıllık giderler (kumbara) | Kasko, MTV, bayram, tatil gibi yıllık giderler için "her ay ne kadar ayırmalıyım" |
| Bütçe › Ödemeler | Yaklaşanlar, düzenli ödemeler, kartlar ve taksitler (rozet Bütçe sekmesinde) |
| Bütçe › Hesaplar | Banka, katılım, nakit, kart, altın hesapları; TL/USD/EUR/gram altın; transfer; kurlar |
| Bütçe › İşlemler | Tüm harcama/gelir kayıtları, elle ekleme, arama, kategori düzeltme |
| **Portföy** › Genel bakış | Toplam birikim, kâr/zarar, risk kuralları durumu, hedefler, "Bu ay yeni parayla ne almalı?", risk ve helal kontrolü, varlık tablosu |
| Portföy › Varlıklar | Varlık kartları (risk seviyesi, helal etiketi, hedefe bağlama, adet/fiyatla veya tutar olarak izleme), hesapların helal etiketi, borçlar |
| Portföy › Alım-satım | Alış/satış kaydı (komisyonla), kaydetmeden önce önizleme, eldekinden fazla satış reddi, pozisyon tablosu (adet, ortalama maliyet, gerçekleşen/gerçekleşmemiş K/Z) |
| Portföy › Dengeleme | Hedef dağılıma dönmek için önce **yeni parayla** alım önerisi; satış yalnızca "gözden geçir" olarak gösterilir |
| Portföy › Getiri | Para ağırlıklı yıllık getiri (XIRR), zaman ağırlıklı getiri (TWR), reel (TÜFE'den arındırılmış) getiri, değer grafiği, altın / dolar / BIST 100 kıyası, aylık TÜFE tablosu |
| Portföy › Hedefler | Birden fazla hedef (tutar, tarih, birikimden pay, süzülme yolu profili: Temkinli / Dengeli / Büyüme), her hedefe ayrı ilerleme ve aylık ihtiyaç |
| Portföy › Risk ve helal | Kurallar (tek varlık üst sınırı, riskli toplam üst sınırı, önce acil fon, en az varlık sayısı) ve uyarılar; varlık başına helal etiketi tablosu |
| Portföy › Fiyatlar | Ücretsiz kaynaklardan "Fiyatları güncelle" (kontrol tablosuyla; TEFAS fonu ve BIST hissesi dahil), elle fiyat, her satırda ✎ hızlı düzeltme, toplu fiyat yapıştırma, kaydedilmiş fiyat geçmişi (kaynak + saat), isteğe bağlı Twelve Data anahtarı |
| Portföy Analizi | Yakında |
| Veri ekle | Üç tür: harcama/gelir kayıtları, **aracı kurum alım-satım dökümü**, **fiyat listesi**. Excel/CSV, PDF, fotoğraf (OCR veya yapay zekâ) |
| Yapay zekâ asistanı | İstediğin yapay zekâyı seç, verilerine (portföy dahil) göre Türkçe soru sor |
| Ayarlar ve yedek | Yedek al/geri yükle, CSV indir, acil fon süresi, enflasyon ve senaryo varsayımları |
| **Yedek, eşitleme, kilit** (`#guvenlik`) | Son yedek, şifreli yedek, yedek hatırlatma sıklığı, otomatik kopyalar ve geri yükleme, kalıcı depolama izni, cihazlar arası eşitleme (kurulum sihirbazı, son eşitleme zamanı, çakışmalar), uygulama kilidi |

Eski `#varliklar` bağlantısı otomatik olarak Portföy › Varlıklar'a yönlenir.

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

### Portföy hesap mantığı (v3)
- **Hassasiyet:** para kuruş (tam sayı), adet 10⁻⁸, birim fiyat 10⁻⁶ ölçekli tam sayı; çarpma/bölme BigInt ile, yarım değerler sıfırdan uzağa yuvarlanır. Oranlar baz puan (10000 = %100).
- **Maliyet:** ağırlıklı ortalama maliyet. Alışta maliyet = adet × fiyat + komisyon; satışta satılan adedin ortalama maliyeti düşülür, gerçekleşen K/Z = satış tutarı − komisyon − düşülen maliyet. Eldekinden fazla satış kaydedilmez. Döviz cinsinden varlıklar işlem günündeki kurla TL'ye çevrilir (kur yoksa uyarı).
- **Varlık değeri** = adet × son kaydedilmiş fiyat (ve gerekirse son kur). Fiyat yoksa değer uydurulmaz, "fiyat yok" görünür.
- **XIRR:** tüm alış (−) ve satış (+) nakit akışları ile bugünkü değerin (+) gün bazlı iç verim oranı (Newton + ikiye bölme yedeği). **TWR:** her nakit akışı gününde dönem getirileri zincirlenir (fiyat geçmişi kullanılır); 1 yıldan kısa dönem yıllıklaştırılmaz.
- **Reel getiri** = (1 + nominal) ÷ (1 + aynı dönem TÜFE) − 1. TÜFE aylık % olarak elle girilir (TÜİK bülteni); eksik ay varsa hangi aya kadar hesaplandığı yazılır.
- **Kıyas:** her alım/satımda aynı TL tutarı aynı gün altına / dolara / BIST 100'e koysaydın bugünkü değer. O güne en yakın fiyat (en fazla 35 gün fark) kullanılır; 7 günden fazla boşluk varsa "yaklaşık" etiketi çıkar. Fiyat geçmişi yoksa satır "geçmiş yok" der.
- **Dengeleme:** hedef dağılım (süzülme yolundan) − bugünkü dağılım; yeni para önce en çok eksik olan risk grubuna, kuruşu kuruşuna dağıtılır. Fazla olan gruplar için satış önerilmez, yalnızca "gözden geçir" denir.
- **Çoklu hedef:** her hedefe birikimden pay (toplam %100'ü geçemez) veya doğrudan varlık bağlanır; her hedefin kendi süzülme yolu vardır. Tek hedefli eski veri aynen eski sonucu verir.
- **Fiyat kontrolü:** bir önceki fiyata göre sıçrama sınırı: döviz/altın %8, endeks %12, fon %10, hisse/ETF %15, kripto %25. Sınırı aşan fiyat varsayılan olarak seçilmez ve onay ister. Eskime: kripto 2, döviz/altın 3, endeks 4, hisse/ETF/fon 5 gün sonra uyarı. Gelecek tarihli, sıfır veya negatif fiyat reddedilir.
- **Aracı kurum dökümü:** satırlar (tarih, sembol, ALIŞ/SATIŞ, adet, fiyat, komisyon) okunur; belgedeki toplam, okunan satırların alış/satış/net toplamlarıyla (komisyonlu ve brüt) kuruşu kuruşuna karşılaştırılır. Mükerrer işlemler seçilmez; bilinmeyen semboller için onayla yeni varlık açılır.

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
| Taranmış PDF, fotoğraf, fiş, ekran görüntüsü (JPG/PNG/WebP/HEIC) | **Otomatik**: yapay zekâ ayarlıysa yapay zekâ, değilse (veya hata verirse) **ücretsiz OCR** (Tesseract.js, Türkçe) | OCR dosyaları sitenin kendi `vendor/tesseract` klasöründen bir kez (~6 MB) yüklenir, sonra tarayıcı önbelleğinden |

Kredi kartı ekstrelerinde harcamalar artı yazılır: "Kredi kartı ekstresi" kutusunu işaretle veya tabloda "gelir ↔ gider çevir" kullan.
Kart borcu ödemesi gibi **Transfer** kategorisindeki işlemler, çift sayılmasın diye aylık gelir/gider toplamlarına katılmaz.
Ekstreyi aktarırken **"Bu belge hangi karta ait?"** seçilirse işlemler karta bağlanır, taksitli satırlardan taksit planı oluşturulabilir (toplam = taksit × taksit sayısı, tahmini) ve kartın ekstre borcu belgedeki dönem borcuyla güncellenir. Belge toplamı, ödemeler düşülmüş net tutarla da kontrol edilir.
Denemek için `ornek-dosyalar/` klasöründe örnek CSV, Excel, PDF (taksitli ekstre dahil) ve fiş görseli var.

## 3b. Piyasa fiyatları — yalnızca ücretsiz kaynaklar, hiçbir fiyat uydurulmaz

**Portföy › Fiyatlar › Fiyatları güncelle** tarayıcıdan doğrudan (sunucusuz) şu ücretsiz kaynakları sorar. Her fiyatın yanında **kaynak ve saat** gösterilir; sonuç önce kontrol tablosuna gelir, sen onaylamadan kaydedilmez. Kaynak yanıt vermezse fiyat boş kalır, eski fiyat "eski" uyarısıyla durur.

| Fiyat | Birinci kaynak | Çapraz kontrol / yedek | Canlı durum (14.11.2026) |
|---|---|---|---|
| USD/TL, EUR/TL | Frankfurter (Avrupa Merkez Bankası referans kurları, iş günü) | Truncgil Finans alış | ✓ çalışıyor |
| Gram altın | Truncgil Finans (Türkiye piyasası, gram altın alış) | gold-api.com ons × USD/TL ÷ 31,1035 | ✓ çalışıyor (Truncgil ara sıra yanıt vermezse yedek devreye girer) |
| Gümüş (gram) | Truncgil Finans | — | ✓ |
| BIST 100 (XU100) | Truncgil Finans | — | ✓ (yalnızca güncel değer) |
| Kripto (BTC, ETH…) | CoinGecko | Binance | ✓ |
| ABD ETF'leri (SPUS, HLAL…) | Twelve Data — **senin ücretsiz anahtarınla** (anahtar yalnızca bu cihazda saklanır, yedeğe girmez) | — | Anahtar yoksa açık mesaj; anahtar girilince çalışır |
| **TEFAS fonları (v5)** | TEFAS Fon Analiz (`fon.yourapiservice.com`) — TEFAS'ın yayınladığı birim pay fiyatını günde bir sunan ücretsiz, anahtarsız ara servis (resmi değil) | — | ✓ https ve dosyadan test edildi (KTV 8,326309 · 13.11.2026) |
| **BIST hisseleri (v5)** | TradingView herkese açık tarayıcısı (`scanner.tradingview.com`) — **resmi değil, 15 dk gecikmeli** | — | ✓ https ve dosyadan test edildi (ASELS 345,50 TL) |
| Fiyat geçmişi (kıyas, TWR için) | Frankfurter zaman serisi (dolar), Currency API (tarihli ons altın → gram), CoinGecko (kripto), TEFAS Fon Analiz (fonların son 1 yılı) | — | ✓ |

Varlıklar'da fiyat kaynağını **"TEFAS fonu"** (fon kodu, ör. `KTV`) veya **"BIST hissesi"** (hisse kodu, ör. `ASELS`) seç. Elle girdiğin eski fiyatlar yeni kaynağa taşınır, kaybolmaz.

**Doğrudan erişilemeyenler:** tefas.gov.tr, Borsa İstanbul, İş Yatırım, TCMB ve Yahoo Finance tarayıcı erişimine (CORS) kapalı (Kasım 2026'da yeniden denendi). Otomatik kaynak çalışmazsa:
- Veri ekle › **Fiyat listesi**: Excel/CSV, PDF, **ekran görüntüsü** (ücretsiz OCR) veya **📋 listeyi yapıştır** (her satır `KOD fiyat`, ör. `KTV 8,326309`; tarih isteğe bağlı). Kontrol tablosunda kaynak ve okunma saati görünür, fiyatı satırda düzeltebilirsin; kaydedilen her fiyatta kaynak ve saat saklanır.
- Portföy › Fiyatlar veya Alım-satım › Pozisyonlar'da fiyatın yanındaki **✎** ile tek dokunuşla düzelt.
- BIST 100 geçmişi elle/CSV ile girilir.

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

## 5. Yedek, eşitleme ve kilit (v5)

### Yedek
- Ana sayfadaki **Veri güvenliği** kartında son yedeğin ne zaman alındığı (halka: dolu = yeni yedek) ve **💾 Yedeği indir** düğmesi var. Hatırlatma sıklığı (kapalı / 3 gün / haftada bir / 2 hafta / ayda bir) **Yedek, eşitleme, kilit** sayfasından seçilir; süre dolunca üstte bant çıkar.
- **🔐 Şifreli yedek:** parolayla (PBKDF2-SHA256 600.000 tur + AES-256-GCM) şifrelenmiş dosya. Geri yüklerken parola sorulur. Normal (açık) yedekler de her zaman yüklenir.
- **Otomatik kopyalar:** günün ilk açılışında, her 30 dakikalık çalışmada, sürüm yükseltmesinden, geri yüklemeden, eşitlemeden ve "tümünü sil"den önce bu cihazda (IndexedDB) kopya alınır; son N sürüm (varsayılan 10) tutulur, tek tıkla geri yüklenir (geri yükleme de önce kopya alır).
- **Kalıcı depo:** uygulama tarayıcıdan "verimi silme" izni ister (`navigator.storage.persist()`). İzin yoksa kart sarı "korumasız" yazar: tarayıcı yer açmak için veriyi silebilir → düzenli yedek al veya eşitlemeyi aç. (Telefonda ana ekrana eklemek izni genelde sağlar.)

### Cihazlar arası eşitleme — kurulum (bir kez, ~3 dakika)
Veriler **senin GitHub hesabındaki gizli bir Gist** dosyasında, **senin eşitleme parolanla şifreli** durur. GitHub dahil kimse içeriği okuyamaz. Ücretsizdir, sunucu yoktur.
1. GitHub hesabın yoksa <https://github.com/signup> adresinden ücretsiz aç.
2. Uygulamada **Yedek, eşitleme, kilit › Cihazlar arası eşitleme › Eşitlemeyi kur**'a bas, **"GitHub'da anahtar sayfasını aç"** bağlantısını aç. Sayfa yalnızca **gist** izni seçili gelir. **Expiration** için "No expiration" (veya en uzun süre) seç, başka kutu işaretleme, **Generate token**'a bas, `ghp_…` anahtarını kopyala. (İstersen ince ayarlı anahtar: Account permissions → **Gists: Read and write**, depo erişimi yok.)
3. Anahtarı yapıştır → **Bağlantıyı dene**.
4. En az 10 karakterlik bir **eşitleme parolası** belirle (bir yere yaz; unutursan buluttaki kopya açılamaz, cihazdaki verin etkilenmez).
5. **Bağla ve eşitle**. Diğer cihazda (telefon/bilgisayar) aynı siteyi aç, **aynı anahtar ve aynı parola** ile 2–5. adımları tekrarla. Yeni cihazda yalnızca örnek veri varsa buluttaki verin gelir; iki tarafta da veri varsa birleştirilir.

Sonrası otomatik: uygulama açılınca ve her kayıttan birkaç saniye sonra eşitlenir; başlıktaki **☁ Eşitlendi · … önce** düğmesi ile elle eşitlenir. Birleştirme kayıt kayıt yapılır (her kaydın değişiklik zamanı ve silinenler için silme izi tutulur): farklı kayıtlardaki değişiklikler iki tarafa geçer; aynı kayıt iki cihazda değiştiyse yenisi kazanır, **diğeri kaybolmaz** — "Çakışmalar" listesinde durur, "Diğer sürümü kullan" ile geri alınır. Bir cihazda silinip diğerinde değiştirilen kayıt korunur. Birleşen veri doğrulanamazsa hiçbir şey değişmez. Anahtar ve parola yalnızca o cihazda saklanır (kilit açıksa şifreli); yedek dosyasına ve buluta girmez.

### Uygulama kilidi
- **Yedek, eşitleme, kilit › Uygulama kilidi**: 6–12 haneli PIN veya en az 8 karakterlik parola. Açılınca bu cihazdaki tüm veri (kayıtlar, otomatik kopyalar, eşitleme anahtarı) rastgele bir anahtarla AES-256-GCM ile şifrelenir; o anahtar PIN'den PBKDF2-SHA256 600.000 turla türetilen anahtarla kilitlenir. 5 hatalı denemeden sonra bekleme süresi artar.
- Hareketsizlikte otomatik kilit (1, 5, 15 dk, 1 saat veya kapalı). Destekleyen telefon/bilgisayarda (https, WebAuthn PRF) **parmak izi / yüz ile aç**; PIN her zaman yedek yol olarak kalır.
- ⚠️ **PIN'i unutursan bu cihazdaki veri açılamaz.** Kurtarma yalnızca **yedek dosyası** (normal veya şifreli) veya **bulut eşitlemesi** ile olur: kilit ekranında "PIN'imi unuttum" → bu cihazdaki veriyi sil → yedeği yükle ya da eşitlemeyi yeniden kur.

### Genel

- **Ayarlar ve yedek > Yedek indir** → `finans-yedek-YYYY-AA-GG.json`. Ayda en az bir kez al; Google Drive, USB vb. bir yere koy.
- **Yedekten geri yükle:** dosya önce sıkı kontrol edilir; bozuksa hiçbir şey değişmez. Geçerliyse ne yükleneceği gösterilir ve onay istenir.
- Tarayıcı verilerini (çerez/site verisi) silersen uygulama verisi de silinir. Yedek bu yüzden önemli.
- İşlemleri Excel'de açmak için **İşlemleri Excel/CSV olarak indir**.
- Yedek; alım-satım kayıtları, hedefler, risk kuralları, fiyat geçmişi, TÜFE, hesaplar, transferler, kurlar, sınırlar, düzenli ödemeler, taksitler ve yıllık giderleri de içerir. Her alan sıkı kontrol edilir (ör. silinmiş hesaba transfer, aynı ay için iki kez oluşturulmuş düzenli kayıt, geçersiz kur tarihi reddedilir).

### Veri sürümü (şema) ve eski veriler

**v5 → şema 4:** temettü/bedelsiz/bedelli işlem türleri, eşitleme bilgisi (`_sync`: kayıt başına değişiklik zamanı ve silme izleri) ve yedek hatırlatma ayarı eklenir; var olan hiçbir kayıt değişmez. Yükseltmeden önce eski hâl **Otomatik kopyalar**'a alınır. v1–v4'ün tüm yedek dosyaları yüklenir ve dönüştürülür.

(v4 notu) v4 şemayı değiştirmemişti (3). Yalnızca isteğe bağlı `nwHistory` (net varlık geçmişi: `{ d: 'YYYY-MM-DD', v: kuruş }`) eklenir: her kayıtta bugünün değeri yazılır, son 120 gün günlük, daha eskisi ay sonu olarak tutulur. Eski yedekler aynen yüklenir; geçmiş, yükledikten sonra birikmeye başlar. Örnek veride geçmiş, bugünün gerçek hesaplanan değeriyle biten örnek bir seridir.

- Veri biçimi sürümü: **şema 4**. v1.0, v2 ve v3 verisi ilk açılışta otomatik ve güvenle dönüştürülür; dönüştürmeden önceki hâli **Otomatik kopyalar**'da saklanır (eski sürümlerin bıraktığı `finans-pusulasi:v1-oncesi-yedek` / `v2-oncesi-yedek` anahtarları da durur). v2→v3'te mevcut varlıklar, hedef ve kurlar aynen korunur; kurlar fiyat geçmişine ilk nokta olarak eklenir, alım-satım defteri boş başlar.
- Eski (v1, v2) yedek dosyaları geri yüklenebilir; yüklenirken dönüştürülür. Uygulamanın bilmediği daha yeni bir şemadaki yedek, veri bozulmasın diye reddedilir.

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
- Komut satırında (Node.js varsa): `node tests/run-tests.js` → 160 test: 105 temel + 30 v5 + 25 v6 (`tests/run-tests-v6.js`: denetimdeki her hata için regresyon — kart ekstresi algılama/çevirme/1.854,39 toplamı, şüpheli işaret, taksi≠TAKSİT, acil fon 0'da "tamam" yok, taşma, ortak risk kuralı, acil fon payı, örnek veri/eşitleme koruması, Türkçe ekler, tutar uyarıları, olası mükerrer, adet yuvarlama, temettü ayrımı, ay sonu tahmini, Katılım 50 kıyası) (`tests/run-tests-v5.js`: şifreleme gidiş-dönüş, yanlış parola/bozuk veri reddi, rastgele tuz/IV; kilit oluştur/aç/yanlış PIN/PIN değiştir, biyometrik sarma, deneme sınırı; eşitleme damgaları, birleştirme, çakışma ve "diğer sürüm", silme izi, silme×değiştirme, fiyat serisi birleşimi, sahte Gist ile iki cihaz turu, yanlış eşitleme parolası; bedelsiz/birleşme/temettü/bedelli hesapları ve XIRR/TWR akışları; v3→v4 taşıma; TEFAS/TradingView ayrıştırıcıları; yapıştırılan fiyat listesi). Önceki 105 test (para, bütçe, içe aktarma, kur, taksit, kart, sınır, düzenli ödeme, kumbara, karşılaştırma, v1→v2→v3 dönüştürme, yedek doğrulama; v3: ortalama maliyet ve K/Z, fazla satış reddi, XIRR, TWR, reel getiri, kıyas, dengeleme, çoklu hedef, risk kuralları, fiyat sıçrama/eskime kontrolü, aracı kurum dökümü ve toplam kontrolü, fiyat kaynağı ayrıştırıcıları; v4: net varlık geçmişi kaydı, aralık ve değişim hesabı, örnek geçmişin bugünün değeriyle tam bitmesi).
- v5 uçtan uca testi (`e2e_v5.py`, 390 px mobil, dosyadan ve http'den; **GitHub API sahte** — gerçek hesaba dokunulmaz): eşitleme sihirbazı, gizli ve şifreli Gist, iki cihaz arasında birleştirme, ayar çakışması ve "diğer sürümü kullan", yedek durumu ve indirme, temettü/bedelsiz formu, fiyat listesi yapıştırma, ✎ hızlı düzeltme, kilit (uyarı onayı, diskte şifreli, kilit ekranı, yanlış/doğru PIN), konsol hatası yok: 45 kontrol.
- Uçtan uca testler (Chrome, dosyadan ve http'den, 390 px mobil, canlı fiyat kaynaklarıyla ve onlarsız) ayrı bir klasörde Playwright ile çalıştırıldı: 62 kontrol (canlıda 68), konsol hatası yok. v4 grafik testi (`e2e_v4.py`): grafiklerin çizilmesi, sayaçların tam tutara oturması, aralık düğmeleri, ipuçları, veri değişince anında güncelleme, koyu tema, hareketi azalt, 390 px mobil ve dış ağ kapalıyken (çevrimdışı) çalışma.

- v6 uçtan uca regresyon (`fix6/e2e_v6.py <adres>`; dosyadan, http'den ve canlı adreste): denetim betiklerindeki tüm senaryolar (kart ekstresi içe aktarma ve kaydetme, açık bütçe, ortak risk kuralı, Türkçe ekler, enflasyon %60 + 2066, saat dilimi/ay sınırı, örnek veri koruması, şifreli anahtarlar) + 1280/390/360 px ve koyu tema: yatay taşma, ana sayfa uzunluğu, kontrast ≥ 4,5:1, kart satırları, dokunma hedefleri, çevrimdışı açılış, konsol/CSP hatası yok.

## 8. Klasör yapısı

```
index.html            Uygulama (CSP meta etiketi)
sw.js                 Çevrimdışı uygulama kabuğu (sürümlü önbellek, onaylı güncelleme)
css/style.css         Tasarım (açık/koyu tema, mobil uyumlu)
js/money.js           Kuruş hassasiyetinde para işlemleri, TR/EN sayı okuma
js/calc.js            Bütçe, acil fon, süzülme yolu, aylık plan, projeksiyon
js/ledger.js          Hesaplar, döviz/altın, transfer, sınırlar, düzenli ödemeler, kart ve taksit, kumbara, aylık karşılaştırma
js/importparse.js     Tarih/tutar ayrıştırma, sütun tespiti, PDF/OCR satırları, kategori, mükerrer
js/portfolio.js       Alım-satım defteri, maliyet, XIRR/TWR/reel getiri, kıyas, dengeleme, çoklu hedef, risk kuralları, fiyat kontrolü, döküm ayrıştırma
js/prices.js          Ücretsiz fiyat kaynakları (Frankfurter, Truncgil, gold-api, CoinGecko, Binance, Twelve Data, Currency API, TEFAS Fon Analiz, TradingView) ve ayrıştırıcılar
js/chartdata.js      Grafik verisi (net varlık geçmişi, zaman aralığı, değişim) — saf, test edilir
js/charts.js         Canlı grafikler (ECharts sarmalayıcı: alan, halka, çubuk, akış, ilerleme halkası, sayaçlar)
js/portfolio-ui.js    Ana sayfa kartları, Portföy Yönetimi ve Portföy Analizi ekranları
js/sample.js          Örnek veri, boş durum, şema dönüştürme (v1→v2→v3→v4), yedek doğrulama
js/store.js           IndexedDB saklama, kilitliyken şifreli kayıt, otomatik kopyalar, kalıcı depo izni
js/cryptobox.js       Web Crypto: PBKDF2 + AES-256-GCM şifreli zarf (yedek, eşitleme)
js/syncmerge.js       Eşitleme birleştirme/çakışma mantığı (saf, test edilir)
js/sync.js            GitHub Gist istemcisi ve eşitleme turu
js/lock.js            Uygulama kilidi çekirdeği (PIN/parola, biyometrik sarma)
js/security-ui.js     Yedek, eşitleme ve kilit ekranları
js/ai.js              Yapay zekâ sağlayıcıları (resmi REST API'ler)
js/app.js             Arayüz
vendor/               Apache ECharts 5.6 (Apache-2.0), SheetJS (Apache-2.0), pdf.js (Apache-2.0), Tesseract.js 5.1.1 + Türkçe dil verisi (Apache-2.0), heic2any (MIT) — yerel kopya, CDN gerekmez
tests/                Otomatik testler (fixture-v1.js: dönüştürme testi için gerçek v1 verisi)
ornek-dosyalar/       Denemelik CSV, Excel, PDF, fiş görseli (hepsi örnek veri)
```

## Sınırlamalar
- Fiyatlar yalnızca sen "Fiyatları güncelle" dediğinde ve onayladığında kaydedilir; arka planda otomatik güncelleme yok. Örnek verideki tüm fiyatlar **ÖRNEK** etiketlidir.
- TEFAS fon ve BIST hisse fiyatları resmi olmayan ücretsiz kaynaklardan gelir (TEFAS Fon Analiz ara servisi; TradingView 15 dk gecikmeli). Bu servisler kapanır veya değişirse fiyat "alınamadı" der, eski fiyat kalır; elle / liste / ekran görüntüsü ile girilir. TCMB kurları ve BIST 100 geçmişi elle girilir. ABD ETF fiyatı için ücretsiz Twelve Data anahtarı gerekir.
- Frankfurter kurları Avrupa Merkez Bankası referansıdır (iş günü, TCMB/piyasa kurundan biraz farklı olabilir). Uluslararası ons fiyatından hesaplanan gram altın kuyumcu alışından farklı olabilir.
- TÜFE otomatik çekilmez; aylık değeri TÜİK bülteninden girersin. Girilmeyen aylar reel getiriye katılmaz (hangi aya kadar hesaplandığı yazılır).
- Kıyas ve TWR, fiyat geçmişindeki boşluklarda en yakın fiyatı kullanır ("yaklaşık" etiketi). Getiri hesabına yalnızca alım-satım kaydı olan varlıklar girer.
- Aracı kurum dökümü okuma, belgenin yazım biçimine bağlıdır; her satır kontrol tablosundan geçer. (v5) Temettü, bedelsiz/bölünme ve bedelli artık işlem türü olarak girilir; dökümden otomatik okunmaz (aktarımda yalnızca alış/satış satırları tanınır), elle eklenir. Yabancı paralı temettüde o günkü kur gerekir.
- Portföy Analizi alanı henüz yapım aşamasındadır.
- Hesap bakiyeleri elle girilir; transferler bakiyeyi değiştirir, sıradan harcama kayıtları değiştirmez (bankayla mutabakat yapılmaz).
- Hatırlatma bildirimleri yalnızca uygulama açıkken (günde en fazla bir kez) gösterilir; arka planda push bildirimi yoktur.
- Ekstreden oluşturulan taksit planının toplamı tahminidir (taksit × sayı); gerekirse Kartlar sekmesinde düzelt. Taksit tanıma, ekstredeki yazım biçimine bağlıdır.
- Kumbaraya "ayrılan" para ayrı bir hesaba taşınmaz; birikim/net varlık içinde görünmeye devam eder.
- Ay seçme kutusunun ay adları tarayıcının diline göre görünür.
- (v4) Net varlık eğrisi yalnızca uygulamanın açıldığı/kaydedildiği günlerin değerlerini gösterir; geçmişe dönük hesaplanmaz. Gerçek verine geçtiğinde eğri o günden itibaren dolar. Grafik kütüphanesi (~1 MB) ilk açılışta bir kez yüklenir, sonra tarayıcı önbelleğinden gelir.
- Ücretsiz OCR, el yazısı ve bulanık fotoğraflarda zayıftır; bu durumda yapay zekâ ile oku. Her durumda kontrol tablosundan geçer.
- HEIC (iPhone) fotoğrafları otomatik JPEG'e çevrilir. Fotoğraf yan yatık çekilmişse (EXIF bilgisi yoksa) OCR okuyamayabilir; fişi dik çek.
- Fiş okunamazsa bile kontrol tablosunda düzenlenebilir bir satır ve okunan ham metin gösterilir; tutarı elle yazıp kaydedebilirsin.
- Site dosyadan (file://) açıldığında OCR motoru jsDelivr CDN'den yüklenir (tarayıcı yerel worker'a izin vermez).
- (v5) Eşitleme için GitHub hesabı ve gist izinli anahtar gerekir. Google Drive seçeneği yok: tarayıcıdan Drive'a yazmak için kayıtlı bir Google OAuth istemci kimliği gerekir (bu da ücretsiz ama Google Cloud'da proje açmayı ister). Çakışmada "yeni" kararı cihaz saatine göre verilir; cihaz saatleri çok farklıysa yanlış sürüm kazanabilir (kaybolmaz, Çakışmalar'da durur). Eşitleme iki cihaz aynı anda yazarsa bir sonraki turda düzelir.
- (v6) Kilit kapalıyken anahtarlar tarayıcının cihaz anahtarıyla şifrelenir: diske/yedeğe açık metin düşmez, ama bu tarayıcı profiline tam erişimi olan biri (ör. aynı bilgisayarda oturum açmış kişi) uygulamayı açıp kullanabilir; gerçek koruma PIN kilididir. Kilit deneme sayacı tüm site verisi silinerek sıfırlanabilir — ama bu, şifreli verinin kendisini de siler.
- (v6) Katılım 50 (KATLM) için ücretsiz otomatik geçmiş kaynağı yok: elle/CSV girilir (girilmezse kıyas "veri yok" der). CSP nedeniyle Ollama yalnızca localhost/127.0.0.1 adresinde çalışır.
- (v5) Biyometrik açma yalnızca https'te ve WebAuthn PRF destekleyen tarayıcılarda (güncel Chrome/Android, Safari 18+/iOS 18+, Windows Hello) görünür. Kilit tarayıcı/cihaz düzeyinde bir önlemdir; açıkken ekrana bakan biri veriyi görebilir.
- (v5) PIN unutulursa ve yedek/eşitleme yoksa veri kurtarılamaz (tasarım gereği).

Bu uygulama bir planlama aracıdır, yatırım tavsiyesi değildir.
