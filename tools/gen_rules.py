#!/usr/bin/env python3
"""tools/news_rules.json → js/newsrules.js (tarayıcı/Node için aynı kurallar). Çalıştır: python3 tools/gen_rules.py"""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
r = json.load(open(os.path.join(here, 'news_rules.json'), encoding='utf-8')); r.pop('_doc', None)
body = json.dumps(r, ensure_ascii=False, indent=1)
open(os.path.join(here, '..', 'js', 'newsrules.js'), 'w', encoding='utf-8').write(
"/* newsrules.js — OTOMATİK ÜRETİLDİ (python3 tools/gen_rules.py). Kaynak: tools/news_rules.json. Elle değiştirme. */\n(function (root, factory) {\n  if (typeof module === 'object' && module.exports) module.exports = factory();\n  else root.NewsRules = factory();\n})(typeof self !== 'undefined' ? self : this, function () {\n  'use strict';\n  return " + body.replace('\n', '\n  ') + ";\n});\n")
print('js/newsrules.js yazıldı')
