"""v8.9.0: TÜFE ayrıştırıcı (TCMB "Tüketici Fiyatları" tablosu) ve günlük işte önceki dosyaya geri dönüş. Ağ yok.
Çalıştırma: python3 -m unittest tests/test_tufe.py"""
import os, sys, json, tempfile, shutil, unittest, importlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'tools'))

HTML = ('<table><tr><th>Ay-Yıl</th><th>TÜFE (Yıllık % Değişim)</th><th>TÜFE (Aylık % Değişim)</th></tr>' +
        ''.join('<tr><td>%02d-%d</td><td>%s</td><td>%s</td></tr>' % (m, y, '30.%02d' % m, '1.%02d' % m) for y in (2025, 2026) for m in range(1, 13)) +
        '<tr><td>10-2026</td><td>99.99</td><td>9.99</td></tr><tr><td>13-2026</td><td>1</td><td>1</td></tr></table>')

class TufeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); sys.argv = ['x', os.path.join(self.tmp, 'out')]
        os.environ['PREV_DIR'] = os.path.join(self.tmp, 'prev')
        import fetch_market_data; self.F = importlib.reload(fetch_market_data)
    def tearDown(self): shutil.rmtree(self.tmp, ignore_errors=True)
    def test_parse(self):
        r = self.F.parse_tufe(HTML)
        self.assertEqual(len(r), 24); self.assertEqual(r[0], {'ym': '2025-01', 'm': 1.01, 'y': 30.01}); self.assertEqual(r[-1]['ym'], '2026-12')
        self.assertEqual([x for x in r if x['ym'] == '2026-10'][0]['m'], 1.10)  # tekrar eden satır: ilki alınır
    def test_job_fallback_to_prev(self):
        F = self.F
        def boom(*a, **k): raise RuntimeError('ağ yok')
        F.http = boom
        self.assertTrue(F.tufe_job().startswith('fail'))
        os.makedirs(os.path.join(self.tmp, 'prev', 'macro')); json.dump({'months': [{'ym': '2026-01', 'm': 1, 'y': 2}]}, open(os.path.join(self.tmp, 'prev', 'macro', 'TUFE.json'), 'w'))
        self.assertEqual(F.tufe_job(), 'stale'); o = json.load(open(os.path.join(self.tmp, 'out', 'macro', 'TUFE.json')))
        self.assertTrue(o['stale']); self.assertIn('ağ yok', o['lastError'])

if __name__ == '__main__': unittest.main()
