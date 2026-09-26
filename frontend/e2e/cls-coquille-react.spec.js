import { test, expect } from '@playwright/test';
// Le protocole (page neuve par relevé, bundle d'entrée bloqué pour la coquille)
// et la liste des routes appartiennent au harnais partagé : la table unique
// `src/config/page-meta.js` en est la source.
import { ROUTES, TAILLES, attendreLaStabilite, ouvrirLaPage } from './helpers/geometrie.js';
import { ESPION_CLS, clsDesDecalages, decrireCls, decrireDecalage } from './helpers/cls.js';
// LE BUDGET EST LU ICI, JAMAIS RECOPIÉ : `scripts/lhci-cls-budgets.cjs` porte la
// table mesurée (un plafond par route, avec son relevé) et c'est elle que la CI
// applique — les deux passes Lighthouse, mobile et desktop. Deux tables de
// budgets divergeraient en silence.
import budgets from '../scripts/lhci-cls-budgets.cjs';
import { shellFileFor } from '../scripts/site-meta.js';

const CLS_BUDGETS = budgets.CLS_BUDGETS;

/**
 * LA sonde de STABILITÉ VERTICALE : combien le montage de React déplace-t-il la
 * page, route par route, et est-ce dans le budget ?
 *
 * ── Deux navigations, et ce que chacune mesure ─────────────────────────────
 *   1. « coquille » — le bundle d'entrée est BLOQUÉ : React ne monte jamais. Le
 *      CLS mesuré est celui de la COQUILLE seule : s'il n'est pas dans le
 *      budget, aucun correctif côté React ne peut l'expliquer (police tardive,
 *      image sans dimensions, bandeau inséré après coup) — et c'est un défaut à
 *      part entière, la coquille étant ce que voit un visiteur sans JavaScript ;
 *   2. « réelle » — navigation normale : le CLS mesuré est celui du MONTAGE de
 *      React, c'est-à-dire ce que la page fait après son premier paint (l'état
 *      de géolocalisation change, les données asynchrones se posent).
 * La comparaison des deux est une ATTRIBUTION : sur un rouge, savoir si la
 * coquille bougeait déjà ou si c'est React qui déplace change complètement le
 * correctif.
 *
 * ── Ce que cette sonde a appris en mesurant (25/09/2026) ────────────────────
 *   • LA COQUILLE SEULE NE BOUGE PAS : 0,0000 sur les 22 relevés, 0 décalage.
 *   • LE MONTAGE NE BOUGE PAS NON PLUS, à proprement parler : remplacer le corps
 *     d'`#root` crée des nœuds NEUFS, et Chrome ne compte le déplacement d'un
 *     nœud que s'il existait déjà dans la mise en page précédente. Vérifié par
 *     une mutation : insérer un bloc de 220 px en tête de /support côté React ne
 *     produit AUCUN décalage (remesuré 0,0000 des deux côtés). Ce qui produit du
 *     CLS, ce sont les changements APRÈS le montage — et c'est ce que cette
 *     sonde attrape : le formulaire de /register descend de 14 px quand la
 *     détection de position échoue (0,0088, la valeur exacte des 27 runs de la
 *     CI), le pied de page de /payment disparaît à la redirection (0,0296,
 *     mesuré sur 412 px), /support desktop voit son pied de page passer de 0 à
 *     31 px de haut (0,0023).
 *   • La conclusion pratique : un budget CLS ne garde pas « le montage » mais les
 *     réactions qui le suivent. C'est exactement pour cela que le premier rendu
 *     n'est PAS gelé ici (voir plus bas) : geler l'état, c'est ne plus mesurer
 *     que 0.
 *
 * ── Pourquoi le premier rendu n'est PAS gelé (contrairement aux autres sondes) ─
 * `gelerLePremierRendu` empêche React de changer d'état, pour comparer deux
 * PEINTURES. Ici ce serait une faute : le budget de la CI est mesuré AVEC le
 * changement d'état du visiteur réel (sur /register, la détection de
 * géolocalisation qui échoue remplace un texte et déplace le formulaire de
 * 14 px — les 0,0088 du budget), et geler l'état mesurerait une page plus sage
 * que celle qu'on sert. La géométrie et le contenu ont leurs sondes ; celle-ci
 * mesure ce que le visiteur SUBIT.
 *
 * ── La mesure, et pourquoi ce n'est pas Lighthouse ─────────────────────────
 * La grandeur est le CLS de Chrome, avec son algorithme de FENÊTRE DE SESSION
 * (décalages à moins d'une seconde l'un de l'autre, sur au plus 5 s, et l'on
 * retient la plus grande fenêtre — additionner ferait rougir un artefact sain).
 * Ce que Lighthouse CI ajoute et que cette sonde n'a pas : trois runs par page et
 * une médiane. Ce que cette sonde ajoute : les SOURCES de chaque décalage (nœud,
 * rectangle avant, rectangle après), à 412×823 ET 1350×940, et la séparation
 * coquille / React. Chaque cas PUBLIE ses chiffres AVANT de conclure : un rouge
 * doit être réparable, et un vert explicable.
 *
 * ── Les budgets ────────────────────────────────────────────────────────────
 * Aucun chiffre n'est écrit ici : `CLS_BUDGETS` est la table de la CI, lue par
 * import, et la même table sert les deux passes Lighthouse (donc les deux
 * tailles mesurées). Une route de `page-meta.js` sans budget mesuré n'est pas
 * auditée « sans plafond » : elle fait ROUGIR un cas dédié — le refus que la CI
 * applique déjà au chargement de sa config (`clsAssertionMatrix`).
 */

/** Une route sans budget mesuré ne peut pas être auditée : le refus est un cas. */
test('budgets CLS — chaque route pré-rendue a un plafond MESURÉ', () => {
  const sansBudget = ROUTES.filter((route) => !Object.hasOwn(CLS_BUDGETS, route));
  expect(
    sansBudget,
    `route(s) pré-rendue(s) sans budget CLS dans scripts/lhci-cls-budgets.cjs : ${sansBudget.join(', ')} — ` +
      'mesurer la page (artifacts `lighthouse-reports` d’un job) puis l’y ajouter. Sans valeur mesurée, la route ' +
      'serait auditée SANS plafond : la régression qu’on veut attraper passerait, et rien ne le dirait.'
  ).toEqual([]);
});

/**
 * Navigue `route` sur une page neuve et rend le relevé CLS.
 *
 * @param {import('@playwright/test').Browser} browser Navigateur du test.
 * @param {string} route Route mesurée (« /jobs »).
 * @param {{peinture: 'coquille'|'reelle', viewport: {width: number, height: number}}} options
 *   `peinture: 'coquille'` bloque le bundle d'entrée : React ne monte pas.
 */
async function relever(browser, route, { peinture, viewport }) {
  const page = await ouvrirLaPage(browser, peinture, viewport);
  try {
    // AVANT la navigation : les décalages du premier paint seraient enregistrés
    // avant que l'observateur ne les écoute (il observe avec `buffered: true`).
    await page.addInitScript(ESPION_CLS);
    await page.goto(route);
    // La mise en page doit se stabiliser, PUIS la fenêtre de session se fermer
    // (1 s sans décalage) pour que le relevé couvre tout le chargement.
    await attendreLaStabilite(page);
    await page.waitForTimeout(1200);
    const releve = await page.evaluate(() => ({
      url: location.pathname,
      decalages: window.__kojoCls.decalages,
      fcp: window.__kojoCls.fcp,
    }));
    return { ...releve, ...clsDesDecalages(releve.decalages) };
  } finally {
    await page.close();
  }
}

/** Les `max` décalages d'un relevé, du plus grand au plus petit. */
const plusGrands = (releve, max = 3) => [...releve.decalages].sort((a, b) => b.valeur - a.valeur).slice(0, max);

test.describe('Parcours E2E — le CLS de chaque route pré-rendue, coquille puis montage de React', () => {
  for (const route of ROUTES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille}`, async ({ browser }) => {
        const budget = CLS_BUDGETS[route] ? CLS_BUDGETS[route].max : null;
        expect(
          budget,
          `${route} (${taille}) : aucun budget CLS mesuré dans scripts/lhci-cls-budgets.cjs — la route ne peut pas ` +
            'être auditée sans plafond.'
        ).not.toBeNull();

        const coquille = await relever(browser, route, { peinture: 'coquille', viewport });
        const reelle = await relever(browser, route, { peinture: 'reelle', viewport });

        // ── Anti-faux-vert : une mesure sans paint ne décrit rien ────────
        expect(
          coquille.fcp,
          `${route} (${taille}) : la coquille n'a rien peint (premier paint absent) — le CLS relevé ne décrit rien`
        ).not.toBeNull();
        expect(
          reelle.fcp,
          `${route} (${taille}) : premier paint absent dans la navigation réelle — le CLS relevé ne décrit rien`
        ).not.toBeNull();

        // ── Le relevé AVANT le verdict : un rouge doit être réparable ────
        console.log(
          `ℹ️  CLS ${route} (${taille}) : coquille ${coquille.cls.toFixed(4)} ` +
            `(${coquille.decalages.length} décalage(s), somme ${coquille.total.toFixed(4)}) · ` +
            `React ${reelle.cls.toFixed(4)} (${reelle.decalages.length} décalage(s), somme ${reelle.total.toFixed(4)}) ` +
            `· plafond ${budget} (${CLS_BUDGETS[route].mesure}) — ` +
            (reelle.url === route ? 'route conservée' : `redirigé vers ${reelle.url}`)
        );
        for (const decalage of plusGrands(reelle)) {
          console.log(`      · montage React : ${decrireDecalage(decalage)}`);
        }
        for (const decalage of plusGrands(coquille)) {
          console.log(`      · coquille seule : ${decrireDecalage(decalage)}`);
        }

        // ── 1. La coquille SEULE ne bouge pas ─────────────────────────────
        // Le budget de la route est plus large que ce qu'on attend ici (du HTML
        // statique et du CSS inline) : le comparer à la MÊME table évite
        // d'inventer un second chiffre, et un décalage de coquille au-delà du
        // budget de sa page serait un défaut de toute façon.
        expect(
          coquille.cls,
          `${route} (${taille}) : la COQUILLE seule (JavaScript bloqué, ${shellFileFor(route)}) déplace la page de ` +
            `${coquille.cls.toFixed(4)} pour un plafond de ${budget} — aucun correctif React ne peut l'expliquer.\n` +
            `      ${decrireCls(coquille.cls, coquille)}\n` +
            plusGrands(coquille)
              .map((decalage) => `      · ${decrireDecalage(decalage)}`)
              .join('\n')
        ).toBeLessThanOrEqual(budget);

        // ── 2. Le montage de React tient le budget de sa route ────────────
        expect(
          reelle.cls,
          `${route} (${taille}) : le montage de React déplace la page de ${reelle.cls.toFixed(4)} pour un plafond de ` +
            `${budget} (scripts/lhci-cls-budgets.cjs : ${CLS_BUDGETS[route].mesure}).\n` +
            `      ${decrireCls(reelle.cls, reelle)}\n` +
            plusGrands(reelle)
              .map((decalage) => `      · ${decrireDecalage(decalage)}`)
              .join('\n') +
            '\n      Corriger la STABILITÉ (dimensions réservées par la coquille, squelette de même hauteur), ' +
            'pas le budget.'
        ).toBeLessThanOrEqual(budget);
      });
    }
  }
});
