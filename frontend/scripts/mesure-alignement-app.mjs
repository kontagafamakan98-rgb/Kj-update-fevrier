#!/usr/bin/env node
/**
 * MESURE — que tiennent les centures EXPLICITES du site ?
 *
 * ── Ce que cet outil mesurait, et pourquoi il a changé de sens ───────────────
 * Il a d'abord répondu à une autre question : « que coûterait le retrait de
 * `.App { text-align: center }` ? ». Cette règle centrait par HÉRITAGE, et la
 * réponse mesurée — l'encre de 2 à 28 porteurs de texte déplacée sur CHAQUE
 * route, jusqu'à 543,89 px, élément LCP compris — a été la matière de la
 * refonte du 25/09/2026 : la règle a été retirée, le site est aligné à GAUCHE
 * par défaut, et chaque bloc qui doit être centré le DÉCLARE (`text-center`).
 *
 * La question a donc été retournée, exactement comme la décision : ce qui est
 * mesuré ici, c'est ce que la centure EXPLICITE tient — l'inverse de ce que
 * l'outil mesurait la veille. Laisser la version précédente aurait produit une
 * table de zéros (elle remettait `.App` à `start`, ce qui ne change plus rien) :
 * un instrument qui n'a plus de sujet doit changer de sujet, pas mentir.
 *
 * ── La méthode, et pourquoi elle est fidèle ─────────────────────────────────
 * Le CSS du site tient en UNE feuille par page (inlinée, sans <link>), donc
 * remettre à `start` l'alignement DANS LA PAGE — priorité du style en ligne —
 * mesure exactement ce que ferait le retrait des déclarations, pour les DEUX
 * canaux (coquille et React), qui lisent cette même feuille. Aucun rebuild, donc
 * aucune divergence possible entre ce qui est mesuré et ce qui serait livré.
 *
 * Ce qui compte est l'ENCRE, pas la boîte : un `<p>` pleine largeur ne bouge pas
 * d'un pixel alors que son texte, centré, se déplace de moitié. Les rectangles
 * de TEXTE sont donc lus via `Range` (et non `getBoundingClientRect`, qui rend
 * la boîte du bloc).
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd frontend && npm run build && node scripts/mesure-alignement-app.mjs
 *
 * Le serveur local `vercel-rewrite-server.js` est lancé (et arrêté) par l'outil,
 * sur le build du dépôt et la table de rewrites de `vercel.json` : les URL
 * mesurées sont celles que la production servirait. La liste des routes vient de
 * `src/config/page-meta.js` (jamais recopiée) — une page pré-rendue ajoutée là
 * est mesurée sans qu'on touche à ce fichier.
 *
 * L'outil ne prononce AUCUN verdict (`role: "outil"` dans
 * .github/scripts/guard-proofs.json) : il mesure et imprime. Les verdicts, eux,
 * sont dans les gardes — `scripts/__tests__/check-app-chrome.test.js` (la moitié
 * centrée du dessin est déclarée dans Home.js, la moitié gauche n'y touche pas)
 * et `scripts/check-prerender-shells.js` (aucune page ne republie une centure
 * par héritage). Et la preuve que les deux canaux s'accordent reste navigateur :
 * `e2e/geometrie-coquille-react.spec.js` (encre + `text-align` calculé) et
 * `e2e/lcp-geometrie.spec.js` (une seule candidate LCP par route).
 *
 * Relevé du 25/09/2026 (Chromium, 412×823 et 1350×940, 11 routes), sur la règle
 * AVANT refonte : 231 déplacements d'encre, jusqu'à 543,89 px. Le chiffre de la
 * refonte faite — la centure explicite — est celui que cette version imprime.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// `chromium` vient de `@playwright/test` (déclaré dans devDependencies) et non de
// `playwright-core` : le second n'est qu'une dépendance TRANSITIVE du premier, et
// `scripts/check-script-deps.js` refuse exactement cela — un import direct d'un
// paquet non déclaré casse dès que l'arbre des dépendances change.
import { chromium } from '@playwright/test';
import { PAGE_META } from '../src/config/page-meta.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(ICI, '..');
const PORT = Number(process.env.PORT_MESURE || 4187);
const ROUTES = Object.keys(PAGE_META).sort();
const TAILLES = [
  { nom: 'mobile', viewport: { width: 412, height: 823 } },
  { nom: 'desktop', viewport: { width: 1350, height: 940 } },
];

/** Démarre le serveur « forme production » sur le build du dépôt. */
async function demarrerLeServeur() {
  const enfant = spawn(
    process.execPath,
    [
      path.join(ICI, 'vercel-rewrite-server.js'),
      '--port',
      String(PORT),
      '--root',
      path.join(FRONTEND, 'build'),
      '--config',
      path.join(FRONTEND, 'vercel.json'),
    ],
    { cwd: FRONTEND, stdio: 'ignore' }
  );
  for (let essai = 0; essai < 80; essai += 1) {
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT}/`);
      if (reponse.ok) return enfant;
    } catch (_e) {
      // Le serveur n'écoute pas encore.
    }
    await new Promise((resoudre) => setTimeout(resoudre, 250));
  }
  enfant.kill();
  throw new Error(
    `le serveur local n'a pas répondu sur ${PORT} — le build existe-t-il (npm run build) ?`
  );
}

/**
 * Relevé exécuté DANS la page : encre de chaque porteur de texte avant/après la
 * remise à `start` des centures EXPLICITES, et encre de l'élément LCP (relevée au
 * moment de sa peinture, car `createRoot` détache ensuite le nœud de la coquille
 * — le mesurer après coup rendrait un rectangle 0×0).
 */
const RELEVE = () => {
  const encre = (el) => {
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()];
    if (!rects.length) return null;
    return {
      gauche: +Math.min(...rects.map((r) => r.left)).toFixed(2),
      droite: +Math.max(...rects.map((r) => r.right)).toFixed(2),
    };
  };
  const porteurs = () =>
    [...document.querySelectorAll('body *')]
      .filter((el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
      )
      .map((el) => ({ balise: el.tagName, encre: encre(el) }));

  // Les porteurs de la DECISION : tout element dont une classe aligne, d'une
  // facon ou d'une autre. `text-left` compte aussi : sa remise a `start` est ce
  // que mesurerait son retrait.
  const decideurs = [
    ...document.querySelectorAll(
      '[class*="text-center"],[class*="text-right"],[class*="text-left"]'
    ),
  ].filter((el) => el.getClientRects().length > 0);

  const avant = porteurs();
  const racine = document.querySelector('.App');
  const lcp = (window.__kojoLcp || []).reduce(
    (meilleur, entree) => (!meilleur || entree.aire > meilleur.aire ? entree : meilleur),
    null
  );
  for (const el of decideurs) el.style.textAlign = 'start';
  const apres = porteurs();

  const deplaces = avant.filter((a, i) => {
    const b = apres[i].encre;
    return (
      a.encre && b && (Math.abs(a.encre.gauche - b.gauche) > 0.5 || Math.abs(a.encre.droite - b.droite) > 0.5)
    );
  });
  const ecarts = avant
    .map((a, i) => {
      const b = apres[i].encre;
      if (!a.encre || !b) return 0;
      return Math.max(Math.abs(a.encre.gauche - b.gauche), Math.abs(a.encre.droite - b.droite));
    })
    .filter((ecart) => ecart > 0.5);
  const parBalise = {};
  for (const d of deplaces) parBalise[d.balise] = (parBalise[d.balise] || 0) + 1;

  return {
    racinePresente: !!racine,
    decideurs: decideurs.length,
    textuels: avant.length,
    deplaces: deplaces.length,
    partDeplacee: avant.length ? +(deplaces.length / avant.length).toFixed(3) : 0,
    ecartMax: ecarts.length ? +Math.max(...ecarts).toFixed(2) : 0,
    parBalise,
    lcp,
  };
};

/** Observateur installé AVANT la navigation : l'élément LCP et son encre. */
const ESPION = () => {
  window.__kojoLcp = [];
  const encre = (el) => {
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()];
    if (!rects.length) return null;
    return {
      gauche: +Math.min(...rects.map((r) => r.left)).toFixed(2),
      droite: +Math.max(...rects.map((r) => r.right)).toFixed(2),
    };
  };
  new PerformanceObserver((liste) => {
    for (const entree of liste.getEntries()) {
      window.__kojoLcp.push({
        aire: entree.size,
        balise: entree.element ? entree.element.tagName : '?',
        encre: encre(entree.element),
      });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
};

const serveur = await demarrerLeServeur();
const navigateur = await chromium.launch();
let lignes = 0;
let deplacesTotal = 0;

try {
  console.log(
    'Décision mesurée : les centures EXPLICITES (`text-center`, etc.) — encre déplacée si on les retire\n'
  );
  console.log(
    'route                              taille   décideurs  textes  déplacés   part   écart max   LCP (encre)\n' +
      '─'.repeat(108)
  );
  for (const route of ROUTES) {
    for (const { nom, viewport } of TAILLES) {
      const page = await navigateur.newPage({ viewport });
      try {
        await page.addInitScript(ESPION);
        await page.goto(`http://127.0.0.1:${PORT}${route}`);
        await page.waitForTimeout(1200);
        const releve = await page.evaluate(RELEVE);
        if (!releve.racinePresente) {
          console.log(`${route.padEnd(34)} ${nom.padEnd(8)} ❌ aucune enveloppe « .App »`);
          continue;
        }
        lignes += 1;
        deplacesTotal += releve.deplaces;
        const lcp = releve.lcp
          ? `${releve.lcp.balise} de x=${releve.lcp.encre?.gauche} à ${releve.lcp.encre?.droite}`
          : 'non relevé';
        console.log(
          `${route.padEnd(34)} ${nom.padEnd(8)} ${String(releve.decideurs).padStart(8)} ` +
            `${String(releve.textuels).padStart(7)} ${String(releve.deplaces).padStart(9)} ` +
            `${String(`${Math.round(releve.partDeplacee * 100)} %`).padStart(6)} ` +
            `${String(`${releve.ecartMax} px`).padStart(10)}   ${lcp}`
        );
      } finally {
        await page.close();
      }
    }
  }
  console.log('─'.repeat(108));
  console.log(
    `${lignes} relevé(s) sur ${ROUTES.length} route(s) pré-rendue(s) × ${TAILLES.length} taille(s) : ` +
      `${deplacesTotal} déplacements d'encre au total.`
  );
  console.log(
    "\nVerdict : l'alignement du site n'est plus hérité mais DÉCLARÉ — ces déclarations sont le dessin, " +
      'et la table ci-dessus dit ce qu\'elles tiennent (voir le commentaire au-dessus de `.App` dans src/App.css).'
  );
} finally {
  await navigateur.close();
  serveur.kill();
}
