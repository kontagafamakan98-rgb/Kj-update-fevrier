/**
 * LA BRANCHE DE `/payment`, DÉCIDÉE PAR LA SEULE URL — un propriétaire, deux
 * lecteurs qui DOIVENT être d'accord.
 *
 * ── Pourquoi ce module existe (09/10/2026) ─────────────────────────────────
 * `/payment` a trois destins, et deux d'entre eux partagent un écran que le
 * troisième ne montre pas :
 *
 *   • `job_id` — la page d'une mission transmet le paiement à régler : la
 *     destination porte le formulaire de paiement ET la carte « mes paiements » ;
 *   • `payment_id` / `token` — retour du payeur (PayDunya) : la destination
 *     porte le statut de ce paiement ;
 *   • NI l'un ni l'autre — la destination est la carte « mission requise », qui
 *     ne contient AUCUNE carte de paiement. C'est le cas que publie la coquille
 *     pré-rendue (`vite-plugins/prerender/shells-routes.js`), et celui d'un
 *     visiteur qui ouvre /payment sans mission.
 *
 * Ce module porte la SEULE définition de cette troisième branche, et il est lu
 * par les DEUX endroits qui réservent une place avant que la page existe :
 * `src/pages/Payment.js` (son propre état de chargement) et
 * `PaymentSkeleton` (son repli de `<Suspense>`). Une règle écrite deux fois
 * divergerait en silence — le cas mesuré le 09/10/2026 : l'état de chargement
 * de la page réservait ~630 px (mobile) / ~450 px (desktop) de cartes de
 * paiement pour une destination qui n'en a aucune, et le pied de page, laissé
 * au-dessus de l'écran pendant le chargement (y=1019 pour une fenêtre de 823),
 * remontait DANS l'écran à l'arrivée des données (y=765,4) : CLS 0,0579, nommé
 * sur `<footer>`.
 *
 * ── Pourquoi une fonction pure de la chaîne de recherche ───────────────────
 * Elle prend la `location.search` en paramètre (défaut : celle du document)
 * pour être éprouvable sans navigateur, et parce que la décision ne dépend que
 * de l'URL — jamais d'une donnée d'API. C'est ce qui permet de la connaître
 * AVANT que la page ne soit chargée, c'est-à-dire au moment où le repli de
 * `<Suspense>` doit décider de sa hauteur.
 *
 * @param {string} [recherche] La chaîne de recherche (`?job_id=…`), sans le `?`.
 * @returns {boolean} `true` si la destination est la carte « mission requise ».
 */
/**
 * Les identifiants de RETOUR DU PAYEUR portés par l'URL, quand il y en a.
 *
 * Ils vivent ici, avec la branche qu'ils décident : la page s'en sert pour
 * choisir l'endpoint de statut (`getPaymentStatusByToken` ou
 * `getPaymentStatus`), et c'est la moitié de la règle qui pourrait être relue
 * ailleurs — donc la moitié qui pourrait diverger. Une seule définition.
 *
 * @param {string} [recherche] La chaîne de recherche, sans le `?`.
 * @returns {{paymentId: string|null, token: string|null}}
 */
export function retourDuPayeur(recherche = window.location.search) {
  const params = new URLSearchParams(recherche);
  return { paymentId: params.get('payment_id'), token: params.get('token') };
}

/**
 * La destination est-elle la carte « mission requise » ?
 *
 * @param {string} [recherche] La chaîne de recherche, sans le `?`.
 * @returns {boolean}
 */
export function carteMissionRequise(recherche = window.location.search) {
  const params = new URLSearchParams(recherche);
  return !params.get('job_id') && !params.get('payment_id') && !params.get('token');
}
