/**
 * PREUVE D'ÉCHEC REJOUÉE de la sonde du document (`style-layout-document.spec.js`)
 * — la règle des sections DIFFÉRÉES de l'accueil (`content-visibility: auto` +
 * `contain-intrinsic-size` EXACT, src/App.css) mise à l'épreuve, sans jamais
 * toucher l'artefact sur disque.
 *
 * ── Pourquoi ce fichier existe ──────────────────────────────────────────────
 * La sonde du document prononce un verdict STRUCTUREL : la coquille accueil doit
 * publier au moins 0,8 × ses NŒUDS et 0,8 × sa HAUTEUR de référence
 * (`scripts/style-layout-budgets.cjs`). Rien, dans la sonde elle-même, ne dit
 * qu'elle sait ROUGIR — un plancher que rien ne franchit est un plancher qui
 * peut devenir aveugle en silence (le motif F17 du registre des preuves). Ce
 * fichier rejoue donc l'échec : il AMPUTE l'accueil de ses neuf sections
 * différées, exige que la sonde rougisse sur les DEUX axes (nœuds ET hauteur),
 * et le prouve sans jamais toucher à l'artefact sur disque.
 *
 * ── Les deux mutations, et ce que la mesure a appris sur la SECONDE ─────────
 *  1. AMPUTATION — retirer les neuf sections différées du corps publié fait
 *     tomber les nœuds ET la hauteur sous leurs planchers, dans les deux
 *     conditions : c'est la seule direction que la sonde sait faire rougir, et
 *     elle est ici rejouée, pas seulement citée.
 *  2. TAILLE CASSÉE — remplacer chaque `contain-intrinsic-size: auto Npx` par
 *     `auto 4px` NE FAIT PAS baisser la hauteur du document. C'est contre-
 *     intuitif et c'est MESURÉ ici : la taille intrinsèque n'agit qu'en PLANCHER,
 *     et le mot-clé `auto` MÉMORISE la taille rendue dès que la section devient
 *     pertinente pour l'utilisateur — donc la hauteur ne bouge que de quelques px
 *     à quelques pour cent (mesuré), jamais jusqu'au plancher. La conséquence est
 *     assumée : la sonde n'a qu'une BORNE BASSE,
 *     elle n'attrape PAS une taille cassée vers le bas, et ce fichier l'écrit
 *     plutôt que de laisser croire le contraire.
 *
 * ── Comment on mute SANS risquer l'artefact ────────────────────────────────
 * La mutation est appliquée au VOL, sur la réponse HTML : la navigation vers `/`
 * est interceptée et servie avec le corps muté (le CSS des sections différées
 * est INLINE dans le HTML pré-rendu, donc muter la chaîne suffit). Le fichier
 * `build/index.html` n'est jamais réécrit — aucune restauration n'est nécessaire,
 * et une interruption en cours de test ne peut pas laisser un artefact amputé.
 * Le protocole de mesure, lui, est celui de la sonde : bundle d'entrée BLOQUÉ,
 * page neuve, throttling CPU posé avant la navigation, mêmes compteurs CDP.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import budgets from '../scripts/style-layout-budgets.cjs';

const { CONDITIONS, NOEUDS, HAUTEUR, plancherNoeudsDe, plancherHauteurDe, BORNE_STRUCTURE } = budgets;

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COQUILLE_ACCUEIL = path.join(RACINE, 'build', 'index.html');
/** Le bundle d'entrée de l'app : son blocage empêche React de monter (la sonde). */
const ENTREE_APPLICATION = /\/assets\/index-[^/]*\.js$/;
/** En dessous, la page n'a manifestement pas été lue (build absent, coquille vide). */
const PLANCHER_MS = 5;
/** Le nombre de sections différées de l'accueil : le héros plus neuf. */
const SECTIONS_ACCUEIL = 10;

/**
 * Retire du corps publié toutes les sections SAUF le héros — exactement la
 * matière que la règle des sections différées recouvre. Les sections ne sont pas
 * imbriquées (`<section>` ne contient pas de `<section>`), donc une passe
 * non-gourmande suffit.
 */
function amputerLesSectionsDifferees(html) {
  const ouverture = html.indexOf('<main');
  const fermeture = html.indexOf('</main>');
  if (ouverture < 0 || fermeture < 0) {
    throw new Error('build/index.html : pas de `<main>` — la coquille n’est pas celle attendue');
  }
  const debut = ouverture;
  const fin = fermeture + '</main>'.length;
  const corps = html.slice(debut, fin);
  const sections = corps.match(/<section\b[^>]*>[\s\S]*?<\/section>/g) || [];
  if (sections.length !== SECTIONS_ACCUEIL) {
    throw new Error(
      `build/index.html : ${sections.length} section(s) trouvée(s) dans <main>, ${SECTIONS_ACCUEIL} attendues — ` +
        'la preuve d’échec doit être recalée sur la structure réelle de l’accueil'
    );
  }
  let vu = 0;
  const ampute = corps.replace(/<section\b[^>]*>[\s\S]*?<\/section>/g, (bloc) => (vu++ === 0 ? bloc : ''));
  return html.slice(0, debut) + ampute + html.slice(fin);
}

/**
 * Casse chaque taille intrinsèque en une valeur minuscule. Le remplacement est
 * atteint si au moins une taille a été trouvée — sinon la preuve parlerait d'un
 * document qui n'a pas la règle.
 */
function casserLesTaillesIntrinseques(html) {
  const casse = html.replace(/contain-intrinsic-size:\s*auto\s+[\d.]+px/g, 'contain-intrinsic-size: auto 4px');
  if (casse === html) {
    throw new Error(
      'build/index.html : aucune `contain-intrinsic-size: auto …px` à casser — la règle des sections différées ' +
        'a disparu de l’artefact, la preuve d’échec ne mesure plus la bonne règle'
    );
  }
  return casse;
}

/**
 * Un relevé sur un document SERVI DEPUIS LA CHAÎNE fournie : page neuve, bundle
 * d'entrée bloqué, throttling CPU posé avant la navigation, compteurs CDP lus
 * après que la peinture s'est posée — le protocole exact de la sonde.
 */
async function relever(browser, condition, html) {
  const page = await browser.newPage({ viewport: condition.viewport });
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  if (condition.cpu > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: condition.cpu });
  await page.route(ENTREE_APPLICATION, (route) => route.abort());
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
      : route.fallback()
  );
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const dom = await page.evaluate(() => ({
    noeuds: document.querySelectorAll('*').length,
    hauteur: document.documentElement.scrollHeight,
    monte: Boolean(document.querySelector('nav a')),
  }));
  const { metrics } = await session.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  await page.close();
  return { total: (m.RecalcStyleDuration + m.LayoutDuration) * 1000, ...dom };
}

test.describe('preuve d’échec rejouée — la sonde du document mord sur les nœuds ET la hauteur', () => {
  const htmlSain = fs.readFileSync(COQUILLE_ACCUEIL, 'utf8');

  for (const condition of CONDITIONS) {
    test(`l’accueil amputé de ses neuf sections différées franchit les deux planchers (${condition.nom})`, async ({ browser }) => {
      const plancherNoeuds = plancherNoeudsDe(NOEUDS['/']);
      const plancherHauteur = plancherHauteurDe(HAUTEUR['/']?.[condition.nom]);

      // 1. Le document SAIN passe le verdict : la preuve ne confond pas une
      //    sonde cassée avec une mutation.
      const sain = await relever(browser, condition, htmlSain);
      expect(sain.monte, `accueil (${condition.nom}) : React a monté — le bundle d’entrée n’était pas bloqué`).toBe(false);
      expect(sain.total, `accueil (${condition.nom}) : relevé nul (${sain.total} ms)`).toBeGreaterThan(PLANCHER_MS);
      expect(sain.noeuds, `accueil (${condition.nom}) : le document sain tombe sous le plancher de nœuds`).toBeGreaterThanOrEqual(plancherNoeuds);
      expect(sain.hauteur, `accueil (${condition.nom}) : le document sain tombe sous le plancher de hauteur`).toBeGreaterThanOrEqual(plancherHauteur);

      // 2. Le document AMPUTÉ franchit les DEUX planchers — c'est l'échec que la
      //    sonde doit savoir attraper, rejoué.
      const ampute = await relever(browser, condition, amputerLesSectionsDifferees(htmlSain));
      expect(ampute.monte, `accueil amputé (${condition.nom}) : React a monté`).toBe(false);
      expect(
        ampute.noeuds,
        `accueil amputé (${condition.nom}) : ${ampute.noeuds} nœuds — la sonde NE mord PAS sur les nœuds ` +
          `(plancher ${plancherNoeuds}, document sain ${sain.noeuds})`
      ).toBeLessThan(plancherNoeuds);
      expect(
        ampute.hauteur,
        `accueil amputé (${condition.nom}) : ${ampute.hauteur} px — la sonde NE mord PAS sur la hauteur ` +
          `(plancher ${plancherHauteur}, document sain ${sain.hauteur})`
      ).toBeLessThan(plancherHauteur);

      console.log(
        `ℹ️  Preuve d’échec (${condition.nom}) : amputation → ${sain.noeuds} → ${ampute.noeuds} nœuds, ` +
          `${sain.hauteur} → ${ampute.hauteur} px de haut (planchers ${BORNE_STRUCTURE} × réf : ${plancherNoeuds} / ` +
          `${plancherHauteur}) — la sonde rougit sur les DEUX axes.`
      );
    });
  }

  for (const condition of CONDITIONS) {
    test(`casser les tailles contain-intrinsic-size ne fait PAS baisser la hauteur (${condition.nom})`, async ({ browser }) => {
      const plancherHauteur = plancherHauteurDe(HAUTEUR['/']?.[condition.nom]);
      const sain = await relever(browser, condition, htmlSain);
      const casse = await relever(browser, condition, casserLesTaillesIntrinseques(htmlSain));

      // La découverte, écrite comme un FAIT mesuré : la taille intrinsèque
      // n'agit qu'en PLANCHER, et `auto` mémorise la taille rendue dès que la
      // section devient pertinente — donc la casser ne rétrécit PAS le document
      // jusqu'au plancher. Le déplacement observé (quelques px à quelques pour
      // cent selon la mise en page) est PUBLIÉ, pas borné à une constante propre
      // à ce poste : ce qui est prouvé, c'est que la hauteur reste AU-DESSUS du
      // plancher — donc que la sonde, qui n'a qu'une borne BASSE, ne l'attrape
      // pas.
      const chute = ((sain.hauteur - casse.hauteur) / sain.hauteur) * 100;
      expect(
        casse.hauteur,
        `accueil (${condition.nom}) : casser contain-intrinsic-size a rétréci le document ` +
          `jusqu'au plancher (${sain.hauteur} → ${casse.hauteur} px, −${chute.toFixed(1)} % pour un plancher ` +
          `de ${plancherHauteur}) — la découverte « plancher mémorisant » est réfutée, cette preuve doit être réécrite`
      ).toBeGreaterThanOrEqual(plancherHauteur);
      // Et la structure de nœuds est intacte : la mutation ne touche que le CSS.
      expect(casse.noeuds, `accueil (${condition.nom}) : casser la taille a changé les nœuds`).toBe(sain.noeuds);

      console.log(
        `ℹ️  Taille cassée (${condition.nom}) : ${sain.hauteur} → ${casse.hauteur} px de haut ` +
          `(Δ ${casse.hauteur - sain.hauteur} px, nœuds ${sain.noeuds} → ${casse.noeuds}) — la sonde NE mord PAS : ` +
          'sa seule borne est basse, et `contain-intrinsic-size` agit comme un plancher que `auto` mémorise.'
      );
    });
  }
});
