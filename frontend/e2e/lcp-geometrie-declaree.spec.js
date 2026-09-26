import { test, expect } from '@playwright/test';
import { TAILLES } from './helpers/geometrie.js';
// Le plan est LE propriétaire de la géométrie du plus grand texte (voir le
// fichier et `scripts/__tests__/check-lcp-geometrie.test.js`) : cette sonde le
// lit au lieu de recopier les classes attendues, sinon elle vérifierait sa
// propre copie — le défaut exact qu'elle existe pour fermer.
import { PAGE_SECTIONS } from '../src/config/page-sections.js';

/**
 * Le LCP de ces quatre routes reste la PEINTURE DE LA COQUILLE, et c'est
 * l'élément que le plan DÉCLARE.
 *
 * ── Ce que cette sonde ajoute à celle de /contact, et à la sonde générale ───
 * `e2e/contact-lcp.spec.js` mesure le FAIT sur /contact (une seule candidate, à
 * l'instant du premier paint) ; `e2e/lcp-geometrie.spec.js` mesure TOUTES les
 * routes (React ne peint pas plus grand que la coquille). Ni l'une ni l'autre
 * ne dit QUELLE classe le navigateur a élue : deux éléments de même aire
 * passeraient, et le jour où ils divergeraient, la cause — une géométrie
 * recopiée dans un canal au lieu d'être lue — ne serait plus nommée nulle part.
 *
 * Ici, l'assertion est l'IDENTITÉ : l'élément élu porte exactement l'ensemble de
 * classes que `src/config/page-sections.js` déclare pour cette route, et il est
 * horodaté au premier paint. C'est la signature de « la coquille a gagné »,
 * doublée de la preuve que le propriétaire unique couvre bien l'élément réel.
 *
 * ── Le mécanisme, mesuré (Chrome 152, pile de la CI, 25/09/2026) ────────────
 * Deux navigations, 412×823 et 1350×940, bundle d'entrée BLOQUÉ pour la
 * coquille et navigation réelle pour React :
 *
 *   /jobs           <p> l'introduction          35 640 (mobile) / 36 002 px²
 *   /about          <p> l'introduction          74 466 / 80 262 px²
 *   /privacy        <p> le CORPS d'une section  84 360 / 86 676 px²
 *   /how-it-works   <p> le sous-titre du héros   30 320 / 32 656 px²
 *
 * ── Et le 26/09/2026, les quatre routes restantes ───────────────────────────
 * Même sonde, navigation RÉELLE : l'élément élu y est un paragraphe SECONDAIRE
 * (ligne légale, notice d'étape, sous-titres), mesuré sur 412×823 et 1350×940 :
 * /login (10 848 / 12 448 px²), /register (10 048 / 12 544), /forgot-password
 * (14 001 / 16 458) et /support (16 468 / 9 324). Les planchers déclarés
 * ci-dessous sont la PLUS PETITE des deux tailles mesurées, diminuée d'un cran.
 * (La notice d'étape de /register est passée de 10 560 à 10 048 px² mobile le
 * 26/09/2026 : son ⚠️ emoji est devenu un SVG, et la ligne se replie un cran
 * plus bas — même élément élu, aire légèrement plus petite.)
 *
 * UNE SEULE candidate dans les deux canaux, au premier paint, d'aire IDENTIQUE :
 * la peinture de la coquille reste celle que Chrome retient, et rien du
 * JavaScript n'entre dans le graphe LCP simulé de Lantern. Un remplacement PLUS
 * GRAND, lui, ré-élit un élément (mesuré sur /jobs avant correctif :
 * `elementRenderDelay` de 1156 à 2345 ms, score desktop 92 au lieu de 100).
 */
const ROUTES_DECLAREES = [
  { route: '/jobs', champ: 'introClass', plancher: 30000 },
  { route: '/about', champ: 'introClass', plancher: 60000 },
  // Sur cette page, le plus grand texte peint est un CORPS de section : c'est
  // `sectionBodyClass` qui porte l'élément élu, pas l'introduction.
  { route: '/privacy', champ: 'sectionBodyClass', plancher: 70000 },
  { route: '/how-it-works', champ: 'heroSubtitleClass', plancher: 25000 },
  // Le plus grand texte peint de ces quatre pages est un paragraphe secondaire,
  // pas le titre : ligne légale de /login, notice d'étape de /register,
  // sous-titres de /forgot-password et de /support (voir la mesure en tête).
  { route: '/login', champ: 'legalContactClass', plancher: 10000 },
  { route: '/register', champ: 'stepNoticeClass', plancher: 9000 },
  { route: '/forgot-password', champ: 'subtitleClass', plancher: 13000 },
  { route: '/support', champ: 'subtitleClass', plancher: 9000 },
];

/**
 * Observateur installé AVANT la navigation : chaque candidate
 * `largest-contentful-paint` est enregistrée avec son horodatage, la taille qui
 * a servi à l'élire, les classes de son élément et son aire — de quoi NOMMER la
 * peinture fautive dans un message d'échec — plus le premier paint, auquel le
 * LCP de la coquille doit être horodaté.
 */
const ESPION_LCP = () => {
  window.__kojoLcp = { candidates: [], fcp: null };
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      const el = entree.element;
      const rect = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      window.__kojoLcp.candidates.push({
        debut: +entree.startTime.toFixed(1),
        taille: entree.size,
        balise: el ? el.tagName : '?',
        classes: el && typeof el.className === 'string' ? el.className : '(sans classe)',
        aire: rect ? +(rect.width * rect.height).toFixed(1) : null,
        texte: el ? String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) : '',
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      if (entree.name === 'first-contentful-paint') window.__kojoLcp.fcp = +entree.startTime.toFixed(1);
    }
  }).observe({ type: 'paint', buffered: true });
};

/** L'ensemble des classes d'une chaîne, pour comparer sans dépendre de l'ordre. */
const ensembleDeClasses = (valeur) =>
  [...new Set(String(valeur || '').split(/\s+/).filter(Boolean))].sort().join(' ');

test.describe('Parcours E2E — le LCP déclaré de chaque route reste la peinture de la coquille', () => {
  test.describe.configure({ mode: 'serial' });

  for (const { route, champ, plancher } of ROUTES_DECLAREES) {
    for (const { nom: taille, viewport } of TAILLES) {
      test(`${route} — ${taille} : l'élément élu porte la géométrie déclarée (${champ})`, async ({ browser }) => {
        const declare = PAGE_SECTIONS[route]?.[champ];
        expect(
          declare,
          `${route} : le plan ne déclare plus \`${champ}\` — la géométrie de son plus grand texte n'a plus ` +
            'de propriétaire, donc cette sonde ne peut plus rien vérifier'
        ).toBeTruthy();

        const page = await browser.newPage({ viewport });
        try {
          await page.addInitScript(ESPION_LCP);
          await page.goto(route);
          // Laisse le temps à createRoot, à la reconstruction de la page et au
          // repaint : une seconde candidate, si elle existe, apparaît ici.
          await page.waitForTimeout(1500);
          const releve = await page.evaluate(() => window.__kojoLcp);

          expect(
            releve.fcp,
            `${route} (${taille}) : aucun premier paint relevé — le relevé ne peut rien prouver`
          ).not.toBeNull();

          const decrire = (c) =>
            `t=${c.debut} ms, taille=${c.taille} px², <${c.balise}> aire=${c.aire} px² ` +
            `[${c.classes}] « ${c.texte} »`;

          // ── La garantie : UNE candidate, horodatée au premier paint ──────
          expect(
            releve.candidates.map(decrire),
            `${route} (${taille}) : React a peint un élément PLUS GRAND que la coquille — le repaint devient ` +
              "l'élément LCP et toute la chaîne JavaScript se fait facturer. Corriger la GÉOMÉTRIE, pas le " +
              'repaint : les classes de l\'élément LCP doivent rester lues dans src/config/page-sections.js.\n' +
              `      déclaré par le plan (\`${champ}\`) : ${declare}`
          ).toHaveLength(1);

          const candidate = releve.candidates[0];
          expect(
            candidate.debut,
            `${route} (${taille}) : le LCP n'est plus le premier paint — il est peint après coup, donc par le ` +
              'JavaScript'
          ).toBe(releve.fcp);

          // ── L'IDENTITÉ : l'élément élu EST celui que le plan déclare ─────
          expect(
            ensembleDeClasses(candidate.classes),
            `${route} (${taille}) : le navigateur a élu <${candidate.balise}> « ${candidate.texte} » ` +
              `[${candidate.classes}], qui n'est pas l'élément déclaré par le plan (\`${champ}\` = ${declare}). ` +
              'Une classe recopiée dans un canal au lieu d\'être lue dans le plan produit exactement ceci : ' +
              'un élément élu que le propriétaire unique ne décrit pas.'
          ).toBe(ensembleDeClasses(declare));

          expect(
            candidate.taille,
            `${route} (${taille}) : l'élément LCP déclaré est trop petit pour être le plus grand texte peint `
              + `(${candidate.taille} px² pour un plancher mesuré de ${plancher}) — la page n'a plus de bloc `
              + 'assez grand au premier paint, et le plus grand texte devient celui d\'un état asynchrone'
          ).toBeGreaterThan(plancher);

          // Un vert sans chiffre ne prouve rien (règle du dépôt) : la mesure est
          // publiée, élément, classes, aire et horodatage compris.
          console.log(
            `ℹ️  LCP déclaré ${route} (${taille}) : <${candidate.balise}> « ${candidate.texte} » ` +
              `taille=${candidate.taille} px² aire=${candidate.aire} px², une seule candidate au premier ` +
              `paint (${releve.fcp} ms), classes = celles du plan (\`${champ}\`)`
          );
        } finally {
          await page.close();
        }
      });
    }
  }
});
