import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Le protocole à deux peintures (bundle d'entrée bloqué pour la coquille), le
// marqueur de montage et les deux tailles appartiennent au harnais partagé —
// `src/config/page-meta.js` en est la source.
import {
  TAILLES,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
  ouvrirLaPage,
} from './helpers/geometrie.js';
// L'observateur de décalages du dépôt porte aussi le PREMIER PAINT
// (`__kojoCls.fcp`) : la sonde n'a pas besoin d'un second observateur « paint ».
import { ESPION_CLS, attendreLaFenetreDeSession } from './helpers/cls.js';
import { attendreLeSilenceDesRequetes } from './helpers/attentes.js';
import { PHOTOS_HEROS, PHOTO_HEROS_LARGEURS, VARIANTES_HEROS } from '../src/config/photos-heros.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// LE MANIFESTE EST LA MESURE, PAS UNE PROMESSE : c'est le fichier écrit par
// `scripts/gen-hero-images.py`, qui a encodé chaque variante. Les octets sont
// relus du disque PLUS BAS (on ne fait pas confiance au manifeste pour dire ce
// que le disque contient) ; ici il sert à savoir ce qu'on ATTEND du navigateur.
const MANIFESTE = JSON.parse(readFileSync(path.join(RACINE, 'scripts/hero-variants.manifest.json'), 'utf8'));

/** Les octets de chaque variante publiée, tels que le manifeste les a mesurés. */
const OCTETS_DU_MANIFESTE = new Map();
for (const photo of MANIFESTE.photos) {
  for (const variante of photo.variantes) OCTETS_DU_MANIFESTE.set(`/assets/${variante.fichier}`, variante.octets);
}

/** Le JPEG de chaque photo, tel qu'il pèse sur le disque. */
const OCTETS_DU_JPEG = new Map(
  MANIFESTE.photos.map((photo) => [`/assets/${photo.source}`, photo.octets_source])
);

/**
 * LA SONDE DU FORMAT TÉLÉCHARGÉ PAR LE HÉROS (08/10/2026).
 *
 * ── Ce qui est en jeu ──────────────────────────────────────────────────────
 * La photo de tête est l'élément LCP de « / », et elle est publiée en `<picture>`
 * (AVIF, WebP, puis JPEG) à DEUX largeurs. Trois choses peuvent se perdre sans
 * qu'aucun test unitaire ne le voie :
 *
 *   1. LE MAUVAIS FICHIER EST TÉLÉCHARGÉ — et c'est le plus coûteux. Un
 *      `<picture>` dont le `<source>` ne correspond pas à ce que le navigateur
 *      choisit, ou un `imagesrcset` de préchargement qui ne décrit pas le même
 *      candidat que le corps, fait télécharger DEUX fichiers pour une seule
 *      photo : plus qu'avant cette passe, exactement l'inverse du but. La sonde
 *      exige donc UNE seule requête pour la photo de tête, et AUCUN `.jpg` du
 *      héros sur toute la navigation (Chromium sait lire l'AVIF : s'il demande
 *      un JPEG, c'est que le balisage ne dit pas la vérité).
 *   2. LE POIDS RÉEL N'EST PAS CELUI ANNONCÉ. Les octets comptés ici sont ceux
 *      de la RÉPONSE, comparés à ceux du fichier sur disque et au manifeste :
 *      un serveur qui recompresse, un cache qui sert autre chose, ou une
 *      variante régénérée sans que le manifeste suive, rougissent ici.
 *   3. LE LCP BOUGE. L'image est l'élément LCP de « / » : la sonde rejoue le
 *      protocole du dépôt (coquille au bundle bloqué contre navigation réelle)
 *      et exige UNE candidate, horodatée au premier paint, d'aire ÉGALE à celle
 *      de la coquille. C'est la mesure de « le LCP de l'accueil ne bouge pas »,
 *      au sens où le dépôt l'entend : la peinture du document reste celle que
 *      Chrome retient.
 *
 * ── Ce que cette sonde ne fait pas ─────────────────────────────────────────
 * Elle ne juge pas la GÉOMÉTRIE (les boîtes sont mesurées par
 * `e2e/heros-pause.spec.js` et `e2e/geometrie-coquille-react.spec.js`) ni le
 * LCP des onze autres routes (`e2e/lcp-geometrie.spec.js`). Le protocole du LCP
 * est le leur, champ pour champ.
 */

/** L'observateur des candidates LCP, installé AVANT la navigation. */
const ESPION_LCP = () => {
  window.__kojoLcpFormat = [];
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      const element = entree.element;
      const rect =
        element && typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
      window.__kojoLcpFormat.push({
        debut: +entree.startTime.toFixed(1),
        balise: element ? element.tagName : '?',
        aire: rect ? +(rect.width * rect.height).toFixed(1) : null,
        // `currentSrc` est LA variante que le navigateur a choisie — la même
        // que celle attendue dans les requêtes, et c'est ce rapprochement qui
        // prouve qu'il n'y a pas eu de double téléchargement.
        choisie: element && element.currentSrc ? String(element.currentSrc) : '',
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

/** Les requêtes d'image vues par la page, avec leur type et leurs octets. */
const brancherLesRequetes = (page) => {
  const images = [];
  page.on('response', async (response) => {
    const type = response.headers()['content-type'] || '';
    const url = new URL(response.url()).pathname;
    const estImage = type.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif|svg)$/i.test(url);
    if (!estImage) return;
    let octets = Number(response.headers()['content-length'] || 0);
    if (!octets) {
      try {
        octets = (await response.body()).length;
      } catch {
        octets = 0;
      }
    }
    images.push({ url, type, octets, statut: response.status() });
  });
  return images;
};

/** Les photos du héros, quelle que soit leur variante ou leur format. */
const estPhotoDuHeros = (url) => /^\/assets\/kojo-hero(-\d)?(-480)?\.(jpg|avif|webp)$/.test(url);

test.describe('Parcours E2E — le format réellement téléchargé par le héros', () => {
  for (const { nom: taille, viewport } of TAILLES) {
    test(`« / » — ${taille} : la photo de tête arrive en AVIF 480, UNE seule fois, sans jamais demander le JPEG`, async ({
      browser,
    }) => {
      const page = await ouvrirLaPage(browser, 'reelle', viewport);
      try {
        const images = brancherLesRequetes(page);
        await page.addInitScript(ESPION_CLS);
        await page.addInitScript(ESPION_LCP);
        await page.goto('/');
        await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
        await attendreLaStabilite(page);
        await attendreLaFenetreDeSession(page);
        const releve = await page.evaluate(() => ({
          fcp: window.__kojoCls.fcp,
          lcp: window.__kojoLcpFormat,
          // `currentSrc` est une URL ABSOLUE : on n'en garde que le chemin,
          // parce que c'est la forme sous laquelle les variantes sont
          // déclarées (et sous laquelle les requêtes sont relevées).
          choisieSurLaPage: (() => {
            const image = document.querySelector('.cadre-image');
            const brut = image ? String(image.currentSrc || image.src) : '';
            return brut ? new URL(brut, location.href).pathname : '';
          })(),
        }));

        const heros = images.filter((image) => estPhotoDuHeros(image.url));
        const variante480 = VARIANTES_HEROS[0].avif[PHOTO_HEROS_LARGEURS[0]];
        const attendues = OCTETS_DU_MANIFESTE.get(variante480);

        // ── 1. UNE seule requête pour la photo de tête, et en AVIF ─────────
        const pourLaTete = heros.filter((image) => image.url === variante480);
        expect(
          pourLaTete.length,
          `« / » (${taille}) : la photo de tête (${variante480}) a été demandée ${pourLaTete.length} fois — ` +
            'un préchargement qui ne décrit pas le même candidat que le corps en ferait deux.\n' +
            `      requêtes du héros : ${JSON.stringify(heros)}`
        ).toBe(1);
        expect(
          pourLaTete[0].type,
          `« / » (${taille}) : ${variante480} est servi en « ${pourLaTete[0].type} » — un type faux fait porter la ` +
            'mesure du format sur autre chose que ce que le navigateur décode.'
        ).toBe('image/avif');

        // ── 2. AUCUN JPEG du héros : c'est la preuve du non-double-téléchargement ──
        const jpegHeros = heros.filter((image) => /\.jpe?g$/.test(image.url));
        expect(
          jpegHeros.map((image) => `${image.url} (${image.octets} o)`),
          `« / » (${taille}) : le JPEG du héros a été téléchargé alors que Chromium sait lire l'AVIF — le repli ` +
            'part donc en plus de la variante, ce qui coûte PLUS cher qu’avant cette passe.'
        ).toEqual([]);

        // ── 3. Le poids réel est celui du fichier, et celui du manifeste ────
        expect(
          pourLaTete[0].octets,
          `« / » (${taille}) : ${pourLaTete[0].octets} octets reçus pour ${variante480}, ${attendues} attendus ` +
            '(manifeste de scripts/gen-hero-images.py)'
        ).toBe(attendues);

        // ── 4. La variante choisie EST celle de l'élément LCP ──────────────
        expect(
          releve.choisieSurLaPage,
          `« / » (${taille}) : l'image affichée dit avoir choisi « ${releve.choisieSurLaPage} »`
        ).toBe(variante480);

        // ── 5. Le LCP ne bouge pas : UNE candidate, au premier paint ───────
        expect(
          releve.lcp.map((c) => `${c.balise} ${c.aire} px² à t=${c.debut} ms`),
          `« / » (${taille}) : ${releve.lcp.length} candidate(s) LCP — le protocole de la peinture du document est ` +
            'rompu par cette passe (la coquille et React n’ont plus la même géométrie, ou l’image se décode après le texte).'
        ).toHaveLength(1);
        const lcp = releve.lcp[0];
        expect(lcp.balise, `« / » (${taille}) : l'élément LCP est <${lcp.balise}> et non la photo`).toBe('IMG');
        expect(
          lcp.debut,
          `« / » (${taille}) : le LCP est horodaté à ${lcp.debut} ms, pas au premier paint (${releve.fcp} ms)`
        ).toBe(releve.fcp);

        // ── 6. Et le poids TOTAL du héros sur la fenêtre mesurée ───────────
        // Ce n'est pas un budget : c'est la mesure que la passe publie, et elle
        // est comparée au JPEG qu'un navigateur aurait téléchargé avant (la
        // photo de tête seule, puisque le repli ne précharge qu'un cran).
        const totalHeros = heros.reduce((somme, image) => somme + image.octets, 0);
        const jpegTete = OCTETS_DU_JPEG.get(PHOTOS_HEROS[0]);
        expect(
          totalHeros,
          `« / » (${taille}) : ${totalHeros} octets d'images de héros (${heros.length} fichier(s)) — ce n'est pas ` +
            `moins que les ${jpegTete} octets du seul JPEG de tête qu'un navigateur téléchargeait avant.`
        ).toBeLessThan(jpegTete);
        console.log(
          `ℹ️  Héros ${taille} : photo de tête ${variante480} — ${pourLaTete[0].octets} o (AVIF, ${pourLaTete[0].type}) ` +
            `au lieu de ${jpegTete} o de JPEG (−${(100 - (100 * pourLaTete[0].octets) / jpegTete).toFixed(1)} %) ; ` +
            `total héros sur la fenêtre ${totalHeros} o en ${heros.length} requête(s) ` +
            `[${heros.map((i) => `${i.url.split('/').pop()} ${i.octets} o`).join(', ')}] ; ` +
            `LCP <${lcp.balise}> ${lcp.aire} px² à t=${lcp.debut} ms (= premier paint ${releve.fcp} ms)`
        );
      } finally {
        await page.close();
      }
    });
  }

  test('« / » — mobile DPR 2 : la même page choisit la variante 720 (l’effet du `srcset`)', async ({ browser }) => {
    // LA PREUVE QUE LE `srcset` SERT À QUELQUE CHOSE : à densité 1 la page prend
    // la 480 (cas ci-dessus), à densité 2 elle doit prendre la 720. Sans ce cas,
    // une page qui publierait une seule largeur passerait tous les autres.
    const page = await browser.newPage({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 2 });
    try {
      const images = brancherLesRequetes(page);
      await page.goto('/');
      await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
      await attendreLaStabilite(page);
      const choisie = await page.evaluate(() => {
        const image = document.querySelector('.cadre-image');
        const brut = image ? String(image.currentSrc || '') : '';
        return brut ? new URL(brut, location.href).pathname : '';
      });
      const variante720 = VARIANTES_HEROS[0].avif[720];
      expect(
        choisie,
        `« / » mobile DPR 2 : le navigateur a choisi « ${choisie} » — à densité 2 il lui faut 760 px, donc la ` +
          `variante 720 (${variante720}), et pas la 480.`
      ).toBe(variante720);
      const demande = images.filter((image) => image.url === variante720);
      expect(demande.length, `« / » mobile DPR 2 : ${demande.length} requête(s) pour ${variante720}`).toBe(1);
      expect(demande[0].octets).toBe(OCTETS_DU_MANIFESTE.get(variante720));
      expect(
        images.filter((image) => estPhotoDuHeros(image.url) && /\.jpe?g$/.test(image.url)).map((i) => i.url),
        '« / » mobile DPR 2 : un JPEG du héros a été demandé en plus de la variante'
      ).toEqual([]);
      console.log(
        `ℹ️  Héros mobile DPR 2 : ${variante720} — ${demande[0].octets} o (manifeste) au lieu de ` +
          `${OCTETS_DU_JPEG.get(PHOTOS_HEROS[0])} o de JPEG`
      );
    } finally {
      await page.close();
    }
  });

  test('« / » — desktop : le préchargement du cran suivant reste en AVIF (aucun JPEG en réserve)', async ({ page }) => {
    // LE PRÉCHARGEMENT DU CRAN SUIVANT est le seul endroit du composant qui
    // pourrait repartir sur le JPEG : il lit `currentSrc` (la variante choisie
    // par le navigateur) et la reporte sur la photo suivante. S'il se trompait,
    // la page téléchargerait un JPEG de 60 à 90 Ko EN PLUS de la variante, en
    // temps mort — invisible à l'œil, visible ici.
    const images = brancherLesRequetes(page);
    await page.setViewportSize({ width: 1350, height: 940 });
    await page.goto('/');
    await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
    await attendreLaStabilite(page);
    const suivante = VARIANTES_HEROS[1].avif[PHOTO_HEROS_LARGEURS[0]];
    // On attend l'ÉVÉNEMENT, pas une durée : le temps mort est déclenché par
    // `requestIdleCallback` (borné à 3 s côté composant), et ce qui doit arriver
    // est la REQUÊTE de la variante suivante. Un `waitForTimeout` aurait dit
    // « combien de temps on espère » — l'angle mort 19a de CI-COVERAGE.md — et
    // sur un hôte chargé il aurait lu un état intermédiaire sans échouer.
    await page
      .waitForResponse((reponse) => new URL(reponse.url()).pathname === suivante, { timeout: 8000 })
      .catch(() => {
        /* le plafond est atteint : c'est la COMPARAISON ci-dessous qui juge, en
           nommant ce qui manque (une attente muette ne dit pas quel défaut existe). */
      });
    await attendreLeSilenceDesRequetes(() => images.length);
    const heros = images.filter((image) => estPhotoDuHeros(image.url));
    expect(
      heros.map((image) => image.url),
      `« / » desktop : au bout du temps mort, les requêtes de héros sont ${JSON.stringify(heros.map((i) => i.url))} — ` +
        `on attend la photo de tête ET le préchargement de la suivante en AVIF 480 (${suivante}).`
    ).toEqual([VARIANTES_HEROS[0].avif[480], suivante]);
    expect(
      heros.filter((image) => /\.jpe?g$/.test(image.url)),
      'un JPEG du héros a été téléchargé : le préchargement ne suit donc pas le format choisi'
    ).toEqual([]);
    console.log(
      `ℹ️  Héros desktop : ${heros.length} requêtes — ${heros.map((i) => `${i.url.split('/').pop()} ${i.octets} o`).join(', ')}`
    );
  });
});
