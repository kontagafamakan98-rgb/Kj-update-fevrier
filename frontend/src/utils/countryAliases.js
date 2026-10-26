const COUNTRY_ALIAS_MAP = {
  ivory_coast: 'ivory_coast',
  cote_divoire: 'ivory_coast',
  ci: 'ivory_coast',
  mali: 'mali',
  ml: 'mali',
  senegal: 'senegal',
  sn: 'senegal',
  burkina_faso: 'burkina_faso',
  bf: 'burkina_faso'
};

/**
 * Les pays du produit, en codes CANONIQUES et dédoublonnés.
 *
 * Une seule déclaration pour ceux qui en ont besoin comme VOCABULAIRE FERMÉ :
 * la liste blanche du funnel (`utils/funnel.js`) publie le pays comme une
 * dimension bornée, et une troisième copie des mêmes quatre noms finirait par
 * diverger de celle-ci (un pays ajouté ici ne serait alors plus mesuré, sans que
 * rien ne le dise).
 */
export const PAYS_KOJO = Object.freeze([...new Set(Object.values(COUNTRY_ALIAS_MAP))]);

export const normalizeCountryCode = (code = '') => {
  const value = String(code || '').toLowerCase().trim();
  return COUNTRY_ALIAS_MAP[value] || value;
};

export const areSameCountry = (left, right) => {
  return normalizeCountryCode(left) === normalizeCountryCode(right);
};

export const getUniqueCountryCodes = (codes = []) => {
  const seen = new Set();

  return codes.filter((code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};
