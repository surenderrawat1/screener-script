export type VerifyLang = 'en' | 'hi';

const HI: Record<string, string> = {
  'page.title': 'पूर्ण स्टॉक सत्यापन',
  'page.subtitle': '8-चरण आवंटन गेट — निवेश से पहले व्यक्तिगत पुष्टि आवश्यक',
  'page.checklist': 'सत्यापन चेकलिस्ट',
  'page.disclaimer':
    'केवल शैक्षिक उपकरण — SEBI-पंजीकृत निवेश सलाह नहीं। स्क्रीनिंग ऑटो-सत्यापन Full Verify का विकल्प नहीं है।',
  'lang.partial': 'गतिशील verdict/notes अंग्रेज़ी में रह सकते हैं',
  'lang.switch': 'हिंदी',
  'lang.switch_en': 'English',

  'phase.0.short': 'चरण 0: निवेशक',
  'phase.1.short': 'चरण 1: व्यवसाय',
  'phase.2.short': 'चरण 2: वित्त',
  'phase.3.short': 'चरण 3: अनुपात',
  'phase.4.short': 'चरण 4: मूल्यांकन',
  'phase.5.short': 'चरण 5: क्वांट',
  'phase.6.short': 'चरण 6: सेक्टर',
  'phase.7.short': 'चरण 7: पोर्टफोलियो',
  'phase.8.short': 'चरण 8: थीसिस',

  'btn.load': 'फॉर्म लोड करें',
  'btn.fetch': 'लाएँ और भरें',
  'btn.refresh': 'रीफ्रेश',
  'btn.run': 'पूर्ण सत्यापन चलाएँ',
  'btn.back': '← पीछे',
  'btn.next': 'आगे →',
  'btn.draft_save': 'ड्राफ्ट सहेजें',
  'btn.draft_load': 'ड्राफ्ट लोड करें',

  'fetch.title': 'ऑटो मोड — डेटा लाएँ और गेट भरें',
  'fetch.symbol': 'NSE/BSE प्रतीक',
  'fetch.legend':
    ' = लाई गई वैल्यू (संपादन योग्य)। चरण 0, circle of competence, पोर्टफोलियो और exit गेट = केवल मैन्युअल।',

  'results.title': 'सत्यापन परिणाम',
  'results.pending': 'लंबित',
  'results.score': 'मास्टर स्कोर',
  'results.ready': 'निवेश के लिए तैयार',
  'results.verdict': 'निर्णय',

  'eps.basis': 'EPS आधार (वार्षिक रिपोर्ट)',
  'eps.consolidated': 'Consolidated',
  'eps.standalone': 'Standalone',
  'eps.hint': 'verify पर valuation पुनर्गणना होगी',
};

export function translateVerify(lang: VerifyLang, key: string, fallback: string): string {
  if (lang !== 'hi') return fallback;
  return HI[key] ?? fallback;
}

export const VERIFY_PHASE_HI_KEYS: Record<number, { title?: string; short?: string }> = {
  0: { title: 'index.ph0.title', short: 'phase.0.short' },
  1: { title: 'index.ph1.title', short: 'phase.1.short' },
  2: { title: 'index.ph2.title', short: 'phase.2.short' },
  3: { title: 'index.ph3.title', short: 'phase.3.short' },
  4: { title: 'index.ph4.title', short: 'phase.4.short' },
  5: { title: 'index.ph5.title', short: 'phase.5.short' },
  6: { title: 'index.ph6.title', short: 'phase.6.short' },
  7: { title: 'index.ph7.title', short: 'phase.7.short' },
  8: { title: 'index.ph8.title', short: 'phase.8.short' },
};

// Extra phase titles from hi.php inlined (templates use English key as fallback)
HI['index.ph0.title'] = 'चरण 0 — निवेशक आधार';
HI['index.ph1.title'] = 'चरण 1 — Business Quality';
HI['index.ph2.title'] = 'चरण 2 — वित्तीय विवरण';
HI['index.ph3.title'] = 'चरण 3 — मूलभूत अनुपात';
HI['index.ph4.title'] = 'चरण 4 — Value vs Growth';
HI['index.ph5.title'] = 'चरण 5 — Quant Screens';
HI['index.ph6.title'] = 'चरण 6 — Sector-Specific Checks';
HI['index.ph7.title'] = 'चरण 7 — Portfolio Fit';
HI['index.ph8.title'] = 'चरण 8 — Final Thesis & Verdict';

for (let i = 0; i <= 8; i++) {
  HI[`phase.${i}.title`] = HI[`index.ph${i}.title`] ?? `Phase ${i}`;
}
