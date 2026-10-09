/**
 * LE LCP DES CINQ ROUTES D'APPLICATION — un instrument qui REFUSE de publier un
 * chiffre quand il ne mesure pas la bonne peinture.
 *
 * ── Les deux défauts de l'instrument précédent, mesurés (09/10/2026) ────────
 *   1. **La mauvaise coquille.** Une première sonde mesurait sur `vite preview`,
 *      qui ne connaît AUCUNE règle de `vercel.json` : `/dashboard` y retombait
 *      sur `index.html`, c'est-à-dire la coquille de l'ACCUEIL. Le héros était
 *      donc peint, puis détaché par React, et le relevé rendait son aire
 *      (69 920 / 306 870 px²) avec un élément ABSENT du document — alors que la
 *      page mesurée n'a aucune image. Vérifié sur l'artefact :
 *      `build/index.html` publie `kojo-hero-480.avif` (deux fois),
 *      `build/app.html` ne publie AUCUNE image (sa seule occurrence de
 *      `cadre-image` est une règle CSS). La production, elle, envoie
 *      `/dashboard` sur `/app.html` — c'est la table de `vercel.json`.
 *   2. **La session incomplète.** `storageState()` ne porte ni le
 *      `sessionStorage` ni… le second stockage que `getAuthToken` lit pourtant :
 *      un contexte semé par lui seul repartait vers `/login` (mesuré : les dix
 *      cas expirés sur `waitForSelector('.cadre-page')`). Les deux stockages
 *      sont donc repris de la page de connexion et reposés par
 *      `addInitScript`, sans avoir à connaître le nom de la clé.
 *
 * ── L'instrument, et ce qui le rend fiable ─────────────────────────────────
 *   • la coquille servie vient de `vercel.json`, LU (`matchRewrite`, le même
 *     lecteur que `scripts/vercel-rewrite-server.js`) : jamais recopiée ;
 *   • elle est servie par le SERVEUR, en réorientant la seule requête de
 *     document (`route.continue` vers `/app.html`). `route.fulfill` a été
 *     essayé d'abord et ne convient pas : une réponse fabriquée à la main rend
 *     la page INORIGINE et les cinq appels `/api/…` de la fixture tombent en
 *     `net::ERR_FAILED` (mesuré : cinq échecs avec `fulfill`, cinq 200 sans) ;
 *   • la page de mesure est NEUVE (contexte neuf) et ne navigue qu'UNE fois :
 *     la seule peinture que ce document puisse avoir enregistrée est la sienne ;
 *   • l'observateur est installé par `addInitScript`, AVANT la navigation — le
 *     protocole de `e2e/lcp-geometrie.spec.js`, l'instrument du dépôt ;
 *   • le relevé refuse de publier quand l'élément élu n'est plus dans le
 *     document, quand la route n'est pas celle demandée, ou quand la géométrie
 *     vivante n'est plus celle qui a été enregistrée. C'est ce refus qui a NOMMÉ
 *     les deux défauts ci-dessus au lieu de produire un faux chiffre.
 *
 * ── Ce qu'elle a mesuré, et qui est la raison de sa présence ────────────────
 * L'alignement du rythme des cinq routes (`.tete-app` / `.bloc-app` /
 * `carte-publique` / `carte-cotes`, RAPPORT-RYTHME-EDITORIAL.md §10) ne change
 * PAS l'élément LCP : sur les dix cas (5 routes × 2 tailles), l'élément élu est
 * le même avant et après, et horodaté au premier paint (+ ~100 ms). Les aires
 * sont identiques sauf là où un texte s'est RE-JUSTIFIÉ (l'inset de carte passe
 * de 24 px à 22,08 → 28,65) : +0,33 % sur le paragraphe d'avis de `/profile`,
 * et — le seul écart qui compte — le titre de mission de `/jobs/:id` en desktop
 * qui passe sur DEUX lignes (aire LCP 26 136 → 28 800 px², +10,2 %). Sur ces
 * routes-là, il n'y a pas de coquille pré-rendue à égaler : le navigateur n'élit
 * qu'une fois, et une aire plus grande ne coûte rien tant qu'elle est peinte au
 * premier paint — ce que le relevé vérifie.
 *
 * ── Ce qu'elle ne fait pas ──────────────────────────────────────────────────
 * Elle ne compare PAS coquille et React (ces routes ne sont pas pré-rendues,
 * `src/config/page-meta.js`), et elle ne juge pas un PLAFOND d'aire : un plafond
 * demande une table mesurée, comme `lhci-cls-budgets.cjs` pour le CLS. Ce qui
 * est jugé ici est la VALIDITÉ du relevé, et ce qui est publié est le chiffre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { connexionALaFixture, COMPTES_DE_LA_FIXTURE } from './helpers/parcours-carte.js';
import { attendreLaStabilite } from './helpers/geometrie.js';
import { matchRewrite } from '../scripts/vercel-rewrite-server.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(ICI, '..', 'build');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ICI, '..', 'vercel.json'), 'utf8'));

/** Les cinq routes d'application, et leur clé de déclaration (`app-cadres.js`). */
const ROUTES = [
  { chemin: '/dashboard', cle: '/dashboard' },
  { chemin: '/profile', cle: '/profile' },
  { chemin: '/messages', cle: '/messages' },
  { chemin: '/create-job', cle: '/create-job' },
  { chemin: '/jobs/playtest-job-1', cle: '/jobs/:id' },
];

const TAILLES = [
  { nom: 'mobile', width: 412, height: 823 },
  { nom: 'desktop', width: 1350, height: 940 },
];

/**
 * La coquille de PRODUCTION d'un chemin : la destination du rewrite de
 * `vercel.json` quand c'est un fichier du build ; sinon la coquille commune des
 * routes d'application, avec la raison ÉCRITE — `/jobs/:id` est produite par le
 * BACKEND (`/api/og/jobs/…`), et ce poste n'en a pas.
 */
function coquilleDe(chemin) {
  const regle = matchRewrite(CONFIG.rewrites, chemin);
  if (regle && !/^https?:\/\//i.test(regle.destination)) {
    const fichier = path.join(BUILD, regle.destination.split('?')[0]);
    if (fs.existsSync(fichier)) {
      return { fichier, declaration: `${regle.source} → ${regle.destination}` };
    }
  }
  return {
    fichier: path.join(BUILD, 'app.html'),
    declaration: regle
      ? `${regle.source} → ${regle.destination} (coquille produite par le BACKEND, absente de ce poste : app.html)`
      : 'aucune règle : coquille des routes d’application (app.html)',
  };
}

/** Observateur des candidates LCP, installé AVANT la navigation mesurée. */
const ESPION_LCP = () => {
  window.__kojoLcp = { candidates: [], fcp: null };
  // Les éléments sont gardés par RÉFÉRENCE : c'est ce qui permet de demander au
  // document courant si la peinture qu'il a élue est encore la sienne.
  window.__kojoLcpElements = [];
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
      window.__kojoLcpElements.push(entree.element || null);
      window.__kojoLcp.candidates.push({
        debut: +entree.startTime.toFixed(1),
        taille: entree.size,
        url: entree.url || null,
        cadre: cadre(entree.element),
        balise: entree.element ? entree.element.tagName : '?',
        classe: entree.element ? String(entree.element.className || '').slice(0, 60) : '',
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

/**
 * L'élément élu est-il ENCORE celui de ce document, et où vit-il ?
 *
 * La référence gardée par l'observateur est confrontée au document courant : un
 * élément détaché — le défaut d'origine — rend `false`. La géométrie VIVANTE est
 * relue et comparée à celle qui a été enregistrée : deux cadres différents
 * voudraient dire que la référence a changé de sujet (un squelette remplacé par
 * la page, par exemple).
 */
const OU_VIT_LA_CANDIDATE = (index) => {
  const reel = window.__kojoLcpElements[index] || null;
  const enregistre = window.__kojoLcp.candidates[index];
  const dansLeDocument = Boolean(reel && document.contains(reel));
  const parent = dansLeDocument ? reel.closest('.cadre-page, nav, header, footer') : null;
  const boite = dansLeDocument ? reel.getBoundingClientRect() : null;
  return {
    dansLeDocument,
    zone: parent
      ? parent.className.includes('cadre-page')
        ? 'main .cadre-page'
        : parent.tagName.toLowerCase()
      : 'hors zone connue',
    aireVivante: boite ? +(boite.width * boite.height).toFixed(1) : null,
    aireEnregistree: enregistre && enregistre.cadre ? enregistre.cadre.aire : null,
    classeVivante: dansLeDocument ? String(reel.className || '').slice(0, 60) : '',
  };
};

/**
 * Le relevé : contexte neuf par mesure, coquille de production, UNE navigation.
 *
 * @param {import('@playwright/test').Browser} browser Navigateur du test.
 * @param {string} chemin Route mesurée (le chemin concret, avec son identifiant).
 * @param {{width: number, height: number}} viewport Taille de fenêtre.
 */
async function relever(browser, chemin, viewport) {
  const coquille = coquilleDe(chemin);

  // (1) Le semis de session : la connexion se fait sur une page jetable, dans
  //     son propre contexte — la vraie connexion, sur la vraie fixture, mais
  //     hors de la mesure.
  const contexteSeed = await browser.newContext({ viewport });
  let etat;
  let session;
  try {
    const seed = await contexteSeed.newPage();
    await connexionALaFixture(seed, COMPTES_DE_LA_FIXTURE[0].email);
    session = await seed.evaluate(() => ({
      ls: Object.fromEntries(Object.entries(localStorage)),
      ss: Object.fromEntries(Object.entries(sessionStorage)),
    }));
    etat = await contexteSeed.storageState();
  } finally {
    await contexteSeed.close();
  }

  // (2) La mesure : contexte neuf, page vierge, et la coquille de la PRODUCTION
  //     pour le document de la route (voir l'en-tête : `fulfill` rendait la page
  //     inorigine, `continue` non).
  const contexte = await browser.newContext({ viewport, storageState: etat });
  try {
    const page = await contexte.newPage();
    await page.route(
      (url) => url.pathname === chemin,
      (route) =>
        route.continue({ url: new URL(`/${path.basename(coquille.fichier)}`, route.request().url()).href })
    );
    await page.addInitScript(({ ls, ss }) => {
      for (const [cle, valeur] of Object.entries(ls)) localStorage.setItem(cle, valeur);
      for (const [cle, valeur] of Object.entries(ss)) sessionStorage.setItem(cle, valeur);
    }, session);
    await page.addInitScript(ESPION_LCP);
    await page.goto(chemin);
    await page.waitForSelector('.cadre-page', { timeout: 15000 });
    // La stabilité de la mise en page (deux signatures égales) : une candidate
    // tardive — un repaint plus grand — doit avoir le temps d'apparaître. C'est
    // la condition du dépôt, pas un délai fixe (`helpers/geometrie.js`).
    await attendreLaStabilite(page);
    const relevé = await page.evaluate(() => window.__kojoLcp);
    const dernier = relevé.candidates.length - 1;
    const provenance = dernier >= 0 ? await page.evaluate(OU_VIT_LA_CANDIDATE, dernier) : null;
    const etatPage = await page.evaluate(() => ({
      chemin: location.pathname,
      images: document.querySelectorAll('img').length,
      cadres: document.querySelectorAll('.cadre-page').length,
    }));
    return {
      ...relevé,
      provenance,
      etat: etatPage,
      coquille: coquille.declaration,
      fichier: path.basename(coquille.fichier),
    };
  } finally {
    await contexte.close();
  }
}

const decrire = (c) =>
  `t=${c.debut} ms, aire=${c.taille} px², <${c.balise}${c.classe ? ` class="${c.classe}"` : ''}>« ${c.texte} »` +
  (c.cadre ? `, cadre ${c.cadre.largeur}×${c.cadre.hauteur} @ (${c.cadre.x}, ${c.cadre.y})` : '');

test.describe('Parcours E2E — le LCP des cinq routes d’application, coquille de production', () => {
  test.describe.configure({ mode: 'serial' });

  for (const { chemin, cle } of ROUTES) {
    for (const { nom: taille, ...viewport } of TAILLES) {
      test(`${cle} — ${taille}`, async ({ browser }) => {
        const relevé = await relever(browser, chemin, viewport);

        // ── AUTO-VALIDATION : sans ces faits, un chiffre publié serait celui
        //    d'une autre peinture — c'est exactement ainsi que la première
        //    sonde s'est trompée.
        expect(
          relevé.etat.chemin,
          `${cle} (${taille}) : la navigation a abouti sur ${relevé.etat.chemin} — ce n’est pas la route mesurée.`
        ).toBe(chemin);
        expect(
          relevé.fcp,
          `${cle} (${taille}) : aucun premier paint — le document n’a rien peint, le relevé ne décrit rien.`
        ).not.toBeNull();
        expect(
          relevé.candidates.length,
          `${cle} (${taille}) : aucune candidate LCP — l’observateur n’a pas lu son sujet.`
        ).toBeGreaterThan(0);
        const derniere = relevé.candidates[relevé.candidates.length - 1];
        expect(
          relevé.provenance.dansLeDocument,
          `${cle} (${taille}) : l’élément LCP n’est PLUS dans le document (${decrire(derniere)}) — c’est ` +
            'l’entrée DÉTACHÉE d’une peinture précédente, donc la mesure désigne une autre page que celle-ci. ' +
            'L’instrument est en cause : la sonde refuse de publier ce chiffre.'
        ).toBe(true);
        expect(
          relevé.provenance.aireVivante,
          `${cle} (${taille}) : l’élément LCP a été enregistré à ${relevé.provenance.aireEnregistree} px² et ` +
            `mesure ${relevé.provenance.aireVivante} px² à la lecture — la référence a changé de sujet.`
        ).toBeCloseTo(relevé.provenance.aireEnregistree, 0);

        // Un vert sans chiffre ne prouve rien (règle du dépôt) : la mesure est
        // PUBLIÉE, avec la coquille servie et la provenance de la peinture.
        console.log(
          `ℹ️  LCP ${cle} (${taille}) : ${derniere.taille} px² <${derniere.balise}>« ${derniere.texte} » à ` +
            `t=${derniere.debut} ms (FCP ${relevé.fcp} ms), zone ${relevé.provenance.zone} · ` +
            `coquille ${relevé.fichier} (${relevé.coquille}) · ` +
            `${relevé.candidates.length} candidate(s) · ${relevé.etat.cadres} cadre(s) · ${relevé.etat.images} image(s)`
        );
      });
    }
  }
});
