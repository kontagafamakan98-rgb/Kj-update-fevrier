import { test, expect } from '@playwright/test';
// La liste des routes, les deux tailles et le protocole à deux peintures (le
// bundle d'entrée est bloqué pour mesurer la coquille SEULE) appartiennent au
// harnais partagé : la table unique `src/config/page-meta.js` en est la source,
// jamais une copie. `geometrie-coquille-react.spec.js` mesure la même chose par
// l'autre bout (rect, encre, text-align, navbar).
import { ROUTES, TAILLES, ouvrirLaPage } from './helpers/geometrie.js';
import { shellFileFor } from '../scripts/site-meta.js';

/**
 * LA sonde de géométrie du LCP : pour chaque route pré-rendue, l'élément LCP
 * peint par la COQUILLE est mesuré face à celui que React finit par peindre, et
 * la sonde échoue quand le repaint de React est PLUS GRAND.
 *
 * ── Le mécanisme, mesuré (Chrome 152, serveur de rewrites de vercel.json) ────
 * La coquille pré-rendue peint le plus grand texte de la page avant tout
 * JavaScript. `createRoot()` efface ensuite `#root`, React reconstruit la même
 * page, et Chrome ne ré-élit un élément LCP que pour une aire STRICTEMENT plus
 * grande. Donc :
 *   • remplacement de MÊME TAILLE → aucun nouvel élément LCP : la peinture de
 *     la coquille reste celle que le navigateur retient, et rien du JavaScript
 *     n'entre dans le graphe LCP simulé de Lantern ;
 *   • remplacement PLUS GRAND → un SECOND élément LCP, plus tardif, et toute la
 *     chaîne JavaScript se fait facturer (mesuré sur /jobs avant correctif :
 *     `elementRenderDelay` de 1156 à 2345 ms, score desktop 92 au lieu de 100 ;
 *     sur /contact avant la façade de carte : LCP 4143-4399 ms simulés, 81-85).
 *
 * ── Comment la coquille est mesurée SEULE ───────────────────────────────────
 * Deux navigations de la MÊME route :
 *   1. « coquille » : le bundle d'entrée de l'application est BLOQUÉ par la
 *      sonde. Le HTML pré-rendu se peint, notre observateur (installé AVANT la
 *      navigation, `buffered: true`) enregistre la candidate, et React ne monte
 *      jamais — c'est la peinture que le navigateur garderait si la géométrie
 *      de React restait sage ;
 *   2. « réelle » : navigation normale. S'il n'y a qu'UNE candidate et qu'elle
 *      est horodatée au premier paint, React a reconstruit sans ré-élire
 *      d'élément : la coquille a gagné. Deux candidates — ou une seule mais plus
 *      grande que celle de la coquille — signifient que React a peint PLUS
 *      GRAND, et c'est un échec.
 *
 * Ce que cette sonde ne remplace pas : `e2e/contact-lcp.spec.js` mesure le FAIT
 * sur /contact (et la mutation qui fait diverger la géométrie le fait rougir),
 * et les gardes de `scripts/__tests__/check-*-lcp.test.js` refusent la
 * divergence à la SOURCE (un propriétaire unique des classes). Cette sonde-ci
 * couvre TOUTES les routes pré-rendues, et c'est elle qui dira qu'une nouvelle
 * page pré-rendue — ou un composant retouché — a divergé, sans que personne ait
 * pensé à l'y inscrire.
 */
// Tolérance : les aires comparées sortent de `getBoundingClientRect()` et de la
// géométrie interne du navigateur. Un écart de sous-pixel ne doit pas rougir ;
// la divergence qui compte — celle qui ré-élit un élément LCP — se compte en
// dizaines de pour cent (mesuré : 36 002 → 36 049 px² sur /jobs, +0,13 %, a
// suffi, mais c'est le RÉ-ÉLECTION qui fait le dégât, pas l'aire). La règle
// d'échec est donc celle du navigateur : React n'a pas le droit de peindre plus
// grand, à 1 px² près.
const EPSILON_PX2 = 1;

/**
 * Observateur installé AVANT la navigation : chaque candidate
 * `largest-contentful-paint` est enregistrée avec son aire, son cadre, sa balise
 * et son texte (de quoi NOMMER la peinture fautive dans le message d'échec), et
 * le premier paint, auquel le LCP de la coquille doit être horodaté.
 */
const ESPION_LCP = () => {
  window.__kojoLcp = { candidates: [], fcp: null };
  const cadre = (element) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    const r = element.getBoundingClientRect();
    return {
      x: +r.x.toFixed(2),
      y: +r.y.toFixed(2),
      largeur: +r.width.toFixed(2),
      hauteur: +r.height.toFixed(2),
      aire: +(r.width * r.height).toFixed(1),
    };
  };
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      window.__kojoLcp.candidates.push({
        debut: +entree.startTime.toFixed(1),
        taille: entree.size,
        cadre: cadre(entree.element),
        balise: entree.element ? entree.element.tagName : '?',
        texte: entree.element ? String(entree.element.textContent || '').trim().slice(0, 40) : '',
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      if (entree.name === 'first-contentful-paint') window.__kojoLcp.fcp = +entree.startTime.toFixed(1);
    }
  }).observe({ type: 'paint', buffered: true });
};

/** Description lisible d'une candidate, pour les messages d'échec. */
const decrire = (candidate) =>
  `t=${candidate.debut} ms, aire=${candidate.taille} px², <${candidate.balise}>« ${candidate.texte} », ` +
  `cadre=${candidate.cadre ? `${candidate.cadre.largeur}×${candidate.cadre.hauteur} @ (${candidate.cadre.x}, ${candidate.cadre.y})` : 'inconnu'}`;

/**
 * Navigue `chemin` sur une page neuve et rend le relevé LCP.
 *
 * @param {import('@playwright/test').Browser} browser Navigateur du test.
 * @param {string} chemin Route (« /jobs »).
 * @param {{peinture: 'coquille'|'reelle', viewport: {width: number, height: number}}} options
 *   `peinture: 'coquille'` bloque le bundle d'entrée : le HTML pré-rendu se peint
 *   et React ne monte pas.
 */
async function relever(browser, chemin, { peinture, viewport }) {
  // Une page NEUVE par relevé, à la taille demandée : l'état (routes bloquées,
  // observateur, dates de performance) ne se partage pas entre les deux
  // peintures, sinon la seconde serait mesurée avec les restes de la première.
  const page = await ouvrirLaPage(browser, peinture, viewport);
  try {
    await page.addInitScript(ESPION_LCP);
    await page.goto(chemin);
    // Laisse le temps au montage (`first-contentful-paint` déclenche
    // `root.render`, puis le repaint) : une seconde candidate, si elle existe,
    // est enregistrée ici.
    await page.waitForTimeout(1000);
    return await page.evaluate(() => window.__kojoLcp);
  } finally {
    await page.close();
  }
}

test.describe('Parcours E2E — la géométrie du LCP de chaque route pré-rendue', () => {
  test.describe.configure({ mode: 'serial' });

  for (const route of ROUTES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille} : React ne peint pas plus grand que la coquille (${shellFileFor(route)})`, async ({ browser }) => {
        const coquille = await relever(browser, route, { peinture: 'coquille', viewport });

        expect(
          coquille.fcp,
          `${route} (${taille}) : la coquille n'a rien peint (premier paint absent) — le relevé ne peut rien prouver`
        ).not.toBeNull();
        expect(
          coquille.candidates.length,
          `${route} (${taille}) : aucune candidate LCP pour la coquille ; le HTML pré-rendu de ${shellFileFor(route)} ne publie pas l'élément LCP de la page`
        ).toBeGreaterThan(0);
        const peintureCoquille = coquille.candidates[coquille.candidates.length - 1];

        const reelle = await relever(browser, route, { peinture: 'reelle', viewport });
        expect(
          reelle.fcp,
          `${route} (${taille}) : premier paint absent dans la navigation réelle`
        ).not.toBeNull();

        // ── Le verdict ─────────────────────────────────────────────────────
        // Une seule candidate dans la navigation réelle : la peinture de la
        // coquille est celle que Chrome retient (React a reconstruit sans
        // ré-élire d'élément). Deux candidates : la seconde est le repaint de
        // React, donc plus GRAND, donc la chaîne JavaScript entre dans le LCP.
        expect(
          reelle.candidates.map(decrire),
          `${route} (${taille}) : React a peint un élément PLUS GRAND que la coquille — le repaint devient ` +
            'l\'élément LCP et toute la chaîne JavaScript se fait facturer.\n' +
            `      coquille (${shellFileFor(route)}, JavaScript bloqué) : ${decrire(peintureCoquille)}\n` +
            '      Corriger la GÉOMÉTRIE, pas le repaint : les classes de l\'élément LCP doivent avoir UN ' +
            'propriétaire lu par les deux canaux (src/config/page-sections.js).'
        ).toHaveLength(1);

        const peintureReact = reelle.candidates[0];
        expect(
          peintureReact.debut,
          `${route} (${taille}) : le LCP n'est plus le premier paint — il est peint après coup, donc par le JavaScript`
        ).toBe(reelle.fcp);
        expect(
          peintureReact.taille,
          `${route} (${taille}) : React a peint une aire PLUS GRANDE que la coquille ` +
            `(${peintureReact.taille} px² contre ${peintureCoquille.taille} px² ; tolérance ${EPSILON_PX2} px²)\n` +
            `      coquille : ${decrire(peintureCoquille)}\n` +
            `      React    : ${decrire(peintureReact)}`
        ).toBeLessThanOrEqual(peintureCoquille.taille + EPSILON_PX2);

        // Un vert sans chiffre ne prouve rien (règle du dépôt) : la comparaison
        // mesurée est publiée, coquille et React, pour chaque route et chaque
        // taille.
        console.log(
          `ℹ️  LCP ${route} (${taille}) : coquille ${peintureCoquille.taille} px² ` +
            `<${peintureCoquille.balise}> à t=${peintureCoquille.debut} ms — React ${peintureReact.taille} px² ` +
            `<${peintureReact.balise}>, une seule candidate, au premier paint (${reelle.fcp} ms)`
        );
      });
    }
  }
});
