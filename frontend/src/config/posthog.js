// POSTHOG — les DEUX origines du projet, et la forme de sa clé publique.
//
// DÉCLARATION UNIQUE, DEUX LECTEURS : `src/config/csp.js` en dérive les
// origines qu'elle ouvre, `src/utils/analytics.js` en dérive l'URL du script
// qu'elle injecte. Recopier l'hôte d'un côté et le charger de l'autre est le
// défaut que ce module existe pour rendre impossible : une origine autorisée
// mais jamais demandée n'ouvre rien d'utile, une origine demandée mais non
// autorisée est bloquée en SILENCE par notre propre politique.
//
// POURQUOI EU, ET PAS LE DÉFAUT US : le domaine du produit est l'Afrique de
// l'Ouest et l'hébergement (Fly `fra`, Vercel) est à Francfort — les données
// d'usage restent sur le sol européen. Changer de région est un changement de
// ces DEUX constantes, plus la copie Python (`backend/kojo_csp.py`) que le
// contrat `scripts/check-csp-contract.js` confronte octet pour octet.
//
// CE QUI N'EST PAS ICI, ET POURQUOI : ni clé, ni identifiant de projet. La clé
// est une variable de BUILD (`VITE_POSTHOG_KEY`), publique par construction —
// elle finit dans le bundle —, et sans elle ces constantes ne servent à rien :
// `initPosthog` n'est jamais appelé et la CSP n'ouvre aucune origine. Un
// `VITE_POSTHOG_HOST` n'existe pas non plus : il pourrait désigner un hôte que
// la CSP n'autorise pas (les deux déclarations divergeraient et PostHog
// échouerait en silence), alors que la région est déjà décidée ici.

/**
 * L'hôte d'INGESTION (le `api_host` du SDK) : `/e/`, `/decide/`, `/i/v0/e/`.
 * C'est la seule origine que `connect-src` doit ouvrir.
 */
export const POSTHOG_API_HOST = 'https://eu.i.posthog.com';

/**
 * Le CDN des ACTIFS du SDK (`/static/array.js`, et tout ce que le SDK charge
 * ensuite). C'est la seule origine que `script-src` doit ouvrir.
 *
 * PostHog recommande `https://*.posthog.com` en prévision d'un changement de
 * sous-domaine. On ne l'a pas suivi, et c'est un CHOIX écrit : une origine
 * exacte par directive, comme pour Plausible — `script-src` et `connect-src`
 * sont la surface qu'un XSS exploite, et un joker sur `posthog.com` ouvrirait
 * la politique à un sous-domaine qu'aucun de nos deux fichiers ne demande. Le
 * coût assumé : si PostHog déménage ses sous-domaines, la mesure cesse sans
 * bruit — c'est pourquoi l'origine est écrite ICI et pas dispersée, et pourquoi
 * le contrat CSP rougit dès qu'un seul des deux côtés la change.
 */
export const POSTHOG_ASSETS_HOST = 'https://eu-assets.i.posthog.com';

/** L'URL du SDK, telle que `initPosthog` l'injecte. */
export const POSTHOG_SCRIPT_URL = `${POSTHOG_ASSETS_HOST}/static/array.js`;

/**
 * Forme d'une clé de projet PostHog utilisable — la même expression que
 * `POSTHOG_MOTIF` dans `backend/kojo_csp.py`.
 *
 * Un jeton PERSONNEL (`phx_…`) ou une chaîne vide n'ouvre RIEN : ce sont les
 * seules formes inutilisables qu'un copier-coller malheureux produit dans les
 * variables d'environnement, et ouvrir `script-src` pour elles élargirait la
 * politique sans qu'un octet de mesure ne sorte.
 */
export const POSTHOG_KEY_MOTIF = /^phc_[A-Za-z0-9]+$/;

/**
 * La clé est-elle utilisable ?
 *
 * @param {unknown} valeur Valeur lue dans l'environnement du build.
 * @returns {boolean} Vrai si la forme est celle d'une clé de projet.
 */
export const estClePosthog = (valeur) => POSTHOG_KEY_MOTIF.test(String(valeur ?? '').trim());
