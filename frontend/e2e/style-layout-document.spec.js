/**
 * SONDE DU COÛT DU DOCUMENT : « Style & Layout » de chaque coquille pré-rendue,
 * route par route, LU AU CDP — pas dans Lighthouse.
 *
 * ── Pourquoi cette sonde existe ─────────────────────────────────────────────
 * Le CSS du document a été élagué (36 règles mortes, 105 noms morts, 8 503 o par
 * page) et la question suivante s'est posée : et le DOCUMENT lui-même ? Il pèse
 * 74 à 94 ko par page, dont 60 929 o de feuille en ligne, 279 nœuds sur
 * l'accueil et 7 075 px de haut sur un écran de 412 px. Lighthouse donne un
 * « Style & Layout » agrégé (552 ms relevés sur l'accueil à cpu×4), une fois par
 * run, sans dire ce qui le compose ni quelle route le porte. Cette sonde lit les
 * compteurs du renderer — `RecalcStyleDuration` + `LayoutDuration`, qui SONT le
 * Style & Layout, en millisecondes cumulées depuis le début de la page — sur une
 * page NEUVE par relevé, bundle d'entrée BLOQUÉ : c'est le document qui est
 * mesuré, jamais React. MINIMUM de trois runs, comme la règle du dépôt pour les
 * mesures bruitées : sur ce poste partagé le bruit ne peut qu'AJOUTER du temps
 * (médiane jusqu'à +44 % au-dessus du minimum sur l'accueil mobile), donc c'est
 * le minimum qui décrit le coût propre de l'artefact — et une régression de
 * l'artefact monte dans les trois runs.
 *
 * ── Ce que la mesure a appris (25/09/2026, table dans
 * `scripts/style-layout-budgets.cjs`) ─────────────────────────────────────────
 *   • LE STYLE N'EST JAMAIS LE SUJET (2 à 6 % du total) : les 811 règles de la
 *     feuille coûtent ~10 ms là où le layout en coûte 141 à 647. L'élagage du
 *     CSS était justifié (poids mort, sources menteuses) mais il n'était PAS le
 *     coût — cette sonde est là pour que l'hypothèse ne se rouvre pas deux fois.
 *   • LE COÛT EST DANS LE HAUT DU DOCUMENT, ET IL Y A UNE PART FIXE. Balayage de
 *     l'accueil mobile (1, 2, … 10 sections, minimum de 3 runs) : 339 / 366 /
 *     494 / 558 / 558 / 569 / 618 / 628 / 622 / 650 ms. Les quatre premières
 *     portent 86 % du coût ; les six dernières (3 800 px, ~40 % du markup) n'en
 *     ajoutent que 90.
 *   • COROLLAIRE CONTRE-INTUITIF : AJOUTER DU CONTENU EST QUASI GRATUIT, MÊME EN
 *     TÊTE. +6 000 px VIDES en haut de `<main>` = 0 ms ; republier tout `<main>`
 *     à la suite (279 → 469 nœuds, 7 075 → 13 848 px) = ×0,99 ; le héros publié
 *     trois fois en tête (+32 nœuds, +1 281 px) = 650 → 672 ms (+3 %) ; les deux
 *     premières sections dupliquées = +1 %. Le coût marginal d'un nœud est de
 *     l'ordre de 0,5 ms à cpu×4 contre ~2,3 ms/nœud en moyenne : une PART FIXE
 *     (250 à 300 ms sur cette route : chrome, première section, mise en page
 *     d'un document qui dépasse l'écran) domine. L'ancienne lecture « le coût
 *     suit les pixels ou les nœuds » est réfutée, et la borne HAUTE ci-dessous
 *     est donc écrite comme un garde-fou de CATASTROPHE, pas comme un détecteur
 *     de dérive fine.
 *   • REACT N'EST PAS LE COÛT DU DOCUMENT : +25,8 ms de style et +51,3 ms de
 *     layout sur l'accueil (647 → 724 ms). Là où il pèse vraiment (/jobs +194,
 *     /payment +131), c'est le volume des données, et cela appartient à
 *     d'autres gardes.
 *
 * ── Les trois refus qui empêchent un faux vert ──────────────────────────────
 *   1. si React montait (blocage du bundle cassé), la sonde mesurerait autre
 *      chose : chaque relevé exige le marqueur de MONTAGE ABSENT ;
 *   2. un relevé nul (build absent, page blanche) passerait sous tous les
 *      budgets : chaque relevé exige un plancher de lecture ;
 *   3. un document qui devient BEAUCOUP MOINS CHER a perdu sa matière — le
 *      verdict est bidirectionnel, et c'est la seule direction que les mutations
 *      savent faire rougir (retirer les neuf dernières sections de l'accueil :
 *      650 → 339 ms, soit 0,52 du relevé).
 * Et la table de budgets doit couvrir EXACTEMENT les routes pré-rendues de
 * `src/config/page-meta.js` : une route ajoutée sans budget rougit ici, comme un
 * budget périmé.
 */
import { test, expect } from '@playwright/test';
import { ROUTES, ouvrirLaPage } from './helpers/geometrie.js';
import budgets from '../scripts/style-layout-budgets.cjs';

const { CONDITIONS, BUDGETS_STYLE_LAYOUT, MESURE, BORNE_BASSE_RATIO } = budgets;
const RUNS = 3;
/** En dessous, la page n'a manifestement pas été lue (build absent, coquille vide). */
const PLANCHER_MS = 5;

/**
 * Un relevé : page neuve, throttling CPU posé AVANT la navigation, compteurs lus
 * après que la peinture s'est posée.
 */
async function relever(browser, chemin, condition) {
  const page = await ouvrirLaPage(browser, 'coquille', condition.viewport);
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  if (condition.cpu > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: condition.cpu });
  await page.goto(chemin, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const dom = await page.evaluate(() => ({
    noeuds: document.querySelectorAll('*').length,
    hauteur: document.documentElement.scrollHeight,
    monte: Boolean(document.querySelector('nav a')),
  }));
  const { metrics } = await session.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  await page.close();
  return {
    style: m.RecalcStyleDuration * 1000,
    layout: m.LayoutDuration * 1000,
    total: (m.RecalcStyleDuration + m.LayoutDuration) * 1000,
    noeuds: dom.noeuds,
    hauteur: dom.hauteur,
    monte: dom.monte,
  };
}

/**
 * Trois relevés, MINIMUM, et les deux refus du faux vert.
 *
 * Le minimum, pas la médiane, et c'est la règle du dépôt pour les mesures
 * bruitées (SI, TBT) : sur ce poste partagé le bruit ne peut qu'AJOUTER du temps
 * — mesuré, la médiane monte jusqu'à +44 % au-dessus du minimum sur l'accueil
 * mobile — donc c'est le minimum qui décrit le coût propre de l'artefact, et une
 * régression de l'artefact monte dans les trois runs.
 */
async function mesurer(browser, chemin, condition) {
  const releves = [];
  for (let i = 0; i < RUNS; i += 1) releves.push(await relever(browser, chemin, condition));
  for (const r of releves) {
    expect(r.monte, `${chemin} (${condition.nom}) : React a monté — le bundle d'entrée n'était pas bloqué, ce n'est plus le document qui est mesuré`).toBe(false);
    expect(r.total, `${chemin} (${condition.nom}) : relevé nul (${r.total} ms) — la page n'a pas été lue`).toBeGreaterThan(PLANCHER_MS);
  }
  const meilleur = releves.reduce((a, b) => (b.total < a.total ? b : a));
  const etendue = Math.max(...releves.map((r) => r.total)) - Math.min(...releves.map((r) => r.total));
  return { ...meilleur, etendue };
}

test.describe('le document pré-rendu : « Style & Layout » route par route', () => {
  for (const condition of CONDITIONS) {
    for (const chemin of ROUTES) {
      test(`${chemin} — ${condition.nom} (cpu×${condition.cpu}) : le document tient son budget`, async ({ browser }) => {
        const budget = BUDGETS_STYLE_LAYOUT[chemin]?.[condition.nom];
        expect(budget, `aucun budget pour ${chemin} en ${condition.nom} — la table scripts/style-layout-budgets.cjs est en retard sur src/config/page-meta.js`).toBeGreaterThan(0);
        const mesure = await mesurer(browser, chemin, condition);
        const mesureReference = MESURE[chemin][condition.nom];
        expect(
          mesure.total,
          `${chemin} (${condition.nom}) : ${mesure.total.toFixed(1)} ms au meilleur des ${RUNS} runs pour un budget de ${budget} ms ` +
            `(minimum de référence du 25/09/2026 : ${mesureReference} ms) — ` +
            `style ${mesure.style.toFixed(1)} ms + layout ${mesure.layout.toFixed(1)} ms, ` +
            `${mesure.noeuds} nœuds, ${mesure.hauteur} px de haut, étendue ${mesure.etendue.toFixed(1)} ms sur ${RUNS} runs. ` +
            'Le style pèse 2 à 6 % de ce total (mesuré) : c\'est le LAYOUT, et l\'accuser le CSS est une fausse piste. ' +
            'La mesure dit aussi ce qui est GRATUIT — le contenu AJOUTÉ (×0,99 mesuré, et 0 ms pour 6 000 px vides) — ' +
            'donc une dérive de cette grandeur ne vient pas du volume : elle vient du HAUT du document ' +
            '(une part fixe de 250 à 300 ms y domine) ou d\'un style qui a doublé de poids.'
        ).toBeLessThanOrEqual(budget);
        const borneBasse = Math.floor(mesureReference * BORNE_BASSE_RATIO);
        expect(
          mesure.total,
          `${chemin} (${condition.nom}) : ${mesure.total.toFixed(1)} ms au meilleur des ${RUNS} runs, sous la borne basse de ${borneBasse} ms ` +
            `(${BORNE_BASSE_RATIO} × le relevé de référence de ${mesureReference} ms) — ` +
            `style ${mesure.style.toFixed(1)} ms + layout ${mesure.layout.toFixed(1)} ms, ${mesure.noeuds} nœuds, ${mesure.hauteur} px de haut. ` +
            'Un document qui devient BEAUCOUP moins cher a perdu sa matière : la coquille cesse de publier son corps, ' +
            'et c\'est une régression du contrat SEO / sans-JavaScript (mesuré : accueil amputé de ses 9 dernières sections, 650 → 339 ms).'
        ).toBeGreaterThanOrEqual(borneBasse);
      });
    }
  }

  test('la table de budgets couvre EXACTEMENT les routes pré-rendues', () => {
    const routes = Object.keys(BUDGETS_STYLE_LAYOUT).sort();
    expect(routes).toEqual([...ROUTES].sort());
    for (const condition of CONDITIONS) {
      for (const chemin of routes) {
        expect(MESURE[chemin][condition.nom], `${chemin}/${condition.nom} : mesure de référence absente`).toBeGreaterThan(0);
        expect(BUDGETS_STYLE_LAYOUT[chemin][condition.nom]).toBeGreaterThan(MESURE[chemin][condition.nom]);
      }
    }
  });
});
