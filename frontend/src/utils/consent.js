// Consentement à la mesure d'audience — un seul domicile.
//
// Le produit ne pose QUE deux cookies, tous deux indispensables à la session :
// le cookie httpOnly de connexion et son jeton CSRF (cf. `set_auth_cookies`
// côté backend). Aucun cookie publicitaire, aucun traceur tiers n'est chargé
// tant que ce module n'a pas rendu « accordé ».
//
// La valeur vit dans `localStorage` sous une clé NOMMÉE (le garde
// `check-token-exposure-production.js` refuse toute clé de jeton, pas celle-ci :
// ce n'est pas un secret, c'est une décision). Trois états :
//   * clé absente        → aucune décision, le bandeau s'affiche ;
//   * `granted`          → analytics autorisé (et injecté au chargement) ;
//   * `denied`           → analytics refusé, définitivement jusqu'à effacement.
//
// `localStorage` peut LEVER (navigation privée, quota, politique du site) : un
// stockage illisible est traité comme « aucune décision », jamais comme un
// accord — le défaut penche du côté qui ne trace pas.

export const CONSENT_STORAGE_KEY = 'kojo_analytics_consent';
export const CONSENT_GRANTED = 'granted';
export const CONSENT_DENIED = 'denied';

const stockage = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Décision enregistrée, ou `null` si aucune (ou illisible).
 * Toute valeur inconnue est traitée comme « aucune décision » : un stockage
 * bricolé à la main ne doit pas valoir un accord.
 */
export const readAnalyticsConsent = () => {
  try {
    const valeur = stockage()?.getItem(CONSENT_STORAGE_KEY);
    return valeur === CONSENT_GRANTED || valeur === CONSENT_DENIED ? valeur : null;
  } catch {
    return null;
  }
};

/** Enregistre la décision. Rend la valeur retenue (utile aux tests). */
export const writeAnalyticsConsent = (choix) => {
  const retenu =
    choix === CONSENT_GRANTED ? CONSENT_GRANTED : CONSENT_DENIED;
  try {
    stockage()?.setItem(CONSENT_STORAGE_KEY, retenu);
  } catch {
    // Stockage indisponible : la décision vaut pour la session en cours, elle
    // n'est simplement pas mémorisée. Rien à journaliser côté client.
  }
  return retenu;
};

/** Vrai SEULEMENT sur un accord explicite — jamais par défaut. */
export const hasAnalyticsConsent = () => readAnalyticsConsent() === CONSENT_GRANTED;
