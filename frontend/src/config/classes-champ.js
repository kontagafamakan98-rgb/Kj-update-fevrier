/**
 * LE CHAMP D'UN FORMULAIRE DU SITE — une seule définition, lue par les trois
 * écrans qui en portent : /login, /register et /profile.
 *
 * ── Pourquoi ce fichier existe (17/10/2026) ────────────────────────────────
 * Les sous-formulaires de /register et de /profile écrivaient encore le champ
 * d'AVANT la refonte : `border-stone-300` (un gris FROID, que la refonte a
 * remplacé partout par le filet chaud `stone-300`), `rounded-md` (un rayon
 * qu'aucune carte du site ne porte : 8 px partout depuis `.carte-editoriale`),
 * `shadow-xs` et un anneau de focus PLEIN (`ring-orange-500`) qui se lisait
 * comme un état de sélection. Résultat : à l'intérieur d'une carte à filet, les
 * champs peignaient un autre site.
 *
 * Le dessin retenu est celui de /login, déjà mesuré là-bas : filet
 * `stone-300`, fond blanc sur la carte papier, focus à l'anneau orange
 * translucide (30 %). Il est écrit ICI, une fois, et les trois écrans le
 * lisent — une quatrième déclaration aurait fini par diverger, et c'est
 * exactement la famille de défaut que le dépôt passe son temps à fermer.
 *
 * CE QUI N'EST PAS ICI : les hauteurs RÉSERVÉES et les blocs `bloc-differe-*`
 * de /register (src/App.css) ne dépendent pas de ce fichier — le changer ne
 * déplace donc pas les constantes du levier différé. Les gardes de CLS et de
 * LCP se mesurent en navigateur après coup, pas ici.
 *
 * Les valeurs sont des chaînes ENTIÈRES, jamais assemblées : un utilitaire posé
 * par un fragment dynamique échappe au lecteur de classes
 * (`scripts/check-classes-sans-regle.js`), donc il ne prouverait rien.
 */

/** Le champ de base : l'espace au-dessus du libellé est inclus (`mt-1`). */
export const CHAMP =
  'mt-1 block w-full rounded-lg border border-stone-300 fond-papier px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-orange-500 focus:outline-hidden focus:ring-2 focus:ring-orange-500/30';

/**
 * Le même champ SANS la marge du haut : pour une surface qui gère déjà cette
 * marge (le champ de recherche d'une liste déroulante, une cellule de grille).
 */
export const CHAMP_SANS_MARGE =
  'block w-full rounded-lg border border-stone-300 fond-papier px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-orange-500 focus:outline-hidden focus:ring-2 focus:ring-orange-500/30';

/**
 * Le champ d'un groupe indicatif + numéro : même dessin, mais SEUL son coin
 * droit est arrondi — l'indicatif occupe le gauche et porte `rounded-l-lg`.
 * Écrit comme une chaîne propre plutôt que `rounded-lg` + `rounded-r-lg` :
 * deux rayons concurrents se départagent par l'ordre de la feuille, pas par
 * l'ordre des classes, et le gauche resterait arrondi sans qu'on le voie.
 */
export const CHAMP_TELEPHONE =
  'mt-1 block w-full flex-1 rounded-r-lg border border-stone-300 fond-papier px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:border-orange-500 focus:outline-hidden focus:ring-2 focus:ring-orange-500/30';

/** L'indicatif d'un groupe téléphone : le pendant gauche de `CHAMP_TELEPHONE`. */
export const CHAMP_PREFIXE =
  'inline-flex items-center rounded-l-lg border border-r-0 border-stone-300 bg-stone-50 px-3 text-sm text-stone-500';

/**
 * Un déclencheur de LISTE (`CountrySelect`) : même filet et même focus qu'un
 * champ, mais il annonce une ouverture — d'où `justify-between` et `text-left`.
 * La marge du haut est laissée à l'appelant (le composant est monté dans un
 * conteneur qui la porte déjà).
 *
 * ── POURQUOI `.bouton-clair` PLUTÔT QUE `border-stone-300` (17/10/2026) ────
 * Le dessin d'un `<input>` ne vient PAS de ses utilitaires : `form :is(input,
 * select, textarea)` (src/index.css) pose le filet `--kojo-filet` (#e6e1d7), le
 * fond papier et le rayon — et sa spécificité l'emporte sur toute classe.
 * Un déclencheur de liste est un `<button>`, donc il n'est pas couvert : mesuré
 * au navigateur, ses champs voisins peignaient `rgb(230, 225, 215)` quand lui
 * peignait le `stone-300` froid de Tailwind (#d6d3d1), et la rangée montrait
 * deux gris différents. `.bouton-clair` porte DÉJÀ le filet et le fond papier
 * du site (c'est le bouton secondaire des pages claires) : on le lit au lieu
 * d'inventer une seconde teinte, et la rangée n'a qu'un filet.
 */
export const CHAMP_SELECTEUR =
  'bouton-clair flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm text-stone-900 focus:border-orange-500 focus:outline-hidden focus:ring-2 focus:ring-orange-500/30';
