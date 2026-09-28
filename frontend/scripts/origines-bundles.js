// RÈGLE : AUCUNE ORIGINE TIERCE DANS LES FICHIERS LIVRÉS (JS ET CSS), ET CHAQUE
// OCCURRENCE LÉGITIME RESTANTE CLASSÉE AVEC SON MOTIF.
//
// ── Le trou que cette règle ferme ───────────────────────────────────────────
// Les deux gardes voisins regardent le HTML des coquilles
// (`shell-remote-resources.js` : ce que la coquille DÉCLARE) et ce que le
// navigateur DEMANDE vraiment avant tout geste (`tiers-avant-interaction.js` +
// son parcours Chromium). Ni l'un ni l'autre ne lit les FICHIERS LIVRÉS : le
// bundle JS et la feuille CSS du build. Or c'est là que vivent les URL que le
// code écrit en clair — un `script.src = 'https://…'` injecté au montage, une
// `<img>` construite par un composant, un appel `fetch` vers un hôte étranger.
// Une telle URL ne figure dans AUCUN HTML publié, donc le garde de coquille ne
// la voit pas ; et si elle ne part qu'au clic, le parcours non plus.
//
// La règle est STATIQUE et TOTALE : elle lit tous les octets des fichiers
// livrés, sans exécuter le code, donc elle voit aussi la branche que le parcours
// n'exerce jamais.
//
// ── Ce qu'est une « origine » ici ───────────────────────────────────────────
// On cherche les URL ABSOLUES écrites en clair (`http://…`, `https://…`) et on
// en retient l'ORIGINE (schéma + hôte + port). Les URL relatives, les schémas
// locaux (`data:`, `blob:`, `mailto:`, `tel:`…) et les chaînes qui ne sont pas
// des URL ne sont pas des origines : elles ne sont pas jugées.
//
// ── Le contrat de « tiers » est celui du dépôt, pas une deuxième définition ──
// `estTiers()` (`tiers-avant-interaction.js`) dit qui est nôtre : l'origine du
// site, celle de l'API (`site-meta.js`) et toute adresse LOOPBACK. Le redéclarer
// ici créerait deux définitions qui divergeraient au premier ajout d'origine —
// exactement la faute que ce dépôt refuse.
//
// ── Ce que la règle REFUSE ──────────────────────────────────────────────────
//   1. NON CLASSÉE : une origine tierce présente dans un fichier livré et absente
//      du classement. C'est le refus principal — il oblige à écrire POURQUOI une
//      origine étrangère a le droit d'être là ;
//   2. PÉRIMÉE : une entrée du classement qu'aucun fichier livré ne porte plus.
//      Une exemption qu'on n'ose plus retirer est une exemption qui mente : elle
//      survit au code qu'elle justifiait et justifie alors le suivant ;
//   3. MOTIF VIDE : une entrée sans motif écrit n'est pas un classement.

import { LOOPBACK_HOSTS, SITE_ORIGIN, API_ORIGIN } from './site-meta.js';
import { estTiers } from './tiers-avant-interaction.js';

/**
 * Les sortes d'occurrence légitime. Le vocabulaire est FERMÉ : une occurrence
 * qui ne rentre dans aucune de ces sortes n'est pas classable, donc elle est
 * refusée. Chaque sorte dit COMMENT l'origine se manifeste, pas à qui elle
 * appartient.
 */
export const SORTES = {
  /** Un identifiant (espace de noms XML/SVG/MathML, vocabulaire JSON-LD) : jamais requêté. */
  IDENTIFIANT: 'identifiant (jamais requêté)',
  /** Une chaîne affichée dans un message d'erreur d'une bibliothèque : jamais requêtée. */
  MESSAGE: 'message de bibliothèque (jamais requêté)',
  /** Un `href` rendu dans la page (lien de contact, attribution) : pas une requête. */
  LIEN: 'lien rendu (href, pas une requête)',
  /** Chargé APRÈS un geste de l'utilisateur : le parcours dynamique le couvre. */
  APRES_INTERACTION: 'chargé après interaction',
  /**
   * Chargé quand le BLOC DE CARTE entre dans le viewport — donc jamais au
   * premier écran, mais sans geste non plus (ni appui ni défilement exigés :
   * c'est l'observation de la mise en page qui décide).
   *
   * La sorte a été AJOUTÉE le 27/09/2026, quand la carte différée de /profile a
   * introduit cette troisième manifestation : la ranger dans
   * `APRES_INTERACTION` aurait écrit « après un geste » pour une carte montée
   * sans que personne ne touche à rien, et le vocabulaire de ce module est
   * FERMÉ précisément pour qu'on ne fasse pas dire à une sorte ce qu'elle ne dit
   * pas. Son solde est prouvé au runtime : `e2e/carte-facade.spec.js`
   * (« la carte différée ne part qu'une fois à l'écran »).
   */
  APRES_MISE_EN_ECRAN: 'chargé quand le bloc entre dans le viewport (jamais au premier écran)',
  /** Chargé seulement si une variable de BUILD l'autorise : no-op sinon. */
  CONDITIONNEL: 'chargé si la variable de build le demande',
};

/**
 * LE CLASSEMENT : chaque origine tierce légitime, SON motif et SA preuve.
 *
 * Une entrée par ORIGINE exacte (schéma compris). Une origine dont le schéma
 * change (`http:` → `https:`, ou l'inverse) ne correspond plus → l'ancienne
 * entrée est PÉRIMÉE et le garde refuse : c'est voulu, un changement de schéma
 * est un fait à relire, pas un détail à ignorer.
 *
 * `preuve` nomme l'ENDROIT du dépôt qui justifie le motif — le fichier que
 * quelqu'un doit ouvrir pour vérifier que le motif est encore vrai.
 */
export const CLASSEMENT_ORIGINES = [
  {
    origine: 'http://www.w3.org',
    sorte: SORTES.IDENTIFIANT,
    motif:
      'espaces de noms XML/SVG/MathML (`http://www.w3.org/2000/svg`, `1999/xlink`, ' +
      '`XML/1998/namespace`, `1998/Math/MathML`) : des identifiants normalisés, jamais des requêtes',
    preuve: 'src/config/page-icons.js (`xmlns`), vendor-react-dom (attributs de namespace)',
  },
  {
    origine: 'https://schema.org',
    sorte: SORTES.IDENTIFIANT,
    motif:
      'vocabulaire du JSON-LD (`@context` de la FAQ de /how-it-works) : une chaîne lue par les ' +
      'moteurs, jamais requêtée par le navigateur',
    preuve: 'le JSON-LD publié par la page /how-it-works',
  },
  {
    origine: 'http://fb.me',
    sorte: SORTES.MESSAGE,
    motif:
      'message d’erreur de `prop-types` (« Read more at http://fb.me/use-check-prop-types ») : ' +
      'une chaîne affichée quand une prop est mal typée, jamais contactée',
    preuve: 'vendor-prop-types',
  },
  {
    origine: 'https://reactjs.org',
    sorte: SORTES.MESSAGE,
    motif:
      'décodeur d’erreurs de React (`/docs/error-decoder.html?invariant=…`) : l’adresse est ' +
      'CONSTRUITE pour le message d’une erreur de rendu, jamais ouverte',
    preuve: 'vendor-react-dom',
  },
  {
    origine: 'https://reactrouter.com',
    sorte: SORTES.MESSAGE,
    motif: 'message d’erreur de `react-router` (« must be used within a data router ») : une chaîne, jamais une requête',
    preuve: 'vendor-router',
  },
  {
    origine: 'https://github.com',
    sorte: SORTES.MESSAGE,
    motif:
      'message d’erreur de `react-router` (conseil de polyfill `url-search-params`) : une chaîne, jamais une requête',
    preuve: 'vendor-router',
  },
  {
    origine: 'https://docs.sentry.io',
    sorte: SORTES.MESSAGE,
    motif:
      'message d’erreur de `@sentry/browser` (interdiction d’`init()` dans une extension de ' +
      'navigateur) : une chaîne, jamais une requête',
    preuve: 'vendor-sentry',
  },
  {
    origine: 'https://leafletjs.com',
    sorte: SORTES.LIEN,
    motif:
      'préfixe d’attribution de Leaflet (`<a href="https://leafletjs.com">`) rendu dans le ' +
      'contrôle de carte : un `href`, pas un téléchargement',
    preuve: 'vendor-leaflet (option `prefix` du contrôle d’attribution)',
  },
  {
    origine: 'https://www.openstreetmap.org',
    // Deux manifestations sur CETTE origine, et la sorte retenue est la plus
    // FORTE des deux (une origine est classée une fois, pas deux) :
    //   • `vendor-leaflet` rend un `href` d'attribution (`/copyright`) : pas une
    //     requête ;
    //   • la carte DIFFÉRÉE du profil (`src/components/DeferredMap.js`, URL
    //     construite par `src/utils/countryMap.js` + `src/utils/locationMaps.js`)
    //     est une iframe (`/export/embed.html?bbox=…`) MONTÉE quand le bloc
    //     entre dans le viewport — donc réellement demandée, mais jamais au
    //     premier écran.
    sorte: SORTES.APRES_MISE_EN_ECRAN,
    motif:
      'lien d’attribution des tuiles (`/copyright`) rendu à côté de la carte Leaflet (un `href`, ' +
      'pas une requête), ET l’iframe de la carte différée de /profile ' +
      '(`/export/embed.html?bbox=…`) : montée seulement quand le bloc entre dans le viewport, ' +
      'jamais au premier écran',
    preuve:
      'vendor-leaflet (attribution des tuiles) + src/components/DeferredMap.js ' +
      '(`src/utils/countryMap.js` pour l’URL)',
  },
  {
    origine: 'https://wa.me',
    sorte: SORTES.LIEN,
    motif:
      'lien de contact WhatsApp (`https://wa.me/18193003507`, lu de `src/config/contact.json`) : ' +
      'un `href` que l’utilisateur ouvre s’il le veut',
    preuve: 'src/config/contact.json',
  },
  {
    origine: 'https://www.google.com',
    sorte: SORTES.LIEN,
    motif:
      'liens de CONTACT (`/maps/search/?api=1&query=…`) rendus en `href`, et l’URL `output=embed` ' +
      'de la FAÇADE de carte, injectée en iframe au clic seulement — jamais une requête au montage',
    preuve: 'src/config/contact.json + la façade de carte (MapEmbed)',
  },
  {
    origine: 'https://accounts.google.com',
    sorte: SORTES.APRES_INTERACTION,
    motif:
      'script Google Identity Services (`/gsi/client`), injecté par `src/services/googleAuth.js` ' +
      'quand l’utilisateur emploie le bouton « Continuer avec Google » — donc après un geste, et ' +
      'c’est le parcours `aucun-tiers-avant-interaction` qui le prouve au runtime',
    preuve: 'src/services/googleAuth.js (injection explicite dans `document.createElement("script")`)',
  },
  {
    origine: 'https://tile.openstreetmap.org',
    sorte: SORTES.APRES_INTERACTION,
    motif:
      'tuiles de la carte (`/{z}/{x}/{y}.png`), demandées quand la carte s’affiche — la carte est ' +
      'derrière une façade, donc après un geste',
    preuve: 'vendor-leaflet (`tileLayer`) monté par la carte',
  },
  {
    origine: 'https://plausible.io',
    sorte: SORTES.CONDITIONNEL,
    motif:
      'script d’analytics (`/js/script.js`) ajouté au `<head>` SEULEMENT si `VITE_PLAUSIBLE_DOMAIN` ' +
      'est défini au build (`isEnabled` dans `src/utils/analytics.js`) ; la CSP de production ' +
      'n’ouvre `script-src` à `plausible.io` que dans ce même cas. Sans la variable, la chaîne est ' +
      'présente dans le bundle mais le script n’est jamais injecté',
    preuve: 'src/utils/analytics.js + vite-plugins/inject-production-csp.js',
  },
  // `https://picsum.photos` (la photo factice de `/mobile-test`) N'EST PLUS ICI :
  // son import est désormais conditionné à `import.meta.env.DEV` dans `src/App.js`,
  // donc le chunk n'est plus ÉMIS en production et l'origine a disparu des
  // fichiers livrés — le refus de PÉRIMÉ exige de la retirer, et c'est ce qui a
  // été fait. Le jour où ce chunk reviendrait, le garde rougirait en réclamant
  // de la reclasser, plutôt que de laisser une exemption mentir.
];

/** Une URL absolue écrite en clair dans un fichier. */
const MOTIF_URL_ABSOLUE = /https?:\/\/[^\s"'`\\<>()[\]{},]+/g;

/** Le schéma d'une URL — pour ne PAS juger ce qui ne sort pas du document. */
const SCHEMAS_LOCAUX = /^(data|blob|about|javascript|mailto|tel|sms):/i;

/**
 * L'origine d'une URL ABSOLUE, ou `null` si la chaîne n'en porte pas.
 *
 * On lit l'URL avec `new URL()` au lieu d'un découpage textuel : c'est lui qui
 * décide ce qu'est l'hôte et le port (un `slice` laissait le port dans l'hôte
 * sur un relatif-au-protocole, leçon de `tiers-avant-interaction.js`).
 *
 * @param {string} valeur URL candidate.
 * @returns {string|null} L'origine (`https://hote:port`), ou `null`.
 */
export function origineDeUrl(valeur) {
  const texte = String(valeur || '').trim();
  if (!texte || SCHEMAS_LOCAUX.test(texte)) return null;
  if (!/^https?:\/\//i.test(texte)) return null;
  try {
    return new URL(texte).origin;
  } catch (_error) {
    return null;
  }
}

/**
 * Les origines d'un ENSEMBLE de fichiers livrés, avec de quoi juger.
 *
 * @param {Array<{ chemin: string, texte: string }>} fichiers
 * @returns {Map<string, { occurrences: number, fichiers: Set<string>, exemples: string[] }>}
 */
export function originesDesFichiers(fichiers) {
  const parOrigine = new Map();
  for (const fichier of fichiers || []) {
    const texte = String(fichier?.texte ?? '');
    for (const correspondance of texte.matchAll(MOTIF_URL_ABSOLUE)) {
      const origine = origineDeUrl(correspondance[0]);
      if (!origine) continue;
      if (!parOrigine.has(origine)) {
        parOrigine.set(origine, { occurrences: 0, fichiers: new Set(), exemples: [] });
      }
      const entree = parOrigine.get(origine);
      entree.occurrences += 1;
      entree.fichiers.add(String(fichier.chemin || ''));
      if (entree.exemples.length < 3 && !entree.exemples.includes(correspondance[0])) {
        entree.exemples.push(correspondance[0]);
      }
    }
  }
  return parOrigine;
}

/**
 * L'audit : ce qui est NÔTRE, ce qui est CLASSÉ, ce qui ne l'est pas, ce qui est
 * PÉRIMÉ. Aucune E/S — les textes sont passés en clair, ce qui rend la règle
 * éprouvable par mutation.
 *
 * @param {{ fichiers: Array<{chemin: string, texte: string}>, classement?: Array<object> }} sources
 * @returns {{
 *   notres: Array<object>,
 *   classees: Array<object>,
 *   nonClassees: Array<object>,
 *   perimees: Array<object>,
 *   occurrences: number,
 * }}
 */
export function analyserOriginesLivrees({ fichiers, classement = CLASSEMENT_ORIGINES }) {
  const trouvees = originesDesFichiers(fichiers);
  const parOrigine = new Map((classement || []).map((entree) => [entree.origine, entree]));

  const notres = [];
  const classees = [];
  const nonClassees = [];
  let occurrences = 0;

  for (const [origine, info] of trouvees) {
    occurrences += info.occurrences;
    const detail = {
      origine,
      occurrences: info.occurrences,
      fichiers: [...info.fichiers].sort(),
      exemples: info.exemples,
    };
    // `estTiers` porte le contrat : nos origines (site + API) et toute adresse
    // LOOPBACK sont nôtres — aucune n'a besoin d'un motif.
    if (!estTiers(origine)) {
      notres.push(detail);
      continue;
    }
    const entree = parOrigine.get(origine);
    if (entree) {
      classees.push({ ...detail, sorte: entree.sorte, motif: entree.motif, preuve: entree.preuve });
    } else {
      nonClassees.push(detail);
    }
  }

  const perimees = [];
  for (const entree of classement || []) {
    if (!entree.origine || !String(entree.motif || '').trim()) {
      perimees.push({ origine: entree.origine || '(sans origine)', motif: '', preuve: entree.preuve });
      continue;
    }
    if (!trouvees.has(entree.origine)) {
      perimees.push({ origine: entree.origine, motif: entree.motif, preuve: entree.preuve });
    }
  }

  const parOrigineTriee = (a, b) => a.origine.localeCompare(b.origine);
  return {
    notres: notres.sort(parOrigineTriee),
    classees: classees.sort(parOrigineTriee),
    nonClassees: nonClassees.sort(parOrigineTriee),
    perimees: perimees.sort(parOrigineTriee),
    occurrences,
  };
}

/** Schémas loopback et nos deux origines, exposés pour la prose et les tests. */
export const ORIGINES_NOTRES_PAR_CONTRAT = [SITE_ORIGIN, API_ORIGIN, ...LOOPBACK_HOSTS];

/**
 * Ce que CE garde voit, et ce qu'il ne peut pas voir — publié pour être comparé
 * à `CE_QUE_LE_GARDE_STATIQUE_VOIT` (coquilles) et au parcours dynamique, pas
 * pour être cru.
 */
export const CE_QUE_CE_GARDE_VOIT = {
  voit: [
    'toute URL ABSOLUE écrite en clair dans le JS ou le CSS LIVRÉ, y compris dans une branche que personne n’exerce',
    'l’ORIGINE seule (schéma + hôte + port), pas le chemin : c’est la destination qui est jugée, pas la ressource',
    'la répétition : combien d’occurrences, dans combien de fichiers, avec des exemples',
  ],
  nePeutPasVoir: [
    'une URL ASSEMBLÉE à l’exécution dont aucun fragment n’est littéral (`"https://" + hote`…)',
    'une origine chargée par une dépendance depuis un contenu qu’elle télécharge (une carte de tuiles qui en appelle une autre)',
    'l’effet réel d’une occurrence classée : le classement dit POURQUOI elle a le droit d’être là, il ne prouve pas qu’elle est inerte — c’est le parcours dynamique qui le prouve',
    'le HTML des coquilles, qui appartient à `shell-remote-resources.js`',
  ],
};
