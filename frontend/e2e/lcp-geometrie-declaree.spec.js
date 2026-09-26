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
 * (14 001 / 16 458) et /support (16 468 / 9 324).
 * (La notice d'étape de /register est passée de 10 560 à 10 048 px² mobile le
 * 26/09/2026 : son ⚠️ emoji est devenu un SVG, et la ligne se replie un cran
 * plus bas — même élément élu, aire légèrement plus petite.)
 *
 * ── LES PLANCHERS, ET CE QUE LA POLICE SERVIE LEUR A FAIT (26/09/2026) ──────
 * Première leçon, mesurée : l'aire de l'ENCRE d'un texte n'est pas portable, elle
 * suit les polices de l'hôte. Le MÊME document, mêmes classes, même élément élu,
 * mesuré sur le runner Linux de la CI (run 36254013043, Chrome 152) : /jobs
 * 35 055 / 30 874, /about 73 340 / 78 208, /privacy 83 058 / 83 400,
 * /how-it-works 27 056 / 30 240, /login 10 290 / 12 120, /register 9 796 /
 * 12 183, /forgot-password 13 104 / 15 336 et /support 15 120 / 7 616 — jusqu'à
 * −18 % de ce poste-ci, alors que la BOÎTE de l'élément ne bouge pas (16 380 px²
 * pour le sous-titre de /support des deux côtés : c'est l'encre qui change, pas
 * le cadre). Des planchers calés à 1 ou 3 % sous le relevé d'UN SEUL hôte
 * (/forgot-password mobile : 13 000 pour 13 104 mesurés ici ; /support desktop :
 * 9 000 pour 7 616 là-bas) ne bornaient pas la page, ils bornaient la MACHINE.
 *
 * Deuxième leçon, et c'est le remède : depuis que `src/index.css` sert Inter et
 * que toutes les pages la préchargent, LES DEUX HÔTES RENDENT LA MÊME POLICE.
 * Les valeurs ci-dessus décrivent l'artefact d'AVANT (police du système) et sont
 * gardées comme histoire ; les planchers sont re-calés sur les DEUX tailles
 * re-mesurées avec la police servie, chaque route en commentaire de sa ligne.
 * Relevé du 26/09/2026 (une seule candidate au premier paint, élément élu et
 * classes inchangés sur les 8 routes) : /jobs 36 750 / 35 144, /about 82 940 /
 * 79 540, /privacy 91 630 / 100 788, /how-it-works 26 334 / 32 928, /login
 * 15 040 / 12 834, /register 9 548 / 12 338, /forgot-password 13 690 / 16 095 et
 * /support 16 720 / 9 480 — la police servie est un peu plus large que celle de
 * ce poste-ci, donc l'encre monte (sauf /how-it-works, /register et
 * /forgot-password, qui perdent quelques centaines de px² au re-pli).
 *
 * Chaque plancher vaut ≈ 70 % de la PLUS PETITE DES DEUX tailles servies : une
 * seule police pour tous les hôtes, donc plus de marge à prendre pour couvrir un
 * écart de police — c'est exactement ce que l'auto-hébergement a acheté.
 *
 * CE QUE CE PLANCHER EST, ET CE QU'IL N'EST PAS (mesuré le 26/09/2026) : une
 * borne de SANITY, pas le discriminateur de l'identité. Sonde d'atelier
 * (`_sonde-plancher.spec.js` : feuille injectée dans le <head> servi, avant le
 * premier paint) — quand l'élément DÉCLARÉ est rendu minuscule, le plus grand
 * texte qui reste vaut encore 12 285 px² (/support mobile), 9 025 (/support
 * desktop) et 11 480 (/forgot-password) : aucun plancher ne peut donc trancher
 * « le bloc déclaré est là » de « un autre texte a pris sa place ». Ce qui
 * tranche, c'est l'IDENTITÉ ci-dessous — l'élément élu doit porter l'ensemble de
 * classes du plan — et `e2e/lcp-geometrie.spec.js` (une seule candidate, de la
 * géométrie de la coquille). Le plancher, lui, refuse un premier paint vidé de
 * sa matière : c'est pour ça qu'il peut être bas sans être un faux vert.
 *
 * UNE SEULE candidate dans les deux canaux, au premier paint, d'aire IDENTIQUE :
 * la peinture de la coquille reste celle que Chrome retient, et rien du
 * JavaScript n'entre dans le graphe LCP simulé de Lantern. Un remplacement PLUS
 * GRAND, lui, ré-élit un élément (mesuré sur /jobs avant correctif :
 * `elementRenderDelay` de 1156 à 2345 ms, score desktop 92 au lieu de 100).
 */
const ROUTES_DECLAREES = [
  // Plancher ≈ 0,7 × la plus petite des deux tailles ; mesures en commentaire, en
  // px², MOBILE / DESKTOP, police servie par le site (26/09/2026).
  { route: '/jobs', champ: 'introClass', plancher: 24000 }, // 36 750 / 35 144
  { route: '/about', champ: 'introClass', plancher: 55000 }, // 82 940 / 79 540
  // Sur cette page, le plus grand texte peint est un CORPS de section : c'est
  // `sectionBodyClass` qui porte l'élément élu, pas l'introduction.
  { route: '/privacy', champ: 'sectionBodyClass', plancher: 64000 }, // 91 630 / 100 788
  { route: '/how-it-works', champ: 'heroSubtitleClass', plancher: 18000 }, // 26 334 / 32 928
  // Le plus grand texte peint de ces quatre pages est un paragraphe secondaire,
  // pas le titre : ligne légale de /login, notice d'étape de /register,
  // sous-titres de /forgot-password et de /support (voir la mesure en tête).
  { route: '/login', champ: 'legalContactClass', plancher: 8900 }, // 15 040 / 12 834
  { route: '/register', champ: 'stepNoticeClass', plancher: 6600 }, // 9 548 / 12 338
  { route: '/forgot-password', champ: 'subtitleClass', plancher: 9500 }, // 13 690 / 16 095
  { route: '/support', champ: 'subtitleClass', plancher: 6600 }, // 16 720 / 9 480
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
              + `(${candidate.taille} px² pour un plancher de ${plancher}) — la page n'a plus de bloc `
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
