#!/usr/bin/env node
/**
 * La session SURVIT-ELLE à un RECHARGEMENT sur le site réellement servi ?
 *
 * ─── Le trou que cette sonde ferme ─────────────────────────────────────────
 * Toutes les sondes de production du dépôt lisent des faits de SERVEUR :
 * le HTML servi (check-seo-production, check-deployed-revision), une paire
 * préflight/GET (check-cors-preflight), /health (backend-health-probe). Aucune
 * n'observe ce que le NAVIGATEUR garde d'une session, ni ce que l'application
 * en fait quand la mémoire JavaScript a disparu. Or c'est exactement là que se
 * logent les régressions de session : le cookie peut être posé sans survivre à
 * un rechargement (attribut de périmètre), et l'application peut ne PAS le
 * relire au démarrage (garde d'amorçage) — deux défauts que tout appel d'API
 * fait dans la foulée d'une connexion laisse invisibles, puisque la session
 * vit alors en mémoire.
 *
 * Le rechargement est aussi le seul moment où une session portée par un cookie
 * httpOnly se distingue d'une session portée par un jeton relu en stockage :
 * c'est la propriété d'AGENTS.md (« Web : aucun jeton en stockage ; le cookie
 * httpOnly est le seul canal ») telle qu'un utilisateur la subit.
 *
 * ─── Ce qu'elle mesure, et à quel endroit ──────────────────────────────────
 * Elle fait ce qu'un utilisateur fait : ouvrir /login, se connecter avec le
 * COMPTE CLIENT DÉDIÉ CI (secrets LHCI_CI_EMAIL/LHCI_CI_PASSWORD, déjà utilisés
 * par le job Lighthouse), puis RECHARGER la page. Deux faits sont alors jugés,
 * séparément parce que leurs corrections n'ont rien à voir :
 *
 *   (A) LE NAVIGATEUR PORTE ENCORE LE JUSTIFICATIF — un appel protégé émis
 *       depuis la page rechargée, avec `credentials: 'include'`, répond 200.
 *       Rien de la mémoire JavaScript n'a survécu au rechargement : ce 200 ne
 *       peut venir que d'un état que le navigateur a persisté. Un échec ici
 *       désigne le cookie (périmètre, `SameSite`, `Secure`, hôte) — pas le
 *       frontend.
 *   (B) L'APPLICATION LE RESTAURE — elle rappelle son endpoint d'amorçage en
 *       200 et ne renvoie pas l'utilisateur vers /login. Un échec ici désigne
 *       le frontend (garde d'amorçage), pas le cookie.
 *
 * La sonde part d'un contexte VIERGE et refuse de conclure si /auth/me répond
 * 200 AVANT toute connexion : une session héritée d'un run précédent ferait
 * passer (A) et (B) sans rien prouver.
 *
 * ─── Ce qu'elle ne juge PAS (et pourquoi c'est écrit) ──────────────────────
 * Ce que la page PERSISTE (clés de stockage, cookies lisibles depuis l'origine
 * frontend) est RELEVÉ et journalisé, jamais transformé en verdict : c'est une
 * autre propriété, avec une autre correction, et un rouge qui les confondrait
 * enverrait corriger le mauvais fichier. Sur l'artefact servi le 11/10/2026, ce
 * relevé montrait un jeton en localStorage côté web : la sonde le dit à chaque
 * run, sans le compter comme un échec de rechargement.
 *
 * ─── Aucune écriture, aucun état partagé ───────────────────────────────────
 * La connexion LIT une session existante (aucune inscription, aucun compte
 * créé), le contexte est jeté à la fin de chaque tentative, et rien n'est
 * laissé en base. Le compte CI est dédié à cet usage (déjà le cas pour
 * Lighthouse) : la sonde ne touche pas aux comptes e2e partagés.
 *
 * Usage :
 *   cd frontend && node scripts/check-session-reload-production.js
 * Optionnel :
 *   --base https://kojoforafrica.cc.cd   (défaut : SITE_ORIGIN)
 *   --api  https://api.kojoforafrica.cc.cd (défaut : API_ORIGIN)
 *   --tentatives 3 --delai 15
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_ORIGIN, SITE_ORIGIN } from './site-meta.js';

/** Endpoint protégé jugé : 200 avec une session, 401 sans. */
export const AUTH_ME_PATH = '/api/auth/me';

/** Route de connexion : la quitter est le premier signe d'une session ouverte. */
export const LOGIN_PATH = '/login';

// Sélecteurs de la page de connexion. Ce sont les ids du SHELL PRÉ-RENDU
// (`id="email"`, `id="password"`, bouton d'envoi) : check-prerender-shells.js
// verrouille déjà leur présence dans build/login.html, donc les nommer ici
// n'ajoute pas une seconde source à tenir — c'est la même surface.
export const EMAIL_SELECTOR = '#email';
export const PASSWORD_SELECTOR = '#password';
export const SUBMIT_SELECTOR = 'button[type="submit"]';

/**
 * Réessais : un démarrage à froid de l'hébergeur, ou une bascule en cours,
 * répond mal pendant quelques secondes. Trois tentatives espacées ne
 * transforment pas une panne réelle en vert, elles absorbent la fenêtre.
 */
export const ATTEMPTS = 3;
export const RETRY_DELAY_MS = 15000;

/** Bornes d'attente de CONDITION (jamais de pause de stabilisation). */
export const LOGIN_TIMEOUT_MS = 30000;
export const RESTORE_TIMEOUT_MS = 20000;

const stripSlash = (value) => String(value ?? '').trim().replace(/\/+$/, '');

/**
 * Lance Chromium. Import PAREESSE : le test companion injecte son propre
 * `launch` et n'a donc jamais à charger Playwright (ni un navigateur) sous
 * jsdom.
 *
 * @returns {Promise<import('@playwright/test').Browser>} Navigateur lancé.
 */
const defaultLaunch = async () => {
  const { chromium } = await import('@playwright/test');
  return chromium.launch({ headless: true });
};

/**
 * Ce que la PAGE, rechargée, porte encore — en une seule évaluation.
 *
 * L'appel part de la page : c'est le seul endroit où le cross-site, les
 * `credentials` et les cookies sont jugés par un vrai navigateur. Le relevé est
 * pris dans le même passage pour que les trois faits décrivent le même instant.
 *
 * @param {object} page Page Playwright (ou doublure de test).
 * @param {string} authMeUrl URL absolue de l'endpoint protégé.
 * @returns {Promise<{status: number, cookie: string, storageKeys: string[], error?: string}>}
 */
const pageState = (page, authMeUrl) =>
  page.evaluate(async (target) => {
    const state = { status: 0, cookie: '', storageKeys: [] };
    try {
      state.cookie = String(document.cookie || '');
    } catch (_error) {
      // Stockage indisponible : le relevé reste vide, il n'est pas un verdict.
    }
    try {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        keys.push(localStorage.key(index));
      }
      state.storageKeys = keys;
    } catch (_error) {
      // Idem : un relevé non lisible ne fait pas échouer une sonde de session.
    }
    try {
      const response = await fetch(target, { credentials: 'include' });
      state.status = response.status;
    } catch (error) {
      state.error = error.message;
    }
    return state;
  }, authMeUrl);

/** Ce qu'une tentative a observé, pour un diagnostic qui se relit. */
const emptyVerdicts = () => ({
  anonymous: null,
  beforeReload: null,
  afterReload: null,
  persisted: null,
});

/**
 * UNE tentative complète : connexion, rechargement, jugement.
 *
 * @param {object} context
 * @param {string} context.base  Origine servie (frontend).
 * @param {string} context.api   Origine de l'API interrogée.
 * @param {string} context.email    Identifiant du compte CI.
 * @param {string} context.password Mot de passe du compte CI.
 * @param {Function} context.launch Fabrique de navigateur (injectable).
 * @param {number} context.loginTimeoutMs
 * @param {number} context.restoreTimeoutMs
 * @returns {Promise<{ok: boolean, errors: string[], notices: string[],
 *   checked: string[], verdicts: object}>}
 */
async function oneAttempt({
  base,
  api,
  email,
  password,
  launch,
  loginTimeoutMs,
  restoreTimeoutMs,
}) {
  const errors = [];
  const notices = [];
  const checked = [];
  const verdicts = emptyVerdicts();
  const authMeUrl = `${api}${AUTH_ME_PATH}`;

  const browser = await launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // ── 0. ÉTAT DE DÉPART ──────────────────────────────────────────────────
    // Un contexte VIERGE ne porte aucune session. Le contrôle n'est pas une
    // politesse : sans lui, un 200 constaté plus tard pourrait venir d'une
    // session laissée par un run précédent, et la sonde se prouverait à
    // elle-même ce qu'elle cherche.
    await page.goto(`${base}${LOGIN_PATH}`, { waitUntil: 'domcontentloaded' });
    const start = await pageState(page, authMeUrl);
    verdicts.anonymous = start.status;
    if (start.status !== 401) {
      errors.push(
        `contexte de sonde non vierge : GET ${AUTH_ME_PATH} répond HTTP ${start.status} AVANT toute ` +
          'connexion (401 attendu). Tant que ce contexte porte une session, un rechargement ne prouve rien.'
      );
      return { ok: false, errors, notices, checked, verdicts };
    }
    checked.push(`départ : GET ${AUTH_ME_PATH} → 401 (aucune session) — la sonde part vierge`);

    // ── 1. CONNEXION par le FORMULAIRE SERVI ───────────────────────────────
    // Pas par `POST /auth/login` en HTTP : c'est le chemin de l'utilisateur, et
    // c'est lui qui décide ce que le navigateur persiste et ce que
    // l'application garde.
    await page.fill(EMAIL_SELECTOR, email);
    await page.fill(PASSWORD_SELECTOR, password);
    await page.click(SUBMIT_SELECTOR);
    try {
      await page.waitForURL((current) => !current.pathname.startsWith(LOGIN_PATH), {
        timeout: loginTimeoutMs,
      });
    } catch (_error) {
      const seen = await pageState(page, authMeUrl);
      errors.push(
        `connexion du compte CI impossible : la page est restée sur ${LOGIN_PATH} ` +
          `(GET ${AUTH_ME_PATH} → HTTP ${seen.status}). Vérifier LHCI_CI_EMAIL / LHCI_CI_PASSWORD ` +
          '(repli LHCI_TEST_*).'
      );
      return { ok: false, errors, notices, checked, verdicts };
    }

    const opened = await pageState(page, authMeUrl);
    verdicts.beforeReload = opened.status;
    if (opened.status !== 200) {
      errors.push(
        `session non ouverte après la connexion : GET ${AUTH_ME_PATH} → HTTP ${opened.status} (200 attendu). ` +
          'Un rechargement ne peut pas être jugé sur une session déjà absente.'
      );
      return { ok: false, errors, notices, checked, verdicts };
    }
    checked.push(`après connexion : GET ${AUTH_ME_PATH} → 200 (session ouverte)`);

    // ── 2. RECHARGEMENT ────────────────────────────────────────────────────
    // L'écoute de la réponse est ARMÉE AVANT le rechargement : un
    // `waitForResponse` posé après peut manquer une réponse déjà arrivée, et
    // ce serait un faux rouge de course. Bornée, jamais une pause fixe.
    const appCall = page
      .waitForResponse((response) => response.url().startsWith(authMeUrl), {
        timeout: restoreTimeoutMs,
      })
      .then((response) => ({ status: response.status() }))
      .catch(() => null);

    await page.reload({ waitUntil: 'domcontentloaded' });

    const observed = await appCall;
    const after = await pageState(page, authMeUrl);
    const landedOnLogin = String(page.url()).includes(LOGIN_PATH);
    verdicts.afterReload = {
      cookie: after.status,
      app: observed ? observed.status : null,
      url: page.url(),
    };
    verdicts.persisted = {
      storageKeys: after.storageKeys,
      // On ne journalise QUE la forme du relevé : un cookie de session n'est
      // pas relisible, et une valeur de jeton n'a rien à faire dans un journal
      // de CI.
      cookiesLisible: /(^|;\s*)(kojo_|token)/.test(after.cookie),
      jetonEnStockage: after.storageKeys.some((key) => /token|jwt|auth/i.test(String(key))),
    };

    // ── 3. VERDICT (A) : LE JUSTIFICATIF A-T-IL SURVÉCU ? ──────────────────
    if (after.status !== 200) {
      errors.push(
        `le justificatif de session n'a pas survécu au rechargement : GET ${AUTH_ME_PATH} depuis la page ` +
          `rechargée → HTTP ${after.status} (200 attendu). La session vit en mémoire et rien ne la porte ` +
          "après un rechargement complet — vérifier les attributs du cookie de session " +
          '(AUTH_COOKIE_SAMESITE / AUTH_COOKIE_SECURE dans kojo_settings.py, périmètre hôte vs domaine parent).'
      );
    } else {
      checked.push(`après rechargement : GET ${AUTH_ME_PATH} → 200 (le justificatif a survécu)`);
    }

    // ── 4. VERDICT (B) : L'APPLICATION L'A-T-ELLE RESTAURÉ ? ───────────────
    if (after.status === 200) {
      if (observed && observed.status === 401) {
        errors.push(
          `la session est refusée par l'API après le rechargement : l'appel d'amorçage de l'application ` +
            `répond HTTP 401 alors que la page, elle, obtient 200. Deux justificatifs différents circulent ` +
            "(en-tête et cookie) — vérifier lequel l'application envoie au démarrage."
        );
      } else if (landedOnLogin) {
        errors.push(
          `l'application renvoie l'utilisateur vers ${LOGIN_PATH} après le rechargement : la session existe ` +
            'encore dans le navigateur (200 depuis la page) mais la page ne la restaure pas. Garde ' +
            "d'amorçage : hasSessionCookie() lit kojo_csrf sur l'origine FRONTEND, or le cookie de session est " +
            'posé hôte-seul sur l\'API — d\'où le prérequis du proxy même-origine (AuthContext.js).'
        );
      } else if (!observed || observed.status !== 200) {
        errors.push(
          `aucun appel authentifié de l'application après le rechargement ` +
            `(GET ${AUTH_ME_PATH} : ${observed ? `HTTP ${observed.status}` : 'aucune requête émise'}) : ` +
            'la session survit dans le navigateur mais l\'application ne la restaure pas.'
        );
      } else {
        checked.push(`après rechargement : l'application a rappelé ${AUTH_ME_PATH} → 200 (session restaurée)`);
      }
    }

    // Le MÉCANISME, relevé à chaque run sans jamais décider du verdict : c'est
    // ce qui rend un rouge exploitable sans avoir à refaire la mesure à la main.
    checked.push(
      `persistance observée : jeton en stockage = ${verdicts.persisted.jetonEnStockage ? 'oui' : 'non'}, ` +
        `cookie lisible depuis l'origine frontend = ${verdicts.persisted.cookiesLisible ? 'oui' : 'non'} ` +
        `(clés : ${after.storageKeys.join(', ') || 'aucune'})`
    );

    return { ok: errors.length === 0, errors, notices, checked, verdicts };
  } finally {
    // Le contexte est jeté à chaque tentative : la tentative suivante repart
    // vierge, et la machine hôte ne garde aucun état de session.
    await browser.close().catch(() => {});
  }
}

/**
 * Sonde complète, avec réessais.
 *
 * @param {object} [options]
 * @param {string} [options.base]    Origine servie (SITE_ORIGIN).
 * @param {string} [options.api]     Origine de l'API (API_ORIGIN).
 * @param {string} [options.email]   Compte CI (LHCI_CI_EMAIL, repli LHCI_TEST_EMAIL).
 * @param {string} [options.password] Mot de passe du compte CI.
 * @param {Function} [options.launch] Fabrique de navigateur (tests).
 * @param {Function} [options.sleep]  Attente entre deux tentatives (tests).
 * @param {number} [options.attempts] Nombre de tentatives.
 * @param {number} [options.delayMs]  Délai entre deux tentatives.
 * @param {Function} [options.log]    Journal (tests).
 * @param {boolean} [options.quiet]   Tait la progression.
 * @returns {Promise<{ok: boolean, errors: string[], notices: string[], checked: string[],
 *   attempts: number, verdicts: object|null}>}
 */
export async function runSessionReloadProbe({
  base = SITE_ORIGIN,
  api = API_ORIGIN,
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  launch = defaultLaunch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = ATTEMPTS,
  delayMs = RETRY_DELAY_MS,
  loginTimeoutMs = LOGIN_TIMEOUT_MS,
  restoreTimeoutMs = RESTORE_TIMEOUT_MS,
  log = console.log,
  quiet = false,
} = {}) {
  const cleanBase = stripSlash(base);
  const cleanApi = stripSlash(api);

  // Sans identifiant, il n'y a pas de session à recharger : le dire AVANT de
  // lancer un navigateur, et en nommant les secrets — un run rouge doit dire
  // quelle variable poser, pas seulement qu'il a échoué.
  if (!email || !password) {
    return {
      ok: false,
      errors: [
        'compte CI absent : LHCI_CI_EMAIL / LHCI_CI_PASSWORD (repli LHCI_TEST_*) ne sont pas définis — ' +
          'sans session ouverte, aucun rechargement ne peut être jugé.',
      ],
      notices: [],
      checked: [],
      attempts: 0,
      verdicts: null,
    };
  }

  let last = { ok: false, errors: [], notices: [], checked: [], verdicts: null };
  let used = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    used = attempt;
    try {
      last = await oneAttempt({
        base: cleanBase,
        api: cleanApi,
        email,
        password,
        launch,
        loginTimeoutMs,
        restoreTimeoutMs,
      });
    } catch (error) {
      last = {
        ok: false,
        errors: [`sonde interrompue (${error.message}).`],
        notices: [],
        checked: [],
        verdicts: null,
      };
    }
    if (last.ok) break;
    if (attempt < attempts) {
      if (!quiet) {
        log(
          `  … tentative ${attempt}/${attempts} sans verdict, nouvel essai dans ${Math.round(delayMs / 1000)} s`
        );
      }
      await sleep(delayMs);
    }
  }

  const label = `session au rechargement sur ${cleanBase} (API ${cleanApi}${AUTH_ME_PATH})`;
  if (last.ok) {
    last.notices.push(`${label} : session restaurée après rechargement (${used} tentative(s)).`);
  } else {
    last.errors = last.errors.map((error) => `${label} : ${error}`);
  }

  return { ...last, attempts: used };
}

/**
 * Options de ligne de commande. Une valeur absente laisse le défaut : la sonde
 * ne « choisit » pas une surface, elle se contente d'en accepter une autre.
 *
 * @param {string[]} argv Arguments après `node script`.
 * @returns {{base?: string, api?: string, attempts?: number, delayMs?: number}}
 */
export function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--base' && next) options.base = next;
    else if (flag === '--api' && next) options.api = next;
    else if (flag === '--tentatives' && next) options.attempts = Number(next);
    else if (flag === '--delai' && next) options.delayMs = Number(next) * 1000;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runSessionReloadProbe(parseArgs(process.argv.slice(2)));
  console.log(
    `Sonde de session au rechargement — ${result.ok ? 'session restaurée' : 'DÉFAUT'} ` +
      `(${result.attempts} tentative(s))`
  );
  for (const line of result.checked) console.log(`  ✓ ${line}`);
  for (const notice of result.notices) console.log(`::notice title=Session production::${notice}`);
  for (const error of result.errors) console.error(`::error title=Session production::${error}`);
  if (!result.ok) process.exit(1);
}
