/**
 * SONDE DU DOCUMENT PRÉ-RENDU : la STRUCTURE qu'il publie (nœuds, hauteur), et
 * le COÛT qu'il représente — publié, plus jugé.
 *
 * ── Pourquoi cette sonde existe ─────────────────────────────────────────────
 * Le CSS du document a été élagué (36 règles mortes, 105 noms morts, 8 503 o par
 * page) et la question suivante s'est posée : et le DOCUMENT lui-même ? Il pèse
 * 74 à 94 ko par page, dont 60 929 o de feuille en ligne, 279 nœuds sur l'accueil
 * et 7 075 px de haut sur un écran de 412 px. Cette sonde lit les compteurs du
 * renderer — `RecalcStyleDuration` + `LayoutDuration`, qui SONT le « Style &
 * Layout » de Lighthouse, en millisecondes cumulées depuis le début de la page —
 * sur une page NEUVE par relevé, bundle d'entrée BLOQUÉ : c'est le document qui
 * est mesuré, jamais React. MINIMUM de trois runs, comme la règle du dépôt pour
 * les mesures bruitées.
 *
 * ── Ce que la mesure a appris (25/09/2026, table et récit dans
 * `scripts/style-layout-budgets.cjs`) ─────────────────────────────────────────
 *   • LE STYLE N'EST JAMAIS LE SUJET (2 à 6 % du total) : les 811 règles de la
 *     feuille coûtent ~10 ms là où le layout en coûte 141 à 647. L'élagage du
 *     CSS était justifié (poids mort, sources menteuses) mais il n'était PAS le
 *     coût — cette sonde est là pour que l'hypothèse ne se rouvre pas deux fois.
 *   • LE COÛT EST DANS LE HAUT DU DOCUMENT, ET IL Y A UNE PART FIXE (250 à
 *     300 ms sur l'accueil mobile : chrome, première section, mise en page d'un
 *     document qui dépasse l'écran).
 *   • AJOUTER DU CONTENU EST QUASI GRATUIT, MÊME EN TÊTE : +6 000 px vides = 0 ms,
 *     tout `<main>` republié = ×0,99, le héros publié trois fois = +3 %.
 *   • REACT N'EST PAS LE COÛT DU DOCUMENT : +25,8 ms de style et +51,3 ms de
 *     layout sur l'accueil (647 → 724 ms).
 *
 * ── Ce que la CI a appris à cette sonde, et ce qu'elle juge désormais ───────
 * Le premier verdict portait sur le TEMPS (0,6 × à 1,5 × le relevé du poste). Au
 * premier passage du runner Linux, 18 des 22 cases sont devenues rouges — toutes
 * sur la borne basse, sur le même artefact, dont `/ — mobile` à 80,4 ms pour un
 * relevé de 662 ms : ×8,2 — l'écart le plus serré étant 1,85 × (/payment
 * desktop, 43 → 23,2 ms). Le même document coûte de 1,85 à 8,2 fois moins cher
 * selon la machine, donc une borne en millisecondes y borne la MACHINE, pas une
 * régression. Le verdict porte maintenant sur la STRUCTURE, qui est une
 * propriété de l'artefact — mesurée IDENTIQUE sur les deux hôtes s'agissant des
 * nœuds (279, 112, 120, …), et à 0,9 % près s'agissant de la hauteur. Le coût,
 * lui, reste imprimé à chaque case : publié, jamais jugé.
 *
 * ── Les trois refus qui empêchent un faux vert ──────────────────────────────
 *   1. si React montait (blocage du bundle cassé), la sonde mesurerait autre
 *      chose : chaque relevé exige le marqueur de MONTAGE ABSENT ;
 *   2. un relevé nul (build absent, page blanche) passerait sous tous les
 *      planchers de temps : chaque relevé exige un plancher de LECTURE, et un
 *      document vide tombe de toute façon sous le plancher de nœuds ;
 *   3. une coquille qui cesse de publier son corps est une régression du contrat
 *      SEO / sans-JavaScript : c'est exactement ce que le plancher de structure
 *      attrape, et c'est la seule direction que les mutations savent faire
 *      rougir (mesuré : accueil amputé de ses neuf dernières sections).
 * Et la table de structure doit couvrir EXACTEMENT les routes pré-rendues de
 * `src/config/page-meta.js` : une route ajoutée sans référence rougit ici.
 */
import { test, expect } from '@playwright/test';
import { ROUTES, ouvrirLaPage } from './helpers/geometrie.js';
import budgets from '../scripts/style-layout-budgets.cjs';

const { CONDITIONS, MESURE, MESURE_CI, NOEUDS, HAUTEUR, plancherNoeudsDe, plancherHauteurDe } = budgets;
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
 * bruitées (SI, TBT) : sur un poste partagé le bruit ne peut qu'AJOUTER du temps
 * — mesuré, la médiane monte jusqu'à +44 % au-dessus du minimum sur l'accueil
 * mobile — donc c'est le minimum qui décrit le coût propre de l'artefact.
 * La structure, elle, est identique dans les trois runs : c'est ce que le
 * verdict mesure désormais.
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

test.describe('le document pré-rendu : sa structure publiée, son coût publié', () => {
  for (const condition of CONDITIONS) {
    for (const chemin of ROUTES) {
      test(`${chemin} — ${condition.nom} (cpu×${condition.cpu}) : la coquille publie toujours son corps`, async ({ browser }) => {
        const noeudsReference = NOEUDS[chemin];
        const hauteurReference = HAUTEUR[chemin]?.[condition.nom];
        expect(
          noeudsReference,
          `aucune structure de référence pour ${chemin} — la table scripts/style-layout-budgets.cjs est en retard sur src/config/page-meta.js`
        ).toBeGreaterThan(0);
        expect(
          hauteurReference,
          `aucune hauteur de référence pour ${chemin} en ${condition.nom} — la table scripts/style-layout-budgets.cjs est en retard sur src/config/page-meta.js`
        ).toBeGreaterThan(0);

        const mesure = await mesurer(browser, chemin, condition);

        // ── La coquille publie-t-elle toujours son corps ? ────────────────
        // Un document qui perd sa matière perd d'abord ses NŒUDS, et c'est la
        // seule direction que les mutations savent faire rougir : l'accueil
        // amputé de ses neuf dernières sections tombe de 279 à 27 nœuds.
        const plancherNoeuds = plancherNoeudsDe(noeudsReference);
        expect(
          mesure.noeuds,
          `${chemin} (${condition.nom}) : ${mesure.noeuds} nœuds peints, sous le plancher de ${plancherNoeuds} ` +
            `(${budgets.BORNE_STRUCTURE} × les ${noeudsReference} nœuds du relevé) — la coquille a perdu son corps, ` +
            'et c’est une régression du contrat SEO / sans-JavaScript (mesuré : accueil amputé de ses neuf dernières ' +
            `sections, 279 → 105 nœuds et 7 075 → 1 125 px). La hauteur, elle, mesure ${mesure.hauteur} px ` +
            `(plancher ${plancherHauteurDe(hauteurReference)} px). ` +
            'Un nœud ne dépend pas de la machine : c’est ce qui décide ici.'
        ).toBeGreaterThanOrEqual(plancherNoeuds);

        // ── …et sa mise en page ? ─────────────────────────────────────────
        // La hauteur départage ce que les nœuds laissent passer : une section
        // vidée de son contenu textuel garde ses boîtes, une section retirée
        // non. Mesurée à 0,9 % près entre deux hôtes, donc portable.
        const plancherHauteur = plancherHauteurDe(hauteurReference);
        expect(
          mesure.hauteur,
          `${chemin} (${condition.nom}) : ${mesure.hauteur} px de haut, sous le plancher de ${plancherHauteur} ` +
            `(${budgets.BORNE_STRUCTURE} × les ${hauteurReference} px du relevé) — le document a été vidé de sa matière ` +
            `(${mesure.noeuds} nœuds, style ${mesure.style.toFixed(1)} ms + layout ${mesure.layout.toFixed(1)} ms). ` +
            'La hauteur s’accorde à 0,9 % près entre les deux hôtes mesurés (7 075 → 7 107 px sur l’accueil mobile) : ' +
            'un écart de cette grandeur ne vient pas de la machine.'
        ).toBeGreaterThanOrEqual(plancherHauteur);

        // ── Le coût est PUBLIÉ, jamais jugé ───────────────────────────────
        // Une borne en millisecondes bornerait la machine : le même artefact
        // coûte de 1,85 à 8,2 fois moins cher sur le runner de la CI (/ — mobile :
        // 662 ms ici, 80,4 ms là-bas ; /payment desktop : 43 contre 23,2).
        // Les deux relevés voyagent donc dans le
        // journal, avec leurs hôtes, et le verdict s'arrête à la structure.
        const coutCI = MESURE_CI[chemin]?.[condition.nom];
        console.log(
          `ℹ️  Document ${chemin} (${condition.nom}) : ${mesure.noeuds} nœuds, ${mesure.hauteur} px de haut, ` +
            `${mesure.total.toFixed(1)} ms de coût (style ${mesure.style.toFixed(1)} + layout ${mesure.layout.toFixed(1)}, ` +
            `étendue ${mesure.etendue.toFixed(1)} ms sur ${RUNS} runs) — relevé du poste partagé ` +
            `${MESURE[chemin][condition.nom]} ms` +
            (coutCI ? `, même artefact sur le runner de la CI ${coutCI} ms` : '') +
            ' — le TEMPS est publié, pas jugé (de 1,85 à 8,2× entre deux hôtes) ; ce qui décide est la structure.'
        );
      });
    }
  }

  test('la table de structure couvre EXACTEMENT les routes pré-rendues', () => {
    expect(Object.keys(NOEUDS).sort()).toEqual([...ROUTES].sort());
    expect(Object.keys(HAUTEUR).sort()).toEqual([...ROUTES].sort());
    for (const condition of CONDITIONS) {
      for (const chemin of Object.keys(NOEUDS)) {
        expect(
          HAUTEUR[chemin][condition.nom],
          `${chemin}/${condition.nom} : hauteur de référence absente`
        ).toBeGreaterThan(0);
        expect(
          MESURE[chemin][condition.nom],
          `${chemin}/${condition.nom} : coût de référence absent — le journal publierait un chiffre sans provenance`
        ).toBeGreaterThan(0);
        // Le plancher doit laisser passer le document mesuré, dans les DEUX
        // hôtes connus : sinon il condamnerait la machine au lieu de l'artefact.
        const hauteurCI = MESURE_CI[chemin]?.[condition.nom];
        if (hauteurCI) expect(hauteurCI, `${chemin}/${condition.nom} : coût CI absurde`).toBeGreaterThan(0);
      }
    }
    for (const chemin of Object.keys(NOEUDS)) {
      expect(plancherNoeudsDe(NOEUDS[chemin]), chemin).toBeLessThan(NOEUDS[chemin]);
      for (const condition of CONDITIONS) {
        expect(plancherHauteurDe(HAUTEUR[chemin][condition.nom]), `${chemin}/${condition.nom}`).toBeLessThan(
          HAUTEUR[chemin][condition.nom]
        );
      }
    }
  });
});
