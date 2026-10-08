/**
 * TIERS CONTACTÉS AVANT TOUTE INTERACTION — la règle, possédée une fois.
 *
 * Le pendant DYNAMIQUE de `shell-remote-resources.js`. Le garde statique lit ce
 * que la coquille DÉCLARE (balises et CSS) ; cette règle-ci classe ce que le
 * navigateur a RÉELLEMENT demandé, sans qu'aucun appui n'ait eu lieu. Les deux
 * répondent à la même question par deux chemins qui ne se recouvrent pas — et
 * c'est ce recouvrement partiel qui rend la comparaison utile (voir
 * `CE_QUE_LE_GARDE_STATIQUE_VOIT` plus bas).
 *
 * ── Pourquoi un navigateur, et pas seulement le lecteur de déclarations ────
 * Le préchargeur ne demande que ce qui est ÉCRIT. Mais une URL peut être
 * ASSEMBLÉE par du code : `fetch('/api' + chemin)`, `new Image().src`, un
 * `import()` calculé, un script tiers injecté par une dépendance montée. Rien
 * de tout cela n'existe dans le HTML publié, donc le garde statique ne peut pas
 * le voir — et un parcours de comportement, lui, prouve ce qu'on a pensé à
 * tester. La sonde e2e (`e2e/aucun-tiers-avant-interaction.spec.js`) ferme ce
 * trou : elle ÉCOUTE toutes les requêtes des routes pré-rendues, sans jamais
 * appuyer, et refuse la première qui sort de nos origines.
 *
 * ── Trois vues, et ce que la TROISIÈME ajoute (27/09/2026) ─────────────────
 * `shell-remote-resources.js` lit ce que la coquille DÉCLARE ; cette règle-ci
 * juge ce que le navigateur DEMANDE ; `origines-bundles.js` (exécutée par
 * `check-origines-bundles.js`) lit le TROISIÈME endroit où une URL peut vivre :
 * les fichiers LIVRÉS (le JS et le CSS du build). Elle ne remplace ni l'un ni
 * l'autre, et elle voit ce que les deux manquent — l'origine écrite EN CLAIR
 * dans le code (`new Image().src = 'https://tiers.test/x'`), y compris dans la
 * branche que le parcours n'exerce jamais. Ce qu'elle ne prouve PAS : que cette
 * origine ne part pas — elle dit qu'elle est ÉCRITE, et c'est pourquoi ses
 * occurrences classées disent « chargé si la variable de build le demande », pas
 * « inerte ». Le parcours dynamique reste le seul à trancher ça.
 *
 * ── Le contrat de « tiers » ────────────────────────────────────────────────
 * Sont NÔTRES : l'origine qui sert la page (le serveur de prévisualisation en
 * e2e, l'origine du site en production), `SITE_ORIGIN`/`API_ORIGIN` lues dans
 * `site-meta.js` (jamais recopiées : la leçon de la migration de domaine), et
 * toute adresse LOOPBACK (la page et l'API de test partagent la machine). Sont
 * TIERS : tout le reste. Un schéma local (`data:`, `blob:`, `mailto:`, `tel:`…)
 * ne sort pas du document et n'est pas une requête réseau.
 *
 * Les URL RELATIVES ne sont pas jugées ici : une requête relative est, par
 * construction, servie par l'origine qui a servi la page.
 */
import { API_ORIGIN, LOOPBACK_HOSTS, SITE_ORIGIN } from './site-meta.js';
import { origineDe, ressourcesDeclarees } from './shell-remote-resources.js';

/** Les origines de PRODUCTION que le site s'autorise à contacter. */
export const ORIGINES_AUTORISEES = [SITE_ORIGIN, API_ORIGIN];

/** Schémas qui ne quittent pas le document (donc jamais « tiers »). */
const SCHEMAS_LOCAUX = /^(data|blob|about|javascript|mailto|tel|sms):/i;

/** L'hôte désigne-t-il CETTE machine (loopback), crochets IPv6 retirés ? */
const hoteLoopback = (hote) => LOOPBACK_HOSTS.includes(String(hote || '').replace(/^\[|\]$/g, ''));

/**
 * Cette URL sort-elle de nos origines ?
 *
 * @param {string} url URL absolue d'une requête observée.
 * @param {{ origineDeLaPage?: string|null, origines?: string[] }} [options]
 *   `origineDeLaPage` vient de `page.url()` (l'origine qui sert la page) ;
 *   `origines` par défaut les origines de production.
 * @returns {boolean} Vrai si la requête est tierce (donc à refuser).
 */
export function estTiers(url, { origineDeLaPage = null, origines = ORIGINES_AUTORISEES } = {}) {
  const valeur = String(url || '').trim();
  if (!valeur) return false;
  if (SCHEMAS_LOCAUX.test(valeur)) return false;

  const origine = origineDe(valeur);
  if (!origine) return false; // relative : servie par l'origine de la page.

  // On lit l'HÔTE avec une URL absolue, y compris pour un relatif-au-protocole
  // (`//hote/chemin`) dont on ne peut pas présumer du schéma : un `slice` sur la
  // chaîne laissait le PORT dans l'hôte et faisait passer `//127.0.0.1:9000`
  // pour un tiers.
  let brut;
  try {
    brut = new URL(origine.startsWith('//') ? `https:${valeur}` : valeur);
  } catch (_error) {
    return true; // URL absolue illisible : on refuse plutôt que de supposer.
  }

  if (hoteLoopback(brut.hostname)) return false;
  if (origineDeLaPage) {
    try {
      if (brut.origin === new URL(origineDeLaPage).origin) return false;
    } catch (_error) {
      /* origine de page illisible : on poursuit sur la liste d'origines */
    }
  }

  const notres = origines.map((o) => String(o).trim().toLowerCase().replace(/\/+$/, ''));
  if (origine.startsWith('//')) {
    // Pas de schéma : on compare l'HÔTE (un relatif-au-protocole vers notre
    // domaine reste nôtre).
    const hote = brut.host.toLowerCase();
    return !notres.some((notre) => {
      try {
        return new URL(notre).host === hote;
      } catch (_error) {
        return false;
      }
    });
  }
  return !notres.includes(brut.origin.toLowerCase());
}

/**
 * Le nom LISIBLE de l'initiateur d'une requête, tel que le protocole le donne
 * (`Network.requestWillBeSent` → `{ type, url, lineNumber, stack }`).
 *
 * C'est la moitié utile du refus : un rouge qui dit « une requête tierce » sans
 * dire QUI l'a lancée oblige à instrumenter à la main. On nomme donc la sorte,
 * puis l'URL et la ligne quand elles existent.
 *
 * ── Pourquoi `cadre` existe, et ce qu'il répare (28/09/2026) ────────────────
 * Pour une iframe ou une image créée PAR UN SCRIPT, Chromium ne remplit RIEN :
 * mesuré sur la façade de carte, `initiator` vaut exactement `{"type":"other"}`
 * — ni URL, ni pile. Le verdict disait donc « une source non nommée » sur la
 * requête la plus intéressante du site, celle que la sonde existe pour nommer.
 * Ce que le protocole sait, en revanche, c'est QUELLE PAGE a demandé : on lui
 * passe donc le document demandeur (`cadre`), relevé par l'écoute
 * (`e2e/helpers/requetes.js`, arbre des cadres du CDP). Le nom devient « le
 * document http://…/contact », qui est vrai et vérifiable — plutôt qu'un
 * « inconnu » qui n'apprend rien. Ce n'est PAS une devinette sur l'auteur du
 * geste : c'est le document qui a émis la requête, et rien de plus.
 *
 * Le document ne REMPLACE jamais une sorte informative : « l’analyseur HTML » et
 * « le préchargeur » disent mieux que le document d'où part la requête, et les
 * écraser ferait reculer les verdicts déjà écrits (le parcours d'avant exige que
 * le tiers DÉCLARÉ dans une coquille soit nommé par l'analyseur).
 *
 * @param {{ type?: string, url?: string, lineNumber?: number, stack?: Object }|undefined} initiateur
 * @param {{ cadre?: string }} [options] URL du document qui a émis la requête.
 * @returns {string} Une phrase courte, jamais vide.
 */
export function nommerInitiateur(initiateur, { cadre = '' } = {}) {
  const documentDemandeur = String(cadre || '').trim();
  const parLeDocument = documentDemandeur ? `le document ${documentDemandeur}` : null;
  if (!initiateur || typeof initiateur !== 'object') {
    return parLeDocument || 'initiateur inconnu';
  }
  const sorte = {
    parser: 'l’analyseur HTML',
    script: 'un script',
    preload: 'le préchargeur',
    other: 'une source non nommée',
  }[initiateur.type] || `initiateur « ${initiateur.type || '?' } »`;
  if (initiateur.url) {
    const ligne = Number.isFinite(initiateur.lineNumber) ? `:${initiateur.lineNumber}` : '';
    return `${sorte} ${initiateur.url}${ligne}`;
  }
  // La PILE quand le protocole la donne : le premier cadre d'appel nomme le
  // fichier et la ligne, ce que `url` ne fait pas toujours.
  const premierAppel = initiateur.stack?.callFrames?.[0];
  if (premierAppel?.url) {
    const ligne = Number.isFinite(premierAppel.lineNumber) ? `:${premierAppel.lineNumber}` : '';
    return `${sorte} ${premierAppel.url}${ligne}`;
  }
  // Sinon, et SEULEMENT quand le protocole ne dit rien d'autre que « autre »
  // (c'est le cas d'une iframe ou d'une image montée par un script), le document
  // demandeur — un fait, pas une supposition. Une sorte INFORMATIVE (« l'analyseur
  // HTML », « le préchargeur ») n'est jamais remplacée : elle est plus précise
  // que le document, et l'écraser ferait reculer le verdict.
  const sorteSansDetails = !initiateur.type || initiateur.type === 'other';
  if (parLeDocument && sorteSansDetails) return parLeDocument;
  return sorte;
}

/**
 * Les divergences : chaque requête TIERCE, nommée avec son initiateur.
 *
 * @param {Array<{ url: string, initiateur?: object, sorte?: string }>} requetes
 *   Requêtes observées AVANT toute interaction (`page.on('request')`).
 * @param {{ origineDeLaPage?: string|null, origines?: string[] }} [options]
 * @returns {Array<{ url: string, initiateur: string, sorte: string }>}
 */
export function divergencesDeTiers(requetes, options = {}) {
  const divergences = [];
  for (const requete of requetes || []) {
    if (!estTiers(requete?.url, options)) continue;
    divergences.push({
      url: String(requete.url || ''),
      initiateur: nommerInitiateur(requete.initiateur, {
        cadre: requete.cadre || options.origineDeLaPage || '',
      }),
      sorte: String(requete.sorte || 'requête'),
    });
  }
  return divergences;
}

/**
 * Ce que le garde statique (`shell-remote-resources.js`) SAIT voir, et ce
 * qu'il ne peut PAS voir. Écrit ici pour être comparé, pas pour être cru : la
 * sonde e2e et le test unitaire l'affirment chacun à leur niveau.
 */
export const CE_QUE_LE_GARDE_STATIQUE_VOIT = {
  voit: [
    'une balise qui télécharge ou contacte (script, img, iframe, link rel=*, …)',
    'un `rel` non classé, refusé plutôt que supposé inoffensif',
    'un `url()` / `@import` / `image-set()` du CSS publié, y compris les feuilles liées',
    'une ressource déclarée dans `style="…"`',
    'une URL écrite en références de caractères (`&#39;…&#39;`)',
  ],
  nePeutPasVoir: [
    'une URL absente du HTML publié, même écrite EN CLAIR dans le code (`new Image().src = \'https://tiers.test/x\'`) — c’est `origines-bundles.js` qui la voit, pas ce garde-ci',
    'une requête qui ne part QU’APRÈS le montage de React (l’iframe de carte au clic)',
    'une ressource chargée par une dépendance au runtime, hors du HTML publié',
    'l’effet d’un `preconnect`/`dns-prefetch` : une connexion ouverte, pas une requête',
  ],
};

/**
 * Ce que le garde statique lit sur une coquille donnée — délègue à la règle,
 * ne la redéclare pas. Sert à comparer les DEUX vues sur les MÊMES routes.
 *
 * @param {string} html HTML d'une coquille pré-rendue.
 * @returns {Array<Object>} Les ressources déclarées (balise, attribut, url, sorte).
 */
export const ceQueLeGardeStatiqueVoit = (html) => ressourcesDeclarees(html ?? '');
