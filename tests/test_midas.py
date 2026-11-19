"""Midas'ın Kulakları ayrıştırıcısı testi (kayıtlı gerçek sayfa parçası; ağ yok). Çalıştırma: python3 tests/test_midas.py"""
import os, sys, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'tools')); sys.argv = ['x', '/tmp/fp-midas-test-out']
import fetch_market_data as F
sys.argv = sys.argv[:1]

class MidasTest(unittest.TestCase):
    def test_list(self):
        rows = F.parse_midas_list(open(os.path.join(HERE, 'fixtures/midas-list.html'), encoding='utf-8').read())
        self.assertEqual(len(rows), 4, 'bozuk kart (başlık/tarih yok) atlanır')
        r = rows[0]; self.assertTrue(r['url'].startswith('https://www.getmidas.com/midasin-kulaklari/')); self.assertRegex(r['day'], r'^\d{4}-\d{2}-\d{2}$'); self.assertGreater(r['rt'], 0); self.assertTrue(r['title'])
        self.assertEqual(len({x['url'] for x in rows}), 4)
    def test_time(self):
        self.assertEqual(F.parse_midas_time(open(os.path.join(HERE, 'fixtures/midas-article-head.html'), encoding='utf-8').read()), '2026-11-17T21:11:45Z', '+03:00 → UTC')
        self.assertIsNone(F.parse_midas_time('<html></html>'))
    def test_empty_page_raises_not_fabricates(self):
        F.http = lambda *a, **k: b'<html><body>bakimda</body></html>'
        with self.assertRaises(RuntimeError): F.midas_fetch({})
    def test_fetch_flow_keeps_known_time_and_flags_approx(self):
        listing = open(os.path.join(HERE, 'fixtures/midas-list.html'), encoding='utf-8').read().encode(); calls = []
        def fake(url, **k):
            calls.append(url)
            if url == F.MIDAS_LIST: return listing
            raise RuntimeError('makale alınamadı')
        F.http = fake; F.time.sleep = lambda s: None
        F.NOW = datetime.datetime(2026, 11, 18, 12, 0, tzinfo=datetime.timezone.utc)
        rows = F.parse_midas_list(listing.decode()); known = {rows[0]['url']: {'url': rows[0]['url'], 'at': '2026-11-18T01:02:03Z'}}
        items, st = F.midas_fetch(known)
        by = {i['url']: i for i in items}
        self.assertEqual(by[rows[0]['url']]['at'], '2026-11-18T01:02:03Z', 'bilinen saat korunur'); self.assertNotIn(rows[0]['url'], calls[1:], 'bilinen makale tekrar çekilmez')
        self.assertTrue(all(i['src'] == F.MIDAS_SRC and i['reg'] == 'tr' for i in items)); self.assertTrue(any(i.get('approx') for i in items), 'saati alınamayan gün başı + approx')
        self.assertNotIn('content', items[0]); self.assertEqual(set(items[0]) - {'approx'}, {'title', 'url', 'src', 'at', 'reg', 'rt'}, 'yalnız başlık/bağlantı/tarih/okuma süresi saklanır')
if __name__ == '__main__': unittest.main()
