import { test, expect } from '@playwright/test';
// Le protocole à deux peintures (page neuve par relevé, bundle d'entrée bloqué
// pour la coquille), le marqueur de montage et les deux tailles appartiennent au
// harnais partagé — `src/config/page-meta.js` en est la source, jamais une copie.
import {
  TAILLES,
  TOLERANCE_PX,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
  ouvrirLaPage,
} from './helpers/geometrie.js';
// L'observateur de décalages est CELUI des autres sondes de stabilité : il
// enregistre aussi le premier paint (`__kojoCls.fcp`), donc cette sonde n'a pas
// besoin de réobserver les entrées « paint » pour se situer dans le temps.
import { ESPION_CLS, attendreLaFenetreDeSession, clsDesDecalages, decrireDecalage } from './helpers/cls.js';
// LE BUDGET EST LU ICI, JAMAIS RECOPIÉ : c'est la table de la CI (deux passes
// Lighthouse), et deux tables de budgets divergeraient en silence.
import budgets from '../scripts/lhci-cls-budgets.cjs';
// Le DÉLAI DE L'ALTERNANCE et le nombre de photos sont lus dans leur module de
// configuration : la sonde attend le délai que le composant applique, elle ne
// recopie pas 15 000 ms.
import { PHOTOS_HEROS, PHOTO_HEROS_DELAI_MS } from '../src/config/photos-heros.js';

const CLS_BUDGETS = budgets.CLS_BUDGETS;

/**
 * LA SONDE DU CONTRÔLE DE PAUSE DU HÉROS (WCAG 2.2.2).
 *
 * ── Ce qui est en jeu ──────────────────────────────────────────────────────
 * La photo du héros alterne toutes les 15 s. Une alternance automatique de plus
 * de cinq secondes DOIT pouvoir être interrompue : le composant publie donc un
 * bouton (visible, nommé, `aria-pressed`) posé SUR la photo. Ce que cette sonde
 * mesure n'est pas le bouton lui-même — son comportement est éprouvé en jsdom, où
 * les minuteurs sont pilotés (`src/components/__tests__/PhotoDuHeros.test.jsx`) —
 * mais SES CONSÉQUENCES SUR LA PAGE, qui ne se mesurent qu'en navigateur :
 *
 *   1. IL N'EST PEINT QUE PAR REACT. La coquille pré-rendue ne le publie pas :
 *      sans JavaScript il n'y a aucune alternance à interrompre (le `setInterval`
 *      est la seule chose qui fait tourner la liste), donc un bouton que rien
 *      n'écouterait serait un contrôle en trompe-l'œil. La sonde le VÉRIFIE des
 *      deux côtés au lieu de le supposer.
 *   2. SON APPARITION NE DÉPLACE RIEN. Il est `position: absolute` dans le cadre
 *      du héros, qui est `relative` : il ne prend aucune place dans le flux. Deux
 *      mesures le disent — la comparaison coquille → React (même hauteur de
 *      document, mêmes boîtes du cadre et de la photo), ET une épreuve DIRECTE :
 *      le nœud retiré du document vivant puis remis ne fait pas bouger la
 *      hauteur d'un pixel. La seconde répond mot pour mot à « son apparition ne
 *      déplace pas la page » ; un contrôle en flux, lui, ferait tomber 44 px.
 *   3. IL N'AJOUTE AUCUNE CANDIDATE LCP. La photo est l'élément LCP de « / » ;
 *      le contrôle ne peint aucun texte (son libellé est un nom ACCESSIBLE, pas
 *      une phrase) et sa boîte de 48 px de côté est minuscule devant elle —
 *      Chrome ne ré-élit un élément LCP que pour une aire STRICTEMENT plus
 *      grande. La sonde exige donc UNE candidate dans la navigation réelle,
 *      horodatée au premier paint, de même balise et de même aire que celle de la
 *      coquille, et que les bornes du contrôle tiennent DANS la photo.
 *   4. IL EST ATTEIGNABLE, ET SA BOÎTE EST CARRÉE. Ni survol, ni déplacement :
 *      au centre de sa boîte, le navigateur doit rendre le contrôle (ou un de ses
 *      descendants) ; la cible vaut au moins 44 px (WCAG 2.5.5) et ses deux côtés
 *      sont ÉGAUX — le socle de la feuille impose `min-height: 48px` à tout
 *      bouton, et une hauteur plus courte que la largeur transforme le cercle
 *      annoncé en stade (défaut mesuré avant correctif : 44 × 48 px). Son nom
 *      accessible annonce l'ACTION qui suit et change avec l'état.
 *
 * ── Ce que cette sonde ne fait pas ─────────────────────────────────────────
 * Elle ne juge ni la géométrie des textes (`geometrie-coquille-react.spec.js`),
 * ni le LCP de toutes les routes (`lcp-geometrie.spec.js`) : elle porte sur une
 * seule page, « / », et sur un seul objet. Le protocole d'observation du LCP est
 * celui de `lcp-geometrie.spec.js`, champ pour champ, pour que ses chiffres
 * soient comparables aux siens (et le premier paint vient de l'observateur de
 * CLS du dépôt, pas d'un second observateur).
 */

/** L'observateur des candidates LCP, installé AVANT la navigation. */
const ESPION_LCP_HEROS = () => {
  window.__kojoLcpHeros = [];
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      const element = entree.element;
      const rect =
        element && typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
      window.__kojoLcpHeros.push({
        debut: +entree.startTime.toFixed(1),
        taille: entree.size,
        balise: element ? element.tagName : '?',
        classe: element ? String(element.className || '') : '',
        aire: rect ? +(rect.width * rect.height).toFixed(1) : null,
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

/**
 * Le relevé de la vue : les boîtes qui ne doivent PAS bouger quand le contrôle
 * apparaît, et ce que le contrôle est (ou n'est pas). Aucune coordonnée ni
 * dimension n'est écrite en dur — tout est lu sur l'élément.
 */
const RELEVE = () => {
  const boite = (element) => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return [+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
  };
  const bouton = document.querySelector('.heros-controle');
  return {
    hauteur: document.documentElement.scrollHeight,
    noeuds: document.querySelectorAll('*').length,
    cadre: boite(document.querySelector('.cadre-illustration')),
    image: boite(document.querySelector('.cadre-image')),
    bouton: boite(bouton),
    boutons: document.querySelectorAll('.heros-controle').length,
    nom: bouton ? bouton.getAttribute('aria-label') : null,
    appuye: bouton ? bouton.getAttribute('aria-pressed') : null,
    textePeint: bouton ? bouton.textContent.replace(/\s+/g, ' ').trim() : null,
  };
};

/**
 * L'épreuve DIRECTE de la mise en page, sur le document vivant : la hauteur est
 * relevée avec le contrôle, puis SANS lui (le nœud retiré), puis il est remis en
 * place. Elle se joue en DERNIER sur une page, puisqu'elle modifie le document.
 */
const EPREUVE_SANS_CONTROLE = () => {
  const bouton = document.querySelector('.heros-controle');
  if (!bouton) return null;
  const cadre = bouton.parentElement;
  const hauteurAvec = document.documentElement.scrollHeight;
  bouton.remove();
  const hauteurSans = document.documentElement.scrollHeight;
  const remis = cadre.appendChild(bouton) === bouton;
  return { hauteurAvec, hauteurSans, remis };
};

/** Deux boîtes coïncident-elles, à la tolérance de sous-pixel du dépôt ? */
const memeBoite = (a, b) =>
  Boolean(a) &&
  Boolean(b) &&
  a.every((valeur, i) => Math.abs(valeur - b[i]) <= TOLERANCE_PX);

/** Un rectangle tient-il ENTIÈREMENT dans un autre ? */
const dansBoite = (dedans, dehors) =>
  Boolean(dedans) &&
  Boolean(dehors) &&
  dedans[0] >= dehors[0] - TOLERANCE_PX &&
  dedans[1] >= dehors[1] - TOLERANCE_PX &&
  dedans[0] + dedans[2] <= dehors[0] + dehors[2] + TOLERANCE_PX &&
  dedans[1] + dedans[3] <= dehors[1] + dehors[3] + TOLERANCE_PX;

/**
 * Attend que le PREMIER PAINT soit relevé, sans jamais lever d'attente muette.
 *
 * L'observateur des entrées « paint » est `buffered: true`, mais ses entrées sont
 * livrées de façon ASYNCHRONE : une page qui ne bouge pas — donc dont la fenêtre
 * de session CLS se referme d'emblée — peut être relevée avant que le rappel de
 * l'observateur n'ait tourné (mesuré : `fcp` nul sur « / » mobile, alors que le
 * relevé desktop qui avait chargé plus longtemps le donnait). Le plafond BORNE
 * cette attente et rend la main : c'est l'assertion qui NOMME l'absence de
 * premier paint, jamais un délai qui expire en silence.
 */
async function attendreLePremierPaint(page, maxMs = 5000) {
  try {
    await page.waitForFunction(() => window.__kojoCls && window.__kojoCls.fcp !== null, null, { timeout: maxMs });
  } catch {
    // Aucun paint relevé dans le délai : le relevé se fait quand même.
  }
}

/**
 * Ouvre « / » une fois, dans la peinture demandée, et rend TOUT le relevé : la
 * vue, les décalages, les candidates LCP, et — sur la navigation réelle — la
 * mesure avec/sans le contrôle.
 *
 * @param {import('@playwright/test').Browser} browser Navigateur du test.
 * @param {'coquille'|'reelle'} peinture `coquille` bloque le bundle d'entrée.
 * @param {{width: number, height: number}} viewport Taille demandée.
 */
async function releverHeros(browser, peinture, viewport) {
  const page = await ouvrirLaPage(browser, peinture, viewport);
  try {
    // AVANT la navigation : le premier paint et les décalages du premier paint
    // seraient manqués par un observateur installé après (les deux observent
    // `buffered: true`, mais le protocole du dépôt installe d'abord).
    await page.addInitScript(ESPION_CLS);
    await page.addInitScript(ESPION_LCP_HEROS);
    await page.goto('/');
    if (peinture === 'reelle') await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
    await attendreLaStabilite(page);
    await attendreLaFenetreDeSession(page);
    await attendreLePremierPaint(page);
    const vue = await page.evaluate(RELEVE);
    const releve = await page.evaluate(() => ({
      fcp: window.__kojoCls.fcp,
      decalages: window.__kojoCls.decalages,
      lcp: window.__kojoLcpHeros,
    }));
    const sansControle = peinture === 'reelle' ? await page.evaluate(EPREUVE_SANS_CONTROLE) : null;
    return { vue, sansControle, ...releve, ...clsDesDecalages(releve.decalages) };
  } finally {
    await page.close();
  }
}

test.describe('Parcours E2E — le contrôle de pause du héros (WCAG 2.2.2)', () => {
  for (const { nom: taille, viewport } of TAILLES) {
    test(`« / » — ${taille} : le contrôle n'apparaît qu'avec le JavaScript, sans déplacer la page ni ajouter de candidate LCP`, async ({
      browser,
    }) => {
      const budget = CLS_BUDGETS['/'] ? CLS_BUDGETS['/'].max : null;
      expect(budget, 'aucun budget CLS mesuré pour « / » dans scripts/lhci-cls-budgets.cjs').not.toBeNull();

      const coquille = await releverHeros(browser, 'coquille', viewport);
      const reelle = await releverHeros(browser, 'reelle', viewport);
      const { vue: vueCoquille } = coquille;
      const { vue: vueReact } = reelle;

      // ── Anti-faux-vert : une mesure sans paint ni corps ne décrit rien ────
      expect(reelle.fcp, `« / » (${taille}) : premier paint absent — le relevé ne décrit rien`).not.toBeNull();
      expect(coquille.fcp, `« / » (${taille}) : la coquille n'a rien peint`).not.toBeNull();
      expect(vueReact.noeuds, `« / » (${taille}) : la page React n'a pas été lue`).toBeGreaterThan(100);
      expect(vueCoquille.noeuds, `« / » (${taille}) : la coquille n'a pas été lue`).toBeGreaterThan(100);

      // ── 1. Le contrôle n'existe que là où il y a une alternance à couper ──
      expect(
        vueCoquille.boutons,
        `« / » (${taille}) : la coquille pré-rendue publie le contrôle de pause — sans JavaScript son alternance ne ` +
          'tourne pas, donc le bouton y promet une pause sans effet.'
      ).toBe(0);
      expect(
        vueReact.boutons,
        `« / » (${taille}) : le contrôle de pause n'est pas publié par React — l'alternance de ${PHOTO_HEROS_DELAI_MS} ms ` +
          "n'est plus interruptible (WCAG 2.2.2)."
      ).toBe(1);

      // ── 2. Son apparition ne déplace RIEN (comparaison coquille → React) ──
      expect(
        Math.abs(vueReact.hauteur - vueCoquille.hauteur),
        `« / » (${taille}) : le document passe de ${vueCoquille.hauteur} px (coquille) à ${vueReact.hauteur} px (React) — ` +
          "le contrôle prend donc une place dans le flux, alors qu'il doit être posé SUR la photo."
      ).toBeLessThanOrEqual(1);
      expect(
        memeBoite(vueReact.cadre, vueCoquille.cadre),
        `« / » (${taille}) : le cadre du héros n'est plus à la même place des deux côtés — coquille ` +
          `${JSON.stringify(vueCoquille.cadre)}, React ${JSON.stringify(vueReact.cadre)}`
      ).toBe(true);
      expect(
        memeBoite(vueReact.image, vueCoquille.image),
        `« / » (${taille}) : la boîte de la photo n'est plus la même des deux côtés — coquille ` +
          `${JSON.stringify(vueCoquille.image)}, React ${JSON.stringify(vueReact.image)}`
      ).toBe(true);

      // ── 3. Son apparition ne déplace RIEN (épreuve directe) ───────────────
      expect(reelle.sansControle, `« / » (${taille}) : l'épreuve directe n'a pas pu se jouer`).not.toBeNull();
      expect(
        reelle.sansControle.hauteurAvec,
        `« / » (${taille}) : retirer le contrôle du document change la hauteur (${reelle.sansControle.hauteurSans} px ` +
          `sans lui contre ${reelle.sansControle.hauteurAvec} px avec) — un contrôle posé sur une image ne devrait ` +
          'occuper aucune place dans le flux.'
      ).toBe(reelle.sansControle.hauteurSans);
      expect(
        reelle.sansControle.remis,
        `« / » (${taille}) : le contrôle n'a pas pu être remis en place après l'épreuve — la page est restée modifiée`
      ).toBe(true);

      // ── 4. Le contrôle n'ajoute aucune candidate LCP ──────────────────────
      expect(
        coquille.lcp.length,
        `« / » (${taille}) : aucune candidate LCP pour la coquille — la comparaison ne peut rien prouver`
      ).toBeGreaterThan(0);
      const lcpCoquille = coquille.lcp[coquille.lcp.length - 1];
      expect(
        reelle.lcp.map((c) => `${c.balise} ${c.classe} ${c.aire} px² à t=${c.debut} ms`),
        `« / » (${taille}) : React a peint un élément PLUS GRAND que la coquille, donc une SECONDE candidate LCP — et si ` +
          "c'est le contrôle de pause, c'est sa géométrie qu'il faut corriger (aucun texte peint, une cible de 44 px ne " +
          'peut pas dépasser la photo).\n' +
          `      coquille : ${JSON.stringify(lcpCoquille)}\n` +
          `      React    : ${JSON.stringify(reelle.lcp)}`
      ).toHaveLength(1);
      const lcpReact = reelle.lcp[0];
      expect(
        lcpReact.balise,
        `« / » (${taille}) : l'élément LCP peint par React est <${lcpReact.balise}>« ${lcpReact.classe} » au lieu de la photo`
      ).toBe(lcpCoquille.balise);
      expect(
        lcpReact.debut,
        `« / » (${taille}) : le LCP n'est plus horodaté au premier paint (${lcpReact.debut} ms contre ${reelle.fcp} ms)`
      ).toBe(reelle.fcp);
      expect(
        lcpReact.aire,
        `« / » (${taille}) : l'aire de l'élément LCP passe de ${lcpCoquille.aire} px² (coquille) à ${lcpReact.aire} px² (React)`
      ).toBeLessThanOrEqual(lcpCoquille.aire + 1);
      // Ce qui rend le contrôle inapte à devenir une candidate LCP : il ne peint
      // aucun texte. Un libellé doit être un nom accessible, pas une phrase
      // publiée (elle entrerait aussi dans le texte attendu des coquilles).
      expect(
        vueReact.textePeint,
        `« / » (${taille}) : le contrôle peint du texte (« ${vueReact.textePeint} »).`
      ).toBe('');

      // ── 5. Il est ATTEIGNABLE et tient DANS la photo ──────────────────────
      expect(
        dansBoite(vueReact.bouton, vueReact.image),
        `« / » (${taille}) : le contrôle (${JSON.stringify(vueReact.bouton)}) dépasse de la photo ` +
          `(${JSON.stringify(vueReact.image)}) — posé sur l'image, il ne doit pas l'agrandir.`
      ).toBe(true);
      const cote = Math.min(vueReact.bouton[2], vueReact.bouton[3]);
      expect(
        cote,
        `« / » (${taille}) : la cible du contrôle fait ${cote} px de côté — le minimum du site (et de WCAG 2.5.5) vaut 44 px`
      ).toBeGreaterThanOrEqual(44);
      // ET ELLE EST CARRÉE, parce que le socle de la feuille pose
      // `button { min-height: 48px }` : une hauteur plus courte que la largeur
      // donne un STADE là où le dessin est un cercle (mesuré avant correctif :
      // 44 × 48 px). Un carré de 48 px est au-dessus des deux exigences.
      expect(
        vueReact.bouton[2],
        `« / » (${taille}) : la boîte du contrôle fait ${vueReact.bouton[2]}×${vueReact.bouton[3]} px — le socle impose ` +
          '`min-height: 48px` à tout bouton, donc une boîte non carrée (stade au lieu du cercle annoncé).'
      ).toBe(vueReact.bouton[3]);
      expect(
        vueReact.nom,
        `« / » (${taille}) : le contrôle n'a pas de nom accessible — un bouton sans nom est muet pour un lecteur d'écran`
      ).toBeTruthy();

      // ── 6. Le CLS de la route, celui que la CI applique ───────────────────
      expect(
        coquille.cls,
        `« / » (${taille}) : la coquille seule déplace la page de ${coquille.cls.toFixed(4)} pour un plafond de ${budget}`
      ).toBeLessThanOrEqual(budget);
      expect(
        reelle.cls,
        `« / » (${taille}) : le montage de React déplace la page de ${reelle.cls.toFixed(4)} pour un plafond de ${budget}\n` +
          reelle.decalages
            .slice(0, 3)
            .map((decalage) => `      · ${decrireDecalage(decalage)}`)
            .join('\n')
      ).toBeLessThanOrEqual(budget);

      // ── Le relevé AVANT le verdict : un vert sans chiffre ne prouve rien ──
      console.log(
        `ℹ️  Héros ${taille} : document ${vueCoquille.hauteur} px (coquille) / ${vueReact.hauteur} px (React) — ` +
          `photo ${vueReact.image ? `${vueReact.image[2]}×${vueReact.image[3]}` : '?'} px des deux côtés — ` +
          `contrôle ${vueReact.bouton[2]}×${vueReact.bouton[3]} px à (${vueReact.bouton[0]}, ${vueReact.bouton[1]}) — ` +
          `LCP coquille ${lcpCoquille.aire} px² <${lcpCoquille.balise}>, React ${lcpReact.aire} px² <${lcpReact.balise}> ` +
          `(une seule candidate, au premier paint à ${reelle.fcp} ms) — CLS ${reelle.cls.toFixed(4)} / plafond ${budget}`
      );
    });

    test(`« / » — ${taille} : le contrôle est atteignable sans survol, nommé, et il bascule`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
      const bouton = page.locator('.heros-controle');
      await expect(bouton).toHaveCount(1);
      await expect(bouton).toBeVisible();

      // Le nom accessible dit l'ACTION, l'état est porté à part — et le nom
      // change avec l'état (le contenu exact des deux libellés est jugé en jsdom,
      // contre le dictionnaire français).
      const avant = await bouton.getAttribute('aria-label');
      expect(avant, `« / » (${taille}) : nom accessible vide`).toBeTruthy();
      expect(await bouton.getAttribute('aria-pressed')).toBe('false');

      // AUCUN survol : au centre de sa boîte, le navigateur doit rendre le
      // contrôle ou l'un de ses descendants (un voile décoratif posé au-dessus
      // avalerait l'appui : c'est le défaut mesuré sur ce même héros le 07/10/2026).
      // Le défilement est EXPLICITE : sur un téléphone le contrôle peut être sous
      // la ligne de flottaison, et `elementFromPoint` rend `null` hors de la
      // fenêtre — un « rien » qui ne dit rien du recouvrement.
      await bouton.scrollIntoViewIfNeeded();
      const rendu = await bouton.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return dessus
          ? { balise: dessus.tagName, contenue: element === dessus || element.contains(dessus) }
          : { balise: 'rien', contenue: false };
      });
      expect(
        rendu.contenue,
        `« / » (${taille}) : au centre du contrôle, le navigateur rend <${rendu.balise}> — l'appui n'atteindrait pas le bouton.`
      ).toBe(true);

      await bouton.click();
      await expect(bouton).toHaveAttribute('aria-pressed', 'true');
      const apres = await bouton.getAttribute('aria-label');
      expect(
        apres,
        `« / » (${taille}) : le nom accessible ne change pas avec l'état (« ${avant} » dans les deux) — il doit annoncer ` +
          "l'action qui suit, pas décrire le bouton."
      ).not.toBe(avant);

      await bouton.click();
      await expect(bouton).toHaveAttribute('aria-pressed', 'false');
      expect(await bouton.getAttribute('aria-label')).toBe(avant);

      console.log(
        `ℹ️  Héros ${taille} : contrôle nommé « ${avant} » → « ${apres} », cible atteignable sans survol au centre de sa boîte.`
      );
    });
  }

  test(`« / » — mobile : la pause arrête VRAIMENT l'alternance, la reprise la relance (délai réel de ${PHOTO_HEROS_DELAI_MS} ms)`, async ({
    page,
  }) => {
    // Trois OBSERVATIONS du délai RÉEL : c'est le seul moyen d'éprouver la
    // pause d'une alternance de quinze secondes sans truquer l'horloge — et
    // truquer l'horloge d'une page déjà montée ne contrôlerait pas le minuteur
    // en cours. Elles sont des CONDITIONS bornées (`changerDePhoto`), pas des
    // `waitForTimeout` : la durée est un plafond qui ne décide de rien, et le
    // verdict tombe sur la comparaison. Le délai est lu dans le module de
    // configuration, jamais recopié.
    test.setTimeout(3 * (PHOTO_HEROS_DELAI_MS + 5000) + 30000);

    await page.setViewportSize({ width: 412, height: 823 });
    await page.goto('/');
    await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
    const image = page.locator('.cadre-image');
    const bouton = page.locator('.heros-controle');
    const source = () => image.getAttribute('src');

    // ── AUCUNE HORLOGE ICI : trois CONDITIONS bornées, pas trois attentes ────
    // Chacune rend la main dès qu'elle est vraie, et son plafond ne décide de
    // RIEN : c'est la comparaison qui juge, et son message nomme ce qui manque.
    // La pause est le cas qui demande le plus de soin — on ne peut pas attendre
    // un événement qui ne doit PAS venir — donc on attend sa CONDITION avec un
    // plafond d'un tour complet, et l'EXPIRATION est le fait mesuré.
    const changerDePhoto = (precedente, ms) =>
      page
        .waitForFunction(
          (avant) => document.querySelector('.cadre-image')?.getAttribute('src') !== avant,
          precedente,
          { timeout: ms }
        )
        .then(() => true)
        .catch(() => false);

    // Préalable : l'alternance TOURNE — sinon tout ce qui suit serait un faux vert.
    const depart = await source();
    const aTourne = await changerDePhoto(depart, PHOTO_HEROS_DELAI_MS + 5000);
    const apresUnTour = await source();
    expect(
      aTourne,
      `« / » mobile : la source de la photo est restée « ${depart} » pendant ${PHOTO_HEROS_DELAI_MS} ms — ` +
        "l'alternance ne tourne pas, donc la pause ne prouverait rien."
    ).toBe(true);

    // La pause : un appui, puis l'assurance qu'un tour complet ne change RIEN.
    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-pressed', 'true');
    const enPause = await source();
    const aBougeEnPause = await changerDePhoto(enPause, PHOTO_HEROS_DELAI_MS + 5000);
    const apresLaPause = await source();
    expect(
      aBougeEnPause,
      `« / » mobile : la photo a changé (${enPause} → ${apresLaPause}) PLUS DE ${PHOTO_HEROS_DELAI_MS} ms après l'appui — ` +
        'le contrôle ne coupe pas le minuteur (WCAG 2.2.2).'
    ).toBe(false);

    // La reprise : le cran suivant arrive APRÈS la reprise, au bout du délai.
    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-pressed', 'false');
    const aRepris = await changerDePhoto(enPause, PHOTO_HEROS_DELAI_MS + 5000);
    const apresLaReprise = await source();
    expect(
      aRepris,
      `« / » mobile : la photo n'a pas repris son alternance après la reprise (toujours ${apresLaReprise}).`
    ).toBe(true);

    console.log(
      `ℹ️  Héros mobile : alternance ${depart} → ${apresUnTour} en ${PHOTO_HEROS_DELAI_MS} ms ; pause tenue ` +
        `${PHOTO_HEROS_DELAI_MS + 4000} ms sur ${enPause} ; reprise → ${apresLaReprise} (${PHOTOS_HEROS.length} photos au cycle).`
    );
  });
});
