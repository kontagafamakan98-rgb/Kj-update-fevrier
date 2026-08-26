import { vi, describe, it, expect } from 'vitest';
import { api } from '../api';
import preciseGeolocationService, {
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
  detectUserCountry,
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
  });

  it('détection par téléphone inconnu → objet neutre detected:false (jamais null)', () => {
    const detected = detectCountryFromPhone('+999');
    expect(detected).not.toBeNull();
    expect(detected.detected).toBe(false);
    expect(detected.code).toBe('');
    expect(detected.nameFrench).toBeDefined(); // lisible sans TypeError
  });

  it('code pays inconnu → getCountryByCode renvoie un objet neutre detected:false (jamais null)', () => {
    const country = getCountryByCode('zz');
    expect(country).not.toBeNull();
    expect(country.detected).toBe(false);
    expect(country.code).toBe('');
    expect(country.phonePrefix).toBe('');
    // Les helpers dérivés restent neutres sur un code inconnu.
    expect(getPhonePrefixByCountry('zz')).toBe('');
  });

  it('banques d\'un pays inconnu → [] (jamais la liste Sénégal par défaut)', () => {
    expect(getPopularBanksByCountry('zz')).toEqual([]);
    expect(getPopularBanksByCountry(null)).toEqual([]);
    expect(getPopularBanksByCountry({ code: 'senegal' })).toContain('Société Générale Sénégal');
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

describe('detectUserCountry — objet neutre au lieu de null (élimine la classe de bugs)', () => {
  it('renvoie un objet neutre detected:false quand la localisation échoue (jamais null)', async () => {
    const spy = vi.spyOn(preciseGeolocationService, 'detectPreciseLocation').mockResolvedValue(null);
    const country = await detectUserCountry();
    expect(country).not.toBeNull();
    expect(country.detected).toBe(false);
    expect(country.nameFrench).toBeDefined(); // lisible sans TypeError
    expect(country.code).toBe('');
    spy.mockRestore();
  });

  it('renvoie un objet neutre quand la localisation échoue avec le nouveau pipeline (detected:false)', async () => {
    const spy = vi
      .spyOn(preciseGeolocationService, 'detectPreciseLocation')
      .mockResolvedValue({ detected: false, method: 'detect' });
    const country = await detectUserCountry();
    expect(country).not.toBeNull();
    expect(country.detected).toBe(false);
    expect(country.nameFrench).toBeDefined(); // lisible sans TypeError
    expect(country.code).toBe('');
    spy.mockRestore();
  });

  it('renvoie un objet neutre quand la position est approximative et non autorisée', async () => {
    const spy = vi
      .spyOn(preciseGeolocationService, 'detectPreciseLocation')
      .mockResolvedValue({ isApproximate: true, countryCode: 'sn', country: 'Sénégal' });
    const country = await detectUserCountry();
    expect(country.detected).toBe(false);
    expect(country.nameFrench).toBe('Pays détecté');
    spy.mockRestore();
  });

  it('renvoie un pays detected:true quand la localisation aboutit', async () => {
    const spy = vi
      .spyOn(preciseGeolocationService, 'detectPreciseLocation')
      .mockResolvedValue({ isApproximate: false, countryCode: 'SN', country: 'Sénégal', phonePrefix: '+221', flag: '🇸🇳' });
    const country = await detectUserCountry();
    expect(country.detected).toBe(true);
    expect(country.code).toBe('senegal');
    expect(country.nameFrench).toBe('Sénégal');
    spy.mockRestore();
  });
});

describe('pattern detected:false généralisé — services IP, reverse geocoding, pipeline', () => {
  it('reverseGeocodePrecise renvoie un objet neutre detected:false quand le backend échoue (jamais null)', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new Error('backend down'));
    const result = await preciseGeolocationService.reverseGeocodePrecise(14.69, -17.44);
    expect(result).not.toBeNull();
    expect(result.detected).toBe(false);
    // Lisible : buildPreciseAddressFromReverseData ne crashe pas sur un neutre.
    expect(result.address).toEqual({});
    expect(result.display_name).toBe('');
    spy.mockRestore();
  });

  it('reverseGeocodePrecise marque detected:true quand le backend répond', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ display_name: 'Dakar', address: { country: 'Sénégal' } });
    const result = await preciseGeolocationService.reverseGeocodePrecise(14.69, -17.44);
    expect(result.detected).toBe(true);
    expect(result.display_name).toBe('Dakar');
    spy.mockRestore();
  });

  it('getMultiIPGeolocation renvoie un objet neutre detected:false quand le backend ne détecte rien', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ country: null, detected: false });
    const result = await preciseGeolocationService.getMultiIPGeolocation();
    expect(result).not.toBeNull();
    expect(result.detected).toBe(false);
    expect(result.method).toBe('ip');
    spy.mockRestore();
  });

  it('detectPreciseLocation renvoie un objet neutre detected:false quand toutes les méthodes échouent', async () => {
    // api.get mocké aussi : loadGeographicDatabase (/geolocation/cities) ne
    // doit pas tenter un vrai appel réseau dans le test.
    vi.spyOn(api, 'get').mockResolvedValue({ countries: {} });
    vi.spyOn(preciseGeolocationService, 'getHighPrecisionGPSLocation').mockResolvedValue({ detected: false, method: 'gps' });
    vi.spyOn(preciseGeolocationService, 'getMultiIPGeolocation').mockResolvedValue({ detected: false, method: 'ip' });
    vi.spyOn(preciseGeolocationService, 'getContextualLocation').mockResolvedValue({ detected: false, method: 'contextual' });
    const result = await preciseGeolocationService.detectPreciseLocation();
    expect(result).not.toBeNull();
    expect(result.detected).toBe(false);
    vi.restoreAllMocks();
  });

  it('detectPreciseLocation renvoie un objet neutre detected:false quand une méthode lève une exception', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ countries: {} });
    vi.spyOn(preciseGeolocationService, 'getHighPrecisionGPSLocation').mockRejectedValue(new Error('GPS refusé'));
    vi.spyOn(preciseGeolocationService, 'getMultiIPGeolocation').mockResolvedValue({ detected: false, method: 'ip' });
    vi.spyOn(preciseGeolocationService, 'getContextualLocation').mockResolvedValue({ detected: false, method: 'contextual' });
    const result = await preciseGeolocationService.detectPreciseLocation();
    expect(result).not.toBeNull();
    expect(result.detected).toBe(false);
    vi.restoreAllMocks();
  });

  it('detectPreciseLocation conserve une détection réussie detected:true', async () => {
    const gps = {
      detected: true,
      method: 'gps',
      coordinates: { lat: 14.69, lng: -17.44 },
      country: 'Sénégal',
      countryCode: 'sn',
      confidence: 93,
    };
    vi.spyOn(preciseGeolocationService, 'getHighPrecisionGPSLocation').mockResolvedValue(gps);
    const result = await preciseGeolocationService.detectPreciseLocation();
    expect(result).not.toBeNull();
    expect(result.detected).toBe(true);
    expect(result.method).toBe('gps');
    vi.restoreAllMocks();
  });
});
