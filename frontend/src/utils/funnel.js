// FUNNEL — les cinq étapes du parcours, et une LISTE BLANCHE de paramètres.
//
// ── Pourquoi ce module existe ────────────────────────────────────────────────
// `analytics.js` publie des PAGE VUES : il dit quelles pages ont été ouvertes,
// jamais si quelqu'un s'est inscrit, a vérifié son code, a publié une mission,
// a envoyé une proposition ou est allé jusqu'au paiement. Ce sont pourtant les
// seules questions qui décident d'un produit : où les gens s'arrêtent. Sans ces
// étapes, GA montre du trafic et tait l'entonnoir.
//
// ── La règle : rien ne sort sans être DÉCLARÉ ────────────────────────────────
// Un événement doit figurer dans `EVENEMENTS_FUNNEL`, un paramètre dans
// `CLES_FUNNEL` AVEC ses valeurs admises. Tout le reste est ÉCARTÉ par
// `trackFunnel` — pas envoyé « au cas où » :
//   • un identifiant (email, nom, `job_id`, `proposal_id`) n'est pas dans la
//     liste, donc ne part pas : une valeur libre crée une série par valeur, et
//     c'est la même règle que celle des étiquettes de `/metrics` côté backend ;
//   • une adresse ou un nom dans un rapport d'audience ne se retire pas après
//     coup, et le consentement ne couvre pas ce qu'on n'avait pas annoncé.
// Les valeurs sont aussi BORNÉES (énumération, booléen, code pays ISO) : une
// clé déclarée dont la valeur viendrait du texte libre d'un utilisateur
// rouvrirait la porte que la liste blanche ferme.
//
// ── Pourquoi ces noms ───────────────────────────────────────────────────────
// `sign_up` et `begin_checkout` sont des noms RECOMMANDÉS par GA4 : les
// renommer priverait les rapports d'entonnoir intégrés de ces deux étapes. Les
// trois autres n'ont pas d'équivalent standard et portent donc un nom propre,
// en `snake_case` comme le reste du rapport.
//
// ── Aucun envoi sans mesure configurée ──────────────────────────────────────
// `window.gtag` n'existe qu'APRÈS `initAnalytics()`, lui-même appelé seulement
// sur consentement (`utils/consent.js`) : sans consentement, sans
// `VITE_GA_MEASUREMENT_ID`, ou hors navigateur, ces appels sont des no-op
// stricts (aucune requête, aucune exception).
//
// Le garde `scripts/check-funnel-events.js` refuse, dans la source, un écart à
// ces deux listes : clé inconnue, événement non déclaré, `gtag('event', …)`
// appelé directement, paramètres non littéraux (clés illisibles), et étape
// DÉCLARÉE sans aucun émetteur.

// Extension EXPLICITE : ce module est aussi lu par `scripts/check-funnel-events.js`
// (Node), qui ne résout pas une importation sans extension — et il doit lire la
// MÊME déclaration que le build, pas une copie.
import { PAYS_KOJO } from './countryAliases.js';

/**
 * Les cinq étapes du funnel, dans l'ordre du parcours.
 *
 * Les CLÉS sont le vocabulaire du code ; les VALEURS sont ce que GA reçoit, et
 * elles ne changent pas sans casser l'historique des rapports.
 */
export const EVENEMENTS_FUNNEL = Object.freeze({
  inscription: 'sign_up',
  otpVerifie: 'email_otp_verified',
  missionCreee: 'job_created',
  propositionEnvoyee: 'proposal_sent',
  paiementLance: 'begin_checkout',
  // Hors entonnoir d'inscription, mais même règle : le partage d'une mission
  // est ce qui fait entrer du trafic par le canal réel du marché (WhatsApp).
  partageMission: 'job_shared',});

// Marqueur de validation : une clé dont la valeur est une ÉNUMÉRATION porte son
// tableau ; un booléen porte ce marqueur explicite.
const BOOLEEN = 'booleen';

/**
 * Les clés de paramètres admises, et les valeurs admises pour chacune.
 *
 * Ajouter une clé ici est une décision de CONFIDENTIALITÉ, pas de mesure : elle
 * doit décrire une dimension bornée (énumération, booléen, code pays), jamais
 * un identifiant, un montant exact ou un texte libre.
 */
export const CLES_FUNNEL = Object.freeze({
  // Type de compte choisi à l'inscription (backend : `user_type`).
  user_type: Object.freeze(['client', 'worker', 'owner']),
  // Pays du site, en code canonique — la liste du produit, pas une troisième
  // copie (`PAYS_KOJO`, utils/countryAliases.js).
  country: PAYS_KOJO,
  // Canal d'inscription : formulaire email (avec code) ou Google.
  signup_method: Object.freeze(['email', 'google']),
  // Moyen de paiement proposé à l'écran (`PAYMENT_METHOD_KEYS` de Payment.js).
  payment_method: Object.freeze(['orange_money', 'wave', 'bank_card']),
  // Un code de parrainage a-t-il été appliqué ? Un booléen, jamais le code.
  has_referral: BOOLEEN,
  // Par où le partage est parti : la feuille du système ou `wa.me`.
  channel: Object.freeze(['whatsapp', 'natif']),});

/** Les noms d'événements déclarés, pour le refus des noms inconnus. */
const NOMS_DECLARES = new Set(Object.values(EVENEMENTS_FUNNEL));

/**
 * La valeur admise pour `cle`, ou `null` quand elle doit être écartée.
 *
 * La normalisation (casse, espaces) est faite ICI pour que deux appelants qui
 * écrivent `'Wave'` et `'wave'` ne produisent pas deux séries dans GA. Une
 * valeur hors liste n'est jamais « corrigée » en une autre : elle est écartée.
 *
 * @param {string} cle Clé déjà reconnue comme déclarée.
 * @param {unknown} valeur Valeur fournie par l'appelant.
 * @returns {string|boolean|null} Valeur admise, ou `null`.
 */
const valeurAdmise = (cle, valeur) => {
  const regle = CLES_FUNNEL[cle];

  if (Array.isArray(regle)) {
    const normalisee = typeof valeur === 'string' ? valeur.trim().toLowerCase() : null;
    return normalisee !== null && regle.includes(normalisee) ? normalisee : null;
  }

  if (regle === BOOLEEN) {
    return typeof valeur === 'boolean' ? valeur : null;
  }

  return null;
};

/**
 * Publie une étape du funnel, filtrée par la liste blanche.
 *
 * @param {string} nom Nom d'événement ; doit figurer dans `EVENEMENTS_FUNNEL`.
 * @param {Record<string, unknown>} [parametres] Dimensions ; seules les clés
 *   de `CLES_FUNNEL` dont la valeur est admise sont transmises.
 * @returns {boolean} vrai si l'événement a été remis à `gtag`.
 */
export const trackFunnel = (nom, parametres = {}) => {
  if (typeof nom !== 'string' || !NOMS_DECLARES.has(nom)) return false;
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return false;

  const transmis = {};
  for (const [cle, valeur] of Object.entries(parametres || {})) {
    if (!Object.prototype.hasOwnProperty.call(CLES_FUNNEL, cle)) continue;
    const admise = valeurAdmise(cle, valeur);
    if (admise === null) continue;
    transmis[cle] = admise;
  }

  window.gtag('event', nom, transmis);
  return true;
};
