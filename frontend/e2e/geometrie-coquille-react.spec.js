import { test, expect } from '@playwright/test';
import {
  ROUTES,
  TAILLES,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
  comparerGeometrie,
  gelerLePremierRendu,
  ouvrirLaPage,
  RELEVE_GEOMETRIE,
} from './helpers/geometrie.js';

/**
 * LA garde de géométrie : pour chaque route pré-rendue et chaque taille, la
 * coquille et le premier rendu de React doivent poser les MÊMES textes aux
 * MÊMES endroits, avec le même alignement CALCULÉ et la même navbar.
 *
 * ── Pourquoi ce garde existe ────────────────────────────────────────────────
 * La garantie « la coquille gagne » tient à une ÉGALITÉ de géométrie : la
 * coquille peint avant le JavaScript, `createRoot()` efface `#root`, React
 * reconstruit la même page — et Chrome ne ré-élit un élément LCP que pour une
 * aire STRICTEMENT plus grande. Un remplacement plus grand, ou décalé, fait
 * entrer toute la chaîne JavaScript dans le graphe LCP simulé de Lantern.
 * C'était jusqu'ici prouvé par des mesures d'atelier, route par route (le
 * `.App { text-align: center }` hérité, les 65 px de navbar, les relevés de
 * /jobs et /contact) : une preuve qu'il fallait refaire à la main, donc qu'on
 * pouvait oublier de refaire. Ce parcours la rend AUTOMATIQUE et GÉNÉRALE, et
 * il a immédiatement trouvé ce qu'aucune mesure ponctuelle n'avait vu (voir le
 * journal de la dernière exécution : le pied de page absent des dix coquilles
 * qui ne l'avaient jamais publié, le `border-t` manquant à la section contact
 * de l'accueil, la bascule liste/carte absente de /jobs en mobile, cinq
 * commandes publiées en `<div>` alors que React les rend en `<button>`).
 *
 * ── Ce qui est comparé ─────────────────────────────────────────────────────
 *   1. l'ENCRE de chaque nœud de texte visible (un rectangle par ligne), et
 *      non la boîte de l'élément qui le porte : un `<div>` qui centre son texte
 *      et un `<span>` dans un `<button>` peignent la même encre avec des boîtes
 *      différentes (mesuré sur /login : 380×38 contre 68×30 pour le même texte
 *      au même pixel) ;
 *   2. le `text-align` CALCULÉ de son porteur — propriété à part entière depuis la
 *      refonte du 25/09/2026 (le site est aligné à gauche, chaque bloc centré le
 *      déclare), et le canal par lequel la centure par héritage déplaçait les
 *      bornes d'encre de l'élément LCP de /jobs avant qu'elle ne soit retirée ;
 *   3. la hauteur de la navbar (64 px au lieu de 65 = 1 px de décalage pour
 *      tout le contenu au montage) ;
 *   4. la BOÎTE et le `vertical-align` des ICÔNES DESSINÉES (`<svg>`). Les trois
 *      points ci-dessus ne les voient pas : une icône n'a pas de nœud de texte,
 *      donc aucune encre à comparer. Or les deux canaux les dessinent depuis le
 *      MÊME registre (`src/config/page-icons.js`, `IconePage` pour React,
 *      `svgDeLIcone` pour la coquille), et c'est précisément là que se glissent
 *      une taille recopiée (`h-4 w-4` d'un côté, `h-5 w-5` de l'autre) ou un
 *      `align-[-0.15em]` calibré pour une autre taille de texte — mesuré le
 *      26/09/2026 : dans la notice de /register (`text-xs`), le centre de
 *      l'icône restait 1,7 px au-dessus de celui de sa ligne. L'appariement se
 *      fait par le repère que les DEUX canaux portent déjà (`data-icone`
 *      `data-drapeau` : le build l'exige des coquilles), donc une divergence est
 *      nommée par le nom de l'icône, jamais par un rang.
 *
 * ── Le protocole ───────────────────────────────────────────────────────────
 * Deux navigations, sur des pages NEUVES : (1) « coquille », le bundle
 * d'entrée bloqué — React ne monte jamais ; (2) « réelle », avec le PREMIER
 * rendu figé (`gelerLePremierRendu` fige la géolocalisation, seul état
 * asynchrone qui déplace le haut de page) et une attente de stabilisation.
 *
 * ── Anti-faux-vert ─────────────────────────────────────────────────────────
 * Un test qui ne compare RIEN passerait : le nombre de textes effectivement
 * comparés est compté, publié et PLANCHERÉ, et le premier texte peint par la
 * coquille dans `main` (son en-tête de page, quel qu'il soit — jamais recopié)
 * doit faire partie des textes comparés. Les routes dont le premier rendu
 * REDIRIGE (page protégée) n'ont pas de peinture à comparer : elles sont
 * nommées dans le journal, jamais comptées comme un vert. Et parce que le
 * plancher des icônes est DÉRIVÉ de ce que la coquille dessine (il ne peut donc
 * pas voir une route sans icône), un cas dédié fixe la COUVERTURE de la sonde
 * d'icônes sur l'accueil mobile, la page qui en dessine le plus.
 */

/**
 * Le plancher de couverture des icônes sur « / » mobile — MESURÉ (voir le
 * journal de l'exécution), pas deviné : il est à mi-chemin entre le relevé et la
 * borne basse qu'une régression franche franchirait. Le jour où l'accueil cesse
 * de dessiner ses icônes, ce cas rougit — et c'est le seul endroit où la sonde
 * le dirait, les planchers dérivés étant muets sur une page vidée.
 */
const PLANCHER_ICONES_ACCUEIL_MOBILE = 20;
/**
 * Les DEUX peintures d'une route : la coquille seule, puis le premier rendu de
 * React. Le protocole est décrit ci-dessus ; il est écrit une fois parce que le
 * cas de couverture des icônes (plus bas) mesure avec le MÊME, et deux copies
 * finiraient par ne plus mesurer la même chose.
 *
 * @param {import('@playwright/test').Browser} browser Navigateur du test.
 * @param {string} route Route pré-rendue à mesurer.
 * @param {{width: number, height: number}} viewport Taille de la fenêtre.
 * @returns {Promise<{coquille: object, react: object}>} Les deux relevés.
 */
async function releverLesDeuxPeintures(browser, route, viewport) {
  // ── 1. La coquille SEULE (bundle d'entrée bloqué) ────────────────
  const pageCoquille = await ouvrirLaPage(browser, 'coquille', viewport);
  let coquille;
  try {
    await pageCoquille.goto(route);
    await attendreLaStabilite(pageCoquille);
    coquille = await pageCoquille.evaluate(RELEVE_GEOMETRIE);
  } finally {
    await pageCoquille.close();
  }

  // ── 2. La même route, peinte par le PREMIER rendu de React ───────
  const pageReact = await ouvrirLaPage(browser, 'reelle', viewport);
  let react;
  try {
    await gelerLePremierRendu(pageReact);
    await pageReact.goto(route);
    // La navbar de l'app (avec ses liens) ne peut exister QUE si React a
    // monté : le chrome des coquilles publie une navbar vide.
    await pageReact.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
    await attendreLaStabilite(pageReact);
    react = await pageReact.evaluate(RELEVE_GEOMETRIE);
  } finally {
    await pageReact.close();
  }

  return { coquille, react };
}

test.describe('Garde de géométrie — la coquille et React peignent les mêmes textes', () => {
  // PAS de mode `serial` : un garde doit nommer TOUTES les routes en défaut en
  // un passage (le mode série s'arrête au premier échec, donc on corrige une
  // route, on relance, et on découvre la suivante).
  for (const route of ROUTES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille}`, async ({ browser }) => {
        const { coquille, react } = await releverLesDeuxPeintures(browser, route, viewport);

        // ── Une route PROTÉGÉE n'a pas de premier rendu à comparer ───────
        // ProtectedRoute redirige vers /login : comparer la coquille de
        // /payment à la peinture de /login n'aurait aucun sens. On le dit, on
        // ne le compte pas comme un vert.
        if (react.url !== coquille.url) {
          console.log(
            `⏭️  Géométrie ${route} (${taille}) : le premier rendu de React quitte la route ` +
              `(${coquille.url} → ${react.url}) — aucune peinture à comparer ` +
              '(page protégée : le visiteur est redirigé).'
          );
          return;
        }

        // ── L'ANCRE : le premier texte peint par la coquille dans `main` ──
        // Lu dans la coquille elle-même (donc jamais recopié ici, et
        // indépendant du nom des clés du plan) : quel que soit l'en-tête de la
        // page, il doit exister des deux côtés, sinon le garde ne prouve pas
        // que la coquille publie l'élément que le LCP élit.
        const premier = Object.entries(coquille.textes)
          .flatMap(([texte, instances]) => instances.map((instance) => ({ texte, instance })))
          .sort((a, b) => a.instance.boite[1] - b.instance.boite[1] || a.instance.boite[0] - b.instance.boite[0])[0];
        expect(
          premier,
          `${route} (${taille}) : la coquille ne peint AUCUN texte — le garde ne prouverait rien`
        ).toBeTruthy();
        expect(
          Object.keys(react.textes),
          `${route} (${taille}) : React ne peint pas le premier texte de la coquille ` +
            `« ${premier.texte} » — le garde ne prouverait rien`
        ).toContain(premier.texte);

        const {
          divergences,
          compares,
          absents,
          exemplesAbsents,
          horsZone,
          exemplesHorsZone,
          frontiere,
          texteFrontiere,
          iconesComparees,
          iconesCoquille,
          iconesAbsentes,
          exemplesIconesAbsentes,
          iconesHorsZone,
          exemplesIconesHorsZone,
          iconesReactSeules,
        } = comparerGeometrie(coquille, react);
        expect(
          divergences,
          `${route} (${taille}) : la coquille et React ne peignent pas la même géométrie ` +
            `(${compares} texte(s) comparé(s)) — corriger la GÉOMÉTRIE, pas le repaint : les classes ` +
            'doivent avoir un propriétaire lu par les deux canaux (src/config/page-sections.js, ' +
            'vite-plugins/prerender/app-chrome.js).'
        ).toEqual([]);
        // Un garde qui ne compare rien est un garde aveugle (règle du dépôt).
        expect(
          compares,
          `${route} (${taille}) : ${compares} texte(s) comparé(s) seulement — la géométrie n'a pas été vérifiée`
        ).toBeGreaterThanOrEqual(3);
        // Les icônes ont leur propre plancher, et il est DÉRIVÉ de ce que la
        // coquille dessine : une route sans icône n'en compare aucune (et ce
        // n'est pas un trou), mais une route qui en dessine une seule doit
        // l'avoir comparée — sinon l'extension serait muette là où il y a de la
        // matière, ce que le plancher des textes ne verrait pas.
        if (iconesCoquille) {
          expect(
            iconesComparees,
            `${route} (${taille}) : la coquille dessine ${iconesCoquille} icône(s) et ${iconesComparees} ` +
              'seulement ont été comparées à celles de React — la géométrie des icônes n\'a pas été vérifiée'
          ).toBeGreaterThan(0);
        }

        console.log(
          `ℹ️  Géométrie ${route} (${taille}) : ${compares} texte(s) peints au même endroit ` +
            `(encre + text-align), ${iconesComparees}/${iconesCoquille} icône(s) à la même boîte ` +
            `(et au même vertical-align), navbar ${react.hauteurNavbar} px des deux côtés` +
            (absents
              ? ` — ${absents} texte(s) de la coquille que React ne peint pas dans cet état ` +
                `(${exemplesAbsents.map((t) => `« ${t.slice(0, 24)} »`).join(', ')} — divergence de CONTENU, ` +
                'jugée mot pour mot par e2e/texte-coquille-react.spec.js)'
              : '') +
            (horsZone
              ? ` — ${horsZone} texte(s) NON comparés au-delà de la frontière de contenu : React peint ` +
                `« ${String(texteFrontiere).slice(0, 40)} » en y=${frontiere}, que la coquille ne peint pas ` +
                `(la hauteur de ce bloc lui est inconnue) ; exemples de textes sautés : ${exemplesHorsZone
                  .map((t) => `« ${t.slice(0, 20)} »`)
                  .join(', ')})`
              : '') +
            (iconesAbsentes
              ? ` — ${iconesAbsentes} icône(s) dessinée(s) par la coquille que React ne dessine pas dans cet état ` +
                `(${exemplesIconesAbsentes.map((n) => `« ${n} »`).join(', ')}) — divergence de CONTENU`
              : '') +
            (iconesHorsZone
              ? ` — ${iconesHorsZone} icône(s) NON comparées au-delà de la frontière de contenu ` +
                `(${exemplesIconesHorsZone.map((n) => `« ${n} »`).join(', ')} — même raison que les textes : ` +
                'leur position dépend d’un bloc que la coquille ne connaît pas)'
              : '') +
            (iconesReactSeules
              ? ` — ${iconesReactSeules} icône(s) que React dessine sans la coquille (chrome de l'app, ` +
                'contenu asynchrone) : comptées, jamais des divergences'
              : '')
        );
      });
    }
  }

  // ── La COUVERTURE des icônes, mesurée là où il y en a le plus ─────────────
  // Les 24 cas ci-dessus (12 routes × 2 tailles) comparent les icônes route par
  // route, mais chacun peut
  // rester vert en n'en comparant AUCUNE (une route sans icône, ou un filtre qui
  // ne serait jamais satisfait) : le plancher d'icônes y est DÉRIVÉ, donc il ne
  // voit un zéro que sur une route qui dessine. Ce cas-ci fixe la seule chose
  // que ces planchers ne peuvent pas dire : que la sonde des icônes a bien de la
  // matière, et il la fixe sur l'accueil MOBILE, la page qui en dessine le plus
  // (les trois repères du héros, les dix catégories, les trois promesses, les
  // trois étapes, les quatre drapeaux, les flèches des listes).
  test('l’accueil mobile dessine assez d’icônes pour que leur géométrie soit jugée', async ({ browser }) => {
    const viewport = TAILLES.find(({ nom }) => nom === 'mobile').viewport;
    const { coquille, react } = await releverLesDeuxPeintures(browser, '/', viewport);
    const { divergences, iconesComparees, iconesCoquille, iconesAbsentes } = comparerGeometrie(coquille, react);
    expect(divergences).toEqual([]);
    // Le plancher est MESURÉ (cf. le journal de l'exécution) : il est très
    // au-dessus de 1, donc un filtre cassé le franchit à la baisse bruyamment.
    expect(
      iconesComparees,
      `« / » mobile : ${iconesComparees} icône(s) comparée(s) sur ${iconesCoquille} dessinée(s) par la ` +
        `coquille (${iconesAbsentes} absente(s) chez React) — la sonde des icônes ne mord plus`
    ).toBeGreaterThanOrEqual(PLANCHER_ICONES_ACCUEIL_MOBILE);
    console.log(
      `ℹ️  Couverture des icônes — « / » mobile : ${iconesComparees} icône(s) comparée(s) ` +
        `sur ${iconesCoquille} dessinée(s), plancher ${PLANCHER_ICONES_ACCUEIL_MOBILE}`
    );
  });
});
