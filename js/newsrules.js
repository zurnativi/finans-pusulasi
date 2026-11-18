/* newsrules.js — OTOMATİK ÜRETİLDİ (python3 tools/gen_rules.py). Kaynak: tools/news_rules.json. Elle değiştirme. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NewsRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
   "version": 1,
   "criticalAt": 80,
   "highAt": 55,
   "mediumAt": 30,
   "officialBonus": 15,
   "tiers": [
    {
     "id": "crisis",
     "w": 60,
     "why": "kriz/olağanüstü durum",
     "kw": [
      "OLAGANUSTU TOPLANTI",
      "ACIL TOPLANTI",
      "DEVRE KESICI",
      "TEMERRUT",
      "IFLAS",
      "DARBE",
      "SAVAS",
      "KUR SOKU",
      "BANKA BATTI",
      "CIRCUIT BREAKER",
      "EMERGENCY MEETING",
      "EMERGENCY RATE",
      "DEFAULT",
      "BANKRUPTCY",
      "BANK RUN",
      "COLLAPSE",
      "PANIC",
      "MARKET CRASH",
      "STOCK MARKET CRASH",
      "BUYUK DEPREM"
     ]
    },
    {
     "id": "decision",
     "w": 55,
     "why": "faiz/para politikası kararı",
     "kw": [
      "FAIZ KARARI",
      "POLITIKA FAIZI",
      "FAIZ INDIRDI",
      "FAIZ ARTIRDI",
      "FAIZI SABIT",
      "PPK KARARI",
      "RATE DECISION",
      "RATE HIKE",
      "RATE CUT",
      "RAISES RATES",
      "CUTS RATES",
      "HOLDS RATES",
      "FOMC"
     ]
    },
    {
     "id": "macro",
     "w": 30,
     "why": "merkez bankası / enflasyon / büyüme verisi",
     "kw": [
      "TCMB",
      "MERKEZ BANKASI",
      "PPK",
      "FED",
      "ECB",
      "ENFLASYON",
      "INFLATION",
      "TUFE",
      "CPI",
      "ISSIZLIK",
      "UNEMPLOYMENT",
      "RESESYON",
      "RECESSION",
      "GSYH",
      "GDP",
      "CARI ACIK",
      "REZERV",
      "CENTRAL BANK"
     ]
    },
    {
     "id": "politics",
     "w": 35,
     "why": "siyasi / jeopolitik gelişme",
     "kw": [
      "SECIM",
      "ELECTION",
      "GOZALTI",
      "TUTUKLAMA",
      "YAPTIRIM",
      "SANCTION",
      "SANCTIONS",
      "TARIFF",
      "TARIFFS",
      "GUMRUK VERGISI",
      "TRADE WAR",
      "ABLUKA",
      "ATESKES",
      "CEASEFIRE",
      "EMBARGO",
      "OPEC",
      "REFERANDUM",
      "NATO",
      "SALDIRI"
     ]
    },
    {
     "id": "rating",
     "w": 35,
     "why": "kredi notu / risk primi",
     "kw": [
      "KREDI NOTU",
      "DERECELENDIRME",
      "RATING",
      "DOWNGRADE",
      "UPGRADE",
      "MOODYS",
      "MOODY'S",
      "FITCH",
      "CDS",
      "RISK PRIMI"
     ]
    },
    {
     "id": "moves",
     "w": 25,
     "why": "sert piyasa hareketi",
     "kw": [
      "SERT DUSUS",
      "SERT YUKSELIS",
      "SERT DUSTU",
      "REKOR",
      "RECORD HIGH",
      "SELL-OFF",
      "SELLOFF",
      "PLUNGE",
      "PLUNGES",
      "TUMBLE",
      "TUMBLES",
      "SURGE",
      "SURGES",
      "SOAR",
      "SOARS",
      "RALLY",
      "SLUMP",
      "CRASH",
      "TAVAN",
      "TABAN"
     ]
    },
    {
     "id": "legal",
     "w": 30,
     "why": "şirkete yönelik hukuki/idari işlem",
     "kw": [
      "ISLEM YASAGI",
      "SPK ISLEM YASAGI",
      "KONKORDATO",
      "FESIH",
      "SORUSTURMA",
      "INVESTIGATION",
      "LAWSUIT",
      "FRAUD",
      "DOLANDIRICILIK"
     ]
    },
    {
     "id": "assets",
     "w": 10,
     "why": "yatırım varlığıyla ilgili",
     "kw": [
      "BIST",
      "BORSA",
      "DOLAR",
      "ALTIN",
      "BITCOIN",
      "PETROL",
      "BRENT",
      "EURO",
      "USD/TL",
      "TAHVIL",
      "BOND",
      "STOCKS",
      "OIL",
      "GOLD"
     ]
    }
   ],
   "market": {
    "XU100": {
     "high": 0.03,
     "critical": 0.05
    },
    "USDTRY": {
     "high": 0.02,
     "critical": 0.04
    },
    "XAUUSD": {
     "high": 0.04
    },
    "BTCUSD": {
     "high": 0.08
    },
    "VIX": {
     "high": 30,
     "critical": 40
    },
    "probJump": 0.15
   }
  };
});
