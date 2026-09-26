#!/usr/bin/env node
/**
 * MESURE LOCALE « FIDÈLE À LA CI » — la pile complète, puis Lighthouse.
 *
 * ── Le trou que cet outil ferme ──────────────────────────────────────────────
 * Sur ce poste, une mesure du LCP/SI « à la main » ne servait PAS l'artefact
 * audité par la CI : le build était compilé avec une API tierce ou absente, donc
 * la page mesurée appelait le backend de production (ou rien). Les requêtes
 * d'API échouaient, et l'audit décrivait alors un ÉTAT D'ERREUR — pas la page
 * qu'un utilisateur reçoit. Relevé du 25/09/2026 sur /jobs, fixture arrêtée :
 * deux `502` sur `GET /api/jobs?limit=12&page=1&status=open` et une liste vide,
 * pour un SI de 953 ms parfaitement « propre » (le LCP et le SI de /jobs sont la
 * peinture de la coquille : ils ne rougissent PAS quand l'API tombe — seule la
 * page change de contenu). Mesurer le SI sans regarder le journal réseau, c'est
 * donc mesurer un nombre juste sur une page fausse.
 *
 * ── Ce qu'il monte, et pourquoi dans cet ordre ───────────────────────────────
 *   1. `npm run build` avec `VITE_API_URL=http://127.0.0.1:<port>/api` : l'API
 *      est MÊME-ORIGINE, comme en production où Vercel rejoue `/api/:path*`.
 *      Sans ce build, l'API inlinée ne passe pas par la table de rewrites.
 *   2. la fixture `scripts/playtest-api-server.mjs` sur 8123 (la même que les
 *      parcours e2e : une vraie fixture serveur, donc de vraies requêtes HTTP) ;
 *   3. `scripts/vercel-rewrite-server.js` sur 4174, `--backend` 8123 : la table
 *      de `vercel.json` devant le build ET devant la fixture — c'est l'ordre qui
 *      fait que `/api/*` est servi par la fixture au lieu du backend Fly.
 * Le port de la pile est celui de la CI (`DEFAULT_PORT` du serveur de rewrites,
 * importé — jamais recopié) ; le port de la fixture est celui de
 * `playwright.config.js`.
 *
 * ── Quatre pièges, tous les quatre MESURÉS ici ───────────────────────────────
 *   • `preset: 'desktop'` est une option du CLI Lighthouse, PAS de son API Node :
 *     passée à l'API Node elle est ignorée EN SILENCE. Premier passage « desktop »
 *     du 25/09/2026 : `configSettings.formFactor` valait `mobile`, écran
 *     412×823, CPU ×4 — un relevé desktop qui n'en était pas un. L'API Node prend
 *     la CONFIG (`desktopConfig`/`defaultConfig`, exportées par `lighthouse`),
 *     celles que le CLI charge pour `--preset`. L'outil lit en plus la condition
 *     REÇUE dans le LHR (`formFactor`, écran, bridage) : c'est l'étiquette
 *     mesurée qui est imprimée, jamais le nom du drapeau demandé.
 *   • `npx lhci autorun` est INUTILISABLE sur cet hôte Windows : le CLI meurt au
 *     nettoyage du profil temporaire (`EPERM ... lighthouse.<n>`), après avoir
 *     audité la page mais AVANT d'écrire le moindre LHR. D'où le pilotage par
 *     l'API Node, le profil jetable étant relâché SANS exiger sa suppression.
 *   • Les DRAPEAUX de Chrome décident du Speed Index. Premier jet du 25/09/2026
 *     qui lançait Chrome à la main avec les quatre seuls drapeaux de la CI
 *     (`--no-sandbox --headless=new --disable-gpu --disable-dev-shm-usage`) :
 *     même artefact, même pile, SI 5 057 / 4 804 / 2 984 ms sur `/` et trois
 *     console.error par route — contre 1 148 à 1 444 ms avec le lanceur du
 *     dépôt. La différence n'était pas la page : `chrome-launcher` ajoute ses
 *     drapeaux par défaut (`--disable-features=Translate,…`,
 *     `--disable-background-networking`, `--enable-automation`, …) et c'est CEUX
 *     que `lhci` utilise en CI. Un Chrome lancé à la main mesure donc autre
 *     chose, avec l'air d'être la même chose. D'où `chrome-launcher` ici aussi,
 *     dans la version que `@lhci/cli` déclare (0.13.4) — jamais des drapeaux
 *     recopiés, qui divergeraient d'une version à l'autre.
 *   • SOUS MSYS/GIT BASH, `--routes /` ARRIVE CONVERTI EN CHEMIN WINDOWS
 *     (`C:/Program Files/Git/`), et Lighthouse ne rend alors qu'un
 *     `INVALID_URL` qui ne dit RIEN de la conversion — deux tentatives perdues
 *     le 25/09/2026 avant d'en voir la cause. La recette est
 *     `MSYS_NO_PATHCONV=1 node scripts/mesure-lighthouse-locale.mjs --routes /`,
 *     et l'outil REFUSE désormais une route qui n'est pas un chemin de site, en
 *     nommant la conversion : un outil qui accepterait de mesurer l'URL qu'on
 *     lui a livrée fabriquerait des chiffres inattribuables.
 *
 * ── Ce qu'il ne fait pas ─────────────────────────────────────────────────────
 * Aucun VERDICT : il mesure et imprime (`role: "outil"` dans
 * .github/scripts/guard-proofs.json). Le verdict de performance est ailleurs —
 * `lighthouserc.cjs` / `lighthouserc.desktop.cjs` (budgets par route, en CI).
 * Ce qu'il ajoute à ces passes, et qu'elles ne peuvent pas dire : les requêtes
 * `/api/` réellement observées. Une requête non-2xx y est NOMMÉE avec son code,
 * sauf celles que l'audit bloque lui-même (les motifs de
 * `scripts/lhci-cls-budgets.cjs`, lus à la source) : celles-là sont attendues.
 *
 * ── Pourquoi AUCUN `onlyCategories` ──────────────────────────────────────────
 * `onlyCategories: ['performance']` ne rend pas seulement le run plus court :
 * il RETIRE des audits du rapport. Mesuré le 25/09/2026 sur ce même poste :
 * `errors-in-console` (catégorie « best practices ») devenait introuvable, et un
 * relevé « 0 erreur console » lu avec `?.` aurait été VRAI À VIDE — un zéro qui
 * ne dit rien du dépôt. Les deux audits que cet outil lit sont donc EXIGÉS
 * (`exigerAudit`) : un audit absent fait échouer la mesure au lieu de fabriquer
 * un zéro.
 *
 * ── MESURER LA VARIANCE, PAS SEULEMENT LA PAGE ───────────────────────────────
 * Deux runs, ce ne sont pas deux mesures de la page : ce sont des mesures de la
 * page ET de l'hôte, sans moyen de les séparer. D'où deux usages à rendre
 * explicites :
 *   • `--sans-build --runs <n élevé>` mesure le MÊME artefact n fois (un seul
 *     build, aucune reconstruction entre les runs). C'est la DISPERSION de
 *     l'hôte pour cet artefact — et elle se publie (n, min, p25, médiane, p75,
 *     p90, max, étendue, écart-type), pas seulement son minimum ;
 *   • `--root <autre dossier> --sans-build` A/B deux artefacts dans la MÊME
 *     session, la seule façon d'attribuer une différence à l'artefact plutôt
 *     qu'à l'heure.
 * Ce que la dispersion dit et qu'un run isolé ne peut pas dire : un effet plus
 * PETIT que l'étendue n'est pas mesurable ici, et un seuil qui l'exigerait
 * mesurerait du bruit. Le verdict, lui, reste ailleurs.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   cd frontend && node scripts/mesure-lighthouse-locale.mjs
 *   node scripts/mesure-lighthouse-locale.mjs --routes /,/jobs --runs 3 \
 *        --preset desktop --sans-build --out <dossier des LHR>
 *   node scripts/mesure-lighthouse-locale.mjs --routes / --runs 30 --sans-build
 *        # MÊME artefact : 30 runs, la dispersion de l'hôte pour cette page
 *
 * Les LHR complets sont écrits dans `--out` (défaut :
 * `<temp>/kojo-mesure-locale`) : chaque chiffre imprimé est relisible.
 *
 * `--root <dossier>` sert à A/B deux artefacts SANS rebuild (ex. `build` contre
 * une copie élaguée) : c'est lui qui permet de dire ce qu'une réduction du
 * document rapporte, sur le même hôte, dans la même session.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'chrome-launcher';
import lighthouse, { defaultConfig, desktopConfig } from 'lighthouse';
// Table des requêtes bloquées et port de la pile : importés, jamais recopiés —
// une seconde liste de motifs pourrait oublier une entrée, et deux ports
// écrits deux fois finissent par diverger de `playwright.config.js`.
import budgets from './lhci-cls-budgets.cjs';
import { DEFAULT_PORT } from './vercel-rewrite-server.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(ICI, '..');

const valeur = (nom, defaut) => {
  const index = process.argv.indexOf(`--${nom}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
};
const present = (nom) => process.argv.includes(`--${nom}`);
const attendre = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms));

const PORT_PILE = Number(valeur('port', DEFAULT_PORT));
const PORT_FIXTURE = Number(valeur('api-port', 8123));
const ROUTES = valeur('routes', '/,/jobs,/contact').split(',').map((r) => r.trim()).filter(Boolean);
const RUNS = Number(valeur('runs', 3));
const PRESET = valeur('preset', 'mobile');
const SANS_BUILD = present('sans-build');
// Racine du build SERVI (et non seulement audité) : deux racines = deux
// artefacts comparables sur la même pile, sans rebuild intermédiaire.
const RACINE = valeur('root', 'build');
const DOSSIER = valeur('out', path.join(tmpdir(), 'kojo-mesure-locale'));
mkdirSync(DOSSIER, { recursive: true });
const MOTIFS_BLOQUES = Object.keys(budgets.REQUETES_HORS_CONTROLE);
const CONFIG = PRESET === 'desktop' ? desktopConfig : defaultConfig;

if (!['mobile', 'desktop'].includes(PRESET)) {
  console.error(`::error::--preset inconnu : « ${PRESET} » (mobile | desktop)`);
  process.exit(1);
}

// Un chemin de site commence par « / » et n'est pas un chemin de DISQUE. La
// vérification ferme le piège MSYS mesuré ci-dessus : sans elle, `--routes /`
// auditerait `http://127.0.0.1:4174/C:/Program Files/Git/` (ou échouerait sur
// un `INVALID_URL` qui ne nomme pas la conversion).
const routesConverties = ROUTES.filter((route) => /^[A-Za-z]:/.test(route) || !route.startsWith('/'));
if (routesConverties.length) {
  console.error(
    `::error::route(s) qui ne sont pas des chemins de site : ${routesConverties.join(', ')} — ` +
      'sous MSYS/Git Bash un argument « / » est converti en chemin Windows ; relancer avec ' +
      'MSYS_NO_PATHCONV=1'
  );
  process.exit(1);
}

// Chrome : la même voie que la CI (le Chrome du poste), nommable par CHROME_PATH.
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find((chemin) => existsSync(chemin));

// Les quatre drapeaux de la CI : `chrome-launcher` y ajoute les siens, et c'est
// cet ENSEMBLE qui est mesuré (cf. « Les DRAPEAUX de Chrome décident du Speed
// Index » ci-dessus). Le chemin n'est passé que s'il est connu, sinon le lanceur
// cherche Chrome lui-même (c'est le cas en CI).
const DRAPEAUX_CI = ['--no-sandbox', '--headless=new', '--disable-gpu', '--disable-dev-shm-usage'];

/** Motif de blocage Lighthouse (`*` = joker) — la forme des clés de la table. */
const motifCorrespond = (motif, url) =>
  new RegExp(`^${motif.split('*').map((partie) => partie.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url);

/**
 * Lance un Chrome jetable avec les drapeaux de la CI et rend son port DevTools.
 *
 * `chrome-launcher` est le lanceur du dépôt (celui de `lhci`, même version
 * déclarée) : il apporte les drapeaux par défaut qui conditionnent le Speed
 * Index. Sa `kill()` peut échouer au nettoyage du profil sous Windows (EPERM) —
 * le processus, lui, est bien terminé : le LHR est déjà produit, on n'échoue pas
 * là-dessus.
 */
async function lancerChrome() {
  const chrome = await launch({ chromePath: CHROME, chromeFlags: DRAPEAUX_CI });
  return {
    port: chrome.port,
    relacher: async () => {
      try { await chrome.kill(); } catch { /* EPERM au nettoyage : ignoré */ }
    },
  };
}

/**
 * Démarre un processus de la pile ; ses 20 dernières lignes servent de
 * diagnostic (affichées seulement si la mesure échoue).
 *
 * `shell` pour npm : c'est un `.cmd` sous Windows, donc `spawn('npm')` y échoue
 * sans passer par le shell (ailleurs, npm est un exécutable comme un autre).
 */
function demarrer(nom, executable, args, env, { shell = false } = {}) {
  const enfant = spawn(executable, args, {
    cwd: FRONTEND,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell,
  });
  const journal = [];
  const retenir = (bloc) => {
    for (const ligne of String(bloc).split('\n')) {
      if (ligne.trim()) journal.push(ligne.trim());
    }
    while (journal.length > 20) journal.shift();
  };
  enfant.stdout.on('data', retenir);
  enfant.stderr.on('data', retenir);
  return { nom, enfant, journal: () => journal.join('\n') };
}

async function joignable(url) {
  try {
    const reponse = await fetch(url);
    return reponse.status;
  } catch {
    return 0;
  }
}

/**
 * Un audit absent n'est PAS un zéro : c'est une mesure qui n'a pas eu lieu.
 *
 * @param {object} lhr Rapport Lighthouse.
 * @param {string} id Identifiant d'audit.
 * @returns {object} L'audit exigé.
 */
function exigerAudit(lhr, id) {
  const audit = lhr.audits[id];
  if (!audit) {
    throw new Error(`l'audit « ${id} » est absent du rapport — le relevé ne peut pas s'appuyer sur une mesure qui n'a pas eu lieu`);
  }
  return audit;
}

/**
 * Un port occupé AVANT que l'on démarre : on refuse de mesurer.
 *
 * Sans ce refus, la sonde `/api/health` répondrait — servie par une pile qu'on
 * n'a pas montée — et le relevé porterait sur un artefact INCONNU (l'ancien
 * build, un autre backend). Un outil de mesure qui accepte de mesurer autre
 * chose que ce qu'il vient de monter fabrique des chiffres inattribuables.
 */
function portLibre(port) {
  return new Promise((resoudre) => {
    const sonde = createConnection({ port, host: '127.0.0.1' });
    sonde.on('connect', () => { sonde.destroy(); resoudre(false); });
    sonde.on('error', () => resoudre(true));
  });
}

const serveurs = [];
let chrome = null;
let sortie = 0;

try {
  console.log(`Pile locale fidèle à la CI (preset ${PRESET})`);

  for (const port of [PORT_PILE, PORT_FIXTURE]) {
    if (!(await portLibre(port))) {
      throw new Error(
        `un serveur écoute déjà sur le port ${port} : arrêtez-le (ou changez de port) — mesurer sur une pile qu'on n'a pas montée revient à mesurer un artefact inconnu`
      );
    }
  }
  console.log(CHROME ? `  chrome       : ${CHROME}` : '  chrome       : détecté par chrome-launcher');

  if (!SANS_BUILD) {
    console.log(`  build        : VITE_API_URL=http://127.0.0.1:${PORT_PILE}/api (API même-origine, comme en production)`);
    // Le journal du build est RETENU, pas affiché : la sortie de la mesure doit
    // rester lisible, et un build rouge se raconte mieux par ses dernières lignes.
    // Commande d'UN SEUL tenant + `shell` : npm est un `.cmd` sous Windows et un
    // script sans extension ailleurs. (`spawn('npm', [...], {shell:true})` marche
    // aussi mais déclenche DEP0190 en Node 24 : les arguments ne sont pas échappés.)
    const build = demarrer('build', 'npm run build', [], { VITE_API_URL: `http://127.0.0.1:${PORT_PILE}/api` }, { shell: true });
    const code = await new Promise((resoudre) => build.enfant.on('exit', resoudre));
    if (code !== 0) {
      console.error(build.journal());
      throw new Error(`npm run build a échoué (code ${code})`);
    }
  } else {
    console.log(`  build        : ${RACINE} réutilisé tel quel (--sans-build) — l'API inlinée doit être http://127.0.0.1:${PORT_PILE}/api`);
  }

  serveurs.push(
    demarrer('fixture', process.execPath, ['./scripts/playtest-api-server.mjs'], { PORT: String(PORT_FIXTURE) })
  );
  serveurs.push(
    demarrer(
      'rewrites',
      process.execPath,
      [
        './scripts/vercel-rewrite-server.js',
        '--port',
        String(PORT_PILE),
        '--root',
        RACINE,
        '--config',
        'vercel.json',
        '--backend',
        `http://127.0.0.1:${PORT_FIXTURE}`,
      ],
      {}
    )
  );
  console.log(`  racine servie: ${RACINE}`);
  console.log(`  fixture API  : http://127.0.0.1:${PORT_FIXTURE} (scripts/playtest-api-server.mjs)`);
  console.log(`  rewrites     : http://127.0.0.1:${PORT_PILE} → backend http://127.0.0.1:${PORT_FIXTURE} (vercel.json)`);

  // Attente de la SONDE qui compte : la fixture doit répondre À TRAVERS la table
  // de rewrites (`/api/health`). Un serveur qui écoute ne prouve pas le câblage.
  let cable = false;
  for (let essai = 0; essai < 80; essai += 1) {
    const code = await joignable(`http://127.0.0.1:${PORT_PILE}/api/health`);
    if (code === 200) { cable = true; break; }
    await attendre(250);
  }
  if (!cable) {
    for (const serveur of serveurs) console.error(`\n--- ${serveur.nom} ---\n${serveur.journal()}`);
    throw new Error(`« /api/health » ne répond pas 200 sur http://127.0.0.1:${PORT_PILE} : la fixture n'est pas derrière le serveur de rewrites`);
  }
  const sante = await (await fetch(`http://127.0.0.1:${PORT_PILE}/api/health`)).json();
  console.log(`  sonde        : /api/health → ${JSON.stringify(sante)}`);

  const table = [];
  const echecsApi = [];

  for (const route of ROUTES) {
    const url = route === '/' ? `http://127.0.0.1:${PORT_PILE}/` : `http://127.0.0.1:${PORT_PILE}${route}`;
    const ligne = { route, runs: [] };
    for (let i = 1; i <= RUNS; i += 1) {
      chrome = await lancerChrome();
      let lhr = null;
      try {
        const resultat = await lighthouse(
          url,
          {
            port: chrome.port,
            output: 'json',
            logLevel: 'error',
            blockedUrlPatterns: MOTIFS_BLOQUES,
          },
          CONFIG
        );
        lhr = resultat.lhr;
      } finally {
        await chrome.relacher();
        chrome = null;
      }
      if (!lhr) {
        console.error(`::error::${route} : le run ${i} n'a produit aucun rapport`);
        echecsApi.push(`${route} run ${i} : aucun rapport Lighthouse`);
        continue;
      }
      const nom = `${route.replace(/\W+/g, '_') || 'racine'}-${PRESET}-${i}`;
      writeFileSync(path.join(DOSSIER, `${nom}.json`), JSON.stringify(lhr));

      const audits = lhr.audits;
      // Le coût du DOCUMENT lui-même : octets servis, parse HTML+CSS, travail de
      // style et de mise en page, et ce que Lighthouse compte comme CSS inutilisé.
      const repartition = exigerAudit(lhr, 'mainthread-work-breakdown').details.items || [];
      const duree = (motif) =>
        repartition.filter((i) => motif.test(i.groupLabel)).reduce((n, i) => n + i.duration, 0);
      const document_ = (exigerAudit(lhr, 'network-requests').details.items || []).find(
        (r) => r.resourceType === 'Document'
      );
      const requetes = (exigerAudit(lhr, 'network-requests').details.items || []).filter((r) => r.url.includes('/api/'));
      const bloquees = requetes.filter((r) => r.statusCode === -1 && MOTIFS_BLOQUES.some((m) => motifCorrespond(m, r.url)));
      const ko = requetes.filter((r) => !bloquees.includes(r) && (r.statusCode < 200 || r.statusCode >= 400 || r.networkFailure || r.finished === false));
      for (const requete of ko) echecsApi.push(`${route} run ${i} : HTTP ${requete.statusCode} ${requete.url}`);
      const config = lhr.configSettings;
      ligne.runs.push({
        score: Math.round((lhr.categories.performance.score || 0) * 100),
        si: Math.round(audits['speed-index'].numericValue),
        fcp: Math.round(audits['first-contentful-paint'].numericValue),
        lcp: Math.round(audits['largest-contentful-paint'].numericValue),
        tbt: Math.round(audits['total-blocking-time'].numericValue),
        cls: Number(audits['cumulative-layout-shift'].numericValue.toFixed(4)),
        apiOk: requetes.filter((r) => !bloquees.includes(r) && r.statusCode >= 200 && r.statusCode < 400).length,
        apiKo: ko.length,
        apiBloquees: bloquees.length,
        // La condition REÇUE, pas celle demandée : c'est elle qui date le relevé.
        condition: `${config.formFactor} ${config.screenEmulation.width}×${config.screenEmulation.height} cpu×${config.throttling?.cpuSlowdownMultiplier ?? '?'} ${config.throttlingMethod}`,
        consoleKo: (exigerAudit(lhr, 'errors-in-console').details.items || []).length,
        version: lhr.lighthouseVersion,
        docBrut: document_?.resourceSize ?? 0,
        docTransfert: document_?.transferSize ?? 0,
        parseHtmlCss: Math.round(duree(/Parse HTML/i)),
        styleLayout: Math.round(duree(/Style & Layout/i)),
        cssInutilise: exigerAudit(lhr, 'unused-css-rules').details.overallSavingsBytes ?? 0,
      });
    }
    table.push(ligne);
  }

  // ── Statistiques de dispersion ─────────────────────────────────────────────
  // Un centile est INTERPOLÉ LINÉAIREMENT (rang = p × (n−1), la convention
  // d'Excel/LibreOffice et de R type 7) : sans convention écrite, deux lecteurs
  // du même relevé publieraient deux p75. L'écart-type est celui de
  // l'ÉCHANTILLON (n−1) : ces runs sont des tirages de l'hôte, pas l'hôte.
  const triees = (valeurs) => [...valeurs].sort((a, b) => a - b);
  const centile = (valeurs, p) => {
    const t = triees(valeurs);
    if (t.length === 0) return 0;
    const rang = p * (t.length - 1);
    const bas = Math.floor(rang);
    const haut = Math.ceil(rang);
    return bas === haut ? t[bas] : t[bas] + (t[haut] - t[bas]) * (rang - bas);
  };
  const ecartType = (valeurs) => {
    if (valeurs.length < 2) return 0;
    const moyenne_ = valeurs.reduce((n, v) => n + v, 0) / valeurs.length;
    return Math.sqrt(valeurs.reduce((n, v) => n + (v - moyenne_) ** 2, 0) / (valeurs.length - 1));
  };
  const distribution = (valeurs) => {
    const t = triees(valeurs);
    if (t.length === 0) {
      return { n: 0, min: 0, p25: 0, mediane: 0, p75: 0, p90: 0, max: 0, etendue: 0, ecartType: 0 };
    }
    return {
      n: t.length,
      min: t[0],
      p25: Math.round(centile(t, 0.25)),
      mediane: Math.round(centile(t, 0.5)),
      p75: Math.round(centile(t, 0.75)),
      p90: Math.round(centile(t, 0.9)),
      max: t[t.length - 1],
      etendue: t[t.length - 1] - t[0],
      ecartType: Math.round(ecartType(t)),
    };
  };
  const mediane = (valeurs) => centile(valeurs, 0.5);
  const premier = table[0]?.runs[0];
  console.log(`\n${RUNS} run(s) par route — condition et version LUEES dans les LHR : ${premier?.condition || '?'} (Lighthouse ${premier?.version || '?'})`);
  console.log('route        score min   SI par run (ms)        SI médian  FCP min  LCP min  TBT min  CLS max  /api/ (ok/bloquée/échec)  console');
  for (const { route, runs } of table) {
    console.log(
      `${route.padEnd(12)} ${String(Math.min(...runs.map((r) => r.score))).padStart(4)}      ` +
        `${runs.map((r) => String(r.si).padStart(5)).join(' / ').padEnd(20)}  ` +
        `${String(Math.round(mediane(runs.map((r) => r.si)))).padStart(8)}   ${String(Math.min(...runs.map((r) => r.fcp))).padStart(7)}  ` +
        `${String(Math.min(...runs.map((r) => r.lcp))).padStart(7)}  ${String(Math.min(...runs.map((r) => r.tbt))).padStart(7)}  ` +
        `${String(Math.max(...runs.map((r) => r.cls))).padStart(7)}  ` +
        `${String(`${runs.reduce((n, r) => n + r.apiOk, 0)}/${runs.reduce((n, r) => n + r.apiBloquees, 0)}/${runs.reduce((n, r) => n + r.apiKo, 0)}`).padStart(22)}  ` +
        `${String(runs.reduce((n, r) => n + r.consoleKo, 0)).padStart(6)}`
    );
  }
  const moyenne = (valeurs) => Math.round(valeurs.reduce((n, v) => n + v, 0) / (valeurs.length || 1));
  console.log('\nCoût du DOCUMENT lui-même (moyenne des runs, condition lue dans les LHR) :');
  console.log('route        doc brut   doc gzip   Parse HTML+CSS   Style & Layout   CSS inutilisé');
  for (const { route, runs } of table) {
    console.log(
      `${route.padEnd(12)} ${String(moyenne(runs.map((r) => r.docBrut))).padStart(8)} o ` +
        `${String(moyenne(runs.map((r) => r.docTransfert))).padStart(8)} o ` +
        `${String(moyenne(runs.map((r) => r.parseHtmlCss)) + ' ms').padStart(14)} ` +
        `${String(moyenne(runs.map((r) => r.styleLayout)) + ' ms').padStart(15)} ` +
        `${String(moyenne(runs.map((r) => r.cssInutilise)) + ' o').padStart(14)}`
    );
  }

  // ── La VARIANCE, chiffrée — la moitié du relevé qui manquait ───────────────
  // Un minimum et une médiane ne se distinguent pas d'un effet réel tant qu'on
  // ne connaît pas la DISPERSION : c'est elle qui dit si un écart de quelques
  // dizaines de millisecondes est un signal ou un tirage. Chaque run garde son
  // LHR dans `--out`, donc ce tableau est relisible run par run (l'ordre des
  // runs y est celui des fichiers `<route>-<preset>-<i>.json`).
  const variance = {};
  console.log('\nDistribution du Speed Index — MÊME artefact, aucun rebuild entre les runs :');
  console.log('route         n    min    p25  médiane    p75    p90    max  étendue    σ   score (min–max, à 100)');
  for (const { route, runs } of table) {
    const d = distribution(runs.map((r) => r.si));
    const scores = runs.map((r) => r.score);
    variance[route] = {
      ...d,
      si: runs.map((r) => r.si),
      score: scores,
      scoreMin: Math.min(...scores),
      scoreMax: Math.max(...scores),
      runsAuPlein: scores.filter((s) => s === 100).length,
    };
    console.log(
      `${route.padEnd(12)} ${String(d.n).padStart(3)}  ${String(d.min).padStart(6)}  ${String(d.p25).padStart(6)}  ` +
        `${String(d.mediane).padStart(7)}  ${String(d.p75).padStart(6)}  ${String(d.p90).padStart(6)}  ` +
        `${String(d.max).padStart(6)}  ${String(d.etendue).padStart(7)}  ${String(d.ecartType).padStart(4)}   ` +
        `${String(Math.min(...scores)).padStart(3)}–${String(Math.max(...scores)).padStart(3)} (${variance[route].runsAuPlein}/${d.n})`
    );
  }
  writeFileSync(
    path.join(DOSSIER, 'distribution-speed-index.json'),
    JSON.stringify(
      {
        preset: PRESET,
        condition: premier?.condition,
        version: premier?.version,
        runsParRoute: RUNS,
        routes: variance,
      },
      null,
      2
    )
  );

  console.log(`\nLHR complets : ${DOSSIER}`);
  console.log(`Motifs bloqués par l'audit (attendus, jamais comptés comme échecs) : ${MOTIFS_BLOQUES.join(', ')}`);
  console.log(
    echecsApi.length === 0
      ? "Aucune requête /api/ en échec : la mesure décrit la page servie, pas un état d'erreur."
      : `Requêtes /api/ en échec (${echecsApi.length}) :\n  ${echecsApi.join('\n  ')}`
  );
} catch (erreur) {
  console.error(`::error::${erreur.message}`);
  sortie = 1;
} finally {
  if (chrome) await chrome.relacher();
  for (const serveur of serveurs) {
    try { serveur.enfant.kill(); } catch { /* déjà mort */ }
  }
}
process.exit(sortie);
