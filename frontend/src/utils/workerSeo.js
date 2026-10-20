/**
 * Ce que l'application annonce pour un PROFIL PUBLIC de travailleur (/workers/:id).
 *
 * Pourquoi ce fichier existe — la même raison que `jobSeo.js`, et la même paire :
 * un profil n'a pas de texte fixe (son titre dépend d'une personne), donc il ne
 * peut pas vivre dans la table des routes (`src/config/page-meta.js`). Il est
 * pré-rendu par le backend (`backend/kojo_worker_og.py`, le document que lit un
 * crawler sans JavaScript) ET annoncé par l'application ; le contrat entre les
 * deux est confronté HORS LIGNE, sans serveur et sans base, par
 * `scripts/check-worker-og-contract.js`.
 *
 * CE QUI SE DÉCIDE ICI, ET NULLE PART AILLEURS :
 *   • le TITRE — nom, métier (première compétence publiée), puis « Kojo » ;
 *   • la DESCRIPTION — bio, compétences, réputation, ville, joints par « · » et
 *     coupés à `DESCRIPTION_LIMIT` POINTS DE CODE (la constante est celle de
 *     `jobSeo.js` : une seule longueur pour les deux pages) ;
 *   • les CHEMINS de la carte et du canonical.
 *
 * L'UNITÉ DE LA COUPE est un point de code, jamais une unité UTF-16 : `slice` et
 * `length` en compteraient deux pour un émoji hors BMP, alors que Python
 * (`[:150]`, `len`) en compte un — la même fiche annoncerait alors deux
 * descriptions selon le canal, et publierait au besoin un demi-caractère. Le
 * garde de contrat éprouve cette frontière sur des caractères astraux.
 *
 * CE QU'ELLE NE PUBLIE PAS : ni email, ni téléphone, ni compte de paiement, ni
 * position. Elle ne les reçoit d'ailleurs pas — la vue publique du backend est
 * une allowlist (`kojo_routers_workers_public.profil_public`), et ces fonctions
 * ne lisent que les champs qu'elle publie.
 */
// Extension EXPLICITE : ce module est aussi importé par un script Node
// (`scripts/check-worker-og-contract.js`), où la résolution ESM n'ajoute pas
// `.js` toute seule. Vite et vitest résolvent les deux formes.
import { DESCRIPTION_LIMIT } from './jobSeo.js';

// Replis : le MÊME texte des deux côtés (backend/kojo_worker_og.py). Un profil
// sans nom, sans bio, sans compétence, sans avis et sans ville n'a rien à dire —
// mais une balise vide se lit comme une page cassée, par un crawler comme par un
// visiteur.
export const FALLBACK_TITLE = 'Travailleur — Kojo';
// Apostrophe TYPOGRAPHIQUE (U+2019), comme toute la copie publiée du site
// (`scripts/published-copy.js`) : une apostrophe droite joint deux lettres sans
// être la bonne, et `check-prerender-shells.js` refuse la copie publiée qui en
// porte une. Le pré-rendu backend écrit la MÊME chaîne avec le même caractère —
// un écart d'octet entre les deux se verrait dans le contrat hors ligne.
export const FALLBACK_DESCRIPTION =
  "Profil d’un travailleur sur Kojo : missions terminées, avis et compétences.";

// Trois compétences suffisent : au-delà, la description devient une liste de
// mots-clés, et la coupe à 150 points de code la tronque de toute façon.
export const MAX_COMPETENCES_DESCRIPTION = 3;

const texte = (valeur) => {
  if (valeur === null || valeur === undefined || typeof valeur === 'boolean') return '';
  return String(valeur).trim();
};

const competences = (worker, maximum) => {
  const brut = worker && worker.skills;
  if (!Array.isArray(brut)) return [];
  const sortie = [];
  for (const element of brut) {
    const valeur = texte(element);
    if (valeur) sortie.push(valeur);
    if (sortie.length >= maximum) break;
  }
  return sortie;
};

const entier = (valeur) => {
  const nombre = Number(valeur);
  return Number.isFinite(nombre) ? Math.trunc(nombre) : 0;
};

/**
 * Note à une décimale, sans « .0 » — le MÊME rendu qu'en Python
 * (`kojo_worker_og._note`) : « 4.8 », « 5 ». Le contrat hors ligne compare les
 * deux sorties, donc ce formatage ne peut pas bouger d'un côté.
 */
const note = (valeur) => {
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) return '';
  const rendu = (Math.round(nombre * 10) / 10).toFixed(1);
  return rendu.endsWith('.0') ? rendu.slice(0, -2) : rendu;
};

export const nomComplet = (worker) => {
  const morceaux = [texte(worker && worker.first_name), texte(worker && worker.last_name)];
  return morceaux.filter(Boolean).join(' ').trim();
};

export const workerSeoTitle = (worker) => {
  const nom = nomComplet(worker);
  if (!nom) return FALLBACK_TITLE;
  const metiers = competences(worker, 1);
  return `${nom} — ${metiers[0] || 'Travailleur'} — Kojo`;
};

export const workerSeoDescription = (worker) => {
  const morceaux = [];

  const bio = texte(worker && worker.bio);
  if (bio) morceaux.push(bio);

  const skills = competences(worker, MAX_COMPETENCES_DESCRIPTION);
  if (skills.length) morceaux.push(`Compétences : ${skills.join(', ')}`);

  const stats = (worker && worker.stats) || {};
  const moyenne = stats.rating_average;
  const nombreAvis = entier(stats.rating_count);
  if (typeof moyenne === 'number' && nombreAvis > 0) {
    morceaux.push(`${note(moyenne)}/5 sur ${nombreAvis} avis`);
  }

  const missions = entier(stats.missions_completed);
  if (missions > 0) {
    const pluriel = missions > 1 ? 's' : '';
    morceaux.push(`${missions} mission${pluriel} terminée${pluriel}`);
  }

  // La VILLE seulement, jamais le pays : `country` stocke une clé machine
  // (« senegal »), et une carte de partage qui imprime « Dakar, senegal » se lit
  // comme un brouillon (même décision côté Python).
  const ville = texte(worker && worker.city);
  if (ville) morceaux.push(ville);

  const complet = morceaux.join(' · ').trim();
  if (!complet) return FALLBACK_DESCRIPTION;
  const points = Array.from(complet);
  return points.length > DESCRIPTION_LIMIT
    ? `${points.slice(0, DESCRIPTION_LIMIT).join('')}…`
    : complet;
};

/**
 * Les deux lignes d'appui (carte OG et page pré-rendue) : réputation, puis
 * ville · compétences. Elles ne sont ni le titre ni la description — ce sont les
 * chiffres qu'un client cherche d'un coup d'œil.
 *
 * @returns {[string, string]} [principale, secondaire]
 */
export const workerMetaLines = (worker) => {
  const stats = (worker && worker.stats) || {};
  const moyenne = stats.rating_average;
  const nombreAvis = entier(stats.rating_count);
  let principale;
  if (typeof moyenne === 'number' && nombreAvis > 0) {
    principale = `${note(moyenne)}/5 · ${nombreAvis} avis`;
  } else {
    const missions = entier(stats.missions_completed);
    if (missions > 0) {
      const pluriel = missions > 1 ? 's' : '';
      principale = `${missions} mission${pluriel} terminée${pluriel}`;
    } else {
      principale = 'Nouveau profil';
    }
  }
  const secondaire = [texte(worker && worker.city), competences(worker, MAX_COMPETENCES_DESCRIPTION).join(', ')]
    .filter(Boolean)
    .join(' · ');
  return [principale, secondaire];
};

/**
 * Tout ce que la page et le pré-rendu annoncent d'un profil.
 *
 * @param {{id?: string, first_name?: string, last_name?: string, bio?: string, city?: string, skills?: string[], stats?: object}} [worker]
 *   Vue PUBLIQUE du travailleur — ou, avant le chargement, le strict nécessaire
 *   `{ id }` : le canonical et la carte ne dépendent pas des données (l'identifiant
 *   EST dans la route), donc ils sont annoncés dès le premier rendu.
 * @returns {{title: string, description: string, card: string, cardSquare: string, canonicalPath: string}}
 */
export const workerSeo = (worker) => {
  const id = texte(worker && worker.id);
  return {
    title: workerSeoTitle(worker),
    description: workerSeoDescription(worker),
    card: id ? `/api/og/workers/${id}.png` : '',
    // La variante carrée est annoncée en second og:image (les réseaux qui
    // recadrent en 1:1) : le pré-rendu publie la paire, le garde de contrat
    // exige qu'elle soit la même des deux côtés.
    cardSquare: id ? `/api/og/workers/${id}-square.png` : '',
    canonicalPath: id ? `/workers/${id}` : '',
  };
};
