/**
 * Correspondance entre les messages d'erreur de validation des comptes de
 * paiement renvoyés par le backend (kojo_core.validate_payment_accounts,
 * utilisé par /auth/register-verified et PUT /users/payment-accounts) et le
 * champ concerné — pour afficher l'erreur SOUS le champ au lieu d'un message
 * général :
 *   - « Numéro Orange Money invalide »   → champ orange_money
 *   - « Numéro Wave invalide »           → champ wave
 *   - « Informations de compte bancaire invalides » → champ bank_account
 * Les messages sans champ précis (ex: minimum requis non atteint) retournent
 * null et restent affichés en erreur générale.
 */

// Mots-clés ancrés sur les messages de VALIDATION précis (pas les messages
// génériques qui citent les moyens de paiement, ex: « …Orange Money, Wave ou
// Compte bancaire… » dans l'erreur de minimum requis).
const FIELD_KEYWORDS = [
  { field: 'orange_money', keywords: ['numéro orange money'] },
  { field: 'wave', keywords: ['numéro wave'] },
  { field: 'bank_account', keywords: ['bancaire invalide'] },
];

/**
 * @param {string|null|undefined} message – detail de l'erreur backend
 * @returns {{field: string, message: string}|null}
 */
export const mapPaymentAccountErrorToField = (message) => {
  if (!message) return null;
  const lower = String(message).toLowerCase();
  for (const { field, keywords } of FIELD_KEYWORDS) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return { field, message: String(message) };
    }
  }
  return null;
};
