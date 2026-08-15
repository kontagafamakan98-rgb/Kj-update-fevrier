import { describe, it, expect } from 'vitest';

import fr from '../../i18n/fr.json';
import en from '../../i18n/en.json';
import wo from '../../i18n/wo.json';
import bm from '../../i18n/bm.json';
import mos from '../../i18n/mos.json';

const LANGUAGES = { fr, en, wo, bm, mos };

describe('i18n parity', () => {
  it('chaque langue contient exactement les mêmes clés que fr (référence)', () => {
    const frKeys = Object.keys(fr).sort();

    for (const [lang, translations] of Object.entries(LANGUAGES)) {
      const keys = Object.keys(translations).sort();
      const missing = frKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !frKeys.includes(k));

      expect(missing, `${lang} manque les clés: ${missing.join(', ')}`).toEqual([]);
      expect(extra, `${lang} a des clés absentes de fr: ${extra.join(', ')}`).toEqual([]);
      expect(keys.length).toBe(frKeys.length);
    }
  });

  it('ne contient pas de doublons de clés', () => {
    for (const [lang, translations] of Object.entries(LANGUAGES)) {
      const keys = Object.keys(translations);
      expect(new Set(keys).size, `${lang} contient des clés dupliquées`).toBe(keys.length);
    }
  });
});
