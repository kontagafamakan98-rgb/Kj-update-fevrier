// Cœur du découpage de pack2PageI18n : helpers partagés + fabrique de
// traducteur scopé. Les dictionnaires par page vivent dans <scope>.js et
// sont importés UNIQUEMENT par leur page lazy (plus de chunk partagé de
// ~60 kB chargé par toutes les pages secondaires).
import { normalizeCountryCode as normalizeCountryAlias } from '../countryAliases';

export const getLocaleForLanguage = (language) => {
  switch (language) {
    case 'en':
      return 'en-US';
    case 'wo':
    case 'bm':
    case 'mos':
    case 'fr':
    default:
      return 'fr-FR';
  }
};

export const normalizeCountryCode = (code = '') => normalizeCountryAlias(code);

/**
 * Fabrique le traducteur scopé à partir du dictionnaire d'UNE page.
 * `dict` = { fr, en, wo, bm, mos } pour ce scope uniquement.
 * Même comportement que l'ancien makeScopedTranslator : résolution
 * langue courante → en → fr → fallback global, et interpolation {vars}.
 */
export const createScopedTranslator = (dict, currentLanguage, fallbackT) => {
  const primary = dict[currentLanguage] || {};
  const englishFallback = dict.en || {};
  const frenchFallback = dict.fr || {};

  return (key, vars = {}) => {
    let value =
      primary[key] ??
      englishFallback[key] ??
      frenchFallback[key] ??
      (typeof fallbackT === 'function' ? fallbackT(key) : key);

    if (typeof value !== 'string') {
      return value ?? key;
    }

    return value.replace(/\{(\w+)\}/g, (_, name) => {
      const replacement = vars[name];
      return replacement === undefined || replacement === null ? '' : String(replacement);
    });
  };
};
