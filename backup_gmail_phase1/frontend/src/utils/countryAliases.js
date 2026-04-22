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
