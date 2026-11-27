# Finans Pusulası — v8.3

Bütçe, birikim ve **helal (faizsiz)** yatırım planı için kişisel finans uygulaması.
Tamamen senin cihazında çalışır, ücretli hiçbir sisteme bağlı değildir, tek klasör hâlinde her yere taşınabilir.

Üç alan: **Bütçe** (gelir, gider, ödemeler, hesaplar), **Portföy Yönetimi** (alım-satım, dengeleme, getiri, hedefler, risk, fiyatlar) ve **Portföy Analizi** (v7: canlı grafikli varlık analizi, skorlar, portföy sağlık skoru, helal portföy oluşturucu). **Ana sayfa** üçünün sade özetini gösterir.

- **Sade görünüm:** finans bilmeyen biri de anlar.
- **Detaylı görünüm:** formüller, oranlar, enflasyonlu/enflasyonsuz değerler, varsayımlar.
- **Hatasız hesap:** tüm para hesapları tam sayı **kuruş** ile yapılır (0,1 + 0,2 = 0,3; ondalık hata yok). 340 otomatik birim testi + tarayıcıda uçtan uca testler var.
- **Canlı grafikler (v4):** Ana sayfa, Bütçe ve Portföy Yönetimi açılışında hareketli, dokunmatik grafikler: net varlık eğrisi (1A/3A/6A/1Y/Tümü), birikim halkası, gelir → gider → birikim akışı, hedef halkaları, 6 aylık gelir/harcama çubukları, sayılarda sayaç animasyonu. Üzerine gelince ya da dokununca kuruşu kuruşuna tutar görünür; veri değişince grafik yumuşak geçişle anında güncellenir. Sistem "hareketi azalt" ayarında animasyonlar kapanır.
- **Yedek, eşitleme ve kilit (v5):** ana sayfada görsel "Veri güvenliği" kutuları (son yedek halkası, eşitleme, kilit, kalıcı depo) ve tek dokunuşla **💾 Yedeği indir**; haftalık (ayarlanabilir) yedek hatırlatması; otomatik kopyalar (son 10 sürüm, geri yüklenebilir); **uçtan uca şifreli cihazlar arası eşitleme** (kendi GitHub hesabındaki gizli Gist, ücretsiz); isteğe bağlı **PIN/parola kilidi** (veri cihazda şifreli, hareketsizlikte otomatik kilit, destekleyen cihazda parmak izi/yüz ile açma).
- **Temettü, bedelsiz, bedelli (v5):** yeni işlem türleri kâr/zarara, maliyete ve getiri hesabına (XIRR/TWR) doğru girer.
- **Otomatik TEFAS ve BIST fiyatı (v5):** TEFAS fonları ücretsiz bir TEFAS veri servisinden, BIST hisseleri TradingView'in herkese açık tarayıcısından (15 dk gecikmeli) çekilir; olmazsa liste yapıştır / ekran görüntüsünden oku / ✎ ile tek dokunuşla düzelt.

### v8.9.0 — Portföy oluşturucu: geçmiş performans ve gelecek tahmini
- **Geçmiş performans** (oluşturucu sonucu ve her kayıtlı portföy): bugünkü ağırlıklarla 1A/3A/6A/1Y/3Y/Maks getirileri, tutarın TL değeri, yıllık ve reel (TÜFE) getiri, en büyük düşüş + toparlanma süresi, oynaklık, Sharpe/Sortino (eşik TÜFE), en iyi/kötü ay, aylık ısı haritası; BIST 100, Katılım Tüm, USD/TL, gram altın ve TÜFE ile kıyas; aylık/çeyreklik dengeleme ve al-tut; düzenli aylık yatırım (DCA, XIRR) ve aynı takvimle dolar/altın/TÜFE karşılaştırması.
- **Gelecek tahmini**: 5.000 senaryolu Monte Carlo (portföy ve USD/TL günlük getirileri birlikte, durağan blok bootstrap; Web Worker'da, arayüz donmaz) — 1/3/6 ay, 1/3/5 yıl yüzdelikleri, zarar / enflasyonu yenme / doları yenme olasılığı, olasılık yelpazesi; "geçmiş veriyle" ve "temkinli (getiri = enflasyon)" varsayımları.
- **Stres testi**: 2018, 2020, 2021, 2022, Mart 2025 kriz dönemlerinin gerçek faktör hareketleri × varlık betası; portföyün kendi en kötü 1/3/6/12 ayı; ani TL değer kaybı şoku. **Hedef hesaplayıcı**: TL/$ hedefe ulaşma olasılığı ve %50/%75/%90 için gereken aylık yatırım.
- Veri: TÜFE TÜİK verisi (TCMB tablosu; günlük işte `macro/TUFE.json`, yedek `refdata/tufe.json`), kriz dönemleri `refdata/stres.json` (`tools/make_ref_data.py`). Karşılaştırma tablosuna geçmiş ve beklenen getiri sütunları; özet kayda yazılır. Hesaplar `js/perf.js` (testli).

### v8.8.3 — ABD hissesi canlı fiyat etiketi ve yenilemesi
ABD/Londra varlıklarında son fiyat kaynağı artık "ABD/Londra borsası son işlem" diye yazılır (önceden BIST'in "15 dk gecikmeli" etiketi görünüyordu); ABD hisseleri de analiz sayfasında 60 sn'de bir canlı yenilenir; Yöntem sayfasına ABD hisselerinin kaynağı ve Şer'i etiket kuralı eklendi.

### v8.8.2 — Anında arama, ABD hisseleri ve yabancı (helal) ETF'ler, hız
- **Anında arama:** Varlık analizi ve Portföy oluşturucudaki arama kutusu yazdıkça (150 ms) açılır liste gösterir: önce sembol öneki (sa → SAHOL, SASA, SARKY…), sonra isim. Türkçe harfler katlanır (İ/I/ı/i, ş, ç, ğ, ö, ü). ↑ ↓ / Enter / Esc, dokunmatik seçim. Liste yerel dizinden gelir (BIST'in tamamı, ABD hisseleri, yabancı ETF'ler, altın/döviz, büyük kriptolar); TEFAS fon adı ve diğer kriptolar yazmayı bırakınca ağdan eklenir.
- **ABD hisseleri:** market-data iş akışı (MODE=us) S&P 500 + Nasdaq-100 bileşenlerini TradingView'den alır, günlük mumları Yahoo'dan çeker. Şer'i etiket: SP Funds (SPUS/SPTE/SPRE) güncel portföyündeyse "Uygun"; banka/sigorta/alkol/kumar/tütün iş kolundaysa "Uygun değil"; kaynak yoksa "Belirsiz" (helal filtresinden geçmez). Analizde USD likidite eşikleri, %30 oynaklık tabanı, S&P 500 (SPY) kıyası, aynı sektördeki ABD şirketleriyle değerleme; BIST %10 tavan kuralı uygulanmaz.
- **Yabancı ETF'ler:** SPUS, HLAL, SPSK, SPRE, SPTE, SPWO, UMMA + Londra (USD hattı) ISDW, ISDU, ISDE, HIWO; kıyas için SPY, QQQ ("Uygun değil"). Oluşturucuda "ABD hisseleri (USD)" sınıfı (en çok 3 hisse, sektör başına 2); Yalnız TL açıkken girmez; USD fiyat × USD/TL kuru.
- **Hız:** varlık sayfasındaki haber tekilleştirme O(n²) idi (~1,7 sn donma) → ters dizin (~15 ms, sonuç birebir aynı). Tam sembol eşleşmesinde arama ağ beklemeden açılır.

### v8.8.1 — Koyu temada form alanları okunur
Koyu temada bazı metin kutuları (özellikle `type` yazılmamış olanlar, ör. Portföy Analizi → Kendi verini yükle → Varlık adı) beyaz kalıp açık renk yazıyı görünmez kılıyordu: genel kural yalnız `input[type=text]` diyordu, özniteliksiz input buna girmez. Tüm metin girişleri (text, sayı, tarih, arama, parola, e-posta, type'sız), seçim kutuları ve metin alanları artık sayfa rengini (`--bg` / `--ink`) kullanır; `color-scheme` açık/koyu temaya uyar; placeholder, `option`, devre dışı ve otomatik doldurma (`-webkit-autofill`) da aynı paleti kullanır. Açık tema bozulmaz. Testler: 489 node (3 yeni) + 11 py; uçtan uca tüm sayfalarda (masaüstü + 390×844, koyu ve açık tema) alan arka planı ve metin kontrastı.

### v8.8.0 — Profesyonel portföy oluşturucu, kayıtlı sanal portföyler ve her bölümde "Nasıl kullanılır?"
- **Portföy Analizi → Portföy oluşturucu:** isteğe bağlı tutar (TL; boşsa yüzde ağırlıklı model portföy) ve ad. Yatırımcı profili (Muhafazakâr / Dengeli = standart / Agresif / Özel) filtreleri otomatik ayarlar; "Standart filtreye dön". Helal filtresi aç/kapa (varsayılan açık; "uygun değil" etiketliler hiçbir ayarda girmez). Vade, risk, varlık sınıfları, **Döviz / Dolar bazlı helal ETF dahil / Yalnız TL araçlar** (üçü bağımsız; Yalnız TL + ETF/Döviz = TL araçlar + istisna, dövize bağlı pay ≤ %30), varlık sayısı, tek varlık üst sınırı, en düşük skor, likidite, hemen alınabilir pay hedefi, alım bölgesi tercihi, BIST sektörleri. Çelişkili seçimler (helal+kripto, Yalnız TL+kripto, sınıf yok, kısa vade+yüksek risk, sayı×sınır < %100 …) uyarıyla gösterilir.
- **Dağılım:** vade × risk tablosundan güvenli/orta/riskli paylar; grup içinde skor, alım bölgesi ve oynaklığa göre ağırlık; tek varlık sınırı; boş/aşan pay daha düşük riskli gruba ya da nakde (risk asla artmaz); sektör/tür çeşitliliği; fonlar gözlenen oynaklıkla gruplanır.
- **Sanal alım ("almış gibi"):** tutar yazılırsa oluşturma anındaki canlı fiyatlardan adet/maliyet/tarih; alım bölgesinde olmayanlar bekleyen nakit/emir olarak tutulur ve sonraki günlük mumlarda seviyeye gelince dolmuş sayılır. Gerçek varlık, alım-satım ve bütçeden tamamen ayrıdır (`labPortfolios`).
- **Rapor:** portföy skoru (0-100, 7 şeffaf bileşen; veri yetersizse skor yok), varlık skorları, dağılım halkası, risk/getiri dağılımı, değer takibi, beklenen oynaklık, 1 aylık %95 VaR, en büyük düşüş ve olası en büyük düşüş tahmini, 3 yıllık geçmiş test, korelasyon, her varlık için alım bölgesi / stop / hedef 1-2 / R/Ö ve seviye cetveli, "şimdi alınabilir" ya da "şu seviyeye gelirse al", özet tablo, filtre dışında kalanlar ve nedenleri, yöntem.
- **Kayıtlı portföylerim:** her portföy ayrı sayfada canlı fiyatlarla yeniden analiz, K/Z (TL ve %), bekleyen emir dolumu, stop/hedef olayları, yeniden dengeleme önerisi, yeniden adlandır, sil (geri al), karşılaştırma tablosu, yazdır/PDF; isteğe bağlı "gerçek portföyüme hedef olarak uygula".
- **Her bölümde ℹ "Nasıl kullanılır?":** açılır-kapanır kutu (kapalı başlar): ne işe yarar, nasıl kullanılır, seçenekler, en iyi ve en kötü seçim, riskler; her sayfada ayrıca sayfa yardımı.
- Testler: 486 node + py; yeni `tests/run-tests-v880.js` (skor, dağılım, seviyeler, filtre birleşimleri, sanal alım/değerleme/emir dolumu, kaydet/yükle, veri koruması, yardım kapsamı).

### v8.7.2 — Tek seferlik yerleşik düzenleme (her cihazda)
Uygulama **her cihazda** (arka plan izleme kurulu olmasa da) açılınca `js/migrate.js`'teki tek seferlik düzenlemeyi (`midas-only-2026-11-25`: tüm varlıkları temizle + Midas geçmişi, bütçe durur) bir kez uygular: şifreli dosyayı `market-data` dalından (`bg/tek-seferlik-1.enc.json`) alır, önce otomatik kopya, sonra "Geri al"lı bildirim; numara kaydedilir, bir daha çalışmaz (Geri al'dan sonra da). Uzaktan düzenleme kutusu aynı numarayı uyguladıysa atlanır (ve tersi). Cihazda yalnız örnek/boş veri varsa örnek bütçe de bırakılmaz. **Gizlilik:** dosya şifreli ama anahtar kodda (parola sormadan çalışsın diye) — yani kodu okuyan biri açabilir; içerik yalnız sembol/adet/fiyat/tarih. Dosya geçmişi tutulmayan `market-data` dalında; tüm cihazlar uyguladıktan sonra silinmesi önerilir. Testler: 453 node (4 yeni) + 11 py.

### v8.7.1 — Uzaktan "tüm varlıkları temizle" ve kendiliğinden sürüm geçişi
Uzaktan düzenlemeye `holdings-wipe` işlemi eklendi (yalnız ilk işlem olabilir): **Tüm varlıkları temizle** ile aynı — altın dahil tüm varlıklar, alım-satımlar, stoplar, varlık uyarıları ve varlık fiyat geçmişi silinir, **bütçe durur**; ardından gelen `broker-replace` yalnız dosyadaki varlıkları açar. Önce otomatik kopya, sonra tek "Geri al"lı değişiklik. Bekleyen düzenleme artık `bg/inbox.v2.enc.json` yolunda (eski sürüm tanımadığı işlemi okumasın); eski sürümde başarısız kaydedilen bir düzenleme yeni sürümde yeniden denenir. **Yeni sürüm kendiliğinden devreye girer**: kullanıcı o an bir alana yazıyorsa ya da pencere açıksa sayfa yenilenmez, "Yeni sürüm yüklendi — Yenile" çıkar. Testler: 449 node (5 yeni) + 11 py.

### v8.7.0 — Uzaktan düzenleme kutusu (senin yerine düzenleme)
Arka plan izleme açıksa, senin isteğinle hazırlanan bir düzenleme (ör. aracı kurum geçmişi) **sen hiçbir şey yapmadan** uygulanır: kutu tarafı düzenlemeyi `FINANS_INBOX_KEY` ile şifreleyip gizli Gist'e koyar (`finans-inbox.box.enc.json`) → `market-portfolio` iş akışı çözüp cihaz anahtarıyla (PORTFOLIO_KEY) yeniden şifreler ve `market-data` dalına `bg/inbox.enc.json` yazar → uygulama açılınca (ve arka planda ~10 dk'da bir) okur; numarası daha önce uygulanmadıysa **önce otomatik kopya** (Ayarlar → Yedek → Anlık görüntüler) alır, sonra uygular ve **Geri al**lı Türkçe bildirim gösterir. Sonuç (numara, saat, kısa özet) cihazın şifreli yüküne girer; iş akışı bunu `bg/inbox-ack.enc.json` olarak (yalnız kutu anahtarıyla açılır) yazar ve uygulanan düzenlemeyi daldan siler. Desteklenen işlemler: `broker-replace` (🏦 Aracı kurum geçmişini uygula ile aynı mantık: altın, diğer varlıklar ve bütçe durur), `asset-set` (ad, risk, helal etiketi). Örnek veriye uygulanmaz. Kutu betiği: `node tools/push-edit.js init | push DOSYA [--id ID] | check [--id ID] | clear` (sırlar yalnız ortamdan/dosyadan okunur, yazdırılmaz). Testler: 444 node (12 yeni) + 11 py.

### v8.6.1 — Aracı kurum geçmişini uygula (ör. Midas)
**Veri ekle → 🏦 Aracı kurum geçmişini uygula** ile hazır geçmiş dosyası (`format: finans-pusulasi-araci-kurum`, .json) seçilir. Önizleme penceresi her varlık için Yeni / Değişecek durumunu, mevcut ve dosyadaki işlem sayısını, sonuç adedi ve dokunulmayacak varlıkları gösterir. Uygulayınca **yalnızca dosyadaki varlıkların alım-satımları** dosyadakilerle değiştirilir (varlık kimliği, stop ve notlar korunur; eksik fiyat kaynağı / tür / helal etiketi tamamlanır; olmayan varlık tam bilgisiyle açılır). Diğer varlıklar (ör. fiziki altın) ve tüm bütçe verileri durur. Önce otomatik kopya alınır ve yedek indirilir; bildirideki **Geri al** önceki hâli getirir. İşlem saati (isteğe bağlı `time`) saklanır, işlem listesinde gösterilir ve aynı gündeki işlemleri doğru sıraya koyar. Dosya yanlışlıkla «Yedekten geri yükle» ile seçilirse de geri yükleme yapılmaz, aynı önizleme açılır.

### v8.6 — Tüm varlıkları temizle (bütçe durur)
Portföyü sıfırdan yazmak için: **Portföy Yönetimi** başlığındaki veya **Ayarlar ve yedek → Veri yönetimi** içindeki **Tüm varlıkları temizle**. Onay penceresi silinecekleri (varlık, alım-satım, stop, seviye uyarısı, işlem notu) ve kalacakları (bütçe işlemleri, hesaplar, transferler, taksitler, düzenli ödemeler, hedefler) sayıyla listeler; **Anladım** kutusu işaretlenmeden onay kapalıdır. Silmeden önce otomatik kopya alınır (Ayarlar → Yedek, eşitleme, kilit → Otomatik kopyalar) ve yedek JSON indirilir. Hemen ardından bildirideki **Geri al** önceki hâli getirir (mevcut değişiklik geçmişi / geri al yığını). Site ve bütçe durur; net varlık yalnız hesapları sayar; raporlar, zarar durdur ve analiz boş portföyde hata vermez. Arka plan izleme bir sonraki yüklemede şifreli paketi varlıkları boş olarak günceller.

### v8.5 — Seans raporları, zarar durdur (stop) uyarıları, işlem gerekçe notları
- **Raporlar** sekmesi: her piyasa için günde 3 rapor — açılış öncesi (beklentiler), seans ortası (ne hareket etti, neden), kapanış sonrası (gün özeti + yarının planı). İlk sayfa özet: gün K/Z, en iyi/en zayıf, risk ışıkları, kilit seviyeler, bugünün olayları, grafikler. Sonra her varlık için banka raporu biçiminde sayfa (fiyat, trend/RSI/MACD/ortalamalar, destek/direnç, haber/KAP, takvim, senaryolar, analize dayalı değerlendirme, helal notu, işlem notların). "PDF indir / Yazdır" ile PDF.
- **Saatler (TSİ):** BIST + altın + TEFAS: 09:30 · 13:30 · 18:30 (arife yarım gün 09:30 · 11:30 · 13:30; BIST tatilleri atlanır). ABD: New York saatiyle 09:00 · 12:45 · 16:30 → kışın 17:00 · 20:45 · 00:30, yazın 16:00 · 19:45 · 23:30 TSİ (yaz saati kendiliğinden; NYSE tatilleri ve erken kapanışlar dahil). Kripto (yalnız elinde varsa): 09:00 · 15:00 · 21:00. GitHub Actions (market-reports.yml) 15 dakikada bir uyanır, zamanı gelen raporu üretir. Herkese açık piyasa raporu `reports/public/`; kişisel rapor yalnızca PORTFOLIO_KEY ile şifreli (`bg/reports.enc.json`), uygulamada açılır; hazır olunca ntfy'ye 2 satır özet.
- **Zarar durdur (stop):** Raporlar → Zarar durdur. Fiyat ya da kapanış bazlı, isteğe bağlı iz süren stop; "Seviye öner" yapı (destek altı − 0,5×ATR) ve ATR'den gerekçeli öneri verir, karar senindir. Yaklaşınca (%3), çok yaklaşınca (%1) uyarı, kırılınca **kritik** bildirim ("Midas'ta sat"). Uyarılar tekrarlanmaz, geçmişi tutulur. Kontrol: uygulama açıkken 5 dakikada bir, arka planda seans saatlerinde ~20 dakikada bir (market-portfolio.yml). **Uygulama emir iletemez**: Midas'ın herkese açık emir API'si yok; otomatik satış için aynı seviyeyi Midas'ta stop emri olarak gir.
- **Gerekçe notları:** her alım/satıma "Gerekçe / not" (1000 karakter); "Analiz gerekçesini ekle" uygulamanın analizini (kaynak ve tarihle) nota yazar; CSV/Excel içe aktarmada isteğe bağlı "Not"/"Gerekçe" sütunu. Notlar işlem geçmişinde ve raporlarda görünür (sunucuya gönderilmez).

### v8.3 — Şifreli kişisel veri paketi (dosya yüklemeden)
Sana ait gerçek veriyi sen yüklemeden, siteyi açıp **şifreni bir kez yazarak** almak için: veri `data/kisisel-veri.enc.json` olarak **yalnızca şifreli** halde depoya konur (AES-256-GCM, PBKDF2-SHA256 6.000.000 tur, rastgele tuz/IV; `js/cryptobox.js` ile aynı biçim). Site açılınca paket varsa ve cihazda yalnızca örnek/boş veri varsa "Kişisel verilerin hazır — şifreni gir" penceresi çıkar. Doğru şifre → önce otomatik kopya ("Kişisel veri yüklenmeden önce"), sonra mevcut geri yükleme yoluyla **tüm örnek veri kaldırılıp** gerçek veri yerleşir. Yanlış şifre → hata, tekrar dene. "Şimdilik geç" oturum boyunca tekrar sormaz; örnek veri bandındaki "Kişisel verilerimi aç" ile açılır. Cihazda gerçek veri varsa sessizce üzerine yazılmaz, "güncelle" teklifi sorulur. Şifre hiçbir yere yazılmaz; cihazda yalnızca gizli olmayan paket kimliği tutulur.
- **Paketi (yeniden) üretme:** düz yedeği **depo dışında** tut; `FINANS_DATA_PASSWORD='…' node tools/encrypt_personal.js <düz-yedek.json>` → `data/kisisel-veri.enc.json`. Betik 12 karakterden kısa / yalnız rakamdan oluşan parolayı **reddeder** (depo herkese açık; şifreli dosyayı herkes indirip çevrimdışı deneyebilir — 6 haneli bir PIN dakikalar içinde kırılır). Öneri: 4–5 rastgele kelime veya 16+ karakter. Depoya bir kez giren şifreli dosya git geçmişinde kalıcıdır; parolayı sonradan değiştirmek eski dosyayı korumaz.

### v8.2 — Arka planda portföyümü de izle (şifreli, isteğe bağlı)
Depo herkese açık olduğu için v8.1'de portföye özel hiçbir şey sunucuda hesaplanmıyordu. v8.2 bunu **portföy verisi düz metin olarak hiçbir yere gitmeden** çözer: veri cihazında şifrelenir, sunucu (GitHub Actions) yalnız çalışırken bellekte çözer, sonucu yine şifreler.
- **Ne izler?** Portföy sağlık skoru ve düşüşü, varlık/limit aşımları (risk kuralları), seviye ve stop alarmları (fiyat Actions'ta güncellenir), **elindeki varlıkların taze analizindeki değişim** (skor ≥15 puan düşüş, zayıf/çok zayıf'a geçiş, dirençte yorulma = "azaltmayı gözden geçir"; yalnız bu varlıklar için, **satış emri değildir**), portföyünle ilgili haber/KAP/olaylar, duygu durumu (duygudan satış önerisi yok), **yaklaşan ödemeler** (kira, fatura, kart son ödeme günü, yıllık giderler). Aynı JS modülleri (`js/bgwatch.js` → `notify.js`, `analysis.js`, `news.js`, `mood.js`, `alerts.js`…) tarayıcıda ve Node'da çalışır; e2e'de Node ↔ tarayıcı sonucu birebir karşılaştırılır.
- **Nasıl çalışır?** Uygulama (Haberler → **Arka plan izleme**) rastgele 256 bit anahtar üretir; yükü (beyaz liste: varlıklar, alım-satımlar, hedefler, alarm seviyeleri, izleme listesi, ayarlar, ödeme hatırlatma listesi — **işlemler, serbest metinler, TÜFE, eşitleme izi, token yok**) AES-256-GCM ile şifreleyip kendi **gizli Gist**'ine yükler (dosya boyutu 16 KiB kademeleriyle sabitlenir). Anahtar + Gist numarası + ntfy konu adı tek bir "kurulum dizgesi" (`FPBG1.…`) olarak GitHub sırrı **`PORTFOLIO_KEY`**'e yapıştırılır. `market-portfolio` iş akışı (her saat :14, :34, :54 — haber işinden 7 dk sonra —, her günlük/saatlik veri işinden sonra ve elle) Gist'i okur, çözer, kontrol eder, sonucu **`bg/results.enc.json`** olarak (aynı anahtarla şifreli) `market-data` dalına yazar ve ntfy ile bildirir. Uygulama sonucu cihazında açar ve "**Arka plan son kontrol**" saatiyle gösterir. Veri değiştikçe (uygulama açıkken) şifreli yük otomatik güncellenir.
- **Senin yapacakların (en az adım):** (1) Haberler → Arka plan izleme → GitHub "gist" izinli bir anahtar gir (bulut eşitlemeyi kurduysan otomatik atlanır) → **Kurulumu başlat**. (2) **GitHub'da sır oluştur** düğmesi → Name: `PORTFOLIO_KEY`, Secret: **Kopyala** ile alınan değer → Add secret. (3) Telefona ntfy uygulamasını kur, gösterilen konuya abone ol. (4) **Uçtan uca test başlat** (en geç ~20 dk içinde telefona "zincir çalışıyor" gelir; hemen için Actions → market-portfolio → Run workflow). Hepsi bu.
- **Bildirim ayarları** (kategori, önem eşiği, sessiz saatler) uygulamadaki **Bildirim ayarları**'ndan gelir (yeni kategori: *Ödeme hatırlatması*). Tekilleştirme: aynı olay bir kez bildirilir (şifreli günlükte tutulur), ağır hâle gelirse yeniden; ntfy hatasında 3 kez yeniden denenir. Örnek veride **gerçek bildirim gönderilmez** (yalnız kurulum testi) ve uygulama "ÖRNEK VERİ" etiketi gösterir. İlk çalışmada eski durumlar için bildirim yağmuru olmaz (en çok 3 kritik).
- **Telefon bildirimi gizliliği:** ntfy.sh mesaj metnini görür. Kip *Ayrıntılı* (varsayılan): varlık adı + gerekçe, **TL tutarları her zaman silinir**; kip *Genel*: yalnız "Portföy uyarısı: Kritik · Portföy" (hiçbir ad yok). Bildirim metni hiçbir zaman otomatik satış emri değildir.
- **Tehdit modeli.** *Herkese açık olanlar:* depodaki kod, `market-data` dalındaki piyasa verisi, **şifreli** `bg/results.enc.json` (boyut 16 KiB kademeli, zaman damgası görünür; "biri bu özelliği kullanıyor" bilgisi sızar), herkese açık Actions günlükleri. *Şifreli:* Gist (GitHub'ın barındırdığı yalnız şifreli metin; adresi bilen de anahtarsız okuyamaz) ve sonuç dosyası. *Anahtar:* yalnız cihazında (`Store.setSecret`; kilit açıksa PIN anahtarıyla şifreli) ve senin Actions sırrında; depoda/kodda/istemci paketinde yok (testle taranır). *Actions günlükleri:* sırlar `::add-mask::` ile maskelenir, çözülen veri hiç yazdırılmaz, günlüğe yalnız sayılar gider (varlık adı/tutar yok); testle "günlükte ve sonuç dosyasında düz metin yok" doğrulanır. *Güvenmen gerekenler:* GitHub (sırrı çalıştırma anında bellekte tutar; depo yöneticisi olarak workflow'u değiştirebilen biri sırrı sızdırabilir — depoya yazma erişimini koru), ntfy.sh (mesaj metni), tarayıcın. *Kapsam dışı:* cihazın ele geçirilmesi; GitHub hesabının ele geçirilmesi (token + sır). Anahtar yenileme ve kapatma aşağıda.
- **Anahtar yenileme / kapatma.** *Anahtarı yenile:* yeni anahtar üretilir, Gist yeniden şifrelenir, yeni dizge gösterilir; GitHub'da `PORTFOLIO_KEY`'i aynı adla "Update" ile güncelle (güncelleyene kadar izleme durur; eski sonuç dosyası yeni anahtarla açılmaz). *Kapat ve sil:* Gist silinir, anahtar cihazdan kalkar; iş akışı bir sonraki çalışmada Gist'in yok olduğunu görüp `bg/results.enc.json`'u da siler (gerçek Actions'ta doğrulandı); sonra `PORTFOLIO_KEY` sırrını silmeni öneririz. Sır hiç tanımlı değilse iş akışı hiçbir şey yapmaz.
- **Durum kontrolü.** Uygulamadaki *Durumu kontrol et*: cihazda şifreleme, Gist'te yedek (anahtarla açılıyor mu), telefona test bildirimi (tarayıcıdan), arka plan sonucunun varlığı/yaşı/anahtar uyumu; *Uçtan uca test* ise Actions'ın telefona gerçekten bildirim gönderdiğini doğrular. (Tarayıcı Actions'ı doğrudan tetikleyemez — belirteç `workflow` izni taşımaz; bu bilerek böyle.)
- **Kamuya açık depo yüzünden eksik/kısıtlı kalanlar — denetim sonucu.** *Düzeltildi:* portföye özel uyarılar/analiz değişimi/haber-olay ilgisi/duygu/limit aşımı (arka planda, şifreli); evrende olmayan varlıkların analizi (artık elindeki her varlık için Actions'ta canlı hesaplanır; `WATCH_SYMBOLS` değişkeni gerekmez, geriye uyumluluk için duruyor); yaklaşan ödeme hatırlatmaları (v8.1'de yalnız uygulama açıkken); seviye alarmları (fiyat artık arka planda da kontrol edilir). *Bilerek cihazda kalanlar:* işlem geçmişi, harcama limitleri/kategori bütçeleri, serbest metinler, AI asistan/OCR anahtarları — bunlar arka plan için gerekmez, şifreli olsa bile dışarı çıkmaz. *Hâlâ sınırlı:* tarayıcı Actions'ı tetikleyemez (≤~20 dk gecikme); GitHub zamanlanmış işleri geciktirebilir; analiz kaynağı günlük mumlar (seans içi fiyat 15 dk gecikmeli); ntfy sunucusu metni görür (Genel kip bunu kapatır); kalıcı sır/Gist hesabın GitHub güvenliğine bağlıdır (2FA aç).

### v8.1 — Her zaman güncel: arka plan veri, haber ve analiz
Siten kapalıyken de veri, haber ve analizler **GitHub Actions** (ücretsiz) ile yenilenir; sayfa açılınca hazır sonucu anında gösterir.
- **Zamanlama (UTC; TSİ = UTC+3).** `market-news` her saat :07, :27, :47 (haber akışı + takvim + olasılıklar + uyarılar, 7/24) · `market-crypto` her saat :22 (8 kripto analizi, 7/24) · `market-intraday` iş günü 08:10–14:10 UTC saat başı (= 11:10–17:10 TSİ; saatlik mumlar, KAP, analizler) ve hafta sonu 09:00 · `market-data` iş günü 07:30 ve 15:40 UTC (= 10:30 ve 18:40 TSİ; tam derleme + Katılım 50 ve örnek varlıkların analizleri) · `keepalive` her pazartesi (iş akışlarını yeniden etkinleştirir). GitHub zamanlanmış işleri dakikalarca (yoğunken yarım saat) geciktirebilir; "her 20 dk" bir **garanti değil hedeftir**.
- **Çakışma yok, depo şişmez.** Her iş kendi concurrency grubunda çalışır ve yayın aşaması (`tools/publish.py`) en güncel `market-data` ucunu alıp yalnızca kendi dosyalarını (iş başına izin listesi) üstüne yazar; haber havuzu URL'ye göre, uyarılar kimliğe göre birleşir; dal hep **tek commit** (force-push, `--force-with-lease` + yeniden deneme). Testi: `tests/test_publish.py` (yerel git deposuyla; eşzamanlı işler birbirini ezmez).
- **Sunucuda hesaplanan analizler.** `tools/precompute.js`, tarayıcıdaki **aynı** modülleri (`js/mdata.js`, `analysis.js`, `snapshot.js`) Node'da çalıştırır: Katılım 50 hissesi, ASELS/EREGL (örnek portföy), endeksler, altın/gümüş, döviz, helal ABD ETF'leri, örnek fonlar, kripto → `analysis/*.json` (+ `analysis/index.json`). Portföy → Genel bakış'ta "Sunucu analizleri" tablosu, varlık sayfasında "Sunucu anlık görüntüsü" kartı (son güncelleme + tarayıcıdaki canlı hesapla karşılaştırma). **Kendi varlıkların** için analiz yine tarayıcında hesaplanır; sunucu satırı yalnız tarayıcı hesabı yoksa ya da eskiyse gösterilir (etiketli). Node ↔ tarayıcı eşitliği e2e'de sabit ASELS verisiyle birebir doğrulanır.
- **Senaryolar.** `tools/scenarios.js` önümüzdeki 21 günün olayları için beklenti/senaryo özeti üretir (`hub/scenarios.json`); olasılık yalnızca gerçek kaynaktan (Kalshi/Polymarket vb.), yoksa boş bırakılır.
- **Midas'ın Kulakları (haber kaynağı).** robots.txt `/midasin-kulaklari/` yolunu yasaklamıyor; RSS/API yok, bu yüzden herkese açık liste sayfası ve makale `article:published_time` meta etiketi okunur (tanımlı User-Agent, en çok 12 makale isteği/çalışma, ≤14 gün). Yalnız **başlık + bağlantı + tarih** saklanır; metin kopyalanmaz. Tarih bulunamazsa yaklaşık işaretlenir. Portföyle ilgili olanlar etiketlenir; aynı haber tekilleştirilir.
- **Güncellik her yerde görünür.** Ana sayfa ve Haberler üstünde "Arka plan verisi" şeridi (iş başına son çalışma), **Haberler → Kaynaklar ve güncelleme** sekmesinde iş durumu, kaynak başına son çekme/en yeni haber, Midas durumu, analiz sayısı. Beklenen çalışma gelmezse "gecikmeli", çok geçse "durmuş görünüyor" uyarısı çıkar (zamanlama `js/freshness.js` ↔ workflow cron'ları testle eşleştirilir).
- **Site kapalıyken telefona bildirim (güvenilir yol): ntfy.** GitHub → Settings → Secrets and variables → Actions: `NTFY_TOPIC` (tahmin edilemez uzun bir ad; ntfy uygulamasında aynı konuya abone ol). İsteğe bağlı değişkenler: `NTFY_MIN` (`critical` varsayılan, `high` ister isen) ve `WATCH_SYMBOLS` (örn. `ASELS,THYAO` — **yalnız sembol**, adet/tutar yok). Piyasa geneli kritik/yüksek uyarılar ve izleme listendeki varlıkların stop/ilk hedef durumları gönderilir; her uyarı bir kez. Sır tanımlı değilse hiçbir şey gönderilmez.
- **Gizlilik:** depo herkese açık olduğundan **portföyün/adetlerin/tutarların düz metin olarak hiçbir yere yüklenmez**; sunucu yalnız genel piyasa verisini analiz eder (portföye özel arka plan izleme için isteğe bağlı **şifreli** yol: v8.2). İzleme listesi uyarıları yalnız ntfy'ye gider, herkese açık dosyalara yazılmaz (tekilleştirme için tuzlu özet kullanılır). Konu adını gizli tut: ntfy'de konu adını bilen herkes mesajları okuyabilir.
- **Tarayıcı arka plan eşitleme (bonus, EN İYİ ÇABA).** Haberler → Kaynaklar ve güncelleme → "Site kapalıyken bildirim": Periodic Background Sync yalnız Chrome/Edge'de (Android'de uygulama ana ekrana yüklüyse) ve tarayıcının seçtiği aralıkta çalışır; iOS/Firefox desteklemez; **garanti yoktur**. İzleme anahtarları yalnız cihazdaki servis çalışanı önbelleğinde durur.
- **Sınırlar:** GitHub 60 gün etkinlik olmayan depolarda zamanlanmış işleri kapatabilir; `keepalive` her hafta işleri yeniden etkinleştirir, ama bunun her durumda yeterli olduğu doğrulanmış değildir (Actions sekmesine ara sıra bak; uygulama "durmuş görünüyor" der). Analizin kaynağı günlük mumlardır; seans içi fiyat 15 dk gecikmeli TradingView'dir. Midas'ın liste sayfası değişirse kaynak "alınamadı" der, haber uydurulmaz.

### v8.0 — Haberler, bildirim merkezi, takvim ve senaryolar, duygu durumu
Yeni **Haberler** bölümü (4 sekme) ve başlıkta **zil**:
- **Bildirim merkezi:** önem (kritik / yüksek / orta / bilgi), tekrar ayıklama (aynı olay bir kez), ertele, kapat (daha ağır olursa yeniden çıkar), okundu, geçmiş, kategori ayarı (portföy, fiyat seviyesi, kritik haber, takvim/senaryo, piyasa şoku, veri kalitesi), sessiz saatler (TSİ), eşikler. Her bildirimde **neden**, **kaynak** ve **saat** var. Portföye özel uyarılar yalnız cihazında üretilir; piyasa geneli uyarılar ayrıca iş akışında üretilir.
- **Haber akışı:** TR + küresel RSS, Fed/ECB duyuruları (resmî), elindeki BIST hisseleri için KAP. Elindeki varlıklara göre ★ / dolaylı etiket, önem puanı (açıklanır), tekrar birleştirme, filtre (portföy / sınıf / bölge / önem).
- **Takvim ve senaryolar:** TCMB PPK, Fed, ECB, TÜİK enflasyon, ABD TÜFE/istihdam, haftalık veri; her olay için beklenti, senaryo (ör. faiz artar/sabit/azalır) → varlık gruplarına genel etki, portföyünün payı ve **geçmişte benzer olaylarda gerçekleşen fiyat tepkisi (n ile)**. Olasılık yalnız gerçek kaynaktan: Fed ve ABD TÜFE → Kalshi, siyaset → Polymarket; TCMB faiz kararı için güvenilir kaynak olmadığından **olasılık gösterilmez** (anket ortalaması ve TCMB'nin yayımladığı enflasyon olasılık dağılımı gösterilir).
- **Duygu durumu kartı (Ana sayfa):** zirveden düşüş, 30 gün değişim, düşüş serisi ve plan sapmasından kural tabanlı durum; korku / FOMO / pişmanlık / aşırı güven; kaynaklı öneriler (Kahneman-Tversky 1979, Odean 1998, Barber-Odean 2000 vb.), kontrol listesi, geçmişte toparlanma süreleri (gerçek veri), isteğe bağlı günlük check-in. Duyguya bakarak al-sat önerisi vermez.
- **Varlık sayfasında** o varlık grubunu etkileyecek yaklaşan olaylar ve haberler.
- **Veri hattı:** `tools/fetch_hub.py` (iş akışında) `hub/*.json` ve `news/feed.json` üretir; kurallar `tools/news_rules.json` (tek kaynak) → `js/newsrules.js` (`python3 tools/gen_rules.py`). Python ve JS puanlama eşitliği testle doğrulanır.
- **Telefona push (isteğe bağlı):** ntfy.sh. Ayarlar → Bildirim ayarları sayfasında adımlar var; GitHub'da `NTFY_TOPIC` adlı Actions sırrı oluşturursan, yalnız piyasa geneli kritik uyarılar telefonuna gelir. Varsayılan kapalı.

### v7.1 — Portföy Analizi, 2. aşama
- **Okunaklı grafik etiketleri:** destek/direnç, trend, Fibonacci, giriş/stop/hedef etiketleri grafiğin sağındaki ayrı bir şeride, çakışmayı önleyen yerleşimle (öncelik + küme birleştirme) yazılır; son mumların üstüne binmez. Küçük ekranda yalnız önemli seviyeler kısa adla gösterilir.
- **Gün içi zaman dilimleri (1S / 4S):** kripto Binance'tan; BIST (Katılım Tüm ∪ BIST 100 ∪ BIST 30 üyeleri), endeksler, makro ve ABD ETF'leri Yahoo saatlik mumlarından (seans boyunca saatte bir derlenir; 4S = seansın 10:00–13:30 / 13:30–18:00 TSİ yarıları). Aynı motor (yapı, göstergeler, formasyonlar, plan) gün içi mumlara uygulanır; günlük skor ve ana plan değişmez, gün içi kart yalnız zamanlama içindir. Kapanmamış mum işaretlenir. TEFAS fonları ve yüklenen veriler için gün içi yoktur.
- **Fiyat uyarıları:** plan seviyelerindeki 🔔 ile ya da elle fiyat yazarak kurulur; uygulama açılınca, sekme açıkken 10 dakikada bir ve fiyat güncellemesinde kontrol edilir; tetiklenen uyarı bir kez bildirilir (isteğe bağlı tarayıcı bildirimi), "Yeniden kur" ile tekrar etkinleşir. Uygulama kapalıyken kontrol yapılmaz.
- **KAP bildirimleri:** her BIST hissesi için son 30 günün bildirimleri (konu etiketleriyle) sunucu tarafında derlenir. Skora katılmaz.
- **Önbellekli haberler:** Türk ekonomi RSS akışları (yalnız başlık + bağlantı) sunucuda 14 gün tutulur, başlığında şirket adı/kodu geçenler hisseye bağlanır; altın/döviz/kripto/piyasa için konu listeleri. GDELT ("Dünya basınında ara") isteğe bağlı ek arama olarak kalır.
- **Gerçek Katılım endeksi geçmişi:** Yahoo, Katılım endeksleri için günlük geçmiş vermez; XKTUM/XK100/XK050/XK030 günlük mumları endeksin kendi 730 günlük saatlik verisinden derlenir (ilk açılış / en yüksek / en düşük / son kapanış) ve üyelerin eşit ağırlıklı getirisiyle korelasyonla kontrol edilir. Katılım hisselerinde göreli güç artık bu endekse göre ölçülür (yoksa BIST 100'e düşülür ve bu yazılır).

### v7.0 — Portföy Analizi
- **Varlık analizi (her kod için):** BIST hissesi (ASELS), TEFAS fonu (KTV), kripto (BTC, SOL…), gram/ons altın-gümüş, dolar/euro, helal ABD ETF'leri (SPUS, HLAL…) yazıp aratılır; başka bir varlık için CSV/Excel'den OHLCV yapıştırılabilir. **Canlı, etkileşimli mum grafiği** (yakınlaştır/kaydır, 3A/6A/1Y/2Y/Tümü), hacim / RSI / MACD / Stokastik RSI / ADX alt paneli, açılır-kapanır SMA-EMA 20/50/200, Bollinger, Ichimoku (ileri bulutla), Supertrend, çapalı VWAP.
- **Algoritmayla çizilen yapı:** ATR tabanlı zikzak tepe-dipler, kümelenmiş **destek/direnç bölgeleri** (dokunuş sayısıyla), en az iki tepe/dipten geçen ve kapanışla kırılmamış **trend çizgileri ve kanal**, son salınımın **Fibonacci** seviyeleri, **formasyonlar** (ikili tepe/dip, OBO/TOBO, yükselen/alçalan/simetrik üçgen, boğa/ayı bayrağı — güven %, onay durumu, hedef ve geçersizlik seviyesiyle), **RSI uyumsuzlukları**, 120 günlük hacim profili (POC, değer alanı).
- **Seviyeler yapıdan çıkar, sabit yüzde yok:** Temkinli plan (destek bölgesinden alım, stop = bölge altı − 1 ATR) ve Atak plan (kırılım/yeniden test, stop = kırılan direnç altı − 0,5 ATR); hedefler sonraki direnç bölgeleri, ölçülen hareket ve Fibonacci uzantıları. Her hedefte **risk/ödül**; ilk güçlü hedefte R/Ö < 1,5 ise "bekle". Pozisyon büyüklüğü portföyün %0,5/%1'i riske edilerek, tek varlık sınırıyla kırpılır. Fonlarda stop yerine "gözden geçirme seviyesi".
- **Skor (0-100) + güven:** varlık türüne göre belgeli ağırlıklarla trend, momentum, risk, temel/değerleme (hisse: F/K, PD/DD, FD/FAVÖK, ÖK kârlılığı, büyüme, borç — sektör medyanına göre; fon: kategori içi getiri sırası, Sharpe, dolar/altın kıyası, yatırımcı ve para akışı), göreli güç, likidite. Helal durumu skora katılmaz, **alım planı için kapıdır**. Elde tutulan varlıkta satış yalnızca **fiyat dirençteyken en az iki yorulma kanıtı** varsa önerilir; direnç kırılıp trend güçlüyse "tut, hedefi yükselt, stopu yukarı çek".
- **Doğrulama katmanı:** (1) gösterge kütüphanesi TA-Lib 0.8.3 / pandas_ta referans değerleriyle birim testinde (ASELS + BTC/USDT gerçek verisi; en büyük göreli fark ~1e-11; Yöntem sekmesinde tarayıcıda yeniden çalıştırılabilir), (2) her analizde göstergelerimiz TradingView'in **aynı gün** için hesapladığı RSI/ATR/ADX/SMA/EMA/MACD/Bollinger/Kijun değerleriyle karşılaştırılır, (3) veri kontrolleri: tarih sırası, mum tutarlılığı, boşluk, BIST %10 sınırı (bölünme günü hariç), aykırı hareket, güncellik, İş Yatırım ile kapanış uyumu. Veri hatası veya güven < 35 → **sinyal verilmez**.
- **Portföy sağlık skoru:** çeşitlendirme (korelasyonla etkin varlık sayısı), yoğunlaşma, risk dağılımı uyumu, oynaklık/düşüş, acil fon, helal uyum, likidite, maliyet, performans (helal kıyasa göre), kural uyumu — ağırlıklı, A-E notlu, düzeltmeler Yönetim/Bütçe sayfalarına bağlı.
- **Portföy oluşturucu (helal filtre her zaman açık):** vade × risk tablosundan güvenli/orta/riskli dağılım; araçlar canlı veriden kurallı seçilir (TEFAS İslami etiketli para piyasası/kira sertifikası, karma ve hisse fonları; gram altın; Katılım Tüm endeksinden tarama puanı yüksek hisseler; SPUS). Kripto eklenmez. 3 yıllık geçmiş test (aylık dengeleme): yıllık getiri, oynaklık, en büyük düşüş, en kötü/en iyi 12 ay. **Tek tıkla Yönetim'e hedef olarak uygula** (önce otomatik yedek); aylık tutar Bütçe'den gelir.
- **Bağlantılar:** Yönetim'deki varlıklar otomatik eşlenir ve "Tümünü analiz et" ile skorlanır; ana sayfa kartında sağlık skoru ve en güçlü/en zayıf varlık; izleme listesi (eşitlenir); "Asistana sor" analizi bağlamıyla yapay zekâya taşır; haberler (GDELT, isteğe bağlı — yanıt yoksa "haber kaynağı yok" denir, uydurulmaz).

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
| Portföy Analizi | **Genel bakış** (sağlık skoru, varlık skorları, izleme listesi) · **Varlık analizi** (`#analiz/varlik/bist:ASELS` gibi doğrudan bağlantı) · **Portföy oluşturucu** · **Yöntem ve doğrulama** (ağırlıklar, kurallar, tarayıcıda referans testi, kaynaklar) |
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
- Python testleri: `python3 tests/test_publish.py` (yayın/birleştirme/ntfy gizliliği, `portfolio` işi yalnız `bg/` + `.delete`, konu adı yedeği; 7 test) ve `python3 tests/test_midas.py` (Midas ayrıştırma, 4 test). v8.2 uçtan uca (sahte GitHub/ntfy + gerçek iş betiği): `python3 e2e_v82.py file|http|live`. v8.1 uçtan uca: `python3 e2e_v81.py file|http|live`.
- Komut satırında (Node.js varsa): `node tests/run-tests.js` → 356 test: 105 temel + 30 v5 + 25 v6 + 101 v7 + 9 v7.1 + 31 v8 + 15 v8.1 + 16 v8.3 (`tests/run-tests-v83.js`: şifreli paket gidiş-dönüş, yanlış parola/kurcalama, örnek verinin tamamen değişmesi, uygulandı atlama, güncelleme teklifi, betik zayıf parola reddi, depo denetimi) + 24 v8.2 (`tests/run-tests-v82.js`: AES-GCM gidiş-dönüş/kurcalama/yanlış anahtar/16 KiB dolgu, kurulum dizgesi, yük gizliliği + hesap eşitliği, ödeme hatırlatmaları, kontrol motoru (örnek veri, eski yük, alarm, tekilleştirme, ilk çalışma sınırı), iş betiği (sahte Gist + yerel ntfy sunucusu; günlükte/sonuç dosyasında düz metin ve sır yok, ntfy hatasında yeniden deneme, anahtar uyuşmazlığı, Gist silinince sonuç silme), akış/depo sır taraması) (`tests/run-tests-v8.js`: haber puanlama/eşleştirme, olasılıklar, bildirim motoru, duygu durumu, Python/JS kural eşitliği) (`tests/run-tests-v71.js`: etiket yerleşimi, saatlik ayrıştırma ve 4S birleştirme, Binance gün içi, gün içi analiz, haber konu eşlemesi, uyarı tetikleme/yeniden kurma) (`tests/run-tests-v7.js`: 33 göstergenin ASELS ve BTC/USDT üzerinde TA-Lib referansına eşitliği, sentetik şekillerle zikzak/bölge/trend çizgisi/Fibonacci/formasyon/uyumsuzluk, veri ayrıştırıcılar ve kontroller, skor-plan-satış kuralı-sağlık-oluşturucu-geçmiş test) (`tests/run-tests-v6.js`: denetimdeki her hata için regresyon — kart ekstresi algılama/çevirme/1.854,39 toplamı, şüpheli işaret, taksi≠TAKSİT, acil fon 0'da "tamam" yok, taşma, ortak risk kuralı, acil fon payı, örnek veri/eşitleme koruması, Türkçe ekler, tutar uyarıları, olası mükerrer, adet yuvarlama, temettü ayrımı, ay sonu tahmini, Katılım 50 kıyası) (`tests/run-tests-v5.js`: şifreleme gidiş-dönüş, yanlış parola/bozuk veri reddi, rastgele tuz/IV; kilit oluştur/aç/yanlış PIN/PIN değiştir, biyometrik sarma, deneme sınırı; eşitleme damgaları, birleştirme, çakışma ve "diğer sürüm", silme izi, silme×değiştirme, fiyat serisi birleşimi, sahte Gist ile iki cihaz turu, yanlış eşitleme parolası; bedelsiz/birleşme/temettü/bedelli hesapları ve XIRR/TWR akışları; v3→v4 taşıma; TEFAS/TradingView ayrıştırıcıları; yapıştırılan fiyat listesi). Önceki 105 test (para, bütçe, içe aktarma, kur, taksit, kart, sınır, düzenli ödeme, kumbara, karşılaştırma, v1→v2→v3 dönüştürme, yedek doğrulama; v3: ortalama maliyet ve K/Z, fazla satış reddi, XIRR, TWR, reel getiri, kıyas, dengeleme, çoklu hedef, risk kuralları, fiyat sıçrama/eskime kontrolü, aracı kurum dökümü ve toplam kontrolü, fiyat kaynağı ayrıştırıcıları; v4: net varlık geçmişi kaydı, aralık ve değişim hesabı, örnek geçmişin bugünün değeriyle tam bitmesi).
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
js/portfolio-ui.js    Ana sayfa kartları ve Portföy Yönetimi ekranları
js/ta.js              Teknik göstergeler ve istatistik (TA-Lib uyumlu, testli)
js/structure.js       Grafik yapısı: pivot, zikzak, destek/direnç, trend çizgisi, Fibonacci, formasyon, uyumsuzluk
js/mdata.js           Piyasa verisi katmanı: kaynaklar, ayrıştırıcılar, veri kontrolleri, arama
js/analysis.js        Skorlar, planlar, satış kuralı, portföy sağlık skoru, oluşturucu, geçmiş test
js/tachart.js         Analiz grafiği (ECharts seçenekleri) ve skor göstergesi
js/analysis-ui.js     Portföy Analizi ekranları
js/newsrules.js       Haber kuralları (tools/news_rules.json'dan üretilir)
js/news.js            Haber puanlama, tekrar birleştirme, portföy eşleştirme (saf, testli)
js/events.js          Takvim, beklenti, olasılık, senaryo → varlık etkisi, benzer olaylar (saf, testli)
js/notify.js          Bildirim motoru: aday üretimi, birleştirme, ertele/kapat, sessiz saat (saf, testli)
js/mood.js            Duygu durumu kuralları, öneriler, kaynaklar (saf, testli)
js/hubdata.js         Haber merkezi verisi yükleyici (market-data dalı, önbellek)
js/hub-ui.js          Haberler bölümü, zil, ana sayfa duygu kartı, varlık sayfası olay kartı
tools/fetch_hub.py   Haber/takvim/olasılık/benzer olay verisi (GitHub Actions)
tools/news_rules.json, tools/analog_events.json, tools/gen_rules.py   Kural ve olay kaynakları
tools/fetch_market_data.py   GitHub Actions ile günlük piyasa verisi derleyici (market-data dalı)
tools/make_ta_reference.py   TA-Lib referans değerlerini üreten betik
.github/workflows/market-data.yml  Zamanlanmış veri derleme (iş günleri 10:30 ve 18:40 TSİ)
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
- (v7) BIST/emtia/döviz/ABD ETF geçmişi, depodaki GitHub Actions iş akışıyla (iş günleri 10:30 ve 18:40 TSİ) Yahoo Finance'tan derlenip `market-data` dalına yazılır; gün içi son fiyat TradingView'den (BIST 15 dk gecikmeli). GitHub, 60 gün hiç işlem olmayan depolarda zamanlanmış iş akışlarını durdurabilir (Actions sekmesinden yeniden etkinleştirilir). Kaynaklar resmî değildir; kesintide "alınamadı" yazılır.
- (v7) Gram altın/gümüş ons × USD/TL'den türetilir (yalnız kapanış); TEFAS fonları günde bir fiyat verir (mum yok, ATR yaklaşık). (v7.1'de çözüldü: Katılım endeksi günlük geçmişi saatlik veriden derlenir; yalnız ~2 yıl geriye gider.) Listede olmayan ABD hisseleri için Twelve Data anahtarı veya OHLCV yükleme gerekir.
- (v7) Haberler GDELT'ten isteğe bağlı çekilir; servis yoğunken yanıt vermeyebilir (o zaman "Haber kaynağı yanıt vermedi" + "Tekrar dene"; haber uydurulmaz). Duygu etiketi basit kelime eşleştirmesidir. (v7.1'de haberler ayrıca Türk RSS akışlarından sunucu tarafında önbelleklenir.)
- (v7.1) KAP verisi kap.org.tr web sitesinin kullandığı resmî olmayan uç noktadan alınır; KAP değiştirirse kart "alınamadı" der. Haber eşleştirmesi başlıkta ad/kod aramasıdır: kısa/genel adlı şirketlerde kaçırma veya yanlış eşleşme olabilir. GDELT bazı IP'lere hız sınırı uygular (429).
- (v7.1) Gün içi BIST verisi yalnız Katılım Tüm ∪ BIST 100 ∪ BIST 30 üyeleri için, iş günleri 11:10–17:10 TSİ arasında saatte bir (Actions zamanlaması birkaç dakika gecikebilir) güncellenir; Yahoo saatlik verisi 15 dk gecikmelidir. Gram altın gün içi yalnız kapanış (mum yok).
- (v7.1) Fiyat uyarıları sunucusuz çalışır: yalnız uygulama açıkken kontrol edilir (kapalıyken bildirim gelmez).
- Sonraki aşama: temel verilerin geçmişi (çeyreklik F/K, kâr büyümesi trendi) ve kripto zincir üstü göstergeler (ücretsiz ve güvenilir kaynak doğrulanınca).
- Hesap bakiyeleri elle girilir; transferler bakiyeyi değiştirir, sıradan harcama kayıtları değiştirmez (bankayla mutabakat yapılmaz).
- Hatırlatma bildirimleri yalnızca uygulama açıkken (günde en fazla bir kez) gösterilir. Site kapalıyken bildirim yalnızca v8.1'deki ntfy (kurulum gerekir) ya da en iyi çaba Periodic Sync ile gelir.
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
