#!/usr/bin/env python3
"""Finans Pusulası v8 — Haber/Takvim/Olasılık/Tarihsel benzerlik verisi (yalnızca Python standart kütüphanesi; PKA PDF'i için pdftotext).

Çıktı (market-data dalında `hub/` ve `news/feed.json`):
  hub/calendar.json  — resmî takvimler (TCMB, Fed, ECB) + TÜİK kural tarihleri + ForexFactory haftalık takvim + Kalshi veri yayın saatleri
  hub/probs.json     — piyasa fiyatlı olasılıklar (Kalshi, Polymarket) + TCMB Piyasa Katılımcıları Anketi beklentileri
  hub/macro.json     — politika faizleri (TCMB, Fed, ECB) + piyasa göstergeleri (VIX, ABD 10Y, DXY, Brent, S&P 500, altın, USD/TL, BIST 100, BTC)
  hub/analogs.json   — tarihsel olay çalışması: gerçek günlük kapanışlardan 1/5/20 işlem günü getirileri
  hub/recovery.json  — gerçek fiyat geçmişinden düşüş ve toparlanma süreleri
  hub/alerts.json    — iş akışı tarafı üretilen piyasa geneli uyarılar (+ isteğe bağlı ntfy.sh push)
  news/feed.json     — son 7 günün başlıkları (TR + küresel + resmî), bölge ve resmî kaynak etiketli
Hiçbir değer uydurulmaz: kaynak alınamazsa ilgili bölüm 'error' ile boş yazılır, önceki başarılı sürüm (varsa) korunur.
Kişisel, ticari olmayan kullanım. Kaynaklar resmî olmayabilir (Kalshi/Polymarket/ForexFactory/Yahoo).
"""
import json, os, sys, re, math, time, html, datetime, subprocess, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_market_data as F

OUT = F.OUT
NOW = F.NOW
TR = F.TR
ISO = '%Y-%m-%dT%H:%M:%SZ'
NOWS = NOW.strftime(ISO)
DAY = datetime.timedelta(days=1)
def utc(s):
    return datetime.datetime.strptime(s, ISO).replace(tzinfo=datetime.timezone.utc)
def ymd(d): return d.strftime('%Y-%m-%d')
def prev(rel): return F.load_prev(rel) or F.load_json(os.path.join(OUT, rel))
def jget(url, tries=2, timeout=30, headers=None):
    return F.http(url, tries=tries, timeout=timeout, headers=headers)
def tget(url, tries=2, timeout=40):
    return F.http(url, tries=tries, timeout=timeout, raw=True, headers={'Accept': 'text/html,*/*'}).decode('utf-8', 'ignore')
def txt(h):
    h = re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h)))
def num_tr(s): return float(s.replace('.', '').replace(',', '.')) if ',' in s else float(s)
def keep_prev(rel, obj, err):
    """Kaynak alınamadıysa önceki başarılı sürüm korunur (stale işaretiyle)."""
    p = prev(rel)
    if p and not p.get('error'):
        p['stale'] = True; p['staleReason'] = str(err)[:120]; return p
    return dict(obj, error=str(err)[:160])

MONTHS_TR = {'Ocak': 1, 'Şubat': 2, 'Mart': 3, 'Nisan': 4, 'Mayıs': 5, 'Haziran': 6, 'Temmuz': 7, 'Ağustos': 8, 'Eylül': 9, 'Ekim': 10, 'Kasım': 11, 'Aralık': 12}
MONTHS_EN = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])}

# ---------------------------------------------------------------- TCMB faiz tablosu ve takvim
CBRT_RATE_URL = 'https://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb+tr/main+menu/temel+faaliyetler/para+politikasi/merkez+bankasi+faiz+oranlari/1+hafta+repo'
CBRT_CAL_URL = 'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Duyurular/Takvim'
CBRT_SURVEY_URL = 'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Egilim+Anketleri/Piyasa+Katilimcilari+Anketi/'

def cbrt_rates():
    """[(etkili tarih, oran)] — TCMB 1 hafta repo (borç verme) değişiklik tablosu."""
    t = txt(tget(CBRT_RATE_URL))
    i = t.find('Tarih Borç Alma Borç Verme'); seg = t[i + 26:i + 4000]
    rows = []
    for m in re.finditer(r'(\d{2})\.(\d{2})\.(\d{4})\s+(-|[\d.]+)\s+(-|[\d.]+)', seg):
        d = '%s-%s-%s' % (m.group(3), m.group(2), m.group(1)); lend = m.group(5)
        if lend != '-': rows.append((d, float(lend)))
    rows.sort()
    if len(rows) < 10: raise Exception('TCMB faiz tablosu ayrıştırılamadı')
    return rows

def cbrt_calendar():
    h = tget(CBRT_CAL_URL); m = re.search(r'<table[^>]*id="midTable".*?</table>', h, flags=re.S)
    if not m: raise Exception('TCMB takvim tablosu yok')
    out = []
    for tr in re.findall(r'<tr>(.*?)</tr>', m.group(0), flags=re.S):
        tds = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', x))).strip().replace('\xa0', ' ') for x in re.findall(r'<td[^>]*>(.*?)</td>', tr, flags=re.S)]
        if len(tds) < 4: continue
        for col, (typ, title) in enumerate([('cbrt_ppk', 'TCMB PPK faiz kararı'), ('cbrt_summary', 'TCMB PPK toplantı özeti'), ('cbrt_infl_report', 'TCMB Enflasyon Raporu'), ('cbrt_fsr', 'TCMB Finansal İstikrar Raporu')]):
            mm = re.match(r'(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})', tds[col])
            if mm and mm.group(2) in MONTHS_TR:
                d = '%s-%02d-%02d' % (mm.group(3), MONTHS_TR[mm.group(2)], int(mm.group(1)))
                out.append({'id': '%s:%s' % (typ, d), 'type': typ, 'title': title, 'date': d, 'time': None, 'country': 'TR', 'impact': 'high' if typ == 'cbrt_ppk' else 'medium' if typ in ('cbrt_infl_report',) else 'low',
                            'kind': 'official', 'source': {'name': 'TCMB resmî takvim', 'url': CBRT_CAL_URL}})
    if not out: raise Exception('TCMB takvimi boş')
    return out

# ---------------------------------------------------------------- Fed ve ECB
FED_CAL_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
FED_RATES_URL = 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm'
ECB_CAL_URL = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'

def fed_calendar():
    h = tget(FED_CAL_URL); out = []
    for y in range(NOW.year, NOW.year + 3):
        i = h.find('%d FOMC Meetings' % y)
        if i < 0: continue
        j = h.find(' FOMC Meetings', i + 20); seg = h[i:j if j > 0 else i + 30000]
        t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '|', seg)); t = re.sub(r'(\|\s*)+', '|', t)
        for m in re.finditer(r'\|(January|February|March|April|May|June|July|August|September|October|November|December)\|\s*(\d{1,2})(?:-(\d{1,2}))?(\*?)\|', t):
            mo = MONTHS_EN[m.group(1)]; day = int(m.group(3) or m.group(2)); d = '%d-%02d-%02d' % (y, mo, day)
            out.append({'id': 'fomc:' + d, 'type': 'fomc', 'title': 'Fed (FOMC) faiz kararı' + (' + ekonomik projeksiyonlar' if m.group(4) else ''), 'date': d, 'time': None, 'country': 'US', 'impact': 'high', 'kind': 'official',
                        'source': {'name': 'Federal Reserve resmî takvim', 'url': FED_CAL_URL}})
    if not out: raise Exception('FOMC takvimi ayrıştırılamadı')
    return out

def fed_rate_changes():
    """[(etkili tarih, artış/azalış bp (+/-), seviye metni)] — Fed 'Open Market Operations' tablosu."""
    h = tget(FED_RATES_URL); t = re.sub(r'[\s|]+', '|', re.sub(r'<[^>]+>', '|', h))
    out = []
    for ym in re.finditer(r'\|(20\d\d)\|Date\|Increase\|Decrease\|Level\|\(%\)\|(.*?)\|Back\|to\|year\|navigation', t):
        y = int(ym.group(1))
        for m in re.finditer(r'(January|February|March|April|May|June|July|August|September|October|November|December)\|(\d{1,2})\|(\d+)\|(\d+)\|([\d.]+(?:-[\d.]+)?)', ym.group(2)):
            d = '%d-%02d-%02d' % (y, MONTHS_EN[m.group(1)], int(m.group(2))); inc, dec = int(m.group(3)), int(m.group(4))
            out.append((d, inc - dec, m.group(5)))
    out.sort()
    if len(out) < 5: raise Exception('Fed faiz tablosu ayrıştırılamadı')
    return out

def ecb_calendar():
    h = tget(ECB_CAL_URL); t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '|', h)); out = []
    for m in re.finditer(r'(\d{2})/(\d{2})/(\d{4})[ |]+Governing Council of the ECB: monetary policy meeting in Frankfurt \(Day 2\)', t):
        d = '%s-%s-%s' % (m.group(3), m.group(2), m.group(1))
        out.append({'id': 'ecb:' + d, 'type': 'ecb_rate', 'title': 'ECB faiz kararı ve basın toplantısı', 'date': d, 'time': None, 'country': 'EU', 'impact': 'high', 'kind': 'official', 'source': {'name': 'ECB resmî takvim', 'url': ECB_CAL_URL}})
    if not out: raise Exception('ECB takvimi ayrıştırılamadı')
    return out

# ---------------------------------------------------------------- ForexFactory haftalık takvim + Kalshi veri saatleri + TÜİK kuralı
FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
def ff_calendar():
    arr = jget(FF_URL); out = []
    for e in arr:
        if e.get('country') not in ('USD', 'EUR', 'TRY', 'GBP', 'JPY', 'CNY') or e.get('impact') not in ('High', 'Medium'): continue
        try: dt = datetime.datetime.fromisoformat(e['date']).astimezone(datetime.timezone.utc)
        except Exception: continue
        tr = dt.astimezone(TR)
        out.append({'id': 'ff:%s:%s:%s' % (e['country'], e['title'][:40], dt.strftime('%Y%m%d%H%M')), 'type': 'data', 'title': '%s — %s' % (e['country'], e['title']), 'date': ymd(tr), 'time': tr.strftime('%H:%M'), 'at': dt.strftime(ISO),
                    'country': {'USD': 'US', 'EUR': 'EU', 'TRY': 'TR', 'GBP': 'GB', 'JPY': 'JP', 'CNY': 'CN'}[e['country']], 'impact': 'high' if e['impact'] == 'High' else 'medium', 'kind': 'ff',
                    'forecast': e.get('forecast') or None, 'previous': e.get('previous') or None, 'actual': e.get('actual') or None, 'source': {'name': 'ForexFactory haftalık takvim (resmî olmayan)', 'url': 'https://www.forexfactory.com/calendar'}})
    return out

KALSHI = 'https://api.elections.kalshi.com/trade-api/v2/'
def f4(x):
    try: return float(x)
    except Exception: return None
def kprice(m):
    b, a, l = f4(m.get('yes_bid_dollars')), f4(m.get('yes_ask_dollars')), f4(m.get('last_price_dollars'))
    if b is not None and a is not None and a >= b and a - b <= 0.08 and (a > 0 or b > 0): return round((a + b) / 2, 4), 'orta (alış/satış)'
    if l is not None: return l, 'son işlem'
    return None, None

def kalshi_release_events():
    """CPI ve istihdam verilerinin yayın saati = Kalshi piyasasının kapanış saati (+1 dk)."""
    out = []
    for ser, typ, title in (('KXCPIYOY', 'us_cpi', 'ABD TÜFE (yıllık) — Kasım gibi aylık veri'), ('KXPAYROLLS', 'us_jobs', 'ABD tarım dışı istihdam')):
        try:
            d = jget(KALSHI + 'events?series_ticker=%s&status=open&with_nested_markets=true&limit=3' % ser)
            for e in d.get('events', [])[:2]:
                ms = e.get('markets') or []
                ct = min([m['close_time'] for m in ms if m.get('close_time')] or [''], default='')
                if not ct: continue
                dt = datetime.datetime.strptime(ct[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc) + datetime.timedelta(minutes=1)
                tr = dt.astimezone(TR)
                out.append({'id': '%s:%s' % (typ, ymd(tr)), 'type': typ, 'title': e.get('title') or title, 'date': ymd(tr), 'time': tr.strftime('%H:%M'), 'at': dt.strftime(ISO), 'country': 'US', 'impact': 'high', 'kind': 'market-derived',
                            'source': {'name': 'Kalshi piyasa kapanış saati (= veri yayın saati)', 'url': 'https://kalshi.com/markets/' + ser.lower()}, 'market': e.get('event_ticker')})
        except Exception as ex: print('kalshi release', ser, ex)
    return out

def tuik_cpi_rule(n=6):
    """TÜİK TÜFE: ayın 3'ü saat 10:00 (hafta sonuna denk gelirse sonraki iş günü). Resmî takvimle doğrulanmadı — KURAL tarihidir."""
    out = []; y, m = NOW.year, NOW.month
    for k in range(n):
        yy, mm = y + (m - 1 + k) // 12, (m - 1 + k) % 12 + 1; d = datetime.date(yy, mm, 3)
        while d.weekday() >= 5: d += DAY
        if d < NOW.date(): continue
        out.append({'id': 'tuik_cpi:%s' % d, 'type': 'tr_cpi', 'title': 'TÜİK enflasyon (TÜFE/ÜFE) açıklaması — kural tarihi', 'date': str(d), 'time': '10:00', 'country': 'TR', 'impact': 'high', 'kind': 'rule',
                    'source': {'name': 'TÜİK yayım kuralı (ayın 3\'ü 10:00; resmî takvimle doğrulanmadı)', 'url': 'https://www.tuik.gov.tr/'}})
    return out

def build_calendar():
    ev, errs, srcs = [], {}, {}
    for name, fn in (('cbrt', cbrt_calendar), ('fed', fed_calendar), ('ecb', ecb_calendar), ('ff', ff_calendar), ('kalshi', kalshi_release_events)):
        try: got = fn(); ev += got; srcs[name] = {'ok': True, 'n': len(got)}
        except Exception as e: errs[name] = str(e)[:120]; srcs[name] = {'ok': False, 'err': str(e)[:120]}
    ev += tuik_cpi_rule(); srcs['tuik_rule'] = {'ok': True}
    seen = {}; out = []
    for e in sorted(ev, key=lambda e: (e['date'], e.get('time') or '')):
        if e['id'] in seen: continue
        seen[e['id']] = 1; out.append(e)
    cut = ymd(NOW - 7 * DAY)
    out = [e for e in out if e['date'] >= cut]
    cal = {'generatedAt': NOWS, 'events': out, 'sources': srcs}
    if len(errs) >= 3 and not out: return keep_prev('hub/calendar.json', cal, 'takvim kaynakları alınamadı: ' + json.dumps(errs, ensure_ascii=False))
    return cal

# ---------------------------------------------------------------- Olasılıklar
POLY = 'https://gamma-api.polymarket.com/'
POLY_SLUGS = [('fed_hike_2026', 'another-fed-rate-hike-in-2026', 'Fed 2026\'da bir artırım daha yapar mı?', 'fed'),
              ('us_recession_2026', 'us-recession-by-end-of-2026', 'ABD 2026 sonuna kadar resesyona girer mi?', 'global'),
              ('tr_early_election', 'will-turkey-schedule-early-presidential-elections-in-2026', 'Türkiye 2026\'da erken cumhurbaşkanlığı seçimi takvimi açıklar mı?', 'tr'),
              ('tr_erdogan_out', 'erdoan-out-before-2027', 'Erdoğan görevden ayrılır mı? (tarihe göre)', 'tr'),
              ('tr_imamoglu', 'ekrem-imamolu-released-from-custody-in-2026', 'Ekrem İmamoğlu 2026\'da tutukluluktan çıkar mı?', 'tr'),
              ('tr_constitution', 'turkish-constitutional-referendum-announced-in-2026', 'Türkiye 2026\'da anayasa referandumu ilan eder mi?', 'tr')]
MTR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
def pm_label(m):
    g = (m.get('groupItemTitle') or '').strip()
    try: d = datetime.datetime.strptime(g, '%B %d, %Y'); return "%d %s %d tarihine kadar" % (d.day, MTR[d.month - 1], d.year)
    except Exception: return (g or (m.get('question') or ''))[:60]
def poly_probs():
    out = []
    for key, slug, q, region in POLY_SLUGS:
        try:
            e = jget(POLY + 'events?slug=' + urllib.parse.quote(slug))[0]
            ms = []
            for m in e.get('markets', [])[:8]:
                try: ops = json.loads(m['outcomePrices']) if isinstance(m.get('outcomePrices'), str) else m.get('outcomePrices')
                except Exception: ops = None
                if m.get('closed') or not ops: continue
                p = float(ops[0]); lab = 'Evet' if len(e.get('markets', [])) == 1 else pm_label(m); ms.append({'label': lab, 'p': round(p, 4), 'bid': f4(m.get('bestBid')), 'ask': f4(m.get('bestAsk')), 'end': (m.get('endDate') or '')[:10]})
            if not ms: continue
            out.append({'id': key, 'question': q, 'region': region, 'source': 'Polymarket', 'url': 'https://polymarket.com/event/' + slug, 'volume': round(float(e.get('volume') or 0)), 'ends': (e.get('endDate') or '')[:10],
                        'outcomes': ms, 'kind': 'market'})
        except Exception as ex: print('polymarket', slug, ex)
    return out

FED_LABEL = {'C26': 'Kesinti >25 bp', 'C25': 'Kesinti 25 bp', 'H0': 'Faiz sabit', 'H25': 'Artırım 25 bp', 'H26': 'Artırım >25 bp'}
def kalshi_fed():
    out = []
    d = jget(KALSHI + 'events?series_ticker=KXFEDDECISION&status=open&with_nested_markets=true&limit=12')
    evs = sorted(d.get('events', []), key=lambda e: e.get('strike_date') or '')[:3]
    for e in evs:
        outs = []
        for m in e.get('markets', []):
            p, how = kprice(m); k = m['ticker'].split('-')[-1]
            if p is None: continue
            outs.append({'label': FED_LABEL.get(k, m.get('yes_sub_title') or k), 'code': k, 'p': p, 'how': how, 'bid': f4(m.get('yes_bid_dollars')), 'ask': f4(m.get('yes_ask_dollars')), 'last': f4(m.get('last_price_dollars'))})
        order = ['C26', 'C25', 'H0', 'H25', 'H26']; outs.sort(key=lambda o: order.index(o['code']) if o['code'] in order else 9)
        if outs: out.append({'id': 'fed:' + (e.get('strike_date') or '')[:10], 'question': e.get('title'), 'region': 'fed', 'source': 'Kalshi', 'url': 'https://kalshi.com/markets/kxfeddecision', 'decisionDate': (e.get('strike_date') or '')[:10],
                             'sum': round(sum(o['p'] for o in outs), 3), 'outcomes': outs, 'kind': 'market'})
    return out

def kalshi_cpi():
    out = []
    d = jget(KALSHI + 'events?series_ticker=KXCPIYOY&status=open&with_nested_markets=true&limit=3')
    def ect(e): return min([m['close_time'] for m in e.get('markets', []) if m.get('close_time')] or ['9'])
    for e in sorted(d.get('events', []), key=ect)[:1]:
        lad = []
        for m in e.get('markets', []):
            p, how = kprice(m); s = f4(m.get('floor_strike'))
            if p is not None and s is not None: lad.append({'above': s, 'p': p})
        lad.sort(key=lambda x: x['above'])
        if len(lad) < 3: continue
        med = None
        for a, b in zip(lad, lad[1:]):
            if a['p'] >= 0.5 > b['p']: med = round(a['above'] + (a['p'] - 0.5) / max(1e-9, (a['p'] - b['p'])) * (b['above'] - a['above']), 2); break
        cts = [m['close_time'] for m in e.get('markets', []) if m.get('close_time')]
        out.append({'id': 'cpi:' + e['event_ticker'], 'question': e.get('title') + ' — "X%\'in üzerinde" olasılıkları', 'region': 'global', 'source': 'Kalshi', 'url': 'https://kalshi.com/markets/kxcpiyoy', 'ladder': lad, 'impliedMedian': med,
                    'releaseAt': (min(cts) if cts else None), 'kind': 'ladder'})
    return out

def kalshi_recession():
    d = jget(KALSHI + 'markets?event_ticker=KXRECSSNBER-26&limit=3'); ms = d.get('markets', [])
    if not ms: return []
    p, how = kprice(ms[0])
    return [{'id': 'rec26', 'question': 'ABD\'de 2026 yılında NBER resesyonu başlar mı?', 'region': 'global', 'source': 'Kalshi', 'url': 'https://kalshi.com/markets/kxrecssnber', 'kind': 'market', 'outcomes': [{'label': 'Evet', 'p': p, 'how': how}]}] if p is not None else []

# TCMB Piyasa Katılımcıları Anketi (PDF)
def cbrt_survey():
    h = tget(CBRT_SURVEY_URL); m = re.search(r'href="([^"]*PKA_Rapor\.pdf[^"]*)"', h)
    if not m: raise Exception('PKA_Rapor.pdf bağlantısı yok')
    url = 'https://www.tcmb.gov.tr' + html.unescape(m.group(1)); b = F.http(url, raw=True, timeout=90, tries=2, headers={'Accept': '*/*'})
    with open('/tmp/pka.pdf', 'wb') as f: f.write(b)
    t = subprocess.run(['pdftotext', '-layout', '/tmp/pka.pdf', '-'], capture_output=True, text=True, timeout=90).stdout
    flat = re.sub(r'\s+', ' ', t)
    mm = re.search(r'\b([A-ZÇĞİÖŞÜ]{4,8}) (20\d\d)\b', t[:600]); up = {k.upper().replace('İ', 'I'): k for k in MONTHS_TR}
    period = ((up.get(mm.group(1).replace('İ', 'I')) or mm.group(1).title()) + ' ' + mm.group(2)) if mm else None
    def two(rx):
        x = re.search(rx, flat); return (num_tr(x.group(1)), num_tr(x.group(2))) if x else None
    cy = two(r'cari yıl sonu tüketici enflasyonu \(TÜFE\) beklentisi bir önceki anket döneminde yüzde ([\d,]+) iken, bu anket döneminde yüzde ([\d,]+)')
    m12 = two(r'12 ay sonrası TÜFE beklentisi bir önceki anket döneminde yüzde ([\d,]+) iken, bu anket döneminde yüzde ([\d,]+)')
    nx = re.search(r'(\w+) ayı Para Politikası Kurulu toplantısı için TCMB politika faiz oranı beklentisi bu anket döneminde yüzde ([\d,]+)', flat)
    row = re.search(r'Önümüzdeki Para Politikası Kurulu toplantıları için\s+((?:[\d,]+\s+){6}[\d,]+)', t)
    vals = [num_tr(x) for x in row.group(1).split()] if row else None
    mrow = re.search(r'Tüketici enflasyonu beklentiniz nedir\? \(%\)\s+((?:[\d,]+\s+){7}[\d,]+)', t)
    mv = [num_tr(x) for x in mrow.group(1).split()] if mrow else None
    fxr = re.search(r'ABD Dolar kuru beklentiniz nedir\? \(TL\)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', t)
    dist = []
    dm = re.search(r'12 ay sonrasına ilişkin olasılık tahminleri değerlendirildiğinde, (.*?) öngörülmektedir', flat)
    if dm:
        for a, b, c in re.findall(r'yüzde ([\d,]+) olasılıkla (?:ise )?yüzde ([\d,]+) [–-] ([\d,]+) aralığında', dm.group(1)): dist.append({'lo': num_tr(b), 'hi': num_tr(c), 'p': num_tr(a) / 100})
    if not (cy and nx): raise Exception('PKA metni beklenen biçimde değil')
    rows = cbrt_rates(); cur = rows[-1]
    return {'id': 'cbrt_survey', 'period': period, 'url': url, 'pageUrl': CBRT_SURVEY_URL, 'source': 'TCMB Piyasa Katılımcıları Anketi', 'respondents': 70 if 'katılımcı tarafından' in flat and '70 katılımcı' in flat else None,
            'cpiYearEnd': {'prev': cy[0], 'now': cy[1]}, 'cpi12m': {'prev': m12[0], 'now': m12[1]} if m12 else None,
            'nextMeeting': {'month': nx.group(1), 'rate': num_tr(nx.group(2))}, 'rateSeries': dict(zip(['meeting1', 'meeting2', 'meeting3', 'yearEnd', 'm12', 'nextYearEnd', 'm24'], vals)) if vals else None,
            'currentRate': {'rate': cur[1], 'since': cur[0]}, 'distribution': None, 'kind': 'survey',
            'monthlyCpi': {'cur': mv[0], 'next': mv[1], 'next2': mv[2]} if mv else None,
            'usdtry': {'monthEnd': num_tr(fxr.group(1)), 'yearEnd': num_tr(fxr.group(2)), 'm12': num_tr(fxr.group(3))} if fxr else None,
            'cpi12mDist': dist or None,
            'note': 'Politika faizi için anket yalnız ortalama verir; katılımcı dağılımı yayımlanmaz, bu yüzden faiz kararı için olasılık yüzdesi YOKTUR. 12 ay sonrası enflasyon için TCMB aralık olasılıklarını yayımlar (cpi12mDist, resmî).'}

def build_probs():
    res = {'generatedAt': NOWS, 'items': [], 'survey': None, 'sources': {}}
    for name, fn in (('kalshi_fed', kalshi_fed), ('kalshi_cpi', kalshi_cpi), ('kalshi_recession', kalshi_recession), ('polymarket', poly_probs)):
        try: got = fn(); res['items'] += got; res['sources'][name] = {'ok': True, 'n': len(got)}
        except Exception as e: res['sources'][name] = {'ok': False, 'err': str(e)[:120]}
    try: res['survey'] = cbrt_survey(); res['sources']['cbrt_survey'] = {'ok': True}
    except Exception as e:
        res['sources']['cbrt_survey'] = {'ok': False, 'err': str(e)[:120]}
        p = prev('hub/probs.json')
        if p and p.get('survey'): res['survey'] = dict(p['survey'], stale=True)
    if not res['items'] and not res['survey']: return keep_prev('hub/probs.json', res, 'olasılık kaynakları alınamadı')
    return res

# ---------------------------------------------------------------- Yahoo geçmişi, makro, olay çalışması, toparlanma
def yahoo_hist(sym, y0, tries=2):
    pts = {}
    y = y0
    while y <= NOW.year:
        p1 = int(datetime.datetime(y, 1, 1, tzinfo=datetime.timezone.utc).timestamp()); p2 = int(datetime.datetime(min(y + 5, NOW.year + 1), 1, 1, tzinfo=datetime.timezone.utc).timestamp()) if y + 5 <= NOW.year else int((NOW + 2 * DAY).timestamp())
        u = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d' % (sym.replace('^', '%5E'), p1, p2)
        r = jget(u, tries=tries, timeout=40)['chart']['result'][0]
        for t, c in zip(r.get('timestamp') or [], r['indicators']['quote'][0]['close']):
            if c is not None and c > 0: pts[datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%d')] = c
        y += 5
    return sorted(pts.items())

MACRO_SET = [('VIX', '^VIX', 'VIX (korku endeksi)', 'idx'), ('US10Y', '^TNX', 'ABD 10 yıllık tahvil faizi (%)', 'yield'), ('DXY', 'DX-Y.NYB', 'Dolar endeksi (DXY)', 'idx'), ('BRENT', 'BZ=F', 'Brent petrol (USD)', 'px'),
             ('SPX', '^GSPC', 'S&P 500', 'px'), ('XAUUSD', 'GC=F', 'Altın ons (USD)', 'px'), ('USDTRY', 'USDTRY=X', 'USD/TL', 'px'), ('XU100', 'XU100.IS', 'BIST 100', 'px'), ('BTCUSD', 'BTC-USD', 'Bitcoin (USD)', 'px')]
def build_macro(rates):
    items = []; err = {}
    for k, ysym, label, kind in MACRO_SET:
        try:
            r = jget('https://query1.finance.yahoo.com/v8/finance/chart/%s?range=3mo&interval=1d' % ysym.replace('^', '%5E'), tries=2)['chart']['result'][0]
            pts = [(t, c) for t, c in zip(r['timestamp'], r['indicators']['quote'][0]['close']) if c]
            if len(pts) < 22: raise Exception('az veri')
            c = [p[1] for p in pts]; last = c[-1]
            items.append({'k': k, 'label': label, 'sym': ysym, 'last': round(last, 4), 'chg1d': round(last / c[-2] - 1, 5), 'chg5d': round(last / c[-6] - 1, 5), 'chg20d': round(last / c[-21] - 1, 5),
                          'asOf': datetime.datetime.fromtimestamp(pts[-1][0], datetime.timezone.utc).strftime(ISO), 'spark': [round(x, 4) for x in c[-40:]], 'src': 'Yahoo Finance chart API (resmî olmayan)'})
        except Exception as e: err[k] = str(e)[:80]
    rt = dict(rates)
    try:
        j = jget('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json')['refRates'][0]
        rt['fed'] = {'from': j['targetRateFrom'], 'to': j['targetRateTo'], 'effr': j['percentRate'], 'asOf': j['effectiveDate'], 'src': 'New York Fed — EFFR API', 'url': 'https://www.newyorkfed.org/markets/reference-rates/effr'}
    except Exception as e: err['fed'] = str(e)[:80]
    try:
        t = F.http('https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=csvdata', raw=True, timeout=30, headers={'Accept': 'text/csv'}).decode()
        L = t.strip().split('\n'); hdr = L[0].split(','); row = L[1].split(',')
        rt['ecb'] = {'depositRate': float(row[hdr.index('OBS_VALUE')]), 'asOf': row[hdr.index('TIME_PERIOD')], 'src': 'ECB Data Portal (FM)', 'url': 'https://data.ecb.europa.eu/'}
    except Exception as e: err['ecb'] = str(e)[:80]
    res = {'generatedAt': NOWS, 'items': items, 'rates': rt, 'errors': err}
    if not items: return keep_prev('hub/macro.json', res, 'piyasa göstergeleri alınamadı')
    return res

def quantile(xs, q):
    xs = sorted(xs); n = len(xs)
    if not n: return None
    i = (n - 1) * q; lo = int(math.floor(i)); hi = min(n - 1, lo + 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)

def event_returns(series, date):
    """series: [(YYYY-MM-DD, close)]. Olay günü D = tarihte/sonrasındaki ilk işlem günü; taban = bir önceki kapanış."""
    ds = [d for d, _ in series]
    import bisect
    i0 = bisect.bisect_left(ds, date)
    if i0 < 1 or i0 >= len(series): return None
    d0 = datetime.date.fromisoformat(ds[i0]); dd = datetime.date.fromisoformat(date)
    if (d0 - dd).days > 4: return None   # veri boşluğu: olay gününe yakın mum yok
    base = series[i0 - 1][1]; out = {'base': ds[i0 - 1]}
    for k, n in (('d1', 0), ('d5', 4), ('d20', 19)):
        if i0 + n < len(series): out[k] = round(series[i0 + n][1] / base - 1, 5)
    if abs(out.get('d1') or 0) > 0.6: return None   # veri hatası şüphesi (örn. bozuk tik)
    return out

def build_analogs():
    start = 2015
    S = {}
    asset_defs = [('XU100', 'XU100.IS', 'BIST 100 (TL)'), ('USDTRY', 'USDTRY=X', 'USD/TL'), ('XAUUSD', 'GC=F', 'Altın ons (USD)'), ('BTCUSD', 'BTC-USD', 'Bitcoin (USD)'), ('SPX', '^GSPC', 'S&P 500 (USD)'), ('XBANK', 'XBANK.IS', 'BIST Banka endeksi (TL)')]
    errs = {}
    for k, ys, lab in asset_defs:
        try: S[k] = yahoo_hist(ys, start)
        except Exception as e: errs[k] = str(e)[:80]
    if 'XAUUSD' in S and 'USDTRY' in S:
        u = dict(S['USDTRY']); S['XAUTRY'] = [(d, c * u[d]) for d, c in S['XAUUSD'] if d in u]
    labels = {k: lab for k, _, lab in asset_defs}; labels['XAUTRY'] = 'Altın ons (TL, türetilmiş: ons × USD/TL)'
    events = []
    # 1) elle derlenmiş olay listesi
    for e in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'analog_events.json'), encoding='utf-8'))['events']:
        events.append(dict(e, auto=False))
    # 2) TCMB faiz kararları (resmî tablo): karar günü = etkili tarih − 1 gün
    try:
        rr = cbrt_rates()
        for (d0, r0), (d1, r1) in zip(rr, rr[1:]):
            dec = ymd(datetime.date.fromisoformat(d1) - DAY)
            if dec < '2016-01-01': continue
            bp = round((r1 - r0) * 100)
            events.append({'id': 'cbrt:' + dec, 'date': dec, 'group': 'cbrt_hike' if bp > 0 else 'cbrt_cut', 'title': 'TCMB faiz kararı: %%%s → %%%s (%+d bp)' % (('%g' % r0), ('%g' % r1), bp), 'bp': bp, 'src': CBRT_RATE_URL, 'auto': True})
    except Exception as e: errs['cbrt'] = str(e)[:100]
    # 3) Fed faiz kararları (resmî tablo)
    try:
        for d1, bp, lvl in fed_rate_changes():
            dec = ymd(datetime.date.fromisoformat(d1) - DAY)
            if dec < '2016-01-01' or bp == 0: continue
            events.append({'id': 'fed:' + dec, 'date': dec, 'group': 'fed_hike' if bp > 0 else 'fed_cut', 'title': 'Fed faiz kararı: %+d bp (yeni aralık %%%s)' % (bp, lvl), 'bp': bp, 'src': FED_RATES_URL, 'auto': True})
    except Exception as e: errs['fed'] = str(e)[:100]
    res_ev = []
    for e in sorted(events, key=lambda e: e['date']):
        r = {}
        for k, ser in S.items():
            x = event_returns(ser, e['date'])
            if x: r[k] = x
        if r: res_ev.append(dict(e, ret=r))
    groups = {}
    for e in res_ev:
        g = groups.setdefault(e['group'], {'n': 0, 'assets': {}}); g['n'] += 1
        for k, x in e['ret'].items():
            a = g['assets'].setdefault(k, {'d1': [], 'd5': [], 'd20': []})
            for h in ('d1', 'd5', 'd20'):
                if h in x: a[h].append(x[h])
    for g in groups.values():
        for k, a in g['assets'].items():
            for h in ('d1', 'd5', 'd20'):
                v = a[h]; a[h] = {'n': len(v), 'median': round(quantile(v, .5), 5), 'min': round(min(v), 5), 'max': round(max(v), 5), 'pos': round(sum(1 for x in v if x > 0) / len(v), 3)} if v else None
    res = {'generatedAt': NOWS, 'method': 'Olay günü D = olay tarihinde veya sonrasındaki ilk işlem günü. Getiri = D, D+4 ve D+19. işlem günü kapanışı ÷ D-1 kapanışı − 1. Kaynak: Yahoo Finance günlük kapanışlar (resmî olmayan; bölünme düzeltmeli). Her olay tek tek listelenir; ortalama/medyan istatistiksel tahmin değil, geçmiş davranışın özetidir. n küçükse (≤5) yorum yapma.',
           'labels': labels, 'groups': groups, 'events': res_ev, 'range': {k: [v[0][0], v[-1][0]] for k, v in S.items()}, 'errors': errs}
    if not res_ev: return keep_prev('hub/analogs.json', res, 'geçmiş fiyatlar alınamadı: ' + json.dumps(errs, ensure_ascii=False))
    return res

def drawdowns(series, thr):
    eps = []; peak = series[0][1]; pd_ = series[0][0]; cur = None
    for d, c in series:
        if c >= peak:
            if cur: cur['recovered'] = d; eps.append(cur); cur = None
            peak, pd_ = c, d; continue
        dd = c / peak - 1
        if cur is None and dd <= -thr: cur = {'peak': pd_, 'peakPx': peak, 'trough': d, 'depth': dd}
        if cur and dd < cur['depth']: cur['trough'] = d; cur['depth'] = dd
    if cur: cur['recovered'] = None; eps.append(cur)
    out = []
    for e in eps:
        D = datetime.date.fromisoformat
        out.append({'peak': e['peak'], 'trough': e['trough'], 'depth': round(e['depth'], 4), 'daysToTrough': (D(e['trough']) - D(e['peak'])).days,
                    'daysToRecover': (D(e['recovered']) - D(e['trough'])).days if e['recovered'] else None, 'recovered': e['recovered']})
    return out

def build_recovery():
    defs = [('XU100', 'XU100.IS', 'BIST 100 (TL, nominal)', 2000), ('SPX', '^GSPC', 'S&P 500 (USD)', 1990), ('XAUUSD', 'GC=F', 'Altın ons (USD)', 2000), ('BTCUSD', 'BTC-USD', 'Bitcoin (USD)', 2015)]
    res = {'generatedAt': NOWS, 'assets': {}, 'method': 'Zirveden en az %10 / %20 düşen her dönem; "toparlanma" = fiyatın önceki zirveyi yeniden görmesi (nominal, temettüsüz). Kaynak: Yahoo Finance günlük kapanış.', 'errors': {}}
    for k, ys, lab, y0 in defs:
        try:
            s = yahoo_hist(ys, y0); a = {'label': lab, 'from': s[0][0], 'to': s[-1][0], 'url': 'https://finance.yahoo.com/quote/%s/history' % ys, 'thr': {}}
            for thr in (0.10, 0.20):
                eps = drawdowns(s, thr); done = [e['daysToRecover'] for e in eps if e['daysToRecover'] is not None]
                a['thr'][str(int(thr * 100))] = {'n': len(eps), 'recovered': len(done), 'medianDaysToRecover': round(quantile(done, .5)) if done else None, 'maxDaysToRecover': max(done) if done else None,
                                                'medianDepth': round(quantile([e['depth'] for e in eps], .5), 4) if eps else None, 'episodes': eps[-12:]}
            res['assets'][k] = a
        except Exception as e: res['errors'][k] = str(e)[:80]
    if not res['assets']: return keep_prev('hub/recovery.json', res, 'geçmiş fiyatlar alınamadı')
    return res

# ---------------------------------------------------------------- Haber akışı (news/feed.json)
def build_feed():
    pool = F.load_json(os.path.join(OUT, 'news/pool.json')) or prev('news/pool.json')
    if not pool: return keep_prev('news/feed.json', {'generatedAt': NOWS, 'items': []}, 'haber havuzu yok')
    cut = (NOW - 7 * DAY).strftime(ISO); items = []
    for x in pool.get('items', []):
        if x.get('at') and x['at'] < cut: continue
        it = {'t': x['title'], 'u': x['url'], 's': x.get('src'), 'a': x.get('at'), 'r': x.get('reg') or ('tr' if not str(x.get('src', '')).startswith('GDELT') else 'tr')}
        if x.get('off'): it['o'] = x['off']
        items.append(it)
    tr = sorted([i for i in items if i['r'] == 'tr'], key=lambda i: i.get('a') or '', reverse=True)[:500]
    gl = sorted([i for i in items if i['r'] != 'tr'], key=lambda i: i.get('a') or '', reverse=True)[:350]
    return {'generatedAt': NOWS, 'poolAt': pool.get('generatedAt'), 'items': tr + gl, 'method': 'Kaynak akışlarından yalnız başlık + bağlantı + saat saklanır (içerik kopyalanmaz). Son 7 gün.'}

# ---------------------------------------------------------------- İş akışı tarafı uyarılar (+ ntfy)
def load_rules():
    r = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'news_rules.json'), encoding='utf-8')); return r
def fold(t): return F.fold(t)
def score_title(title, rules):
    f = fold(title); sc = 0; why = []; hard = False
    for tier in rules['tiers']:
        for kw in tier['kw']:
            if re.search(r'(?<![A-Z0-9])' + re.escape(fold(kw)) + r'(?![A-Z0-9])', f):
                sc += tier['w']; why.append(kw)
                if tier.get('hard'): hard = True
                break
    return sc, why, hard
def tokens(title, rules):
    stop = set(rules.get('stop', [])); o = set()
    for w in re.sub(r"[^A-Z0-9' ]", ' ', fold(title)).split(' '):
        w = re.sub(r"'.*$", '', w)
        if len(w) >= 3 and w not in stop: o.add(w)
    return o
def jacc(a, b):
    if not a or not b: return 0
    return len(a & b) / float(len(a | b))

def build_alerts(cal, probs, macro, feed):
    rules = load_rules(); old = prev('hub/alerts.json') or {}; oldItems = {a['id']: a for a in old.get('items', [])}
    new = []
    def add(id_, sev, cat, title, body, url=None, assets=None):
        if id_ in oldItems or any(n['id'] == id_ for n in new): return
        new.append({'id': id_, 'sev': sev, 'cat': cat, 'title': title, 'body': body, 'url': url, 'assets': assets or [], 'at': NOWS})
    # 1) kritik haberler (son 6 saat, tarihli)
    cut = (NOW - datetime.timedelta(hours=6)).strftime(ISO)
    allf = feed.get('items', []); toks = {}
    for it in allf:
        if it.get('a') and it['a'] >= (NOW - 2 * DAY).strftime(ISO): toks[id(it)] = tokens(it['t'], rules)
    for it in allf:
        if not it.get('a') or it['a'] < cut: continue
        sc, why, hard = score_title(it['t'], rules)
        if it.get('o'): sc += rules['officialBonus']
        tk = toks.get(id(it)) or tokens(it['t'], rules)
        srcs = set(x.get('s') for x in allf if id(x) in toks and jacc(tk, toks[id(x)]) >= rules.get('similar', 0.6)) | {it.get('s')}
        nsrc = len(srcs)
        if nsrc >= 3 and sc > 0: sc += 10
        if sc >= rules['criticalAt'] and hard and (it.get('o') or nsrc >= rules.get('corroborate', 2)):
            add('news:' + re.sub(r'[^a-z0-9]', '', fold(it['t']).lower())[:40], 'critical', 'news', it['t'][:140], 'Kaynak: %s · eşleşen: %s' % (it.get('s'), ', '.join(why[:4])), it['u'])
    # 2) yaklaşan yüksek etkili olaylar (T-1 gün)
    tom = ymd(NOW.astimezone(TR) + DAY); today = ymd(NOW.astimezone(TR))
    for e in (cal.get('events') or []):
        if e.get('impact') == 'high' and e['date'] in (tom, today) and e['type'] in ('cbrt_ppk', 'fomc', 'ecb_rate', 'tr_cpi', 'us_cpi', 'us_jobs'):
            extra = ''
            if e['type'] == 'fomc':  # yalnız gerçek kaynaktan (Kalshi) olasılık; yoksa hiçbir sayı yazılmaz
                pi = next((i for i in probs.get('items', []) if i.get('region') == 'fed' and i.get('decisionDate') == e['date'] and i.get('outcomes')), None)
                if pi:
                    g = {'cut': 0.0, 'hold': 0.0, 'hike': 0.0}
                    for o in pi['outcomes']: g['cut' if o['code'] in ('C25', 'C26') else 'hold' if o['code'] == 'H0' else 'hike'] += o['p']
                    t = sum(g.values())
                    if t > 0.5: extra = ' Piyasa (Kalshi): artırım %%%d · sabit %%%d · indirim %%%d.' % tuple(round(100 * g[k] / t) for k in ('hike', 'hold', 'cut'))
            add('event:%s:%s' % (e['id'], 'T0' if e['date'] == today else 'T1'), 'high', 'event', ('Bugün: ' if e['date'] == today else 'Yarın: ') + e['title'], 'Tarih %s%s. Kaynak: %s.%s' % (e['date'], (' ' + e['time'] + ' TSİ') if e.get('time') else '', e['source']['name'], extra), e['source'].get('url'))
    # 3) piyasa şokları
    th = rules['market']
    for it in (macro.get('items') or []):
        c = it['chg1d']; k = it['k']
        if k == 'XU100' and c <= -th['XU100']['critical']: add('mkt:XU100:%s:c' % it['asOf'][:10], 'critical', 'market', 'BIST 100 sert düştü: %%%.1f' % (c * 100), 'Gün sonu/son kapanışa göre. Kaynak: ' + it['src'])
        elif k == 'XU100' and c <= -th['XU100']['high']: add('mkt:XU100:%s:h' % it['asOf'][:10], 'high', 'market', 'BIST 100 düşüşte: %%%.1f' % (c * 100), 'Kaynak: ' + it['src'])
        if k == 'USDTRY' and c >= th['USDTRY']['critical']: add('mkt:USDTRY:%s:c' % it['asOf'][:10], 'critical', 'market', 'USD/TL sert yükseldi: %%+%.1f' % (c * 100), 'Kaynak: ' + it['src'])
        elif k == 'USDTRY' and c >= th['USDTRY']['high']: add('mkt:USDTRY:%s:h' % it['asOf'][:10], 'high', 'market', 'USD/TL yükseliyor: %%+%.1f' % (c * 100), 'Kaynak: ' + it['src'])
        if k == 'XAUUSD' and abs(c) >= th['XAUUSD']['high']: add('mkt:XAUUSD:%s' % it['asOf'][:10], 'high', 'market', 'Altın ons sert hareket: %%%+.1f' % (c * 100), 'Kaynak: ' + it['src'])
        if k == 'BTCUSD' and abs(c) >= th['BTCUSD']['high']: add('mkt:BTCUSD:%s' % it['asOf'][:10], 'high', 'market', 'Bitcoin sert hareket: %%%+.1f' % (c * 100), 'Kaynak: ' + it['src'])
        if k == 'VIX' and it['last'] >= th['VIX']['critical']: add('mkt:VIX:%s:c' % it['asOf'][:10], 'critical', 'market', 'VIX %.0f — küresel panik seviyesi' % it['last'], 'Kaynak: ' + it['src'])
        elif k == 'VIX' and it['last'] >= th['VIX']['high']: add('mkt:VIX:%s:h' % it['asOf'][:10], 'high', 'market', 'VIX %.0f — küresel risk iştahı zayıf' % it['last'], 'Kaynak: ' + it['src'])
    # 4) tahmin piyasası kaymaları (önceki çalıştırmaya göre ≥ 15 puan)
    op = prev('hub/probs.json') or {}; omap = {i['id']: i for i in op.get('items', [])}
    for i in probs.get('items', []):
        o = omap.get(i['id'])
        if not o or not i.get('outcomes') or not o.get('outcomes'): continue
        om = {x['label']: x['p'] for x in o['outcomes']}
        for x in i['outcomes']:
            if x['label'] in om and x['p'] is not None and abs(x['p'] - om[x['label']]) >= th['probJump']:
                add('prob:%s:%s:%s' % (i['id'], re.sub(r'\W', '', x['label'])[:12], NOW.strftime('%Y%m%d%H')), 'high', 'event', '%s: "%s" olasılığı %%%d → %%%d' % (i['question'][:80], x['label'][:30], round(om[x['label']] * 100), round(x['p'] * 100)), 'Kaynak: ' + i['source'], i.get('url'))
    keep = [a for a in old.get('items', []) if a['at'] >= (NOW - 7 * DAY).strftime(ISO)]
    allitems = sorted(new + keep, key=lambda a: a['at'], reverse=True)[:150]
    res = {'generatedAt': NOWS, 'items': allitems, 'newCount': len(new)}
    # ntfy: gönderim tools/publish.py'de (birleştirme sonrası, 'pushed' işaretiyle) yapılır; burada yalnız uyarı üretilir.
    return res

def main():
    t0 = time.time(); os.makedirs(os.path.join(OUT, 'hub'), exist_ok=True)
    full = F.MODE == 'full'
    cal = build_calendar(); F.write(os.path.join(OUT, 'hub/calendar.json'), cal)
    probs = build_probs(); F.write(os.path.join(OUT, 'hub/probs.json'), probs)
    rates = {}
    try:
        rr = cbrt_rates(); rates['cbrt'] = {'rate': rr[-1][1], 'since': rr[-1][0], 'prev': rr[-2][1], 'src': 'TCMB — 1 hafta repo (resmî tablo)', 'url': CBRT_RATE_URL}
    except Exception as e: print('cbrt rates', e)
    macro = build_macro(rates); F.write(os.path.join(OUT, 'hub/macro.json'), macro)
    feed = build_feed(); F.write(os.path.join(OUT, 'news/feed.json'), feed)
    # ağır işler yalnız tam modda; saatlik modda önceki dosyalar korunur
    for rel, fn in (('hub/analogs.json', build_analogs), ('hub/recovery.json', build_recovery)):
        if full or not (prev(rel) or F.load_json(os.path.join(OUT, rel))):
            try: F.write(os.path.join(OUT, rel), fn())
            except Exception as e: print(rel, 'hata', e); F.write(os.path.join(OUT, rel), keep_prev(rel, {'generatedAt': NOWS}, e))
    alerts = build_alerts(cal, probs, macro, feed); F.write(os.path.join(OUT, 'hub/alerts.json'), alerts)
    st = {'generatedAt': NOWS, 'mode': F.MODE, 'seconds': round(time.time() - t0), 'calendar': len(cal.get('events', [])), 'calendarSources': cal.get('sources'), 'probs': len(probs.get('items', [])), 'probSources': probs.get('sources'),
          'macro': len(macro.get('items', [])), 'feed': len(feed.get('items', [])), 'alerts': len(alerts['items']), 'newAlerts': alerts['newCount']}
    F.write(os.path.join(OUT, 'hub/status.json'), st)
    print('hub', json.dumps(st, ensure_ascii=False)[:1500])

if __name__ == '__main__':
    main()
