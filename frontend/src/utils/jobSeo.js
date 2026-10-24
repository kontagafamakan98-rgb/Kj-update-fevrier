/**
 * Ce que l'application annonce pour une FICHE MISSION (/jobs/:id).
 *
 * Une fiche mission n'est pas une route comme les autres : son titre, sa
 * description et sa carte dépendent d'une DONNÉE, chargée après le montage. Elle
 * ne peut donc pas les lire dans une table (src/config/page-meta.js) comme les
 * routes statiques — sa page les déclare, et c'est ici qu'ils se décident.
 *
 * POURQUOI CETTE FONCTION EXISTE : elle rend le contrat app ↔ pré-rendu
 * vérifiable HORS LIGNE. La même mission est pré-rendue par le backend
 * (backend/kojo_job_og.py — le HTML que lit un crawler sans JavaScript, celui
 * qui porte le titre et la carte partagés) et annoncée par l'application ;
 * scripts/check-job-og-contract.js confronte les deux sur une mission de
 * référence, sans serveur et sans base de données. Avant, ce contrat n'était
 * vérifié qu'en HTTP, contre une mission réellement créée en base.
 *
 * Le formatage (« — Kojo », coupe à 150 points de code suivie de « … ») est donc
 * écrit ICI et dans kojo_job_og.py : deux langages, deux déploiements. C'est
 * exactement cette paire que le garde compare, donc aucune des deux copies ne peut
 * bouger seule.
 *
 * L'UNITÉ de la coupe est un POINT DE CODE, et pas une unité UTF-16 : `slice` et
 * `length` compteraient des unités UTF-16, ce que Python ne fait pas (`[:150]` et
 * `len` comptent des points de code). Tant que le texte reste dans le plan
 * multilingue de base, les deux comptes coïncident — accents compris. Un caractère
 * ASTRAL (emoji hors BMP, deux unités UTF-16) les sépare : la coupe tombait un
 * cran plus tôt d'un côté, et au MILIEU de la paire de surrogates si la frontière
 * était pile dessus — c'est-à-dire un demi-caractère publié dans la balise. La
 * même mission annonçait donc deux descriptions selon le canal (l'onglet et la
 * carte de partage), ce que le jeu de missions de référence du garde éprouve
 * désormais cas par cas (check-job-og-contract.js).
 *
 * @param {{title?: string, description?: string, id?: string}} [job] Mission
 *   chargée — ou, tant qu'elle ne l'est pas, le strict nécessaire : `{ id }`,
 *   parce que la carte ne dépend pas du chargement (l'identifiant de la route
 *   suffit). Les autres champs valent alors '' : une fiche sans titre n'annonce
 *   pas de titre.
 * @returns {{title: string, description: string, card: string, canonicalPath: string}}
 *   Titre et description prêts à publier (chaîne vide = rien à annoncer,
 *   l'appelant garde alors son texte de repli), le CHEMIN de la carte (l'URL
 *   absolue est ajoutée par absoluteUrl — les crawlers l'exigent) et le CHEMIN
 *   canonique de la fiche.
 */

/**
 * La coupe de la description, en POINTS DE CODE. La même valeur vit dans
 * backend/kojo_job_og.py (`DESCRIPTION_LIMIT`) : deux langages, deux déploiements,
 * et c'est la paire que scripts/check-job-og-contract.js compare sur un jeu de
 * missions de référence — donc aucune des deux copies ne peut bouger seule.
 */
export const DESCRIPTION_LIMIT = 150;

/**
 * La description PUBLIÉE : coupée sur le dernier ESPACE de la tranche.
 *
 * MESURÉ le 24/10/2026 sur /jobs/c7b740c2-1be5-40c8-a1f3-f2fec7c807aa : la
 * balise annonçait « … Il faut localiser la fuite, remplacer le. » — les 150
 * premiers points de code, donc un mot tranché et une phrase finissant sur un
 * article. Un moteur qui cite cette phrase la cite telle quelle.
 *
 * La règle est écrite à l'IDENTIQUE dans `couper_description`
 * (backend/kojo_job_og.py) : 150 POINTS DE CODE, puis recul jusqu'au dernier
 * espace — coupe dure seulement s'il n'y en a aucun, et un espace en PREMIÈRE
 * position ne compte pas (reculer à zéro ne publierait que « … »). Un texte
 * plus court que la limite est rendu tel quel, sans « … ».
 */
export const couperDescription = (description) => {
  const texte = description || '';
  const points = Array.from(texte);
  if (points.length <= DESCRIPTION_LIMIT) return texte;
  let tranche = points.slice(0, DESCRIPTION_LIMIT).join('');
  const espace = tranche.lastIndexOf(' ');
  if (espace > 0) tranche = tranche.slice(0, espace);
  return `${tranche}…`;
};

export const jobSeo = (job) => {
  const title = (job && job.title) || '';
  const description = (job && job.description) || '';
  // Coupe identique côté pré-rendu (`couper_description`, kojo_job_og.py), qui
  // coupe AUSSI sur le dernier espace (cf. `couperDescription` ci-dessus) :
  // `Array.from` énumère les POINTS DE CODE, ce qui rend le compte comparable
  // au `list(texte)` de Python — un emoji hors BMP vaut deux unités UTF-16.
  return {
    title: title ? `${title} — Kojo` : '',
    description: couperDescription(description),
    card: job && job.id ? `/api/og/jobs/${job.id}.png` : '',
    // L'URL canonique de la fiche — la même pour le pré-rendu (kojo_job_og.py)
    // et pour le contrat hors ligne (scripts/check-job-og-contract.js). Elle ne
    // dépend pas du chargement (l'identifiant EST dans la route), donc la page
    // l'annonce dès le premier rendu : sans cela, /jobs/:id garderait le
    // canonical « / » d'index.html jusqu'à l'arrivée de la mission — et, en
    // changeant d'identifiant sans remonter le composant, celui de la mission
    // précédente.
    canonicalPath: job && job.id ? `/jobs/${job.id}` : '',
  };
};
