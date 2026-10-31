#!/usr/bin/env node
/**
 * SONDE CDN : le TTFB et le LCP de la production, mesurés et PUBLIÉS chaque jour.
 *
 * CE QU'ELLE FERME (31/10/2026). Le dépôt mesurait des FAITS (révision servie,
 * actifs, SEO, typographie, CSP) et des POIDS (budgets de bundle, de CSS), mais
 * jamais la seule grandeur que le visiteur ressent : le temps avant le premier
 * octet utile, et l'instant où le plus grand élément de la page est peint. Un
 * CDN qui répond en 2 s, une image LCP qui part du serveur d'origine au lieu du
 * bord : rien de tout cela ne change un statut HTTP, un canonical ou un octet de
 * bundle, donc rien de tout cela ne rougissait nulle part.
 *
 * TROIS DÉCISIONS, ET LES MESURES QUI LES ONT PRISES.
 *
 * 1. UN CHARGEMENT DE CHAUFFE, JETÉ. Mesuré le 31/10/2026 depuis un poste :
 *    « / » a rendu **9 668 ms de TTFB et 12 712 ms de LCP** au premier
 *    chargement, puis **388 ms / 852 ms** au second. Ce n'est pas une panne du
 *    site, c'est un bord froid (résolution DNS, poignée de main TLS, cache CDN
 *    vide côté nœud). Juger cette première visite aurait rougi la sonde tous les
 *    matins pour un fait qui ne se produit qu'une fois par nœud.
 * 2. LA MÉDIANE DE TROIS MESURES, jamais la première ni la meilleure. Un
 *    décideur unique (min) cache une dégradation qui touche deux visiteurs sur
 *    trois ; le maximum, lui, juge le hasard du réseau. La médiane est publiée
 *    AVEC le minimum et le maximum de chaque route, pour que l'écart reste
 *    visible au lieu d'être moyenné.
 * 3. LES SEUILS SONT UNE SIGNATURE DE PANNE, PAS UN BUDGET DE PERFORMANCE. Le
 *    budget de performance est jugé là où il a un sens (Lighthouse, `lhci-*`,
 *    sur un artefact local et un profil réseau fixé). Un chiffre mesuré depuis
 *    un runner GitHub, à travers Internet, ne borne pas le site : il borne la
 *    machine et le trajet. Les plafonds ci-dessous sont donc LARGES à dessein —
 *    ils attrapent « la page ne répond plus » et « le LCP s'est effondré » — et
 *    la tendance quotidienne se lit dans les nombres publiés, pas dans la
 *    couleur du run. Écrire ici un seuil serré aurait produit une sonde qu'on
 *    désactive au bout de trois semaines.
 *
 * L'INSTRUMENT LCP EST CELUI DU DÉPÔT (`e2e/lcp-geometrie.spec.js`,
 * `e2e/contact-lcp.spec.js`, `e2e/lcp-app.spec.js`) : un `PerformanceObserver`
 * `largest-contentful-paint` posé AVANT la navigation, en `buffered: true`, et
 * on lit la DERNIÈRE candidate. Aucune géométrie n'est jugée ici (les sondes
 * e2e le font) : seule la DATE de la dernière candidate compte.
 *
 * Trois sorties, jamais deux :
 *   0 — toutes les routes répondent 200, chacune a un TTFB et un LCP, et les
 *       médianes sont sous les plafonds ;
 *   1 — refus NOMMÉ : statut inattendu, aucune candidate LCP (l'instrument n'a
 *       rien lu), médiane au-dessus d'un plafond ;
 *   2 — PRÉMISSE : aucune route lisible (origine injoignable, réseau, lancement
 *       du navigateur impossible) ou corpus vide. Une prémisse n'est jamais un
 *       vert, et elle rougit le run.
 *
 * Usage :
 *   node scripts/check-cdn-lente-production.js
 *   node scripts/check-cdn-lente-production.js --base https://… --routes /,/jobs
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { PAGE_META } from '../src/config/page-meta.js';

const ORIGINE_PAR_DEFAUT = 'https://kojoforafrica.cc.cd';

// Les routes jugées sont DÉRIVÉES de `src/config/page-meta.js` : ce fichier est
// le propriétaire des routes qui publient un titre et une description, il est
// déjà confronté aux coquilles pré-rendues et au sitemap par leurs gardes. Une
// route ajoutée là-bas est donc mesurée le lendemain, sans toucher à ce script.
export const ROUTES = Object.keys(PAGE_META);

/**
 * Plafonds d'ALARME (voir l'en-tête). Mesuré le 31/10/2026 après chauffe, depuis
 * un poste, sur la production : TTFB 219 à 388 ms, LCP 452 à 852 ms sur /jobs,
 * /login, /how-it-works et /. Les plafonds laissent donc ~4× (TTFB) et ~5× (LCP)
 * de marge : ils ne disent rien d'une lenteur acceptable, ils disent qu'une page
 * a changé de nature.
 */
export const BUDGETS = {
  ttfbMs: 1500,
  lcpMs: 4000,
};

// Trois mesures et une médiane : deux suffisent à définir une médiane mais pas à
// ignorer un décideur aberrant, et au-delà de trois le coût (une navigation
// chacune, ~1 à 3 s) dépasse ce que la question demande.
export const ECHANTILLONS_PAR_DEFAUT = 3;

// Un plancher de lecture : sous ce nombre de routes, le corpus ne décrit plus la
// surface du site (une liste vide dit que la DÉCLARATION n'a pas été lue).
export const PLANCHER_ROUTES = 5;

const TAILLE_MOBILE = { width: 412, height: 823 };

/** Médiane d'une liste de nombres (sans muter l'entrée). */
export const mediane = (valeurs) => {
  const triees = valeurs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (triees.length === 0) return null;
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 ? triees[milieu] : Math.round((triees[milieu - 1] + triees[milieu]) / 2);
};

const ms = (valeur) => (typeof valeur === 'number' ? `${Math.round(valeur)} ms` : '—');

/**
 * L'observateur des candidates LCP, sérialisé dans la page AVANT la navigation.
 *
 * `buffered: true` rattrape les entrées peintes avant que l'observateur
 * n'existe ; on garde la DERNIÈRE candidate, comme les sondes e2e du dépôt.
 */
export const ESPION_LCP = () => {
  window.__kojoCdn = { lcp: [] };
  try {
    new PerformanceObserver((liste) => {
      for (const entree of liste.getEntries()) {
        window.__kojoCdn.lcp.push({ debut: entree.startTime, taille: entree.size });
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (erreur) {
    // Un navigateur sans cet Observateur ne doit pas casser la sonde : le
    // relevé dira « aucune candidate », qui est un refus nommé.
    window.__kojoCdn.erreur = String(erreur && erreur.message);
  }
};

/** Le relevé lu DANS la page : TTFB (navigation timing) et dernière LCP. */
export const LIRE_RELEVE = () => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const lcp = (window.__kojoCdn && window.__kojoCdn.lcp) || [];
  const derniere = lcp.length ? lcp[lcp.length - 1] : null;
  return {
    ttfb: typeof nav.responseStart === 'number' && typeof nav.startTime === 'number'
      ? Math.round(nav.responseStart - nav.startTime)
      : null,
    lcp: derniere ? Math.round(derniere.debut) : null,
    candidates: lcp.length,
    erreur: (window.__kojoCdn && window.__kojoCdn.erreur) || null,
  };
};

/**
 * Une mesure d'une route, dans un navigateur déjà lancé.
 *
 * @param {object} navigateur Instance Playwright (`chromium.launch()`).
 * @param {string} base Origine à mesurer.
 * @param {string} route Chemin (« /jobs »).
 * @param {number} [delaiPeinture] Attente après `load` pour laisser passer une
 *   candidate tardive (une image qui arrive après le HTML).
 * @returns {Promise<{statut: number|null, ttfb: number|null, lcp: number|null,
 *   candidates: number, erreur: string|null}>}
 */
export const mesurerViaNavigateur = async (navigateur, base, route, delaiPeinture = 800) => {
  const page = await navigateur.newPage({ viewport: TAILLE_MOBILE });
  try {
    await page.addInitScript(ESPION_LCP);
    let statut = null;
    try {
      const reponse = await page.goto(`${base.replace(/\/$/, '')}${route}`, {
        waitUntil: 'load',
        timeout: 45000,
      });
      statut = reponse ? reponse.status() : null;
    } catch (erreur) {
      return { statut, ttfb: null, lcp: null, candidates: 0, erreur: String(erreur.message || erreur) };
    }
    // Le LCP n'est définitif qu'une fois la page stable : un délai court après
    // `load` laisse passer l'image qui arrive après le HTML (mesuré : une
    // candidate à +600 ms sur / en 412×823).
    await page.waitForTimeout(delaiPeinture);
    const releve = await page.evaluate(LIRE_RELEVE);
    return { statut, ...releve };
  } finally {
    await page.close();
  }
};

/**
 * Juge les relevés AGRÉGÉS (une entrée par route) et rend le verdict.
 *
 * Séparé de la mesure pour que les preuves scriptent des chiffres sans navigateur
 * et pour que le verdict soit relisible : une règle qu'on ne peut pas éprouver
 * hors ligne dérive sans que rien ne le dise.
 *
 * @param {Array<{route: string, statut: number|null, ttfb: number|null,
 *   lcp: number|null, candidats: number, echantillons: number[],
 *   erreur?: string|null}>} releves
 * @param {{ttfbMs: number, lcpMs: number}} [budgets]
 * @returns {{ok: boolean, erreurs: string[]}}
 */
export const juger = (releves, budgets = BUDGETS) => {
  const erreurs = [];
  for (const releve of releves) {
    const { route } = releve;
    if (releve.erreur) {
      erreurs.push(`${route} : illisible (${releve.erreur}) — la route n'a pas pu être chargée`);
      continue;
    }
    if (releve.statut !== 200) {
      erreurs.push(`${route} : HTTP ${releve.statut} au lieu de 200 — la route ne répond pas`);
      continue;
    }
    if (releve.lcp === null || releve.lcp === undefined) {
      erreurs.push(
        `${route} : aucune candidate LCP lue sur ${releve.echantillons.length} mesure(s) — ` +
          "l'instrument n'a rien vu, donc il ne prouve rien (un LCP nul n'est pas un LCP rapide)"
      );
      continue;
    }
    if (typeof releve.ttfb === 'number' && releve.ttfb > budgets.ttfbMs) {
      erreurs.push(
        `${route} : TTFB ${ms(releve.ttfb)} > plafond ${ms(budgets.ttfbMs)} ` +
          `(médiane de ${releve.echantillons.length} mesures) — le bord ne répond plus`
      );
    }
    if (releve.lcp > budgets.lcpMs) {
      erreurs.push(
        `${route} : LCP ${ms(releve.lcp)} > plafond ${ms(budgets.lcpMs)} ` +
          `(médiane de ${releve.echantillons.length} mesures) — le plus grand élément se peint trop tard`
      );
    }
  }
  return { ok: erreurs.length === 0, erreurs };
};

/**
 * La passe complète : mesure chaque route (chauffe jetée, puis médiane), juge, publie.
 *
 * `mesurer` est injectable : les preuves jouent une passe entière sans navigateur.
 *
 * @returns {Promise<{code: number, releves: object[], erreurs: string[]}>}
 */
export const verifier = async ({
  base = ORIGINE_PAR_DEFAUT,
  routes = ROUTES,
  echantillons = ECHANTILLONS_PAR_DEFAUT,
  mesurer,
  budgets = BUDGETS,
  cout = () => {},
} = {}) => {
  if (!Array.isArray(routes) || routes.length < PLANCHER_ROUTES) {
    console.log(
      `[PREMISSE] corpus de routes vide ou amputé (${(routes || []).length} route(s), ` +
        `plancher ${PLANCHER_ROUTES}) : la déclaration de src/config/page-meta.js n'a pas été lue — ` +
        'aucun verdict rendu ici'
    );
    return { code: 2, releves: [], erreurs: [] };
  }
  if (typeof mesurer !== 'function') {
    throw new Error('verifier : `mesurer` doit être fourni (navigateur réel ou injection de test)');
  }

  const debut = Date.now();
  const releves = [];
  let navigations = 0;
  let illisibles = 0;

  for (const route of routes) {
    let derniereErreur = null;
    try {
      // Chauffe JETÉE : c'est le chargement qui paie DNS, TLS et le cache de
      // bord. La garder ferait de la sonde un détecteur de bord froid.
      await mesurer(route);
      navigations += 1;
      const mesures = [];
      for (let i = 0; i < echantillons; i += 1) {
        mesures.push(await mesurer(route));
        navigations += 1;
      }
      const ttfb = mesures.map((m) => m.ttfb).filter((v) => typeof v === 'number');
      const lcp = mesures.map((m) => m.lcp).filter((v) => typeof v === 'number');
      const statuts = mesures.map((m) => m.statut);
      const borne = (valeurs, sens) =>
        valeurs.length ? Math[sens](...valeurs) : null;
      releves.push({
        route,
        statut: statuts.every((s) => s === 200) ? 200 : statuts.find((s) => s !== 200) ?? null,
        ttfb: mediane(ttfb),
        lcp: mediane(lcp),
        ttfbMin: borne(ttfb, 'min'),
        ttfbMax: borne(ttfb, 'max'),
        lcpMin: borne(lcp, 'min'),
        lcpMax: borne(lcp, 'max'),
        candidats: mesures.reduce((n, m) => n + (m.candidates || 0), 0),
        echantillons: lcp,
        erreur: mesures.find((m) => m.erreur)?.erreur ?? null,
      });
    } catch (erreur) {
      illisibles += 1;
      derniereErreur = String(erreur.message || erreur);
      releves.push({
        route,
        statut: null,
        ttfb: null,
        lcp: null,
        candidats: 0,
        echantillons: [],
        erreur: derniereErreur,
      });
    }
  }

  const duree = (Date.now() - debut) / 1000;

  // Toutes les routes injoignables : le réseau ou l'origine, pas le code de la
  // PR. Une prémisse rougit le run, elle ne se lit jamais comme un vert.
  if (illisibles === releves.length) {
    console.log(
      `[PREMISSE] aucune des ${releves.length} route(s) n'a pu être chargée ` +
        `(dernière erreur : ${releves[0]?.erreur}) — aucun verdict rendu ici`
    );
    cout({ navigations, duree, routes: releves });
    return { code: 2, releves, erreurs: [] };
  }

  const verdict = juger(releves, budgets);

  for (const releve of releves) {
    console.log(
      `  ${releve.route.padEnd(18)} TTFB ${ms(releve.ttfb).padStart(8)} ` +
        `(${ms(releve.ttfbMin)}–${ms(releve.ttfbMax)})   ` +
        `LCP ${ms(releve.lcp).padStart(8)} (${ms(releve.lcpMin)}–${ms(releve.lcpMax)})   ` +
        `${releve.candidats} candidate(s)`
    );
  }
  console.log(
    `[COUT] ${releves.length} route(s) jugée(s), ${navigations} navigation(s) ` +
      `(chauffe comprise), ${duree.toFixed(1)} s, plafonds TTFB ${ms(budgets.ttfbMs)} / ` +
      `LCP ${ms(budgets.lcpMs)}`
  );
  cout({ navigations, duree, routes: releves });

  if (verdict.erreurs.length) {
    for (const erreur of verdict.erreurs) console.log(`[ERREUR] ${erreur}`);
    console.log('[VERDICT] refus');
    return { code: 1, releves, erreurs: verdict.erreurs };
  }

  console.log('[VERDICT] conforme');
  return { code: 0, releves, erreurs: [] };
};

// Le coût est publié sur le vert COMME sur le rouge : une sonde dont les
// chiffres n'apparaissent que le jour où ils débordent n'a servi à aucun
// arbitrage (même règle que les autres sondes de production du dépôt).
const _publierResume = (lignes) => {
  const chemin = process.env.GITHUB_STEP_SUMMARY;
  if (!chemin) return;
  try {
    fs.appendFileSync(chemin, `${lignes.join('\n')}\n`);
  } catch {
    // Un résumé illisible n'est pas une raison de perdre le verdict.
  }
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = { base: ORIGINE_PAR_DEFAUT, routes: ROUTES, echantillons: ECHANTILLONS_PAR_DEFAUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base' && argv[i + 1]) options.base = argv[++i];
    else if (arg === '--routes' && argv[i + 1]) options.routes = argv[++i].split(',').map((r) => r.trim()).filter(Boolean);
    else if (arg === '--echantillons' && argv[i + 1]) options.echantillons = Math.max(1, Number(argv[++i]) || 1);
  }

  if (!/^https?:\/\//i.test(options.base)) {
    console.log(`[PREMISSE] origine inutilisable : ${options.base} — aucun verdict rendu ici`);
    return 2;
  }

  console.log(`Sonde CDN : ${options.base} — ${options.routes.length} route(s), ${options.echantillons} mesure(s) + chauffe`);

  let navigateur;
  try {
    // Import DYNAMIQUE : les preuves de ce script n'ont pas besoin de navigateur
    // installé, et un poste sans Chromium peut quand même relire le module.
    // `@playwright/test`, et non `playwright` : c'est la dépendance DÉCLARÉE
    // (devDependencies), celle que les autres sondes de production importent —
    // importer le paquet transitif marchait par hissage npm et cassait dès que
    // l'arbre change (`check-script-deps.js` le refuse, et il a raison).
    const { chromium } = await import('@playwright/test');
    navigateur = await chromium.launch();
  } catch (erreur) {
    console.log(
      `[PREMISSE] navigateur indisponible (${String(erreur.message || erreur).split('\n')[0]}) — ` +
        'aucun verdict rendu ici ; installer avec `npx playwright install --with-deps chromium`'
    );
    return 2;
  }

  try {
    const resultat = await verifier({
      ...options,
      mesurer: (route) => mesurerViaNavigateur(navigateur, options.base, route),
      cout: ({ navigations, duree, routes }) => {
        const lignes = [
          `### Sonde CDN — ${options.base}`,
          '',
          '| route | TTFB médian | TTFB min–max | LCP médian | LCP min–max |',
          '| --- | --- | --- | --- | --- |',
          ...routes.map(
            (r) =>
              `| \`${r.route}\` | ${ms(r.ttfb)} | ${ms(r.ttfbMin)}–${ms(r.ttfbMax)} | ` +
              `${ms(r.lcp)} | ${ms(r.lcpMin)}–${ms(r.lcpMax)} |`
          ),
          '',
          `Coût : ${navigations} navigation(s) (chauffe comprise), ${duree.toFixed(1)} s.`,
        ];
        _publierResume(lignes);
      },
    });
    return resultat.code;
  } finally {
    await navigateur.close();
  }
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((erreur) => {
      console.error(`[PREMISSE] sonde interrompue : ${erreur.message}`);
      process.exit(2);
    });
}
