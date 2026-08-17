import {
  getCountriesList,
  getCountryByCode,
  getPhonePrefixByCountry,
  detectCountryFromPhone,
  formatPhoneNumber,
  getPhoneExampleForCountry,
  getPopularBanksByCountry,
  AVAILABLE_LANGUAGES,
  getPrimaryLanguageForCountry,
  getLocalLanguageForCountry,
  getOrderedLanguagesForCountry,
  getLanguageSuggestionMessage,
} from '../geolocationService';

describe('geolocationService (fallback pays)', () => {
  it('fournit les 4 pays ouest-africains avec leurs préfixes téléphoniques', () => {
    const countries = getCountriesList();
    expect(countries).toHaveLength(4);
    const codes = countries.map((c) => c.code).sort();
    expect(codes).toEqual(['burkina_faso', 'cote_divoire', 'mali', 'senegal']);
    const prefixes = Object.fromEntries(countries.map((c) => [c.code, c.phonePrefix]));
    expect(prefixes).toEqual({
      mali: '+223',
      senegal: '+221',
      burkina_faso: '+226',
      cote_divoire: '+225',
    });
  });

  it('résout les alias de code pays (SN, CI, ivory_coast...)', () => {
    expect(getCountryByCode('SN').code).toBe('senegal');
    expect(getCountryByCode('CI').code).toBe('cote_divoire');
    expect(getCountryByCode('ivory_coast').code).toBe('cote_divoire');
    expect(getCountryByCode('BF').code).toBe('burkina_faso');
  });

  it('retourne le préfixe téléphonique par pays', () => {
    expect(getPhonePrefixByCountry('mali')).toBe('+223');
    expect(getPhonePrefixByCountry('senegal')).toBe('+221');
  });

  it('détecte le pays depuis un numéro de téléphone', () => {
    const detected = detectCountryFromPhone('+221 77 123 45 67');
    expect(detected).not.toBeNull();
    expect(detected.code).toBe('senegal');
    expect(detectCountryFromPhone('+225 07 12 34 56').code).toBe('cote_divoire');
    expect(detectCountryFromPhone('+999')).toBeNull();
  });

  it('formate un numéro de téléphone avec le préfixe du pays', () => {
    expect(formatPhoneNumber('771234567', 'senegal')).toBe('+221 771234567');
    expect(formatPhoneNumber('+221 771234567', 'senegal')).toBe('+221 771234567');
    expect(formatPhoneNumber('071234567', 'mali')).toBe('+223 71234567');
  });

  it('fournit un exemple de numéro par pays', () => {
    expect(getPhoneExampleForCountry({ code: 'senegal' })).toBe('+221 70 12 34 56');
    expect(getPhoneExampleForCountry('mali')).toBe('+223 70 12 34 56');
  });
});

describe('geolocationService — helpers fusionnés (banques + langues)', () => {
  it('fournit les banques populaires par pays (ex-geolocationService.js)', () => {
    const banks = getPopularBanksByCountry({ code: 'senegal' });
    expect(banks).toContain('Société Générale Sénégal');
    expect(getPopularBanksByCountry('mali')).toContain('Bank of Africa Mali');
    expect(getPopularBanksByCountry('CI')).toContain('Ecobank Côte d\'Ivoire');
  });

  it('expose les langues disponibles et la langue primaire par pays', () => {
    expect(Object.keys(AVAILABLE_LANGUAGES)).toEqual(expect.arrayContaining(['fr', 'en', 'wo', 'bm', 'mos']));
    expect(getPrimaryLanguageForCountry({ code: 'senegal' })).toBe('fr');
    expect(getLocalLanguageForCountry({ code: 'senegal' })).toBe('wo');
    expect(getLocalLanguageForCountry({ code: 'mali' })).toBe('bm');
    expect(getLocalLanguageForCountry({ code: 'cote_divoire' })).toBeNull();
  });

  it('ordonne les langues recommandées en premier selon le pays', () => {
    const ordered = getOrderedLanguagesForCountry({ code: 'senegal' });
    expect(ordered[0].code).toBe('fr');
    expect(ordered[1].code).toBe('wo');
    expect(ordered.find((l) => l.code === 'wo').isCountryLanguage).toBe(true);
    expect(ordered.find((l) => l.code === 'fr').isPrimary).toBe(true);
  });

  it('fournit un message de suggestion de langue par pays', () => {
    const suggestion = getLanguageSuggestionMessage({ code: 'mali' });
    expect(suggestion).not.toBeNull();
    expect(suggestion.localLang).toBe('Bambara');
    expect(getLanguageSuggestionMessage(null)).toBeNull();
  });
});
