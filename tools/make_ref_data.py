#!/usr/bin/env python3
"""v8.9.0 — Gelecek tahmini / geçmiş performans için paketlenen referans veriler (elle, sürüm öncesi çalıştırılır).

refdata/tufe.json  : TÜFE aylık/yıllık % değişim (TÜİK verisi, TCMB tablosu). Site önce market-data dalındaki
                  macro/TUFE.json'u (günlük iş tazeler) okur; alınamazsa bu paketlenmiş kopyayı kullanır.
refdata/stres.json : Tarihî kriz dönemlerinde gerçek piyasa hareketleri (Yahoo Finance günlük kapanışları, range=max):
                  BIST 100 (TL), USD/TL, altın ons (USD), gümüş ons (USD), S&P 500 (SPY, USD). Dönem sınırları
                  olayın bilinen tarihleridir; getiriler bu tarihlerdeki (veya öncesindeki son) kapanışlardan hesaplanır.
Hiçbir değer uydurulmaz: kapanışı olmayan faktör null yazılır.
"""
import json, os, sys, datetime
sys.argv = [sys.argv[0], '/tmp/_ref_unused']
sys.path.insert(0, os.path.dirname(__file__))
import fetch_market_data as F

ROOT = os.path.join(os.path.dirname(__file__), '..')
NOW = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
FACT = {'XU100': 'XU100.IS', 'USDTRY': 'USDTRY=X', 'XAUUSD': 'GC=F', 'XAGUSD': 'SI=F', 'SPY': 'SPY'}
WINDOWS = [
    ('kur2018', '2018 kur krizi', '2018-07-31', '2018-08-13', 'Ağustos 2018 TL krizi: kısa sürede sert kur yükselişi, hisselerde düşüş.'),
    ('covid2020', 'Covid çöküşü (2020)', '2020-02-20', '2020-03-23', 'Şubat–Mart 2020 küresel salgın satışı.'),
    ('kur2021', 'Kasım–Aralık 2021 TL şoku', '2021-11-01', '2021-12-17', 'Faiz indirimleri sonrası TL\'nin hızlı değer kaybı (20 Aralık müdahalesinden önceki zirve).'),
    ('abd2022', '2022 küresel ayı piyasası', '2022-01-03', '2022-10-12', 'ABD faiz artışlarıyla küresel hisse düşüşü.'),
    ('mart2025', 'Mart 2025 piyasa şoku', '2025-03-18', '2025-04-07', 'Mart 2025 iç siyasi gelişmeler ve Nisan 2025 küresel gümrük vergisi satışı.'),
]

def closes(sym):
    # range=max Yahoo'da aylık mum döndürür → günlük için period1/period2 (2015-01-01'den bugüne)
    import urllib.request
    p1 = int(datetime.datetime(2015, 1, 1, tzinfo=datetime.timezone.utc).timestamp()); p2 = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    url = 'https://query2.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d' % (urllib.request.quote(sym), p1, p2)
    r = F.http(url)['chart']['result'][0]; off = int(r['meta'].get('gmtoffset') or 0)
    q = r['indicators']['quote'][0]; out = {}
    for t, c in zip(r['timestamp'], q['close']):
        if c is not None and c > 0: out[datetime.datetime.fromtimestamp(t + off, datetime.timezone.utc).strftime('%Y-%m-%d')] = c
    assert len(out) > 2000, sym + ': günlük veri az (%d)' % len(out)
    return out

def at_or_before(m, d):
    ks = [k for k in m if k <= d]
    return (max(ks), m[max(ks)]) if ks else (None, None)

def main():
    h = F.http(F.TUFE_URL, headers={'Accept': 'text/html'}, raw=True, tries=3).decode('utf-8', 'replace')
    rows = F.parse_tufe(h)
    assert len(rows) >= 24, 'TÜFE tablosu okunamadı'
    F.write(os.path.join(ROOT, 'refdata/tufe.json'), {'kind': 'cpi', 'name': 'TÜFE (Türkiye, aylık % değişim)', 'source': 'TÜİK — TCMB "Tüketici Fiyatları" tablosu (tcmb.gov.tr)', 'url': F.TUFE_URL, 'fetchedAt': NOW, 'bundled': True, 'months': rows})
    data = {k: closes(v) for k, v in FACT.items()}
    out = []
    for wid, label, a, b, desc in WINDOWS:
        f, used = {}, {}
        for k, m in data.items():
            da, ca = at_or_before(m, a); db, cb = at_or_before(m, b)
            f[k] = round(cb / ca - 1, 5) if ca and cb and da and db and da < db else None
            used[k] = [da, db]
        out.append({'id': wid, 'label': label, 'from': a, 'to': b, 'desc': desc, 'f': f, 'dates': used})
    F.write(os.path.join(ROOT, 'refdata/stres.json'), {'source': 'Yahoo Finance günlük kapanışlar (resmi olmayan): BIST 100 (XU100.IS, TL), USD/TL (USDTRY=X), altın (GC=F, USD), gümüş (SI=F, USD), S&P 500 (SPY, USD)', 'fetchedAt': NOW, 'factors': FACT, 'windows': out})
    print(json.dumps(out, ensure_ascii=False, indent=1)[:3000]); print('TÜFE', rows[-1])

if __name__ == '__main__':
    main()
