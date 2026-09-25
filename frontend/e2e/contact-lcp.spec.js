import { test, expect } from '@playwright/test';

/**
 * /contact : le LCP est la PEINTURE DE LA COQUILLE, pas le repaint de React.
 *
 * ── Ce que ce parcours mesure, et que rien d'autre ne peut mesurer ──────────
 * La coquille pré-rendue publie le paragraphe d'introduction — l'élément LCP de
 * la page — avant tout JavaScript. `createRoot()` efface ensuite `#root` et
 * React reconstruit le même paragraphe. Ce qui décide du verdict est l'ÉGALITÉ
 * des deux peintures : un remplacement de MÊME TAILLE n'enregistre aucun nouvel
 * élément LCP, tandis qu'un remplacement PLUS GRAND en enregistre un second,
 * plus tardif, et toute la chaîne JavaScript entre alors dans le graphe LCP
 * simulé de Lantern (mesuré sur /jobs : `elementRenderDelay` de 1156 à 2345 ms,
 * score desktop 92 au lieu de 100).
 *
 * La géométrie des deux peintures a un propriétaire unique
 * (`src/config/page-sections.js`, refusé par
 * `scripts/__tests__/check-contact-lcp.test.js`) ; ce parcours-ci vérifie le
 * FAIT : une seule candidate LCP, et son horodatage est celui du premier paint.
 * C'est la signature de « la coquille a gagné » — un repaint de React, lui,
 * arrive strictement plus tard (la garantie d'amorçage : le montage attend
 * l'entry `first-contentful-paint`).
 *
 * Le relevé est pris dans la page, via un `PerformanceObserver` sur
 * `largest-contentful-paint` avec `buffered: true` (les entries déjà produites
 * sont livrées), installé AVANT la navigation.
 */
const ESPION_LCP = () => {
  window.__kojoLcp = { candidates: [], fcp: null };
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      window.__kojoLcp.candidates.push({
        debut: +entree.startTime.toFixed(1),
        taille: entree.size,
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

test.describe('Parcours E2E — le LCP de /contact reste la peinture de la coquille', () => {
  test('une seule candidate LCP, horodatée au premier paint', async ({ page }) => {
    await page.addInitScript(ESPION_LCP);
    await page.goto('/contact');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Laisse le temps à createRoot, à la reconstruction de la page et au
    // repaint : une seconde candidate, si elle existe, apparaît ici.
    await page.waitForTimeout(1500);

    const releve = await page.evaluate(() => window.__kojoLcp);
    expect(releve.fcp, 'aucun premier paint relevé : le relevé ne peut rien prouver').not.toBeNull();

    // La garantie tient à UNE candidate : une seconde, plus tardive, serait le
    // repaint de React — donc la chaîne JavaScript facturée au LCP.
    expect(
      releve.candidates.map((c) => `t=${c.debut} taille=${c.taille} <${c.balise}>`),
      'la géométrie des deux peintures a divergé : React a peint un élément PLUS GRAND que la coquille'
    ).toHaveLength(1);

    const candidate = releve.candidates[0];
    expect(candidate.debut, 'le LCP n’est plus le premier paint').toBe(releve.fcp);
    expect(candidate.taille).toBeGreaterThan(10000);
  });
});
