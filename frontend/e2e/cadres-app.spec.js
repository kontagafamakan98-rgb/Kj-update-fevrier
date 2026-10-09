import { test, expect } from '@playwright/test';
// LE CADRE EST LU DANS SON PROPRIÉTAIRE, jamais recopié : `src/config/app-cadres.js`
// déclare la largeur et la gouttière de chaque route d'application, et c'est cette
// déclaration que la sonde confronte à ce que le navigateur peint. Recopier
// `max-w-7xl` ici ferait deux endroits à tenir d'accord, et le premier oublié
// laisserait la sonde verte sur un cadre qui a changé.
import { CADRES_APP, REGLES_DE_SQUELETTE } from '../src/config/app-cadres.js';
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
  const reserve = cadre ? cadre.querySelector('.reserve-pied-hors-ecran') : null;
  const styleReserve = reserve ? getComputedStyle(reserve) : null;
  return {
    url: location.pathname,
    fenetre: { l: window.innerWidth, h: window.innerHeight },
    pulses: document.querySelectorAll('.cadre-page .animate-pulse').length,
    pied: pied
      ? (() => {
          const r = pied.getBoundingClientRect();
          return { y: arrondi(r.y + window.scrollY), h: arrondi(r.height) };
        })()
      : null,
    piedHorsEcran: pied ? pied.getBoundingClientRect().top >= window.innerHeight : null,
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
