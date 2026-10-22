#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — LE PROFIL `/workers/:id` DEVIENT-IL INTERACTIF ?
 *
 * ── Le fait que cette sonde juge, et pourquoi la sonde voisine ne le peut pas ─
 * `check-worker-page-production.js` juge le DOCUMENT servi : réécriture Vercel
 * (sentinelle), point d'entrée chargé une fois, feuille avant le module, bloc
 * `kojo-worker-data` accordé au `<h1>`, cartes OG. C'est nécessaire, et ce n'est
 * pas suffisant : un document parfait peut charger un module qui ne s'exécute
 * pas (404 sur l'entrée hachée, erreur au premier rendu). Le crawler, lui, ne
 * s'en aperçoit jamais — il lit le HTML. Le SEUL arrivant d'un lien partagé
 * reçoit alors le document statique : un profil lisible, sans châssis ni geste.
 *
 * C'était la limite DÉCLARÉE de cette page (cf. CI-COVERAGE, F21) ; cette sonde
 * la ferme. Elle ouvre le profil dans un vrai Chromium, en production, avec un
 * contexte VIERGE (aucune session), et juge trois faits :
 *
 *   1. LE MONTAGE — `#root` ne porte plus la coquille statique écrite par
 *      `backend/kojo_worker_og.py` mais le châssis de l'application
 *      (`#root nav`). La coquille n'a ni `nav` ni `#root` peuplé par React : le
 *      sélecteur ne peut pas être vrai avant le montage.
 *   2. LE PROFIL PEINT — le `<h1>` de `#root` est le nom du bloc
 *      `kojo-worker-data` : React a consommé la vue publique que le serveur
 *      vient de rendre, il n'affiche ni squelette ni une autre personne.
 *   3. LE GESTE — un clic réel sur l'action de la page, et la navigation qui en
 *      découle est CLIENTE : un marqueur posé dans `window` avant le clic
 *      survit (le document n'a pas été rechargé), l'adresse attendue est
 *      atteinte, et `#root` porte encore le châssis. Un lien mort ne change pas
 *      d'adresse ; un `<a href>` sans routeur recharge le document et perd le
 *      marqueur — les deux sont refusés, nommément.
 *
 * L'action cliquée est choisie dans l'état RENDU : l'ancre stable
 * `[data-sonde="voir-missions"]` (posée par `WorkerProfile` pour cette sonde).
 * Le profil public est en LECTURE SEULE — une proposition se fait depuis la
 * mission (`/jobs/:id`, jugée par `check-job-interactive-production.js`) — donc
 * le geste offert au visiteur est celui de la page : rejoindre les missions.
 * Son absence est un refus : un profil monté sans geste n'a pas de gestionnaire
 * prouvé.
 *
 * ── Ce qu'elle ne fait PAS, et qui est écrit ─────────────────────────────
 *   • aucune ÉCRITURE : le geste ouvre `/jobs`, il ne soumet rien, ne propose
 *     rien, ne crée aucun compte ;
 *   • elle ne rejuge pas le DOCUMENT (réécriture, point d'entrée, ordre, bloc,
 *     cartes OG) : c'est `check-worker-page-production.js`, et deux gardes qui
 *     recopient la même règle divergent un jour ;
 *   • elle ne juge pas le RENDU VISUEL (géométrie, contraste, CLS) : c'est la
 *     suite e2e, sur une pile locale ;
 *   • elle ne juge qu'un navigateur, Chromium, et un profil par passage. La
 *     matrice des moteurs est un autre sujet et un autre coût.
 *
 * ── Trois sorties, jamais deux ────────────────────────────────────────────
 * 0 = le profil a monté, peint la personne du bloc et répondu au geste ;
 * 1 = refus nommé (montage, nom, action, navigation ou marqueur) ;
 * 2 = prémisse : aucun profil `/workers/:id` au sitemap (rien à juger), ou
 *     navigateur indisponible (outillage) — une prémisse n'est jamais un vert.
 *
 * Usage :
 *   node scripts/check-worker-interactive-production.js                     # production
 *   node scripts/check-worker-interactive-production.js --base https://…    # une preview
 *   node scripts/check-worker-interactive-production.js --worker <id|url>   # un profil précis
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { POINT_ENTREE_TRAVAILLEUR, SITE_ORIGIN } from './site-meta.js';
import { BYPASS_ENV } from './preview-vercel.js';
import { cheminProfil, resoudreProfil } from './check-worker-page-production.js';
// Le GESTE et le MARQUEUR sont UNE règle, déjà écrite et prouvée pour la fiche
// mission : même marqueur de vie, même refus d'une navigation qui recharge,
// même lecture de `#root nav` après le clic. La recopier ici ferait deux
// définitions qui divergent au premier correctif — et deux sondes qui ne
// mesurent plus la même chose sous le même nom.
import {
  ACTION_TIMEOUT_MS,
  MONTAGE_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  SELECTEUR_MONTAGE,
  contextOptions,
  eprouverLeGeste,
} from './check-job-interactive-production.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'profil travailleur interactif';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Profil travailleur interactif production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * L'action que la page OFFRE, et qui n'existe que dans l'application :
 * `WorkerProfile` la pose sur son lien vers la liste des missions. Le libellé
 * est traduit en cinq langues et la classe est une peinture — aucun des deux ne
 * peut servir de repère stable.
 */
export const ANCRE_MISSIONS = '[data-sonde="voir-missions"]';

/** Le chemin atteint par cette action, lu dans le routeur. */
export const CHEMIN_MISSIONS = '/jobs';

/** L'action attendue après le montage (une seule aujourd'hui). */
export const SELECTEUR_ACTION = ANCRE_MISSIONS;

const strip = (value) => String(value ?? '').trim().replace(/\/+$/, '');

/**
 * Le libellé qui préfixe chaque refus : la famille, et la surface jugée.
 *
 * @param {string} base Origine servie.
 * @returns {string}
 */
export const libelleSonde = (base) =>
  `${FAMILLE} — le démarrage RÉEL de ${strip(base)}/workers/:id dans un navigateur`;

/**
 * Lance Chromium. Import PARESSEUX : les tests injectent leur propre `launch`
 * et n'ont donc jamais à charger Playwright (ni un navigateur) sous jsdom.
 *
 * @returns {Promise<import('@playwright/test').Browser>} Navigateur lancé.
 */
const defaultLaunch = async () => {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: true });
};

/**
 * L'état du profil, relevé DANS la page : ce que React a réellement rendu.
 *
 * Un seul aller-retour pour que tous les faits décrivent le même instant. Le
 * bloc est HORS de `#root` (`backend/kojo_worker_og.py`), donc il survit au
 * montage — le relire ici ne dépend pas de React.
 *
 * @param {object} page Page Playwright (ou doublure de test).
 * @returns {Promise<object>} Relevé de l'instant.
 */
export async function etatDuProfil(page) {
  return page.evaluate(() => {
    const racine = document.getElementById('root');
    const bloc = document.getElementById('kojo-worker-data');
    let donnees = null;
    if (bloc) {
      try {
        donnees = JSON.parse(bloc.textContent || 'null');
      } catch (_erreur) {
        donnees = null;
      }
    }
    const lisible = Boolean(donnees && typeof donnees === 'object' && !Array.isArray(donnees));
    const titrePeint = racine ? racine.querySelector('h1') : null;
    const normaliser = (valeur) => String(valeur || '').replace(/\s+/g, ' ').trim();
    return {
      monte: Boolean(racine && racine.querySelector('nav')),
      racineVide: !racine || !racine.childElementCount,
      nom: normaliser(titrePeint ? titrePeint.textContent : ''),
      blocLisible: lisible,
      idBloc: lisible ? String(donnees.id || '') : '',
      nomBloc: lisible
        ? normaliser([donnees.first_name, donnees.last_name].filter(Boolean).join(' '))
        : '',
      ancreMissions: Boolean(racine && racine.querySelector('[data-sonde="voir-missions"]')),
    };
  });
}

/**
 * Le refus de MONTAGE, avec le diagnostic que la page permet de lire.
 *
 * @param {object} options
 * @param {string} options.url Adresse demandée.
 * @param {object|null} options.etat Relevé de la page au moment du refus.
 * @param {number} options.timeoutMs Borne d'attente dépassée.
 * @returns {string}
 */
export function refusDeMontage({ url, etat, timeoutMs }) {
  const forme = etat
    ? etat.racineVide
      ? '#root est resté VIDE'
      : etat.monte
        ? '#root porte le châssis (relevé tardif)'
        : '#root porte encore la coquille statique (aucun châssis)'
    : '#root n’a pas pu être relu';
  return (
    `le profil ${url} n'a pas monté en ${Math.round(timeoutMs / 1000)} s : ${forme} — ` +
    `${POINT_ENTREE_TRAVAILLEUR.script} n'a pas exécuté l'application. Vérifier que le point ` +
    `d'entrée répond 200, que son import pointe une entrée /assets/ réellement servie ` +
    `(manifeste d'actifs), et qu'aucune erreur d'exécution n'arrête le premier rendu. ` +
    `Le DOCUMENT, lui, est jugé par check-worker-page-production.js : un profil peut le ` +
    `passer et rester mort dans un navigateur.`
  );
}

/**
 * Choisit l'action à cliquer dans l'état RENDU.
 *
 * Une seule action ici, et son absence est un refus : la page existe pour
 * amener un client vers les missions.
 *
 * @param {object} etat Relevé de la page.
 * @returns {{selecteur: string, chemin: string, quoi: string}|null}
 */
export function choisirAction(etat) {
  if (etat.ancreMissions) {
    return {
      selecteur: ANCRE_MISSIONS,
      chemin: CHEMIN_MISSIONS,
      quoi: 'l’action « voir les missions »',
    };
  }
  return null;
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine frontend servie (défaut : production).
 * @param {string} [options.worker] Identifiant ou URL de profil (défaut : sitemap).
 * @param {string} [options.bypassToken] Jeton de contournement Vercel (preview).
 * @param {Function} [options.launch] Fabrique de navigateur (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {boolean} [options.quiet] Tait la progression.
 * @param {number} [options.montageTimeoutMs] Borne du montage.
 * @param {number} [options.actionTimeoutMs] Borne de l'action.
 * @param {number} [options.navigationTimeoutMs] Borne de la navigation.
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], workerId: string, source: string}>}
 */
export async function runWorkerInteractiveProbe({
  base = process.env.KOJO_WORKER_BASE_URL || DEFAULT_BASE,
  worker = process.env.KOJO_WORKER_ID || '',
  bypassToken = process.env[BYPASS_ENV] || '',
  launch = defaultLaunch,
  fetchImpl = fetch,
  quiet = false,
  montageTimeoutMs = MONTAGE_TIMEOUT_MS,
  actionTimeoutMs = ACTION_TIMEOUT_MS,
  navigationTimeoutMs = NAVIGATION_TIMEOUT_MS,
} = {}) {
  const BASE = strip(base);
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };
  const errors = [];
  const notices = [];
  const checked = [];
  const result = {
    ok: false,
    premisse: false,
    errors,
    notices,
    checked,
    workerId: '',
    source: '',
  };

  // ── 1. Le profil à juger — le résolveur de la sonde du document ─────────
  // Le premier `/workers/:id` du sitemap (la surface par laquelle un crawler le
  // découvre), ou `--worker`. Une seule lecture du sitemap dans tout le dépôt.
  const resolution = await resoudreProfil({ base: BASE, worker, fetchImpl });
  result.workerId = resolution.id;
  result.source = resolution.source;
  if (resolution.erreur) {
    errors.push(resolution.erreur);
    return result;
  }
  if (!resolution.id) {
    result.premisse = true;
    const message =
      `${MARQUE_PREMISSE} : aucun profil /workers/:id au sitemap de ${BASE} — le démarrage ` +
      `RÉEL d'un profil (montage, nom peint, geste) n'a donc PAS été jugé. Publier un profil, ` +
      `ou passer --worker <id|url> pour en juger un précis.`;
    notices.push(message);
    log(`⚠️ ${message}`);
    return result;
  }

  const url = `${BASE}${cheminProfil(resolution.id)}`;
  const libelle = libelleSonde(BASE);

  // Le navigateur est l'OUTIL de la sonde, pas la production : son absence rend
  // une prémisse nommée avec le remède, jamais un rouge du profil — et jamais un
  // vert.
  let browser;
  try {
    browser = await launch();
  } catch (error) {
    result.premisse = true;
    const message =
      `${MARQUE_PREMISSE} : navigateur indisponible (${error.message}) — Chromium n'a pas pu ` +
      `être lancé, donc le profil ${url} n'a PAS été jugé. Installer le binaire : ` +
      `npx playwright install --with-deps chromium.`;
    notices.push(message);
    log(`⚠️ ${message}`);
    return result;
  }

  try {
    const context = await browser.newContext(contextOptions({ bypassToken }));
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      errors.push(
        `le profil ${url} n'a pas pu être ouvert (${error.message}) : la page est injoignable, ` +
          `ou la protection de la preview refuse le contexte (poser ${BYPASS_ENV} pour une preview fermée).`
      );
      return result;
    }

    // ── 2. LE MONTAGE ─────────────────────────────────────────────────────
    try {
      await page.waitForSelector(SELECTEUR_MONTAGE, {
        state: 'attached',
        timeout: montageTimeoutMs,
      });
    } catch (_erreur) {
      const etat = await etatDuProfil(page).catch(() => null);
      errors.push(refusDeMontage({ url, etat, timeoutMs: montageTimeoutMs }));
      return result;
    }

    // ── 3. L'ACTION ───────────────────────────────────────────────────────
    // Attendue bornée : si le bloc manque, la page relit l'API et se peint
    // après — la sonde attend le fait, elle ne suppose pas un instant. Le refus
    // du BLOC, lui, appartient à la sonde du document (le bloc est HORS de
    // `#root`, il survit au montage : ce n'est pas un fait d'exécution).
    try {
      await page.waitForSelector(SELECTEUR_ACTION, {
        state: 'attached',
        timeout: actionTimeoutMs,
      });
    } catch (_erreur) {
      // La page a monté mais n'a peint aucune action : refus nommé plus bas.
    }

    const etat = await etatDuProfil(page);

    if (!etat.nom) {
      errors.push(
        `le profil ${url} a monté mais ne peint AUCUN nom dans #root : la vue publique ` +
          `n'a pas été rendue (profil absent, ou état de repli affiché).`
      );
    } else if (etat.blocLisible && etat.nomBloc && etat.nom !== etat.nomBloc) {
      errors.push(
        `<h1> peint « ${etat.nom} » alors que le bloc #${POINT_ENTREE_TRAVAILLEUR.seedId} ` +
          `porte « ${etat.nomBloc} » : le profil affiché ne parle pas de la personne annoncée.`
      );
    }

    if (!etat.ancreMissions) {
      errors.push(
        `le profil ${url} n'expose AUCUNE action interactive (${ANCRE_MISSIONS}) : il a monté ` +
          `sans offrir de geste, donc rien ne prouve que ses gestionnaires sont attachés.`
      );
    }

    if (errors.length) return result;

    checked.push(
      `  ✓ ${url} (profil ${resolution.id}, via ${resolution.source}) : montage réel — #root ` +
        `porte le châssis (nav), pas la coquille statique ; <h1> peint « ${etat.nom} », ` +
        `accordé au bloc #${POINT_ENTREE_TRAVAILLEUR.seedId}`
    );

    // ── 4. LE GESTE ───────────────────────────────────────────────────────
    const cible = choisirAction(etat);
    const geste = await eprouverLeGeste({
      page,
      cible,
      base: BASE,
      timeoutMs: navigationTimeoutMs,
    });
    errors.push(...geste.erreurs);

    if (!geste.erreurs.length) {
      checked.push(
        `  ✓ geste « ${cible.quoi} » : ${cheminProfil(resolution.id)} → ${geste.cheminAtterri} ` +
          `sans rechargement (marqueur vivant), #root porte encore le châssis`
      );
    }
  } finally {
    // Le contexte est jeté avec le navigateur : la machine hôte ne garde ni
    // session, ni cache d'un run précédent.
    await browser.close().catch(() => {});
  }

  result.ok = errors.length === 0;
  if (result.ok) {
    log(`\n${libelle} : conforme (${checked.length} fait(s) mesuré(s)).`);
  }
  return result;
}

/** Les options de ligne de commande (`--base`, `--worker`, `--quiet`). */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', worker: '', quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--worker') options.worker = argv[(index += 1)] || '';
    else if (argument === '--quiet') options.quiet = true;
  }
  return options;
}

/**
 * Le point d'entrée, séparé pour que le VERDICT (0/1/2) se juge sans navigateur.
 *
 * @param {string[]} [argv] Arguments après `node script`.
 * @param {object} [deps] Dépendances injectables (tests).
 * @returns {Promise<number>} Code de sortie.
 */
export async function main(
  argv = process.argv.slice(2),
  { run = runWorkerInteractiveProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run({
    base: options.base || undefined,
    worker: options.worker || undefined,
    quiet: options.quiet,
  });

  log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) log(ligne);

  if (resultat.errors.length) {
    error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const erreur of resultat.errors) error(`  • ${erreur}`);
    error(
      `\n   → cette sonde juge l'EXÉCUTION, pas le document : le document et son démarrage ` +
        `sont jugés par scripts/check-worker-page-production.js. Un montage absent se corrige ` +
        `dans le build (entrée, feuille, manifeste) ou dans le premier rendu de WorkerProfile ; ` +
        `une action absente ou morte se corrige dans la page (WorkerProfile.js).`
    );
    error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur l'exécution de /workers/:id`
    );
    return 1;
  }

  if (resultat.premisse) {
    error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    for (const notice of resultat.notices) error(`  • ${notice}`);
    return 2;
  }

  log(
    `\n✅ /workers/:id est interactive : montage réel dans Chromium, profil ${resultat.workerId} ` +
      `peint depuis son bloc, et geste de la page menant à une navigation cliente.`
  );
  return 0;
}

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(await main());
}
