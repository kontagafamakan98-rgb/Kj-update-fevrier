import { test, expect } from '@playwright/test';
// LE CADRE EST LU DANS SON PROPRIÉTAIRE, jamais recopié : `src/config/app-cadres.js`
// déclare la largeur et la gouttière de chaque route d'application, et c'est cette
// déclaration que la sonde confronte à ce que le navigateur peint. Recopier
// `max-w-7xl` ici ferait deux endroits à tenir d'accord, et le premier oublié
// laisserait la sonde verte sur un cadre qui a changé.
import {
  CADRES_APP,
  HAUTEUR_PIED_HORS_ECRAN,
  REGLES_DE_CHARGEMENT,
  REGLES_DE_SQUELETTE,
} from '../src/config/app-cadres.js';
// LE BUDGET CLS AUSSI est lu, jamais recopié : `scripts/lhci-cls-budgets.cjs` porte
// la table mesurée de la CI (un plafond par route, avec son relevé). Deux tables
// divergeraient en silence — et la sonde mesure la MÊME grandeur que la CI.
import budgets from '../scripts/lhci-cls-budgets.cjs';
import { attendreLaStabilite } from './helpers/geometrie.js';
import {
  ESPION_CLS,
  attendreLaFenetreDeSession,
  clsDesDecalages,
  decrireCls,
  decrireDecalage,
} from './helpers/cls.js';
// La connexion par la fixture a UN propriétaire (`helpers/parcours-carte.js`) :
// trois specs en portaient une copie, et une quatrième copie serait un endroit de
// plus à corriger le jour où la page de connexion change de marqueur.
import { connexionALaFixture, COMPTES_DE_LA_FIXTURE } from './helpers/parcours-carte.js';

const CLS_BUDGETS = budgets.CLS_BUDGETS;

/**
 * LA SONDE DES ROUTES CONNECTÉES : leur cadre (largeur, gouttière, centrage) et
 * leur CLS, en navigateur, à travers la connexion à la fixture.
 *
 * ── Le trou qu'elle ferme ──────────────────────────────────────────────────
 * Les cinq routes d'application (`/dashboard`, `/profile`, `/messages`,
 * `/create-job`, `/jobs/:id`) écrivaient leur cadre à la main jusqu'au
 * 07/10/2026, et il avait divergé : cinq largeurs, deux vocabulaires de
 * gouttière (`px-4 sm:px-6 lg:px-8` sur trois pages, `px-4` seul sur deux), un
 * pas de page parfois absent. La déclaration unique (`src/config/app-cadres.js`)
 * et le composant `src/components/CadrePage.js` ont fermé la divergence, mais
 * tout ce qui la vérifiait vivait en jsdom — qui ne calcule AUCUNE mise en page.
 * Une classe `px-4` mal orthographiée, un `mx-auto` perdu, une largeur
 * remplacée par une autre : les quatre tests unitaires restaient verts, parce
 * qu'ils comparent des CHAÎNES. Ici, on mesure la boîte peinte.
 *
 * ── LES CINQ ROUTES DÉCLARÉES SONT SONDÉES (08/10/2026) ────────────────────
 * Les trois premières (tableau de bord, profil, messages) couvraient les trois
 * largeurs déclarées ; les deux suivantes manquaient, et le motif écrit ici
 * (« la fixture ne sait pas les faire rendre ») était devenu FAUX : mesuré, la
 * fixture les fait rendre toutes les deux, et ce qui manquait tenait à UN champ.
 *
 *   • `/jobs/:id` se visite à l'identifiant d'une mission RÉELLE, et la fixture
 *     en sert vingt-cinq (`playtest-job-1`…`25`) : `chemin` dit donc laquelle, et
 *     c'est la seule chose que la sonde devait apprendre. La fiche affichait
 *     « Publié le Date non renseignée » parce que la fixture n'avait pas de
 *     `created_at` — complétée (`scripts/playtest-api-server.mjs`), elle peint sa
 *     date comme en production, et la sonde mesure 40 nœuds de contenu réel.
 *   • `/create-job` est un formulaire qui se peint SANS donnée (aucune requête
 *     retenue ne le fait attendre) : il n'avait donc rien à compléter, seulement
 *     à être mesuré. Ses 48 nœuds sont ceux du formulaire complet, et sa règle
 *     de chargement est `generique` (voir plus bas).
 *
 * Les cinq largeurs déclarées sont maintenant vues : `max-w-7xl` (tableau de
 * bord, fiche de mission), `max-w-4xl` (profil, création de mission) et
 * `max-w-6xl` (messages) — soit trois plafonds et, aux deux tailles sondées,
 * les deux extrémités du vocabulaire de gouttière (`px-4` seul, puis `px-8`).
 *
 * ── Ce qui n'est PAS revérifié ici, et pourquoi ────────────────────────────
 * La GOUTTIÈRE UNIQUE des cinq routes : elle est vraie par construction — les
 * cinq `frameClass` viennent du même propriétaire, et le test unitaire
 * (`src/components/__tests__/cadres-app.test.jsx`) refuse une entrée dont la
 * gouttière diffère. Chaque cas d'ici confronte la gouttière PEINTE à la
 * gouttière ANNONCÉE par la classe ; l'égalité entre routes en découle, et un
 * second parcours serait une redite plus lente, pas une preuve de plus.
 *
 * ── Deux canaux, ou un seul ? ──────────────────────────────────────────────
 * Un seul, et c'est une propriété des routes : elles n'ont pas de coquille
 * pré-rendue (`app.html` en `noindex`), donc il n'y a pas deux peintures à
 * comparer — le protocole « coquille puis React » des autres sondes de
 * géométrie n'a pas de sujet ici. Ce qui reste à mesurer, c'est ce que le
 * navigateur peint après le montage, et c'est ce que ce fichier mesure.
 *
 * ── Le CLS, et pourquoi il compte double ici ───────────────────────────────
 * Ces pages remplacent un SQUELETTE par leur contenu (le chunk de route puis les
 * données) : c'est exactement la fenêtre où un décalage se produit, et c'est la
 * raison pour laquelle le squelette doit partager le cadre ET réserver la hauteur
 * de la page. La mesure n'est donc pas décorative — elle porte sur la phase que le
 * squelette existe pour stabiliser.
 *
 * UNE SEULE EXCEPTION, et elle est mesurée : `/create-job` n'attend AUCUNE donnée
 * (3 requêtes `/api` retenues → 0 pulse, le formulaire peint quand même, cf. sa
 * règle `generique`). Son CLS de 0,0039 ne vient donc pas d'un squelette remplacé
 * mais de la pastille de notifications de la barre du haut, comme partout
 * ailleurs — et son budget (`scripts/lhci-cls-budgets.cjs`) le dit.
 *
 * ── CE QUE LA SONDE A TROUVÉ EN PASSANT, ET LA MESURE QUI LE DIT ───────────
 * Premier relevé, 07/10/2026 : 0,0039 de CLS partout… et **0,1010 sur /profile en
 * desktop**, pour un plafond de 0,06. La source était nommée par la sonde : le
 * pied de page, 1 350×81 px à y=858,9 (donc VISIBLE), puis tiré de ~1 600 px
 * vers le bas quand les données arrivaient — il quittait l'écran, ce que Chrome
 * compte. Aucune passe Lighthouse ne pouvait le voir : la passe desktop n'audite
 * que `/` et `/jobs`, et les plafonds de /profile viennent de la passe MOBILE.
 * Deux causes, toutes deux corrigées le même jour :
 *   • `ProfileSkeleton` ne réservait pas la hauteur de l'écran (le pied de page
 *     venait s'y ancrer pendant le chargement) — il porte désormais
 *     `min-h-[calc(100vh-65px)]`, la règle déjà écrite pour les états de
 *     chargement génériques ;
 *   • il en existait une SECONDE copie, locale à `Profile.js`, et c'est ELLE qui
 *     était peinte pendant le chargement des données — la corriger à sa source
 *     ne servait donc à rien. La copie est supprimée : le squelette a UN
 *     propriétaire, partagé par les deux phases.
 * Après correction, mesuré : **0,0039 sur /profile desktop**, comme partout
 * ailleurs (le reste du décalage est la pastille de notifications de la barre du
 * haut, qui se résout à ~130 ms). Le plafond de 0,06 n'a pas été touché — c'est
 * la page qui a été corrigée, pas le budget.
 *
 * ── LE PIED DE PAGE PENDANT LE CHARGEMENT, ET POURQUOI LE CLS NE SUFFIT PAS ──
 * Le CLS ci-dessus mesure la conséquence, APRÈS coup, et seulement sur UNE
 * taille : il ne dit rien du bas de page pendant le chargement, ni d'une fenêtre
 * qu'aucun parcours ne visite (1 200 px de haut — le cas où /dashboard laissait
 * le pied de page VISIBLE pendant tout le chargement, relevé y=1 119). Les cas
 * « pied de page » ci-dessous mesurent donc la CAUSE, sur le squelette réellement
 * peint : les requêtes de données sont RETENUES (`page.route`) pour que le
 * squelette reste à l'écran, puis on lit la boîte du `<footer>` — il doit
 * démarrer SOUS la ligne de flottaison, sinon il a quelque part où descendre
 * quand les données arrivent, et c'est ce déplacement que Chrome compte.
 *
 * Les deux autres relevés de ces cas, et ce qu'ils ajoutent : (1) le nombre de
 * pulses > 0, sans quoi on mesurerait la PAGE et le cas serait un faux vert, et
 * (2) la hauteur MINIMALE peinte du corps réservé, confrontée à la valeur que la
 * déclaration ANNONCE (`calc(100vh - 65 px)`) — un correctif qui cesserait d'être
 * appliqué (la prop `squelette` perdue, une classe écrasée par une autre) serait
 * vu là, alors qu'un pied de page hors écran par chance ne le serait pas.
 */

/**
 * Les routes connectées que la fixture sait faire rendre, avec le CHEMIN
 * CONCRET sur lequel chacune se visite.
 *
 * Deux champs, et ce n'est pas un détail de forme : `route` est la CLÉ de la
 * déclaration (`src/config/app-cadres.js`) — donc aussi celle du budget CLS —,
 * tandis que `chemin` est ce qu'on ouvre dans le navigateur. `/jobs/:id` est le
 * cas qui l'exige : la clé porte un paramètre, l'URL non, et confondre les deux
 * ferait échouer l'assertion « la navigation a abouti sur la route sondée »
 * (`received: "/jobs/playtest-job-1"`) — ou pire, la ferait passer sur une
 * navigation qui n'a rien à voir avec la route nommée.
 *
 * `chemin` ne doit PAS porter de `:paramètre` : un cas dédié le refuse, sinon la
 * sonde naviguerait vers une URL littérale que le routeur ne peut pas résoudre,
 * et mesurerait la page 404 du site.
 */
export const ROUTES_CONNECTEES = [
  { route: '/dashboard', chemin: '/dashboard' },
  { route: '/profile', chemin: '/profile' },
  { route: '/messages', chemin: '/messages' },
  { route: '/create-job', chemin: '/create-job' },
  // La FICHE DE MISSION EST SONDÉE DEUX FOIS, et ce n'est pas un doublon :
  // `/jobs/:id` n'a aucune longueur maximale (sa hauteur suit la DESCRIPTION),
  // donc son CLS dépend de la TAILLE de l'annonce — et les deux cas opposés
  // doivent être couverts par le MÊME plafond.
  //   • `playtest-job-1` : l'annonce LONGUE de la fixture. La page dépasse la
  //     réserve d'un écran, donc le pied de page, réservé SOUS la ligne de
  //     flottaison, ne remonte pas ;
  //   • `playtest-job-2` : l'annonce COURTE. La réserve dépasse la page, et
  //     c'est le pied de page qui remonte DANS l'écran à l'arrivée des données
  //     — c'est ce cas-là qui a fixé le plafond (0,0166 en desktop).
  // Mesurer le seul cas long laisserait le plus risqué des deux hors du
  // périmètre ; mesurer le seul cas court, l'inverse.
  //
  // `cas` est un LIBELLÉ, pas une clé : la clé de route reste `/jobs/:id` (c'est
  // elle qui porte la déclaration de cadre et le budget), et deux entrées
  // partageraient sinon le même titre de test — deux cas indistinguables dans le
  // rapport.
  { route: '/jobs/:id', chemin: '/jobs/playtest-job-1', cas: 'annonce longue' },
  { route: '/jobs/:id', chemin: '/jobs/playtest-job-2', cas: 'annonce courte' },
];

/**
 * LE PLANCHER DE LECTURE, par route — mesuré, jamais deviné.
 *
 * Relevé du 07/10/2026 (fixture, 412×823 et 1350×940, même compte) : 188 nœuds
 * dans le cadre de /dashboard, 129 dans celui de /profile et 17 dans celui de
 * /messages — l'état VIDE de la messagerie est le plus mince du site par
 * nature, ce qui est la raison pour laquelle un plancher unique aurait été ou
 * trop haut pour elle (un rouge à tort) ou trop bas pour les autres (un vert
 * sans lecture). Chaque valeur vaut ~60 % de la mesure, donc une page qui perd
 * la MOITIÉ de son contenu rougit, tandis qu'un rendu normal garde 1,7× la
 * marge.
 *
 * Une route sondée sans plancher est REFUSÉE (cas dédié) : une route ajoutée
 * demain ne peut pas hériter du plancher d'une autre, elle se mesure.
 */
const PLANCHERS_NOEUDS = {
  '/dashboard': 120,
  '/profile': 80,
  '/messages': 10,
  // Mesurés le 08/10/2026 par la sonde temporaire de la même passe : 48 nœuds
  // pour le formulaire de `/create-job`, 40 pour la fiche de `playtest-job-1`.
  '/create-job': 28,
  '/jobs/:id': 24,
};

/**
 * LE PLANCHER DU PREMIER ÉCRAN, par route — mesuré, jamais deviné (09/10/2026).
 *
 * Deux nombres, et ils ne mesurent pas la même chose : `elements` est le nombre
 * d'éléments de CONTENU (texte direct ou média) visibles sans défiler dans le
 * cadre, `caracteres` la longueur du texte qu'ils portent. Le second existe
 * parce qu'une page peut garder ses icônes et perdre ses phrases : le compte
 * d'éléments ne le verrait pas, la longueur si.
 *
 * Relevé du 09/10/2026 (fixture, 412×823 et 1350×940, même compte) — la valeur
 * retenue est TOUJOURS la plus BASSE des deux tailles, et le plancher vaut ~60 %
 * d'elle, comme `PLANCHERS_NOEUDS` :
 *
 *   route          mobile (élém./car.)   desktop (élém./car.)   plancher retenu
 *   /dashboard     12 / 149              24 / 288                7 /  89
 *   /profile       19 / 275              26 / 436               11 / 165
 *   /messages       4 /  74               5 / 118                2 /  44
 *   /create-job     7 / 139              10 / 227                4 /  83
 *   /jobs/:id      11 / 397              18 / 491                6 / 238
 *
 * (les deux nombres de `/jobs/:id` sont ceux du cas COURT — la fiche brève,
 * qui fixe le plancher : son annonce longue peint 2 856 / 2 952 caractères, soit
 * sept fois la valeur courte, et un plancher calé sur elle ne dirait rien du cas
 * risqué.)
 *
 * LE MOBILE EST LE CONTRAIGNANT sur les cinq routes (fenêtre plus étroite,
 * contenu plus haut) : le plancher est donc un plancher MOBILE, et la valeur
 * desktop garde ~2× la marge. Un plancher de 0 est REFUSÉ (cas de surface) :
 * un zéro est toujours vrai, il ne lit rien de la page.
 *
 * La fiche de mission se visite DEUX FOIS sous la MÊME clé : le plancher est
 * celui de la clé, donc les deux cas lui sont confrontés — c'est voulu, et c'est
 * le cas COURT qui l'impose.
 */
const PLANCHERS_PREMIER_ECRAN = {
  '/dashboard': { elements: 7, caracteres: 89 },
  '/profile': { elements: 11, caracteres: 165 },
  '/messages': { elements: 2, caracteres: 44 },
  '/create-job': { elements: 4, caracteres: 83 },
  '/jobs/:id': { elements: 6, caracteres: 238 },
};

/**
 * LES ROUTES DONT L'ÉTAT DE CHARGEMENT A UN SUJET — la liste du cas « pied de
 * page hors écran », DÉRIVÉE de la déclaration et jamais recopiée.
 *
 * Ce qu'un cas de chargement peut mesurer, c'est un squelette DÉDIÉ, peint dans
 * le cadre de la route et dont les requêtes de données sont RETENUES. Une route
 * déclarée `generique` n'en a pas : sa place d'attente est le `PageSkeleton`
 * partagé du `Suspense` de `App.js`, qui n'a ni cadre ni réserve (il est en
 * `min-h-screen` et il n'attend aucune donnée) — et surtout, il ne dure que le
 * temps du chunk, qu'aucune requête retenue ne prolonge. `pourquoi` le dit déjà
 * dans la déclaration ; la sonde n'a donc rien à mesurer là, et le refus de
 * juger quand même est un cas (une route `generique` qui se retrouverait dans
 * la liste rougirait sur ses pulses).
 *
 * MESURÉ le 08/10/2026 (sonde temporaire, 412×823 / 1350×940) : `/create-job`
 * avec ses trois requêtes `/api` retenues peint **0 pulse**, n'a **aucune
 * réserve**, et sa page fait déjà 1 902 px pour une fenêtre de 823 — le pied de
 * page y était hors écran par la seule taille du formulaire, c'est-à-dire que le
 * cas aurait mesuré LA PAGE : le faux vert exact que son assertion anti-faux-vert
 * existe pour refuser. `/jobs/:id`, lui, peint 19 pulses dans son cadre et
 * annonce 758 / 875 px de réserve : son sujet est bien là.
 *
 * La dérivation est un PLANCHER autant qu'un filtre : un test refuse que cette
 * liste tombe sous trois routes, sinon une déclaration retouchée viderait
 * silencieusement la moitié de la sonde.
 */
export const ROUTES_A_SQUELETTE_PEINT = ROUTES_CONNECTEES.filter(
  ({ route }) => CADRES_APP[route].squelette.regle !== REGLES_DE_SQUELETTE.GENERIQUE
);

/**
 * LES ROUTES DONT L'ÉTAT D'ATTENTE EST LE FALLBACK GÉNÉRIQUE — la liste
 * DÉRIVÉE de la déclaration, exactement le complément de celle ci-dessus.
 *
 * Elles n'ont pas de squelette dédié ET n'attendent aucune donnée : leur seul
 * état d'attente est le repli du `<Suspense>` de `src/App.js` pendant le
 * chargement du CHUNK de la route. C'est donc le chunk — et non `/api/**` — qui
 * est le sujet de la règle pour elles, et le seul cas de chargement qui les
 * atteigne.
 */
export const ROUTES_A_FALLBACK_GENERIQUE = ROUTES_CONNECTEES.filter(
  ({ route }) => CADRES_APP[route].squelette.regle === REGLES_DE_SQUELETTE.GENERIQUE
);

/**
 * LE PRÉFIXE DU CHUNK DE PAGE, par route à repli générique — le nom que Vite
 * donne au fichier de la page (`assets/<Préfixe>-<empreinte>.js`).
 *
 * Il n'est pas DÉRIVABLE de la clé de route (`/create-job` n'écrit nulle part
 * « CreateJob ») : une convention implicite se paierait en silence, le jour où
 * le chunk est renommé. Le motif est donc DÉCLARÉ, il est confronté au build par
 * la sonde elle-même (`retenues > 0` : une requête qui ne correspond à rien est
 * un rouge nommé), et une route générique SANS motif est refusée (cas de
 * surface) — sans lui, elle aurait un cas de chargement perdu sans que rien ne
 * le dise.
 */
const CHUNKS_DE_ROUTE = {
  // `src/App.js` : `const CreateJob = lazy(() => import('./pages/CreateJob'))`
  // → `assets/CreateJob-DsPCDuPl.js` au build du 09/10/2026.
  '/create-job': 'CreateJob',
};

/**
 * Les deux tailles mesurées, les mêmes que partout ailleurs dans le dépôt :
 * 412×823 (le téléphone de référence) et 1350×940 (la fenêtre des relevés de
 * /jobs et /contact). 412 est SOUS le palier `sm` (640) et 1350 est AU-DESSUS de
 * `lg` (1024) : les deux extrémités du vocabulaire de gouttière sont donc
 * exercées, et `px-4` seul comme `px-8` sont vus.
 */
const TAILLES = [
  { nom: 'mobile', viewport: { width: 412, height: 823 } },
  { nom: 'desktop', viewport: { width: 1350, height: 940 } },
];

/** 1 rem = 16 px : la seule constante de conversion, nommée. */
const PX_PAR_REM = 16;

/**
 * Les paliers de Tailwind RÉELLEMENT en jeu, et leur largeur de fenêtre en px.
 * Ce qui est mesuré ici est du CSS mobile-first : un jeton sans préfixe
 * s'applique toujours, `sm:` à partir de 640 px, `lg:` à partir de 1024 px.
 */
const PALIERS_PX = { base: 0, sm: 640, lg: 1024 };

/** Les largeurs maximales de Tailwind, en rem (7xl = 80 rem = 1 280 px). */
const LARGEUR_MAX_REM = { '2xl': 42, '3xl': 48, '4xl': 56, '5xl': 64, '6xl': 72, '7xl': 80 };

/** `px-4` vaut 4 × 0,25 rem, soit 16 px — l'échelle de Tailwind, pas un réglage. */
const PX_PAR_CRAN = 4;

/**
 * La géométrie qu'une `frameClass` ANNONCE, pour une largeur de fenêtre donnée.
 *
 * Elle est LUE dans la chaîne de classes : c'est la déclaration qui décide, et
 * le jour où une page change de `max-w-*` ou gagne un palier de gouttière, c'est
 * l'attente du cas qui change — jamais une constante de sonde à retrouver.
 *
 * Un jeton géométrique INCONNU LÈVE au lieu d'être ignoré : une sonde qui ne
 * saurait pas lire une classe mesurerait « à l'aveugle », c'est-à-dire qu'une
 * retouche du cadre passerait sans que rien ne le dise — le faux vert exact que
 * ce fichier existe pour fermer. Les jetons NON géométriques (`cadre-page`,
 * `min-h-screen`) sont ignorés sans lever : ce sont des pas verticaux, dont la
 * sonde ne juge pas la valeur.
 *
 * @param {string} frameClass La déclaration de `src/config/app-cadres.js`.
 * @param {number} largeurFenetre La largeur de fenêtre mesurée (px CSS).
 * @returns {{gouttiere: number, largeurMax: number, centre: boolean}}
 * @throws {Error} Classe de largeur, de gouttière ou de palier inconnue.
 */
export function geometrieAnnoncee(frameClass, largeurFenetre) {
  let gouttiere = 0;
  let largeurMax = null;
  let centre = false;
  for (const jeton of String(frameClass).split(/\s+/).filter(Boolean)) {
    if (jeton === 'mx-auto') {
      centre = true;
      continue;
    }
    const padding = jeton.match(/^(?:([a-z0-9]+):)?px-(\d+)$/);
    if (padding) {
      const palier = padding[1] || 'base';
      if (!Object.hasOwn(PALIERS_PX, palier)) {
        throw new Error(`palier Tailwind inconnu : « ${jeton} » dans « ${frameClass} »`);
      }
      if (largeurFenetre >= PALIERS_PX[palier]) {
        gouttiere = Math.max(gouttiere, Number(padding[2]) * PX_PAR_CRAN);
      }
      continue;
    }
    const largeur = jeton.match(/^max-w-(\w+)$/);
    if (largeur) {
      if (!Object.hasOwn(LARGEUR_MAX_REM, largeur[1])) {
        throw new Error(`largeur maximale inconnue : « ${jeton} » dans « ${frameClass} »`);
      }
      largeurMax = LARGEUR_MAX_REM[largeur[1]] * PX_PAR_REM;
      continue;
    }
  }
  if (largeurMax === null) throw new Error(`aucune largeur annoncée dans « ${frameClass} »`);
  return { gouttiere, largeurMax, centre };
}

/**
 * Le relevé du cadre, et le CLS du chargement de la route.
 *
 * Le bloc de conteneur est pris sur le PARENT du cadre (`main`, qui n'a pas de
 * rembourrage horizontal) plutôt que sur la fenêtre : `mx-auto` répartit l'espace
 * libre du conteneur, et la largeur de la fenêtre comprend la barre de
 * défilement verticale — 15 px sur un Chromium de bureau, de quoi rendre fausse
 * une attente de centrage calculée sur `innerWidth`.
 */
export const RELEVE_DU_CADRE = () => {
  const arrondi = (valeur) => +valeur.toFixed(2);
  const cadres = [...document.querySelectorAll('.cadre-page')];
  const cadre = cadres[0] || null;
  const boite = (element) => {
    const r = element.getBoundingClientRect();
    return { x: arrondi(r.x), y: arrondi(r.y), l: arrondi(r.width), h: arrondi(r.height) };
  };
  const parent = cadre ? cadre.parentElement : null;
  const styleParent = parent ? getComputedStyle(parent) : null;
  const boiteParent = parent ? parent.getBoundingClientRect() : null;
  const styleCadre = cadre ? getComputedStyle(cadre) : null;
  return {
    url: location.pathname,
    nombreCadres: cadres.length,
    dansMain: Boolean(cadre && cadre.closest('main')),
    cadre: cadre ? boite(cadre) : null,
    paddingGauche: styleCadre ? arrondi(parseFloat(styleCadre.paddingLeft)) : null,
    paddingDroit: styleCadre ? arrondi(parseFloat(styleCadre.paddingRight)) : null,
    contenuParent:
      parent && boiteParent
        ? {
            gauche: arrondi(boiteParent.left + parseFloat(styleParent.paddingLeft)),
            droite: arrondi(boiteParent.right - parseFloat(styleParent.paddingRight)),
          }
        : null,
    noeudsDansCadre: cadre ? cadre.querySelectorAll('*').length : 0,
    // ── LE CONTENU DU PREMIER ÉCRAN, relevé dans la MÊME visite (09/10/2026)
    // « Ce qu'un visiteur voit sans défiler » a une définition, et elle s'écrit
    // ici plutôt que de rester dans une intention : un élément du CADRE dont la
    // boîte INTERSECTE la fenêtre sur les DEUX axes (la même condition que
    // `EST_DANS_LE_VIEWPORT`, `helpers/parcours-carte.js`), qui est PEINT
    // (`display`, `visibility`, `opacity`) et qui PORTE du CONTENU — du texte
    // direct, ou un MÉDIA. Les enveloppes vides ne comptent pas : elles sont
    // innombrables et ne disent rien de ce qu'on voit ; compter TOUS les
    // éléments donnerait un nombre qui ne baisse pas quand le contenu disparaît.
    // Le CADRE est le périmètre, pas `document` : l'en-tête et le pied de page
    // sont le CHROME, identiques sur ces routes, et les compter aplatirait
    // justement la différence que cette mesure existe pour lire.
    //
    // `caracteres` est la MÊME matière comptée en LONGUEUR : une phrase qui
    // disparaîtrait laisserait les mêmes enveloppes peintes, et le seul nombre
    // d'éléments ne la verrait pas. Le plancher porte sur les deux.
    premierEcran: (() => {
      const fenetre = { l: window.innerWidth, h: window.innerHeight };
      const intersecte = (r) =>
        r.bottom > 0 && r.top < fenetre.h && r.right > 0 && r.left < fenetre.l;
      const peint = (element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
      };
      const texteDirect = (element) =>
        [...element.childNodes]
          .filter((noeud) => noeud.nodeType === 3)
          .map((noeud) => noeud.textContent.trim())
          .join(' ');
      const MEDIAS = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'PICTURE']);
      const elements = cadre ? [...cadre.querySelectorAll('*')] : [];
      const peints = [];
      const porteurs = [];
      let caracteres = 0;
      for (const element of elements) {
        const r = element.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || !intersecte(r) || !peint(element)) continue;
        peints.push(element);
        const texte = texteDirect(element);
        if (texte) caracteres += texte.length;
        if (texte || MEDIAS.has(element.tagName)) porteurs.push(element);
      }
      return {
        fenetre,
        // « SANS DÉFILER » est une propriété du relevé, pas un sous-entendu :
        // `scrollY` non nul mesurerait une tranche arbitraire du document.
        defilement: window.scrollY,
        elements: porteurs.length,
        peints: peints.length,
        caracteres,
      };
    })(),
    // ── Le RYTHME, relevé dans la MÊME visite (09/10/2026) ───────────────
    // Les jetons sont RÉSOLUS, jamais lus comme texte de déclaration :
    // `getPropertyValue('--rythme-bloc')` rend `clamp(…)`, pas la longueur
    // utilisée. Une sonde jetable les fait peindre, et disparaît aussitôt.
    jetons: (() => {
      const resoudre = (nom) => {
        const sonde = document.createElement('div');
        sonde.style.cssText = `position:absolute;visibility:hidden;margin-bottom:var(${nom})`;
        document.body.appendChild(sonde);
        const valeur = arrondi(parseFloat(getComputedStyle(sonde).marginBottom));
        sonde.remove();
        return valeur;
      };
      return {
        tete: resoudre('--rythme-tete'),
        bloc: resoudre('--rythme-bloc'),
        carte: resoudre('--rythme-carte'),
      };
    })(),
    // Le pas peint des blocs de PREMIER niveau du cadre — la relation que le
    // relevé du 09/10/2026 a mesurée à 4 · 8 · 16 · 24 · 32 px sur ces routes.
    pasDesBlocs: cadre
      ? [...cadre.children].map((element) => ({
          cls: String(element.className || element.tagName).slice(0, 64),
          mb: arrondi(parseFloat(getComputedStyle(element).marginBottom)),
        }))
      : [],
    // Le rembourrage PEINT de chaque carte et de ses rangées internes : c'est
    // lui qui décide où l'encre commence, pas la classe écrite.
    rembourrages: [...document.querySelectorAll('.cadre-page .carte-editoriale, .cadre-page .carte-publique, .cadre-page .carte-cotes, .cadre-page .encart')]
      .filter((element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          cls: String(element.className || element.tagName).slice(0, 64),
          h: arrondi(parseFloat(style.paddingLeft)),
          v: arrondi(parseFloat(style.paddingTop)),
        };
      }),
    debordement: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    cls: window.__kojoCls
      ? { decalages: window.__kojoCls.decalages, fcp: window.__kojoCls.fcp }
      : null,
  };
};

/**
 * Une route sans budget CLS mesuré ne peut pas être sondée : le refus est un cas.
 *
 * C'est la MÊME règle que celle que la CI applique au chargement de sa config
 * (`clsAssertionMatrix` lève sur une page auditée sans plafond) : sans valeur
 * mesurée, la page serait sondée SANS plafond — donc un décalage réintroduit
 * passerait, et rien ne le dirait.
 */
test('budgets CLS — chaque route connectée sondée a un plafond MESURÉ', () => {
  expect(
    ROUTES_CONNECTEES.length,
    'la sonde ne sonderait rien : sa liste de routes est vide'
  ).toBeGreaterThanOrEqual(5);
  const sansBudget = ROUTES_CONNECTEES.filter(({ route }) => !Object.hasOwn(CLS_BUDGETS, route));
  expect(
    sansBudget.map(({ route }) => route),
    `route(s) connectée(s) sans budget CLS dans scripts/lhci-cls-budgets.cjs : ${sansBudget
      .map(({ route }) => route)
      .join(', ')} — ` +
      'mesurer la page (cette sonde publie son relevé) puis l’ajouter à la table. Sans valeur mesurée, la ' +
      'route serait sondée SANS plafond : un décalage réintroduit passerait, et rien ne le dirait.'
  ).toEqual([]);
  // Une route sondée sans cadre déclaré ferait lever `geometrieAnnoncee` dans le
  // cas, mais le refus est plus lisible ici : la sonde ne saurait pas quoi peindre.
  const sansCadre = ROUTES_CONNECTEES.filter(({ route }) => !Object.hasOwn(CADRES_APP, route));
  expect(
    sansCadre.map(({ route }) => route),
    `route(s) sans cadre déclaré dans src/config/app-cadres.js : ${sansCadre.map(({ route }) => route).join(', ')}`
  ).toEqual([]);
  // Le plancher de lecture n'hérite pas : une route ajoutée demain se mesure.
  const sansPlancher = ROUTES_CONNECTEES.filter(({ route }) => !Object.hasOwn(PLANCHERS_NOEUDS, route));
  expect(
    sansPlancher.map(({ route }) => route),
    `route(s) sans plancher de lecture : ${sansPlancher.map(({ route }) => route).join(', ')} — mesurer (cette sonde publie son ` +
      'relevé) puis l’ajouter à PLANCHERS_NOEUDS. Un plancher hérité ne dirait rien du contenu de la page.'
  ).toEqual([]);
  // Le plancher du PREMIER ÉCRAN non plus n'hérite pas — et il est refusé à
  // ZÉRO : `elements: 0` ou `caracteres: 0` rendrait l'assertion toujours vraie,
  // c'est-à-dire un plancher qui ne lit rien (le faux vert exact que la table
  // existe pour fermer).
  const sansPlancherEcran = ROUTES_CONNECTEES.filter(
    ({ route }) => !Object.hasOwn(PLANCHERS_PREMIER_ECRAN, route)
  );
  expect(
    sansPlancherEcran.map(({ route }) => route),
    `route(s) sans plancher de premier écran : ${sansPlancherEcran.map(({ route }) => route).join(', ')} — ` +
      'mesurer (cette sonde publie son relevé) puis l’ajouter à PLANCHERS_PREMIER_ECRAN, comme pour les nœuds : ' +
      'un plancher hérité ne dirait rien de ce que la page montre sans défiler.'
  ).toEqual([]);
  const planchersVides = [...new Set(ROUTES_CONNECTEES.map(({ route }) => route))].filter((route) => {
    const plancher = PLANCHERS_PREMIER_ECRAN[route];
    return !plancher || !(plancher.elements > 0) || !(plancher.caracteres > 0);
  });
  expect(
    planchersVides,
    `route(s) dont le plancher de premier écran est nul ou absent : ${planchersVides.join(', ') || 'aucune'} — ` +
      'un plancher de 0 est toujours satisfait : il ne lit rien de la page.'
  ).toEqual([]);
  // ── LE REPLI GÉNÉRIQUE A SON CAS, ET IL LUI FAUT SON MOTIF ────────────
  // Le cas « chunk retenu » ne juge que les routes à repli générique (liste
  // DÉRIVÉE de la déclaration), et il ne peut rien retenir sans le préfixe du
  // chunk que le build publie pour elles. Une route générique sans motif serait un
  // cas de chargement PERDU en silence ; un motif dont la route n'est plus en
  // repli générique est une ligne périmée, qui survivrait à la décision qu'elle
  // décrit. Le plancher, lui, dit que la sonde rejoue la décision écrite pour
  // `/create-job` : faire disparaître la dernière route générique demande donc de
  // retirer AUSSI cette ligne — la décision ne peut pas s'évaporer en silence.
  expect(
    ROUTES_A_FALLBACK_GENERIQUE.length,
    'aucune route à repli générique : le cas « chunk retenu » aurait zéro cas et ne jugerait plus rien '
  ).toBeGreaterThanOrEqual(1);
  const generiquesSansChunk = ROUTES_A_FALLBACK_GENERIQUE.filter(
    ({ route }) => !Object.hasOwn(CHUNKS_DE_ROUTE, route)
  );
  expect(
    generiquesSansChunk.map(({ route }) => route),
    `route(s) à repli générique sans préfixe de chunk : ${generiquesSansChunk
      .map(({ route }) => route)
      .join(', ')} — ajouter l’entrée à CHUNKS_DE_ROUTE : le cas retient le chunk de la route, sans quoi il ` +
      'mesurerait une navigation ordinaire.'
  ).toEqual([]);
  const chunksOrphelins = Object.keys(CHUNKS_DE_ROUTE).filter(
    (route) => !ROUTES_A_FALLBACK_GENERIQUE.some((entree) => entree.route === route)
  );
  expect(
    chunksOrphelins,
    `préfixe(s) de chunk déclaré(s) pour une route qui n’est plus en repli générique : ` +
      `${chunksOrphelins.join(', ')} — une ligne périmée de la table des chunks décrirait encore une ` +
      'décision qui a changé.'
  ).toEqual([]);
  // LE CHEMIN EST CONCRET. Un `chemin` qui garderait le paramètre de la clé
  // ferait naviguer la sonde vers une URL littérale (`/jobs/:id`), que le routeur
  // ne résout pas : elle mesurerait alors une page dont elle ne parle pas.
  const avecParametre = ROUTES_CONNECTEES.filter(({ chemin }) => chemin.includes(':'));
  expect(
    avecParametre.map(({ chemin }) => chemin),
    `chemin(s) sondé(s) portant encore un paramètre : ${avecParametre.map(({ chemin }) => chemin).join(', ')} — ` +
      'la sonde doit visiter une URL RÉELLE (la clé reste la clé, pour la déclaration et le budget).'
  ).toEqual([]);
  // Et le PLANCHER de la liste de chargement : dériver le filtre ne doit pas
  // pouvoir vider le cas « pied de page hors écran » sans que rien ne le dise.
  expect(
    ROUTES_A_SQUELETTE_PEINT.length,
    `${ROUTES_CONNECTEES.length - ROUTES_A_SQUELETTE_PEINT.length} route(s) hors du cas de chargement ` +
      `(${ROUTES_CONNECTEES.map(({ route }) => route).join(', ')}) : il n'en resterait que ` +
      `${ROUTES_A_SQUELETTE_PEINT.length}, trop peu pour que la sonde de chargement juge quoi que ce soit.`
  ).toBeGreaterThanOrEqual(3);
  // ── LA FICHE DE MISSION EST SONDÉE DANS SES DEUX CAS ──────────────────
  // Un plafond unique couvre deux pages qui n'ont rien à voir : celle d'une
  // annonce longue (le pied de page ne remonte pas) et celle d'une annonce
  // courte (le pied de page remonte). Perdre le SECOND — le seul qui sollicite
  // vraiment le plafond — laisserait la route verte sur le cas qui ne la met pas
  // à l'épreuve. La liste est confrontée à la FIXTURE, pas à un compte : deux
  // entrées quelconques ne suffiraient pas.
  const casDeLaFiche = ROUTES_CONNECTEES.filter(({ route }) => route === '/jobs/:id').map(
    ({ chemin }) => chemin
  );
  expect(
    casDeLaFiche,
    `la fiche de mission n'est sondée que dans ${casDeLaFiche.length} cas ` +
      `(${casDeLaFiche.join(', ') || 'aucun'}) — sa hauteur suit la description, donc ses DEUX cas ` +
      'doivent être mesurés : l’annonce courte est le seul des deux qui fasse remonter le pied de page, ' +
      'c’est-à-dire le seul qui mette le plafond à l’épreuve.'
  ).toEqual(['/jobs/playtest-job-1', '/jobs/playtest-job-2']);
});

/**
 * LE FILTRE SAIT MORDRE — et il ne mord que sur la règle `generique`.
 *
 * Sans ces cas, une retouche de la dérivation (comparer à la mauvaise règle, ou
 * garder tout le monde) ferait entrer `/create-job` dans le cas de chargement, où
 * il rougirait sur `pulses = 0` — un rouge d'outillage qui accuserait la page.
 * Ici le filtre est appliqué à deux déclarations synthétiques, donc éprouvé sans
 * toucher à la vraie table.
 */
test('le filtre du cas de chargement écarte la règle `generique`, et seulement elle', () => {
  const gardees = (regles) =>
    [{ route: '/synthetique', chemin: '/synthetique' }].filter(
      ({ route }) => regles[route].squelette.regle !== REGLES_DE_SQUELETTE.GENERIQUE
    );
  const avec = (regle) => ({ '/synthetique': { squelette: { regle } } });
  expect(gardees(avec(REGLES_DE_SQUELETTE.GENERIQUE))).toEqual([]);
  expect(gardees(avec(REGLES_DE_SQUELETTE.PIED_HORS_ECRAN))).toHaveLength(1);
  expect(gardees(avec(REGLES_DE_SQUELETTE.REPLIQUE))).toHaveLength(1);
  // Et sur la vraie déclaration : la seule route écartée est bien `/create-job`.
  const ecartees = ROUTES_CONNECTEES.filter(
    ({ route }) => !ROUTES_A_SQUELETTE_PEINT.some((gardee) => gardee.route === route)
  );
  expect(ecartees.map(({ route }) => route)).toEqual(['/create-job']);
});

/**
 * Ouvre la route CONNECTÉE dans une page neuve et rend le relevé complet.
 *
 * Le protocole, et pourquoi il est dans cet ordre :
 *   1. la session d'abord (`connexionALaFixture` attend l'URL du tableau de
 *      bord — la redirection est ce qui PROUVE que le jeton est posé ; sans
 *      elle, la sonde mesurerait l'écran de connexion) ;
 *   2. l'espion CLS ENSUITE, et c'est un point de mesure, pas un détail : posé
 *      AVANT la connexion, il enregistrerait aussi les décalages de la page de
 *      connexion, et le relevé de /dashboard ne décrirait plus /dashboard. Posé
 *      après, il ne voit que le document de la route — le même relevé que celui
 *      qu'une navigation directe produirait ;
 *   3. la route par une navigation RÉELLE (`goto`), pas par un lien de
 *      l'application : c'est une page neuve, comme celle que la CI audite.
 */
async function releverLaRoute(browser, route, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await connexionALaFixture(page, COMPTES_DE_LA_FIXTURE[0].email);
    await page.addInitScript(ESPION_CLS);
    await page.goto(route);
    // Deux échantillons de mise en page égaux, puis la fermeture de la fenêtre
    // de session CLS (1 s sans décalage — la règle de la MÉTRIQUE, pas une marge
    // d'attente : elle se termine dès qu'elle est vraie). Voir `helpers/cls.js`.
    await attendreLaStabilite(page);
    await attendreLaFenetreDeSession(page);
    const releve = await page.evaluate(RELEVE_DU_CADRE);
    // Le relevé CLS est APLATI ici, et ce n'est pas cosmétique : `clsDesDecalages`
    // remplace `cls` (l'objet brut) par sa VALEUR, donc les décalages et le FCP
    // sont remontés au premier niveau pour rester lisibles par les cas — sans
    // quoi `releve.cls.fcp` serait `undefined` et le refus de faux vert ne
    // pourrait plus lire son sujet.
    const brut = releve.cls || { decalages: [], fcp: null };
    return { ...releve, decalages: brut.decalages, fcp: brut.fcp, ...clsDesDecalages(brut.decalages) };
  } finally {
    await page.close();
  }
}

/**
 * Ce que les cas « pied de page » lisent PENDANT le chargement : la boîte du
 * pied de page, celle de la fenêtre, la hauteur minimale PEINTE de la réserve
 * et le nombre de pulses.
 *
 * La réserve est trouvée par SA CLASSE (`reserve-pied-hors-ecran`, écrite dans
 * `src/index.css`) et sa hauteur minimale est lue en pixels RÉSOLUS : c'est la
 * valeur qui a un effet, jamais la chaîne de classes. Ce n'est pas un détail de
 * style — un utilitaire Tailwind arbitraire (`min-h-[calc(100vh-65px)]`) a été
 * utilisé d'abord, et `calc()` sans espaces autour du `-` est du CSS INVALIDE :
 * la classe était posée, le build était vert, et la réserve valait 0 px. La
 * mesure porte donc sur la hauteur calculée par le navigateur, seule capable de
 * distinguer « la classe est là » de « la place est réservée ».
 *
 * `reservePresente` dit si la classe est portée DU TOUT : une route en RÉPLIQUE
 * n'en porte aucune, et c'est un état légitime — pas un oubli.
 */
export const RELEVE_DU_CHARGEMENT = () => {
  const arrondi = (valeur) => +valeur.toFixed(2);
  const cadre = document.querySelector('.cadre-page');
  const pied = document.querySelector('footer');
  // La réserve est cherchée dans `main`, PAS dans le cadre : /payment n'a AUCUN
  // `.cadre-page` (son cadre est déclaré dans son plan à deux canaux) et sa
  // réserve vit donc directement dans `main` — la chercher dans le cadre aurait
  // annoncé « aucune réserve posée » sur une route qui en pose une.
  const reserve = document.querySelector('main .reserve-pied-hors-ecran');
  const styleReserve = reserve ? getComputedStyle(reserve) : null;
  return {
    url: location.pathname,
    // L'URL COMPLÈTE, en plus du chemin : les branches de /payment ne diffèrent
    // que par leur CHAÎNE DE RECHERCHE (`?job_id=…`), et c'est elle qui décide de
    // ce qui est réservé — un relevé qui ne publierait que `pathname` ne
    // pourrait pas dire laquelle des deux branches a été mesurée.
    urlComplete: location.pathname + location.search,
    fenetre: { l: window.innerWidth, h: window.innerHeight },
    // Le repli GÉNÉRIQUE ne publie AUCUN `.cadre-page` (c'est le `PageSkeleton`
    // partagé) : `pulses` ci-dessous, scopé au cadre, y vaut donc 0 — mesuré,
    // pas supposé. Les deux champs qui suivent existent pour ce cas-là :
    // `cadrePresent` prouve qu'on regarde bien l'état d'attente et non la page,
    // et `pulsesDansMain` compte les pulses du repli, qui vivent dans `main`.
    cadrePresent: Boolean(cadre),
    pulsesDansMain: document.querySelectorAll('main .animate-pulse').length,
    pulses: document.querySelectorAll('.cadre-page .animate-pulse').length,
    // LE TITRE DE LA PAGE, comme repère de « c'est la page, pas son état
    // d'attente » : le repli dédié de /payment ne publie AUCUN `<h1>` (il peint
    // des barres grises), donc un titre VIDE pendant le retrait du chunk prouve
    // qu'on mesure le repli — et un titre non vide après, que la page est
    // arrivée. Le repère est publié (jamais un booléen nu) : un rouge doit
    // pouvoir nommer ce qu'il a lu.
    titre: (() => {
      const h1 = document.querySelector('main h1');
      return h1 ? String(h1.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    })(),
    pied: pied
      ? (() => {
          const r = pied.getBoundingClientRect();
          return { y: arrondi(r.y + window.scrollY), h: arrondi(r.height) };
        })()
      : null,
    piedHorsEcran: pied ? pied.getBoundingClientRect().top >= window.innerHeight : null,
    // La BOÎTE de `main`, en plus de celle du pied de page : la hauteur du
    // contenu est ce que l'état de chargement de /payment doit égaler à sa
    // destination (le pied de page, lui, n'en est que la conséquence visible :
    // il vaut `main` + la barre de navigation). Publier les deux laisse un rouge
    // nommer LAQUELLE des deux grandeurs a bougé.
    main: document.querySelector('main')
      ? (() => {
          const r = document.querySelector('main').getBoundingClientRect();
          return { y: arrondi(r.y + window.scrollY), h: arrondi(r.height) };
        })()
      : null,
    reservePresente: Boolean(reserve),
    reserveHauteurPx: reserve ? arrondi(reserve.getBoundingClientRect().height) : null,
    minHeightPx: styleReserve ? arrondi(parseFloat(styleReserve.minHeight)) : null,
  };
};

/** La hauteur minimale qu'annonce `HAUTEUR_PIED_HORS_ECRAN` : la fenêtre moins
 * la barre de navigation collée (65 px, `h-16` plus sa bordure). */
export const HAUTEUR_RESERVE_PX = (hauteurFenetre) => hauteurFenetre - 65;

/**
 * Ouvre la route avec ses requêtes de données RETENUES, et rend le relevé du
 * squelette peint.
 *
 * Ce qui est retenu (`/api/**`) et ce qui ne l'est PAS (`/auth/me`) : le second
 * porte la session — le retenir ferait échouer la connexion au lieu de peindre
 * un squelette. Le relâchement est dans le `finally`, avec la fermeture de la
 * page : une requête jamais relâchée laisserait le worker Playwright attendre sa
 * fin, et le cas suivant paierait cette attente.
 */
async function releverSousChargement(browser, route, viewport) {
  const page = await browser.newPage({ viewport });
  const retenues = [];
  let retenir = true;
  try {
    await connexionALaFixture(page, COMPTES_DE_LA_FIXTURE[0].email);
    await page.route(
      (url) => url.href.includes('/api/') && !url.href.includes('/auth/me'),
      (requete) => {
        if (retenir) retenues.push(requete);
        else requete.continue();
      }
    );
    await page.goto(route);
    await page.waitForSelector('.cadre-page .animate-pulse', { timeout: 15000 });
    return await page.evaluate(RELEVE_DU_CHARGEMENT);
  } finally {
    retenir = false;
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // déjà relâchée, ou page fermée : rien à faire.
      }
    }
    await page.close();
  }
}

/**
 * Ouvre la route avec le CHUNK DE SA PAGE RETENU, puis le relâche, et rend les
 * deux états peints plus le CLS de la transition.
 *
 * Pourquoi ce protocole et non celui de `releverSousChargement` : une route en
 * repli générique n'attend AUCUNE donnée, donc retenir ses requêtes `/api` ne
 * peint rien de plus qu'une navigation ordinaire (mesuré : 0 pulse dans le
 * cadre, le formulaire se peint quand même, cf. la déclaration de la route).
 * Son seul état d'attente est le repli du `<Suspense>` de `src/App.js` pendant
 * le chargement du chunk de la route — c'est donc le CHUNK qu'il faut retenir,
 * et le relâchement qui suit EST la transition à mesurer.
 *
 * L'espion CLS est posé AVANT le retrait : sans cela, la seule transition où
 * cette route peut bouger serait mesurée à l'aveugle — et sur une navigation
 * ordinaire, ce repli n'est même jamais peint (React résout le chunk avant la
 * première peinture), donc le CLS d'une navigation ordinaire ne peut pas juger.
 * Le relâchement est dans le `finally` : une requête jamais relâchée laisserait
 * le worker Playwright attendre sa fin.
 */
async function releverSousChunkRetenu(browser, chemin, viewport, motif) {
  const page = await browser.newPage({ viewport });
  const retenues = [];
  try {
    await connexionALaFixture(page, COMPTES_DE_LA_FIXTURE[0].email);
    await page.addInitScript(ESPION_CLS);
    await page.route(motif, (requete) => {
      retenues.push(requete);
    });
    await page.goto(chemin, { waitUntil: 'commit' });
    // On attend le REPLI **ou** la page, jamais le repli seul : si le chunk
    // n'était pas retenu (motif périmé), le repli peut n'être jamais peint —
    // attendre son seul sélecteur donnerait un timeout MUET là où les cas
    // veulent un rouge qui NOMME la cause (`retenues` à zéro).
    await page.waitForFunction(
      () => document.querySelector('main .animate-pulse') || document.querySelector('.cadre-page'),
      { timeout: 15000 }
    );
    await attendreLaStabilite(page);
    const pendant = await page.evaluate(RELEVE_DU_CHARGEMENT);
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // déjà relâchée, ou page fermée : rien à faire.
      }
    }
    await page.waitForSelector('.cadre-page', { timeout: 20000 });
    await attendreLaStabilite(page);
    const apres = await page.evaluate(RELEVE_DU_CHARGEMENT);
    await attendreLaFenetreDeSession(page);
    const brut = await page.evaluate(() =>
      window.__kojoCls
        ? { decalages: window.__kojoCls.decalages, fcp: window.__kojoCls.fcp }
        : { decalages: [], fcp: null }
    );
    return { pendant, apres, retenues: retenues.length, fcp: brut.fcp, ...clsDesDecalages(brut.decalages) };
  } finally {
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // déjà relâchée : rien à faire.
      }
    }
    await page.close();
  }
}

/** Les `max` décalages d'un relevé, du plus grand au plus petit. */
const plusGrands = (releve, max = 3) =>
  [...(releve.decalages || [])].sort((a, b) => b.valeur - a.valeur).slice(0, max);

test.describe('Parcours E2E — le pied de page reste hors de l’écran pendant le chargement', () => {
  for (const { route, chemin, cas } of ROUTES_A_SQUELETTE_PEINT) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route}${cas ? ` (${cas})` : ''} — ${taille}`, async ({ browser }) => {
        const declaration = CADRES_APP[route].squelette;
        const releve = await releverSousChargement(browser, chemin, viewport);

        // ── Anti-faux-vert n° 0 : la route chargée est bien CELLE-CI ──────
        // Une session perdue renvoie vers /login, dont le squelette de
        // chargement satisfait aussi « il y a un cadre et des pulses » : le cas
        // serait alors vert sur une page qui n'est pas la sienne, à la seule
        // condition que la page de connexion laisse son pied de page plus bas.
        expect(
          releve.url,
          `${route} (${taille}) : la navigation retenue a abouti sur ${releve.url} — la sonde décrit un ` +
            'autre écran que celui qu’elle nomme.'
        ).toBe(chemin);

        // ── Anti-faux-vert n° 1 : du SQUELETTE était bien peint ────────────
        // Sans ce contrôle, un hôte rapide mesurerait la PAGE (dont le pied de
        // page est évidemment hors écran sur ces routes) et le cas serait vert
        // sans avoir jamais regardé ce qu'il nomme.
        expect(
          releve.pulses,
          `${route} (${taille}) : ${releve.pulses} pulse(s) au moment du relevé — le squelette n’était pas ` +
            'peint, donc le cas mesurerait la page et non l’état de chargement.'
        ).toBeGreaterThan(0);

        console.log(
          `ℹ️  ${route} (${taille}) PENDANT : pied ${releve.pied.h} px à y=${releve.pied.y} ` +
            `(${releve.piedHorsEcran ? 'HORS écran' : 'VISIBLE'}) · fenêtre ${releve.fenetre.h} px · ` +
            `${releve.pulses} pulses · réserve ${releve.minHeightPx} px peinte ${releve.reserveHauteurPx} px ` +
            `(règle : ${declaration.regle})`
        );

        // ── LE SUJET : le pied de page démarre SOUS la ligne de flottaison ──
        expect(
          releve.piedHorsEcran,
          `${route} (${taille}) : le pied de page est VISIBLE (y=${releve.pied.y} pour une fenêtre de ` +
            `${releve.fenetre.h} px) pendant le chargement — il a donc quelque part où descendre quand les ` +
            `données arrivent, et ce déplacement est exactement ce que Chrome compte. Règle déclarée pour ` +
            `cette route : « ${declaration.regle} » (${declaration.pourquoi ? 'mesure dans app-cadres.js' : 'AUCUNE RAISON ÉCRITE'}).`
        ).toBe(true);

        // ── La réserve ANNONCÉE est celle qui est PEINTE ──────────────────
        // Seulement pour les routes qui en déclarent une : `/messages` tient la
        // règle inverse (réplique exacte de sa page, donc pas de réserve — sur
        // une fenêtre plus haute que la page, réserver ferait ENTRER le pied de
        // page dans l’écran au lieu de le laisser tranquille).
        if (declaration.hauteurClass) {
          const attendue = HAUTEUR_RESERVE_PX(releve.fenetre.h);
          expect(
            releve.reservePresente,
            `${route} (${taille}) : aucun élément « .${declaration.hauteurClass} » dans le cadre — la réserve ` +
              'déclarée par la route n’est pas posée (prop `squelette` perdue, ou classe écrite ailleurs).'
          ).toBe(true);
          expect(
            releve.minHeightPx,
            `${route} (${taille}) : la réserve annonce ${releve.minHeightPx} px de hauteur minimale pour ` +
              `${attendue} px attendus (fenêtre ${releve.fenetre.h} − barre 65). Une valeur de 0 px est le ` +
              'signe d’une règle CSS INVALIDE : c’est le cas de `calc(100vh-65px)`, que Tailwind recopie ' +
              'verbatim et que le navigateur rejette (espaces obligatoires autour du `-`).'
          ).toBeCloseTo(attendue, 0);
          expect(
            releve.reserveHauteurPx,
            `${route} (${taille}) : la réserve PEINT ${releve.reserveHauteurPx} px de haut pour une hauteur ` +
              `minimale de ${releve.minHeightPx} px — ` +
              '`min-height` ne s’applique pas (élément en flux avec une hauteur plus grande, ou règle battue).'
          ).toBeGreaterThanOrEqual(releve.minHeightPx - 1);
        } else {
          expect(
            declaration.regle,
            `${route} (${taille}) : la route ne réserve rien alors que sa règle dite est ` +
              `« ${declaration.regle} » — une réplique n’est légitime que si la hauteur de la page ne dépend ` +
              'pas de ses données (mesure à l’appui, dans src/config/app-cadres.js).'
          ).toBe(REGLES_DE_SQUELETTE.REPLIQUE);
          expect(
            releve.reservePresente,
            `${route} (${taille}) : la route est déclarée en RÉPLIQUE et porte pourtant une réserve d’écran — ` +
              'sur une fenêtre plus haute que sa page, la réserve ferait ENTRER le pied de page au lieu de le ' +
              'laisser tranquille.'
          ).toBe(false);
        }
      });
    }
  }
});

/**
 * LE REPLI GÉNÉRIQUE TIENT LA RÈGLE PENDANT LE CHUNK DE SA ROUTE — et ce cas
 * existe parce que c'est la MESURE QUI A DÉCIDÉ de la règle `generique`.
 *
 * ── Pourquoi le CHUNK, et non `/api/**` ─────────────────────────────────
 * Le cas « pied de page hors écran » ci-dessus retient les requêtes de DONNÉES,
 * ce qui peint le squelette DÉDIÉ d'une route. Une route en repli générique n'a
 * pas de squelette dédié ET n'attend aucune donnée : ses requêtes `/api`
 * retenues ne peignent rien de plus. Son SEUL état d'attente est le repli du
 * `<Suspense>` pendant le chargement du chunk de la route — c'est donc le chunk
 * qui est le sujet, et c'est lui que ce cas retient.
 *
 * ── Ce qu'il mesure, et pourquoi c'est DÉCISIF ──────────────────────────
 * Un squelette a une raison d'être : que rien ne bouge quand la page arrive.
 * Deux nombres le disent, mesurés dans la même visite :
 *   • la position du pied de page PENDANT le retrait du chunk — il doit démarrer
 *     SOUS la ligne de flottaison (mesuré : y=984 pour une fenêtre de 823 en
 *     mobile, y=1005 pour 940 en desktop, soit 22 px sous la barre et son
 *     rembourrage) ;
 *   • le CLS du RELÂCHEMENT — c'est-à-dire de l'arrivée de la page — parce qu'un
 *     chargement ordinaire ne peint JAMAIS ce repli sur cet hôte (React résout le
 *     chunk avant la première peinture) : le CLS d'une navigation ordinaire ne
 *     dit donc rien du remplacement et ne peut pas décider.
 * Si l'un des deux manquait, un squelette dédié serait la réponse (réserve
 * `HAUTEUR_PIED_HORS_ECRAN`, comme `/dashboard`, `/profile` et `/jobs/:id`) —
 * c'est écrit dans la déclaration de la route, et c'est ce cas qui le rejouerait.
 */
test.describe('Parcours E2E — le repli GÉNÉRIQUE tient la règle pendant le chunk de sa route', () => {
  for (const { route, chemin, cas } of ROUTES_A_FALLBACK_GENERIQUE) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route}${cas ? ` (${cas})` : ''} — ${taille}`, async ({ browser }) => {
        const budget = CLS_BUDGETS[route] ? CLS_BUDGETS[route].max : null;
        expect(
          budget,
          `${route} (${taille}) : aucun budget CLS mesuré dans scripts/lhci-cls-budgets.cjs — la route ne ` +
            'peut pas être sondée sans plafond.'
        ).not.toBeNull();
        const prefixe = CHUNKS_DE_ROUTE[route];
        const motif = new RegExp(`/assets/${prefixe}[\\w.-]*\\.js$`);
        const releve = await releverSousChunkRetenu(browser, chemin, viewport, motif);

        // ── Anti-faux-vert n° 0 : le chunk a bien été RETENU ───────────────
        // Sans ce contrôle, un motif qui ne nomme plus le fichier produit par le
        // build laisserait la page se charger normalement : le cas mesurerait
        // une navigation ordinaire et serait vert sans avoir rien retenu.
        expect(
          releve.retenues,
          `${route} (${taille}) : aucune requête retenue pour « ${prefixe} » — le motif (${motif}) ne nomme ` +
            'plus le chunk que le build publie pour cette page, donc le repli n’a jamais été peint et le cas ' +
            'mesurerait la PAGE.'
        ).toBeGreaterThan(0);

        // ── Anti-faux-vert n° 1 : c'est bien le REPLI qui est peint ────────
        // `.cadre-page` n'existe que sur la page : s'il est là, le chunk n'était
        // pas retenu (ou l'a été trop tard) et la règle serait vérifiée sur la
        // mauvaise peinture. Les pulses, eux, prouvent que le repli est là.
        expect(
          releve.pendant.url,
          `${route} (${taille}) : le chargement retenu a abouti sur ${releve.pendant.url} — la sonde décrit ` +
            'un autre écran que celui qu’elle nomme.'
        ).toBe(chemin);
        expect(
          releve.pendant.cadrePresent,
          `${route} (${taille}) : un \`.cadre-page\` est peint alors que le chunk est RETENU — la sonde mesure ` +
            'donc la PAGE, pas son état d’attente.'
        ).toBe(false);
        expect(
          releve.pendant.pulsesDansMain,
          `${route} (${taille}) : ${releve.pendant.pulsesDansMain} pulse(s) dans \`main\` pendant le retrait du ` +
            'chunk — le repli du `<Suspense>` n’était pas peint, donc le cas mesurerait une page vide.'
        ).toBeGreaterThan(0);

        // ── LE SUJET : la règle est tenue PENDANT le retrait du chunk ──────
        expect(
          releve.pendant.piedHorsEcran,
          `${route} (${taille}) : le pied de page est VISIBLE (y=${releve.pendant.pied.y} pour une fenêtre de ` +
            `${releve.pendant.fenetre.h} px) pendant le chargement du chunk — le repli générique ne tient donc ` +
            'pas la règle, et un squelette dédié (réserve `HAUTEUR_PIED_HORS_ECRAN`) serait la réponse.'
        ).toBe(true);

        console.log(
          `ℹ️  ${route} (${taille}) CHUNK RETENU : repli ${releve.pendant.pulsesDansMain} pulses · ` +
            `pied ${releve.pendant.pied.h} px à y=${releve.pendant.pied.y} ` +
            `(${releve.pendant.piedHorsEcran ? 'HORS écran' : 'VISIBLE'}) pour une fenêtre de ` +
            `${releve.pendant.fenetre.h} px · ${releve.retenues} requête(s) retenue(s) · ` +
            `CLS du relâchement ${releve.cls.toFixed(4)} pour ${budget}`
        );
        for (const decalage of plusGrands(releve)) {
          console.log(`      · décalage : ${decrireDecalage(decalage)}`);
        }

        // ── Et l'arrivée de la page ne déplace rien de visible ─────────────
        expect(
          releve.apres.cadrePresent,
          `${route} (${taille}) : après relâchement du chunk, aucun \`.cadre-page\` — la page n’est pas arrivée, ` +
            'donc le CLS mesuré ne décrit pas le remplacement.'
        ).toBe(true);
        expect(
          releve.fcp,
          `${route} (${taille}) : premier paint absent — le CLS relevé ne décrit rien.`
        ).not.toBeNull();
        expect(
          releve.cls,
          `${route} (${taille}) : le remplacement du repli par la page déplace celle-ci de ` +
            `${releve.cls.toFixed(4)} pour un plafond de ${budget} (scripts/lhci-cls-budgets.cjs : ` +
            `${CLS_BUDGETS[route].mesure}).\n      ${decrireCls(releve.cls, releve)}\n` +
            plusGrands(releve)
              .map((decalage) => `      · ${decrireDecalage(decalage)}`)
              .join('\n') +
            '\n      Un décalage dont une source est DANS `main` est le signal qu’un squelette dédié apporterait ' +
            'ce que le repli générique n’apporte pas — corriger la DÉCLARATION de la route, pas le plafond.'
        ).toBeLessThanOrEqual(budget);
      });
    }
  }
});

test.describe('Parcours E2E — le cadre et le CLS des routes connectées, par la fixture', () => {
  for (const { route, chemin, cas } of ROUTES_CONNECTEES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route}${cas ? ` (${cas})` : ''} — ${taille}`, async ({ browser }) => {
        const budget = CLS_BUDGETS[route] ? CLS_BUDGETS[route].max : null;
        expect(
          budget,
          `${route} (${taille}) : aucun budget CLS mesuré dans scripts/lhci-cls-budgets.cjs — la route ne ` +
            'peut pas être sondée sans plafond.'
        ).not.toBeNull();

        const releve = await releverLaRoute(browser, chemin, viewport);

        // ── Anti-faux-vert n° 1 : la route a bien été ATTEINTE ─────────────
        // Une redirection (session perdue, route protégée) mesurerait une autre
        // page, avec un cadre qui n'est pas celui qu'on croit juger. Le CHEMIN
        // concret est confronté, pas la clé : `/jobs/:id` visite
        // `/jobs/playtest-job-1`, et c'est cette URL-là qui doit être au bout.
        expect(
          releve.url,
          `${route} (${taille}) : la navigation a abouti sur ${releve.url} — la sonde mesurerait une autre ` +
            'page que celle qu’elle nomme.'
        ).toBe(chemin);

        // ── Anti-faux-vert n° 2 : il y a UN cadre, et il porte du contenu ──
        expect(
          releve.nombreCadres,
          `${route} (${taille}) : ${releve.nombreCadres} élément(s) \`.cadre-page\` — un cadre par page, ni ` +
            'zéro (la déclaration n’est pas lue) ni deux (un squelette qui ne s’est pas démonté).'
        ).toBe(1);
        expect(releve.dansMain, `${route} (${taille}) : le cadre doit vivre dans \`main\``).toBe(true);
        expect(
          releve.noeudsDansCadre,
          `${route} (${taille}) : ${releve.noeudsDansCadre} nœud(s) dans le cadre — trop peu pour décrire une ` +
            'page rendue (état d’erreur, squelette figé ou contenu non monté).'
        ).toBeGreaterThanOrEqual(PLANCHERS_NOEUDS[route]);
        expect(releve.cadre.h, `${route} (${taille}) : cadre de ${releve.cadre.h} px de haut`).toBeGreaterThan(200);

        // ── LE CONTENU DU PREMIER ÉCRAN — ce qu'un visiteur voit SANS DÉFILER ─
        // Le plancher est PAR ROUTE et lu dans la déclaration ci-dessus. Trois
        // contrôles l'encadrent, et les deux premiers sont des anti-faux-vert :
        // la fenêtre mesurée doit être celle qui a été DEMANDÉE (sinon « le
        // premier écran » ne désignerait pas la bonne hauteur), le relevé doit
        // avoir été pris SANS défilement (un `scrollY` non nul mesurerait une
        // tranche arbitraire du document), et les DEUX nombres du contenu — le
        // compte d'éléments ET la longueur du texte — sont confrontés au leur :
        // une page peut garder ses icônes et perdre ses phrases, et le seul
        // compte d'éléments ne le verrait pas.
        const plancherEcran = PLANCHERS_PREMIER_ECRAN[route];
        expect(
          releve.premierEcran.fenetre,
          `${route} (${taille}) : le relevé a mesuré une fenêtre de ` +
            `${releve.premierEcran.fenetre.l}×${releve.premierEcran.fenetre.h} px pour ` +
            `${viewport.width}×${viewport.height} demandés — « le premier écran » ne décrit pas la bonne taille.`
        ).toEqual({ l: viewport.width, h: viewport.height });
        expect(
          releve.premierEcran.defilement,
          `${route} (${taille}) : le relevé a été pris à scrollY=${releve.premierEcran.defilement} — ` +
            'ce n’est plus « ce qu’un visiteur voit sans défiler », c’est une tranche arbitraire du document.'
        ).toBe(0);
        expect(
          releve.premierEcran.elements,
          `${route} (${taille}) : ${releve.premierEcran.elements} élément(s) de contenu visible(s) sans ` +
            `défiler pour un plancher de ${plancherEcran.elements} — la page montre moins que ce qu’elle ` +
            'montrait au relevé du 09/10/2026 (état d’erreur, bloc non monté, ou contenu sorti du cadre).'
        ).toBeGreaterThanOrEqual(plancherEcran.elements);
        expect(
          releve.premierEcran.caracteres,
          `${route} (${taille}) : ${releve.premierEcran.caracteres} caractère(s) de texte visible(s) sans ` +
            `défiler pour un plancher de ${plancherEcran.caracteres} — le compte d’éléments peut tenir avec ` +
            'des icônes seules ; c’est la LONGUEUR qui dit que la page parle encore.'
        ).toBeGreaterThanOrEqual(plancherEcran.caracteres);

        // ── La géométrie ANNONCÉE, puis la géométrie PEINTE ────────────────
        const annonce = geometrieAnnoncee(CADRES_APP[route].frameClass, viewport.width);
        expect(
          annonce.centre,
          `${route} : la déclaration « ${CADRES_APP[route].frameClass} » ne dit pas \`mx-auto\` — un cadre ` +
            'colle alors au bord gauche au lieu d’être centré.'
        ).toBe(true);

        const largeurContenu = releve.contenuParent.droite - releve.contenuParent.gauche;
        // LA GOUTTIÈRE EST INTERNE AU CADRE, et c'est ce qui change tout :
        // `px-4` est un `padding`, donc il n'enlève rien à la BOÎTE du cadre —
        // il décale son CONTENU. La boîte, elle, prend toute la largeur du
        // conteneur que son plafond lui laisse, et `mx-auto` répartit le reste.
        // Confondre les deux ferait attendre une boîte de « conteneur − 2 ×
        // gouttière », soit 32 px de trop sur un téléphone (mesuré).
        const largeurAttendue = Math.min(annonce.largeurMax, largeurContenu);
        const margeGauche = releve.cadre.x - releve.contenuParent.gauche;
        const margeDroite = releve.contenuParent.droite - (releve.cadre.x + releve.cadre.l);

        console.log(
          `ℹ️  ${route} (${taille}) : cadre ${releve.cadre.l}×${releve.cadre.h} px à (${releve.cadre.x}, ` +
            `${releve.cadre.y}) · conteneur ${largeurContenu} px centré [${margeGauche} / ${margeDroite}] · ` +
            `gouttière peinte ${releve.paddingGauche}/${releve.paddingDroit} px pour ${annonce.gouttiere} annoncée ` +
            `· plafond ${annonce.largeurMax} px · ${releve.noeudsDansCadre} nœuds · CLS ${releve.cls.toFixed(4)} ` +
            `pour ${budget} (${CLS_BUDGETS[route].mesure})`
        );
        for (const decalage of plusGrands(releve)) {
          console.log(`      · décalage : ${decrireDecalage(decalage)}`);
        }
        console.log(
          `      · premier écran : ${releve.premierEcran.elements} élément(s) de contenu visible(s) ` +
            `(dont ${releve.premierEcran.caracteres} caractères) sur ${releve.premierEcran.peints} ` +
            `élément(s) peint(s), dans ${releve.premierEcran.fenetre.l}×${releve.premierEcran.fenetre.h}`
        );

        expect(
          releve.paddingGauche,
          `${route} (${taille}) : gouttière gauche peinte ${releve.paddingGauche} px pour ` +
            `${annonce.gouttiere} px annoncés par « ${CADRES_APP[route].frameClass} » — la classe n’a pas ` +
            'l’effet qu’elle déclare (palier inactif, classe écrasée, ou rembourrage écrit ailleurs).'
        ).toBeCloseTo(annonce.gouttiere, 2);
        expect(releve.paddingDroit, `${route} (${taille}) : gouttière droite asymétrique`).toBeCloseTo(
          annonce.gouttiere,
          2
        );
        expect(
          releve.cadre.l,
          `${route} (${taille}) : cadre de ${releve.cadre.l} px — attendu ${largeurAttendue} px (` +
            `min(plafond ${annonce.largeurMax}, conteneur ${largeurContenu}))`
        ).toBeCloseTo(largeurAttendue, 2);
        expect(
          Math.abs(margeGauche - margeDroite),
          `${route} (${taille}) : marges ${margeGauche} / ${margeDroite} px — le cadre n’est pas centré.`
        ).toBeLessThanOrEqual(0.5);

        // ── La page ne déborde pas horizontalement ─────────────────────────
        // Une gouttière absente ou une largeur mal contrainte se voit ici avant
        // de se voir ailleurs : c'est la conséquence visible du défaut que la
        // déclaration unique a fermé (`px-4` seul au-delà de 640 px).
        expect(
          releve.debordement.scrollWidth,
          `${route} (${taille}) : le document déborde (${releve.debordement.scrollWidth} px de contenu pour ` +
            `${releve.debordement.clientWidth} px de fenêtre).`
        ).toBeLessThanOrEqual(releve.debordement.clientWidth + 1);

        // ── Le CLS du chargement de la route ───────────────────────────────
        // ── LE RYTHME : les pas et les rembourrages lisent les JETONS ──────
        //
        // Ce que le relevé du 09/10/2026 a mesuré (RAPPORT-RYTHME-EDITORIAL.md,
        // §3, §4, §8) : ces cinq routes écrivaient leur pas en utilitaires FIXES
        // — 32, 24, 16 et 8 px, dont trois qu’aucun jeton ne produit — et le
        // rembourrage d’une seule carte sur cinq lisait `--rythme-carte`.
        // Aucun garde ne le voyait : la sonde de cadre DÉCLARAIT cet angle mort
        // (« les jetons NON géométriques sont ignorés sans lever »). Les règles
        // ci-dessous le ferment, chacune avec sa contrepartie anti-faux-vert.
        const permisMb = [0, releve.jetons.tete, releve.jetons.bloc];
        const pres = (valeur, permis) => permis.some((p) => Math.abs(valeur - p) < 0.6);

        expect(
          releve.jetons.tete,
          `${route} (${taille}) : le jeton \`--rythme-tete\` ne se résout pas en pixels — la sonde ` +
            'jetable n’a rien peint, donc les règles de rythme ne jugeraient rien.'
        ).toBeGreaterThan(0);
        expect(
          releve.pasDesBlocs.length,
          `${route} (${taille}) : aucun bloc de premier niveau lu dans le cadre — le relevé du pas ` +
            'serait vert sur une page vide.'
        ).toBeGreaterThanOrEqual(1);
        // La contrepartie n’a de sens que s’il y a UN pas à juger : `/profile`
        // n’a qu’un bloc de premier niveau (sa carte, qui est le dernier — donc
        // sans marge), et exiger un pas là reviendrait à demander à une page
        // d’une seule section d’espacer quelque chose. Les quatre autres routes
        // en portent au moins un, et c’est mesuré.
        if (releve.pasDesBlocs.length > 1) {
          expect(
            releve.pasDesBlocs.filter((bloc) => bloc.mb > 0).length,
            `${route} (${taille}) : ${releve.pasDesBlocs.length} blocs de premier niveau et AUCUN ne ` +
              'porte de pas — le jeton n’est donc lu nulle part, et un zéro de mort ne prouve rien.'
          ).toBeGreaterThanOrEqual(1);
        }
        for (const bloc of releve.pasDesBlocs) {
          expect(
            pres(bloc.mb, permisMb),
            `${route} (${taille}) : le bloc « ${bloc.cls} » laisse ${bloc.mb} px avant le suivant — ` +
              `aucun jeton ne produit cette valeur (tête ${releve.jetons.tete} / bloc ${releve.jetons.bloc}). ` +
              'Un pas fixe est faux à l’une des deux extrémités de l’échelle : la classe `.bloc-app` (ou ' +
              '`.tete-app` pour un en-tête) lit le jeton, un `mb-*` ne le lit pas.'
          ).toBe(true);
        }

        expect(
          releve.rembourrages.length,
          `${route} (${taille}) : aucune carte visible lue — le rembourrage ne serait jugé sur rien.`
        ).toBeGreaterThanOrEqual(1);
        for (const carte of releve.rembourrages) {
          expect(
            pres(carte.v, [0, releve.jetons.carte]) || Math.abs(carte.h - releve.jetons.carte) < 0.6,
            `${route} (${taille}) : la carte « ${carte.cls} » rembourre ${carte.v} px en tête et ` +
              `${carte.h} px à gauche pour un jeton de ${releve.jetons.carte} px — un rembourrage fixe ` +
              's’écarte du jeton d’autant plus que la fenêtre grandit. `carte-publique` le lit ; ' +
              'une rangée interne d’une carte le lit en HORIZONTAL par `carte-cotes`.'
          ).toBe(true);
        }

        expect(
          releve.fcp,
          `${route} (${taille}) : premier paint absent — le CLS relevé ne décrit rien.`
        ).not.toBeNull();
        expect(
          releve.cls,
          `${route} (${taille}) : le chargement déplace la page de ${releve.cls.toFixed(4)} pour un plafond de ` +
            `${budget} (scripts/lhci-cls-budgets.cjs : ${CLS_BUDGETS[route].mesure}).\n` +
            `      ${decrireCls(releve.cls, releve)}\n` +
            plusGrands(releve)
              .map((decalage) => `      · ${decrireDecalage(decalage)}`)
              .join('\n') +
            '\n      Corriger la STABILITÉ (le squelette doit partager le cadre ET la hauteur de la page), ' +
            'pas le budget.'
        ).toBeLessThanOrEqual(budget);
      });
    }
  }
});

/**
 * LES ROUTES À REPLI DÉDIÉ DONT LE CADRE EST DÉCLARÉ AILLEURS (09/10/2026).
 *
 * /payment a une COQUILLE pré-rendue : son cadre appartient à
 * `src/config/page-sections.js` (les deux canaux de cette route lisent le même
 * plan, et un test unitaire refuse son entrée dans `CADRES_APP`). Sa RÈGLE DE
 * CHARGEMENT, elle, est purement React — une coquille n'a aucun état de
 * chargement à publier — et elle a été écrite dans le plan SANS POUVOIR Y
 * RESTER : `npm run build` a REFUSÉ la coquille de /payment en réclamant
 * « pied-hors-ecran », que le plan déclarait alors comme un texte à publier
 * (contrat de `page-sections.js` : « un plan ne porte AUCUNE donnée interne : ce
 * qu'il déclare est publié par la coquille, sans exception »).
 *
 * Elle vit donc chez le propriétaire des règles de chargement,
 * `REGLES_DE_CHARGEMENT` (`src/config/app-cadres.js`), sous la MÊME forme que
 * `CADRES_APP[route].squelette` — et c'est ce cas-ci qui la rejoue, au même
 * protocole que les routes de `CADRES_APP` (chunk de la route retenu puis
 * relâché), parce que la mesure qui a décidé de la règle n'a de valeur que si
 * elle est rejouée.
 */
export const ROUTES_A_REPLI_HORS_CADRE = [{ route: '/payment', chemin: '/payment' }];

/**
 * LE PRÉFIXE DU CHUNK DE PAGE, par route à repli dédié hors cadre — le nom que
 * Vite donne au fichier de la page (`assets/<Préfixe>-<empreinte>.js`).
 *
 * Même contrat que `CHUNKS_DE_ROUTE`, et pour la même raison : il n'est pas
 * DÉRIVABLE de la clé de route, une route sans motif serait un cas de chargement
 * perdu en silence (elle mesurerait une navigation ordinaire), et un motif
 * orphelin décrirait une décision qui a changé. Les deux refus sont des cas de
 * surface.
 */
const CHUNKS_DES_REPLIS_HORS_CADRE = {
  // `src/App.js` : `const Payment = lazy(() => import('./pages/Payment'))`
  // → `assets/Payment-Csiv17TS.js` au build du 09/10/2026.
  '/payment': 'Payment',
};

test('les replis dédiés hors cadre sont DÉCLARÉS, avec leur motif de chunk et leur plafond', () => {
  expect(
    ROUTES_A_REPLI_HORS_CADRE.length,
    'cette liste est vide : le cas de chargement ne jugerait rien'
  ).toBeGreaterThanOrEqual(1);

  const sansRegle = ROUTES_A_REPLI_HORS_CADRE.filter(
    ({ route }) => !Object.hasOwn(REGLES_DE_CHARGEMENT, route)
  );
  expect(
    sansRegle.map(({ route }) => route),
    `route(s) à repli dédié sans règle déclarée dans REGLES_DE_CHARGEMENT (src/config/app-cadres.js) : ` +
      `${sansRegle.map(({ route }) => route).join(', ')} — une règle non déclarée ne tient rien, et le cas ` +
      'de chargement n’aurait rien à comparer.'
  ).toEqual([]);

  // La règle est CONNUE, la raison est une MESURE, et la réserve suit la règle :
  // les trois exigences que `cadres-app.test.jsx` applique à CADRES_APP, ici sur
  // la table des routes dont le cadre est ailleurs.
  for (const { route } of ROUTES_A_REPLI_HORS_CADRE) {
    const { regle, hauteurClass, pourquoi } = REGLES_DE_CHARGEMENT[route];
    expect(
      Object.values(REGLES_DE_SQUELETTE),
      `${route} : règle « ${regle} » inconnue du vocabulaire (REGLES_DE_SQUELETTE).`
    ).toContain(regle);
    expect(
      String(pourquoi || ''),
      `${route} : la raison déclarée ne porte AUCUNE mesure — « une règle est une mesure, pas une intention ».`
    ).toMatch(/px/);
    if (regle === REGLES_DE_SQUELETTE.PIED_HORS_ECRAN) {
      expect(
        hauteurClass,
        `${route} : règle « pied-hors-ecran » sans la réserve déclarée — la classe qui place le pied de page ` +
          `sous la ligne de flottaison est « ${HAUTEUR_PIED_HORS_ECRAN} ».`
      ).toBe(HAUTEUR_PIED_HORS_ECRAN);
    }
  }

  const sansChunk = ROUTES_A_REPLI_HORS_CADRE.filter(
    ({ route }) => !Object.hasOwn(CHUNKS_DES_REPLIS_HORS_CADRE, route)
  );
  expect(
    sansChunk.map(({ route }) => route),
    `route(s) à repli dédié sans préfixe de chunk : ${sansChunk.map(({ route }) => route).join(', ')} — sans ` +
      'lui, le cas retiendrait n’importe quoi et mesurerait une navigation ordinaire.'
  ).toEqual([]);
  const chunksOrphelins = Object.keys(CHUNKS_DES_REPLIS_HORS_CADRE).filter(
    (route) => !ROUTES_A_REPLI_HORS_CADRE.some((entree) => entree.route === route)
  );
  expect(
    chunksOrphelins,
    `préfixe(s) de chunk déclaré(s) pour une route qui n’a plus de repli dédié ici : ${chunksOrphelins.join(', ')}`
  ).toEqual([]);

  const sansBudget = ROUTES_A_REPLI_HORS_CADRE.filter(({ route }) => !Object.hasOwn(CLS_BUDGETS, route));
  expect(
    sansBudget.map(({ route }) => route),
    `route(s) sans budget CLS dans scripts/lhci-cls-budgets.cjs : ${sansBudget.map(({ route }) => route).join(', ')} — ` +
      'sans valeur mesurée, la route serait sondée sans plafond.'
  ).toEqual([]);

  // Et leur cadre n'est PAS dans CADRES_APP : il appartient à leur plan (deux
  // canaux). Le déclarer ici demanderait un `CadrePage` que ces routes n'ont pas
  // — `cadres-app.test.jsx` le refuse de l'autre côté, ce cas-ci le dit de ce
  // côté.
  const dansCadres = ROUTES_A_REPLI_HORS_CADRE.filter(({ route }) => Object.hasOwn(CADRES_APP, route)).map(
    ({ route }) => route
  );
  expect(
    dansCadres,
    `route(s) déclarée(s) à la fois ici et dans CADRES_APP : ${dansCadres.join(', ')} — le cadre d’une route a UN ` +
      'propriétaire, et ces routes-là ont une coquille (leur plan).'
  ).toEqual([]);
});

/**
 * Ouvre la route avec le CHUNK DE SA PAGE RETENU, puis le relâche : le repli
 * dédié est peint pour de bon, et la transition mesurée EST le relâchement.
 *
 * Pourquoi ce protocole pour /payment : sa page n'attend pas toujours de donnée
 * (la branche « mission requise » n'en a aucune) et son repli est celui du
 * `<Suspense>` de `src/App.js`. Retenir `/api/**` peindrait l'ÉTAT DE CHARGEMENT
 * DE LA PAGE, qui n'est pas le sujet ici (celui-là est mesuré et corrigé : cf.
 * `src/pages/Payment.js` et son propriétaire `src/utils/paymentBranche.js`). Le
 * sujet est le sort du pied de page quand la page n'existe pas encore.
 *
 * Le repère de « page arrivée » n'est pas `.cadre-page` (cette route n'en a pas)
 * mais le TITRE : le repli peint des barres grises, la page peint son `<h1>`.
 * Le relâchement est dans le `finally` : une requête jamais relâchée laisserait
 * le worker Playwright attendre sa fin.
 */
async function releverLeRepliDedie(browser, chemin, viewport, motif) {
  const page = await browser.newPage({ viewport });
  const retenues = [];
  try {
    await connexionALaFixture(page, COMPTES_DE_LA_FIXTURE[0].email);
    await page.addInitScript(ESPION_CLS);
    await page.route(motif, (requete) => {
      retenues.push(requete);
    });
    await page.goto(chemin, { waitUntil: 'commit' });
    // Le REPLI **ou** la page, jamais le repli seul : un motif périmé doit donner
    // un rouge qui NOMME la cause (`retenues` à zéro), pas une attente muette.
    await page.waitForFunction(
      () => document.querySelector('main .animate-pulse') || document.querySelector('main h1'),
      { timeout: 15000 }
    );
    await attendreLaStabilite(page);
    const pendant = await page.evaluate(RELEVE_DU_CHARGEMENT);
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // déjà relâchée, ou page fermée : rien à faire.
      }
    }
    await page.waitForFunction(
      () => Boolean(document.querySelector('main h1')) && document.querySelectorAll('main .animate-pulse').length === 0,
      { timeout: 20000 }
    );
    await attendreLaStabilite(page);
    const apres = await page.evaluate(RELEVE_DU_CHARGEMENT);
    await attendreLaFenetreDeSession(page);
    const brut = await page.evaluate(() =>
      window.__kojoCls
        ? { decalages: window.__kojoCls.decalages, fcp: window.__kojoCls.fcp }
        : { decalages: [], fcp: null }
    );
    return { pendant, apres, retenues: retenues.length, fcp: brut.fcp, ...clsDesDecalages(brut.decalages) };
  } finally {
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // rien à faire.
      }
    }
    await page.close();
  }
}

/**
 * LE REPLI DÉDIÉ DE /payment TIENT LA RÈGLE PENDANT LE CHUNK DE SA ROUTE.
 *
 * Deux nombres, mesurés dans la même visite : la position du pied de page
 * PENDANT le chargement — il doit démarrer SOUS la ligne de flottaison, sinon il
 * a quelque part où descendre quand la page arrive, et c'est ce déplacement que
 * Chrome compte — et le CLS du RELÂCHEMENT (l'arrivée de la page). Et la réserve
 * PEINTE est confrontée à celle qui est ANNONCÉE, comme pour les routes de
 * `CADRES_APP` : un correctif qui cesserait d'être appliqué (déclaration non
 * lue, `min-height` battue, règle CSS invalide) serait vu là, alors qu'un pied
 * de page hors écran par chance ne le serait pas.
 *
 * Relevé du 09/10/2026 (chunk retenu puis relâché, connexion à la fixture,
 * 412×823 et 1350×940) : pied de page à y=1019 (mobile, fenêtre 823) et y=1004
 * (desktop, 940) — HORS écran aux DEUX tailles, réserve peinte 758 / 875 px —
 * puis 765,4 / 859 à l'arrivée de la page, CLS 0,0218 / 0,0132 pour un plafond
 * de 0,06. Le témoin SANS la réserve (même journée) laissait le pied de page
 * VISIBLE en desktop pendant tout le chargement (y=859, déjà à sa place finale)
 * pour un CLS de 0,0148 : c'est ce témoin qui a décidé la déclaration.
 */
/**
 * LES DEUX BRANCHES DE CHARGEMENT DE LA PAGE /payment — celles que l'URL décide,
 * mesurées l'une CONTRE l'autre (09/10/2026).
 *
 * La règle que ces cas tiennent est celle de `src/utils/paymentBranche.js` :
 * `carteMissionRequise()` ne lit QUE l'URL, donc la page — et son état de
 * chargement — sait, AVANT que la moindre donnée n'arrive, laquelle de ses deux
 * destinations elle peint. C'est ce qui permet d'affirmer, et de vérifier, que
 * l'état de chargement réserve ce que SA branche montrera :
 *
 *   • `mission requise` (aucun paramètre) — la destination est la carte
 *     « mission requise », qui ne porte AUCUNE carte de paiement. L'état de
 *     chargement doit donc faire EXACTEMENT la hauteur de sa destination ; c'est
 *     le correctif du 09/10/2026 (`src/pages/Payment.js`), dont le défaut était
 *     mesuré : 1 376,4 px de `main` pour une destination de 700,4 en mobile,
 *     ~630 px de cartes réservées qui n'apparaissent jamais, le pied de page
 *     remontant DANS l'écran à l'arrivée des données (CLS 0,0579, nommé sur
 *     `<footer>`).
 *   • `mission` (`?job_id=…`) — la destination porte le formulaire ET les cartes
 *     de paiement : le même état de chargement les RÉSERVE (12 pulses, au lieu
 *     de 0). Même règle, résultat inverse — et c'est cette CONTREPARTIE qui
 *     empêche de « corriger » le cas court en rétrécissant le repli sous la
 *     hauteur de sa destination (le défaut mesuré à 0,0801 : `main` à 617 px, le
 *     pied de page inséré dans l'écran dès le chargement).
 *
 * `reserveLesCartes` et `hauteurDeLaDestination` ne sont pas des commentaires :
 * ce sont les deux faits mesurés ci-dessus, et les cas les confrontent au
 * navigateur sur les DEUX tailles. La surface les vérifie aussi (deux branches,
 * deux issues opposées, la branche courte déclarée à la hauteur de sa
 * destination).
 */
export const BRANCHES_DE_PAYMENT = [
  { branche: 'mission requise', chemin: '/payment', reserveLesCartes: false, hauteurDeLaDestination: true },
  {
    branche: 'mission',
    chemin: '/payment?job_id=playtest-job-1',
    reserveLesCartes: true,
    hauteurDeLaDestination: false,
  },
];

/**
 * L'état de chargement de la PAGE /payment : ses requêtes de données sont
 * RETENUES (`/api/**`, sauf `/auth/me` qui porte la session), donc la page est
 * peinte avec SON PROPRE squelette — et non le repli de `<Suspense>`, qui est le
 * sujet de l'autre describe (là c'est le chunk qui est retenu).
 *
 * Le repère de « on regarde bien la page » est le TITRE : il est peint dans les
 * deux états de cette route (le repli, lui, ne publie aucune `<h1>`), donc un
 * titre vide signalerait qu'on mesure autre chose que la page.
 *
 * Le relâchement est dans le `finally` : une requête jamais relâchée laisserait
 * le worker Playwright attendre sa fin.
 */
async function releverLEtatDeChargementDeLaPage(browser, chemin, viewport) {
  const page = await browser.newPage({ viewport });
  const retenues = [];
  let retenir = true;
  try {
    await connexionALaFixture(page, COMPTES_DE_LA_FIXTURE[0].email);
    await page.addInitScript(ESPION_CLS);
    await page.route(
      (url) => url.href.includes('/api/') && !url.href.includes('/auth/me'),
      (requete) => {
        if (retenir) retenues.push(requete);
        else requete.continue();
      }
    );
    await page.goto(chemin, { waitUntil: 'commit' });
    await page.waitForFunction(() => Boolean(document.querySelector('main h1')), { timeout: 15000 });
    await attendreLaStabilite(page);
    const pendant = await page.evaluate(RELEVE_DU_CHARGEMENT);
    retenir = false;
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // déjà relâchée : rien à faire.
      }
    }
    await page.waitForFunction(() => document.querySelectorAll('main .animate-pulse').length === 0, {
      timeout: 20000,
    });
    await attendreLaStabilite(page);
    // La fenêtre de session CLS se ferme au moins une seconde APRÈS le dernier
    // décalage : c'est la règle de la métrique, donc le relevé « après » est
    // pris quand la page a fini de se poser (et non au milieu de l'arrivée des
    // données).
    await attendreLaFenetreDeSession(page);
    const apres = await page.evaluate(RELEVE_DU_CHARGEMENT);
    const brut = await page.evaluate(() =>
      window.__kojoCls
        ? { decalages: window.__kojoCls.decalages, fcp: window.__kojoCls.fcp }
        : { decalages: [], fcp: null }
    );
    return { pendant, apres, retenues: retenues.length, fcp: brut.fcp, ...clsDesDecalages(brut.decalages) };
  } finally {
    retenir = false;
    for (const requete of retenues) {
      try {
        await requete.continue();
      } catch {
        // rien à faire.
      }
    }
    await page.close();
  }
}

test('les deux branches de /payment sont DÉCLARÉES, opposées, et la courte à la hauteur de sa destination', () => {
  expect(
    BRANCHES_DE_PAYMENT.length,
    'la sonde des branches de /payment ne déclare pas ses deux cas : la branche qui réserve les cartes et celle qui ne les réserve pas'
  ).toBeGreaterThanOrEqual(2);
  const chemins = BRANCHES_DE_PAYMENT.map(({ chemin }) => chemin);
  expect(new Set(chemins).size, `les deux branches doivent être deux URL distinctes : ${chemins.join(', ')}`).toBe(
    chemins.length
  );
  const courte = BRANCHES_DE_PAYMENT.find(({ chemin }) => chemin === '/payment');
  expect(
    courte,
    'aucune branche ne visite /payment SANS paramètre — c’est pourtant celle que publie la coquille pré-rendue et celle ' +
      'd’un visiteur sans mission, donc celle du correctif du 09/10/2026.'
  ).toBeTruthy();
  expect(
    courte.hauteurDeLaDestination,
    'la branche « mission requise » ne demande plus la hauteur de sa destination — c’est EXACTEMENT le correctif du ' +
      '09/10/2026 que ce cas existe pour rejouer.'
  ).toBe(true);
  const avecMission = BRANCHES_DE_PAYMENT.find(({ chemin }) => chemin.includes('job_id='));
  expect(
    avecMission,
    'aucune branche ne visite /payment AVEC `job_id` — la contrepartie (les cartes DOIVENT y être réservées) manquerait.'
  ).toBeTruthy();
  expect(
    [courte.reserveLesCartes, avecMission.reserveLesCartes],
    'les deux branches déclarent la MÊME issue — la règle mesurée est qu’elles diffèrent (0 pulse contre 12).'
  ).toEqual([false, true]);
  expect(courte.chemin.includes('?'), 'la branche courte ne doit porter AUCUN paramètre').toBe(false);
});

test.describe('Parcours E2E — l’état de chargement de /payment réserve ce que sa BRANCHE montrera', () => {
  for (const { branche, chemin, reserveLesCartes, hauteurDeLaDestination } of BRANCHES_DE_PAYMENT) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${branche} — ${taille}`, async ({ browser }) => {
        const budget = CLS_BUDGETS['/payment'] ? CLS_BUDGETS['/payment'].max : null;
        expect(
          budget,
          `${branche} (${taille}) : aucun budget CLS mesuré pour /payment dans scripts/lhci-cls-budgets.cjs.`
        ).not.toBeNull();
        const releve = await releverLEtatDeChargementDeLaPage(browser, chemin, viewport);

        // ── Anti-faux-vert n° 0 : les requêtes de données ont bien été RETENUES
        // Sans elles, la page aurait reçu ses données et le relevé « pendant »
        // décrirait la page finie — c’est-à-dire le cas voisin, pas celui-ci.
        expect(
          releve.retenues,
          `${branche} (${taille}) : aucune requête retenue pour /payment — la page n’était donc pas dans son état de ` +
            'chargement, et le relevé décrit la page finie.'
        ).toBeGreaterThan(0);
        expect(
          releve.pendant.urlComplete,
          `${branche} (${taille}) : l’état de chargement a abouti sur ${releve.pendant.urlComplete} — la sonde décrit ` +
            'une autre branche que celle qu’elle nomme (et c’est la CHAÎNE DE RECHERCHE qui décide de ce qui est réservé).'
        ).toBe(chemin);
        expect(
          releve.pendant.titre,
          `${branche} (${taille}) : aucun titre de page pendant le chargement — c’est le repli de \`<Suspense>\` qui était ` +
            'peint, donc le sujet de l’autre describe (le chunk), pas l’état de chargement de la page.'
        ).not.toBe('');

        // ── LE SUJET N° 1 : LA BRANCHE décide de ce qui est réservé ──────────
        // 0 pulse sur la branche « mission requise » (aucune carte de paiement
        // n’y est réservée), 12 sur la branche « mission ». Le même état de
        // chargement, deux issues — et c’est la déclaration qui dit laquelle.
        if (reserveLesCartes) {
          expect(
            releve.pendant.pulsesDansMain,
            `${branche} (${taille}) : ${releve.pendant.pulsesDansMain} pulse(s) pendant le chargement — la branche ` +
              'portant `job_id` DOIT réserver ses cartes de paiement (mesuré : 12).'
          ).toBeGreaterThan(0);
        } else {
          expect(
            releve.pendant.pulsesDansMain,
            `${branche} (${taille}) : ${releve.pendant.pulsesDansMain} pulse(s) pendant le chargement alors que la ` +
              'carte « mission requise » ne porte AUCUNE carte de paiement — c’est le défaut du 09/10/2026 ' +
              '(1 376,4 px de `main` pour une destination de 700,4 en mobile).'
          ).toBe(0);
        }

        // ── LE SUJET N° 2 : le réservé n’est jamais plus COURT que la destination ─
        // La contrainte est celle qui a fait RETIRER la variante réduite le
        // 09/10/2026 : plus court que sa destination, le repli laissait le pied
        // de page s’insérer dans l’écran puis le faisait pousser vers le bas
        // (CLS 0,0801). Elle tient sur les DEUX branches, et elle n’interdit pas
        // de réduire la réserve : seulement de passer SOUS la destination.
        const delta = releve.apres.main.h - releve.pendant.main.h;
        expect(
          delta,
          `${branche} (${taille}) : l’état de chargement réserve ${releve.pendant.main.h} px de \`main\` pour une ` +
            `destination de ${releve.apres.main.h} px — il est PLUS COURT de ${Math.abs(delta)} px, donc la page le ` +
            'pousse vers le bas en arrivant. C’est le défaut mesuré le 09/10/2026 (repli réduit : 0,0801).'
        ).toBeLessThanOrEqual(1);

        // ── LE SUJET N° 3 (la branche courte) : la hauteur EST celle de sa
        // destination — le correctif du 09/10/2026, à 0,00 px près.
        if (hauteurDeLaDestination) {
          expect(
            Math.abs(delta),
            `${branche} (${taille}) : l’état de chargement fait ${releve.pendant.main.h} px de \`main\` quand sa ` +
              `destination fait ${releve.apres.main.h} px (Δ ${delta.toFixed(2)}) — la carte « mission requise » ne ` +
              'réserve rien d’autre qu’elle-même, donc la hauteur doit être la MÊME (mesuré : 700,38 mobile / ' +
              '794 desktop, Δ 0,00).'
          ).toBeLessThanOrEqual(1);
        }

        console.log(
          `ℹ️  /payment (${branche}) (${taille}) : ${releve.retenues} requête(s) retenue(s) · pendant ${releve.pendant.pulsesDansMain} pulse(s), ` +
            `\`main\` ${releve.pendant.main.h} px, pied à y=${releve.pendant.pied.y} ` +
            `(${releve.pendant.piedHorsEcran ? 'HORS écran' : 'VISIBLE'}) · après \`main\` ${releve.apres.main.h} px, ` +
            `pied à y=${releve.apres.pied.y} · Δ main ${delta.toFixed(2)} px · CLS ${releve.cls.toFixed(4)} pour ${budget}`
        );
        for (const decalage of plusGrands(releve)) {
          console.log(`      · décalage : ${decrireDecalage(decalage)}`);
        }

        expect(
          releve.fcp,
          `${branche} (${taille}) : premier paint absent — le CLS relevé ne décrit rien.`
        ).not.toBeNull();
        expect(
          releve.cls,
          `${branche} (${taille}) : le relâchement des données déplace la page de ${releve.cls.toFixed(4)} pour un ` +
            `plafond de ${budget} (scripts/lhci-cls-budgets.cjs : ${CLS_BUDGETS['/payment'].mesure}).\n      ` +
            `${decrireCls(releve.cls, releve)}\n` +
            plusGrands(releve)
              .map((decalage) => `      · ${decrireDecalage(decalage)}`)
              .join('\n') +
            '\n      Un décalage dont une source est DANS `main` est le signal que l’état de chargement ne fait plus la ' +
            'hauteur de sa destination — corriger la BRANCHE (src/utils/paymentBranche.js) ou le squelette, pas le plafond.'
        ).toBeLessThanOrEqual(budget);
      });
    }
  }
});

test.describe('Parcours E2E — le repli dédié de /payment tient la règle pendant le chunk de sa route', () => {
  for (const { route, chemin } of ROUTES_A_REPLI_HORS_CADRE) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille}`, async ({ browser }) => {
        const budget = CLS_BUDGETS[route] ? CLS_BUDGETS[route].max : null;
        expect(
          budget,
          `${route} (${taille}) : aucun budget CLS mesuré dans scripts/lhci-cls-budgets.cjs — la route ne peut ` +
            'pas être sondée sans plafond.'
        ).not.toBeNull();
        const declaration = REGLES_DE_CHARGEMENT[route];
        const prefixe = CHUNKS_DES_REPLIS_HORS_CADRE[route];
        const motif = new RegExp(`/assets/${prefixe}[\\w.-]*\\.js$`);
        const releve = await releverLeRepliDedie(browser, chemin, viewport, motif);

        expect(
          releve.retenues,
          `${route} (${taille}) : aucune requête retenue pour « ${prefixe} » — le motif (${motif}) ne nomme plus ` +
            'le chunk que le build publie pour cette page, donc le repli n’a jamais été peint et le cas mesurerait ' +
            'la PAGE.'
        ).toBeGreaterThan(0);
        expect(
          releve.pendant.url,
          `${route} (${taille}) : le chargement retenu a abouti sur ${releve.pendant.url} — la sonde décrit un autre ` +
            'écran que celui qu’elle nomme.'
        ).toBe(chemin);
        expect(
          releve.pendant.pulsesDansMain,
          `${route} (${taille}) : ${releve.pendant.pulsesDansMain} pulse(s) dans \`main\` pendant le retrait du ` +
            'chunk — le repli du `<Suspense>` n’était pas peint, donc le cas mesurerait une page vide.'
        ).toBeGreaterThan(0);
        expect(
          releve.pendant.titre,
          `${route} (${taille}) : le titre de la page était DÉJÀ peint (« ${releve.pendant.titre} ») pendant le ` +
            'retrait du chunk — la sonde mesure donc la PAGE, pas son état d’attente.'
        ).toBe('');

        expect(
          releve.pendant.piedHorsEcran,
          `${route} (${taille}) : le pied de page est VISIBLE (y=${releve.pendant.pied.y} pour une fenêtre de ` +
            `${releve.pendant.fenetre.h} px) pendant le chargement — il a donc quelque part où descendre quand la ` +
            `page arrive. Règle déclarée : « ${declaration.regle} » (${declaration.pourquoi}).`
        ).toBe(true);

        const attendue = HAUTEUR_RESERVE_PX(releve.pendant.fenetre.h);
        expect(
          releve.pendant.reservePresente,
          `${route} (${taille}) : aucun élément « .${declaration.hauteurClass} » dans \`main\` — la réserve déclarée ` +
            'par la route n’est pas posée (déclaration non lue, ou classe écrite ailleurs).'
        ).toBe(true);
        expect(
          releve.pendant.minHeightPx,
          `${route} (${taille}) : la réserve annonce ${releve.pendant.minHeightPx} px de hauteur minimale pour ` +
            `${attendue} px attendus (fenêtre ${releve.pendant.fenetre.h} − barre 65). Une valeur de 0 px est le ` +
            'signe d’une règle CSS INVALIDE (cf. `calc(100vh-65px)`, que Tailwind recopie verbatim).'
        ).toBeCloseTo(attendue, 0);
        expect(
          releve.pendant.reserveHauteurPx,
          `${route} (${taille}) : la réserve PEINT ${releve.pendant.reserveHauteurPx} px de haut pour une hauteur ` +
            `minimale de ${releve.pendant.minHeightPx} px — \`min-height\` ne s’applique pas.`
        ).toBeGreaterThanOrEqual(releve.pendant.minHeightPx - 1);

        console.log(
          `ℹ️  ${route} (${taille}) CHUNK RETENU : repli ${releve.pendant.pulsesDansMain} pulses · ` +
            `pied ${releve.pendant.pied.h} px à y=${releve.pendant.pied.y} ` +
            `(${releve.pendant.piedHorsEcran ? 'HORS écran' : 'VISIBLE'}) pour une fenêtre de ` +
            `${releve.pendant.fenetre.h} px · réserve ${releve.pendant.minHeightPx} px peinte ` +
            `${releve.pendant.reserveHauteurPx} px · ${releve.retenues} requête(s) retenue(s) · CLS du ` +
            `relâchement ${releve.cls.toFixed(4)} pour ${budget}`
        );
        for (const decalage of plusGrands(releve)) {
          console.log(`      · décalage : ${decrireDecalage(decalage)}`);
        }
        console.log(
          `      · après relâchement : pied ${releve.apres.pied.h} px à y=${releve.apres.pied.y} · ` +
            `titre « ${releve.apres.titre} »`
        );

        expect(
          releve.apres.titre,
          `${route} (${taille}) : après relâchement du chunk, aucun titre dans \`main\` — la page n’est pas arrivée, ` +
            'donc le CLS mesuré ne décrit pas le remplacement.'
        ).not.toBe('');
        expect(
          releve.fcp,
          `${route} (${taille}) : premier paint absent — le CLS relevé ne décrit rien.`
        ).not.toBeNull();
        expect(
          releve.cls,
          `${route} (${taille}) : le remplacement du repli par la page déplace celle-ci de ` +
            `${releve.cls.toFixed(4)} pour un plafond de ${budget} (scripts/lhci-cls-budgets.cjs : ` +
            `${CLS_BUDGETS[route].mesure}).\n      ${decrireCls(releve.cls, releve)}\n` +
            plusGrands(releve)
              .map((decalage) => `      · ${decrireDecalage(decalage)}`)
              .join('\n') +
            '\n      Un décalage dont une source est DANS `main` est le signal que la réserve ou la hauteur du repli ' +
            'ne tient plus — corriger la DÉCLARATION de la route, pas le plafond.'
        ).toBeLessThanOrEqual(budget);
      });
    }
  }
});
