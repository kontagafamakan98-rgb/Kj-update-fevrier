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
 * séparément parce que leurs corrections n'ont rien à voir (plus le contrat
 * de sécurité du cookie, vérifié indépendamment) :
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
 *   (C) LE COOKIE RESPECTE LE CONTRAT DE PRODUCTION — Chromium observe le
 *       cookie applicable à /auth/me après connexion ET après rechargement :
 *       kojo_session unique, HttpOnly=true, Secure=true, SameSite=None. Tout
 *       écart est un échec même si /auth/me répond 200. Aucune valeur de cookie
 *       n'est publiée dans les résultats ou les journaux.
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
 * Ce fait-là a sa propre sonde, et la réciprocité est écrite des deux côtés :
 * `check-token-exposure-production.js` juge l'EXPOSITION d'un jeton sur le
 * domaine web servi (`::error title=Exposition jeton production::`) et publie, à
 * l'inverse, qu'un rechargement non restauré ne rougit pas chez elle. Ici, la
 * symétrie est portée par `MARQUE_PREMISSE` (les refus de prémisse : compte CI
 * absent, contexte non vierge, connexion impossible, session non ouverte — la
 * sonde n'a pas pu juger) et par `RENVOI_EXPOSITION` (le fait jugé par l'autre
 * sonde, nommé). Chaque refus porte donc sa famille dans le message lui-même,
 * pas seulement dans le titre de l'annotation. Garde :
 * `frontend/scripts/__tests__/check-sondes-production-distinctes.test.js`.
 *
 * ─── Aucune écriture, aucun état partagé ───────────────────────────────────
 * La connexion LIT une session existante (aucune inscription, aucun compte
 * créé), le contexte est jeté à la fin de chaque tentative, et rien n'est
 * laissé en base. Le compte CI est dédié à cet usage (déjà le cas pour
 * Lighthouse) : la sonde ne touche pas aux comptes e2e partagés.
 *
 * ─── Préproduction CROSS-SITE (Vercel fermé par défaut) ──────────────────────
 * Une preview Vercel du projet est DERRIÈRE l'authentification Vercel : sa page
 * de connexion répond 302 vers vercel.com/sso-api (mesuré le 16/10/2026 sur
 * deux previews). Deux réglages de la SONDE — aucun du dépôt — sont donc requis
 * pour juger une preview :
 *   • le jeton « Protection Bypass for Automation » (Vercel → Settings →
 *     Deployment Protection), lu dans `VERCEL_AUTOMATION_BYPASS_SECRET` et
 *     envoyé à CHAQUE requête du contexte (sous-ressources comprises) ; il
 *     vient de l'environnement, JAMAIS d'une entrée de workflow — une entrée de
 *     dispatch est publiée dans les journaux du run ;
 *   • `--cross-site <origine API>`, qui FORCE la topologie cross-site : ce
 *     drapeau pose `window.__KOJO_USE_SAME_ORIGIN_API__ = false` avant le
 *     premier rendu (le levier d'exécution de src/utils/backendUrl.js) pour que
 *     la page interroge VRAIMENT l'API distante, quel que soit le build.
 *
 * ─── La topologie de PRODUCTION se LIT, elle ne se suppose pas ──────────────
 * `--api` et `--cross-site` ne servent qu'à forcer une surface. Sans eux, la
 * sonde lit l'hôte où Chromium a RANGÉ kojo_session (`context.cookies()`), et
 * c'est LUI qu'elle juge ensuite : le proxy même-origine range le cookie sur
 * l'origine de la page, un build `VITE_USE_SAME_ORIGIN_API=false` (la
 * production de ce projet) le range sur l'hôte de l'API. Supposer le premier
 * faisait refuser le second sur une prémisse (« 0 cookie(s) ») le 17/10/2026,
 * alors que la session vivait : la sonde accusait sa propre hypothèse.
 *
 * Usage :
 *   cd frontend && node scripts/check-session-reload-production.js
 * Optionnel :
 *   --base https://kojoforafrica.cc.cd   (défaut : SITE_ORIGIN)
 *   --api  https://api.kojoforafrica.cc.cd (origine jugée SI aucun cookie n'est lisible ; défaut : --base)
 *   --cross-site https://api.kojoforafrica.cc.cd (API directe + drapeau même-origine désactivé)
 *   --tentatives 3 --delai 15
 * En préproduction :
 *   VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/check-session-reload-production.js \
 *     --base https://<preview>.vercel.app --cross-site https://api.kojoforafrica.cc.cd
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN } from './site-meta.js';

/** Endpoint protégé jugé : 200 avec une session, 401 sans. */
export const AUTH_ME_PATH = '/api/auth/me';

// Contrat de production, indépendant du cookie observé et des secrets du run.
// Même derrière le proxy, le backend conserve SameSite=None (Capacitor/direct).
// Changer ce contrat exige une décision explicite, pas une adaptation au relevé.
export const SESSION_COOKIE_NAME = 'kojo_session';
export const SESSION_COOKIE_ATTRIBUTES = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'None',
});

/**
 * La FAMILLE de cette sonde — ce qu'un rouge prononcé ici veut dire. Elle est
 * écrite DANS chaque refus, en plus du titre de l'annotation : la sonde
 * d'exposition du jeton ouvre le même formulaire servi et recharge la même page,
 * donc un refus sans famille se lirait comme un refus de l'autre.
 */
export const FAMILLE = 'session au rechargement';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * Renvoi de famille : le refus qui suit n'est PAS celui de la sonde d'exposition
 * du jeton. Ce que la page PERSISTE (clé de stockage, cookie lisible, URL) est
 * RELEVÉ ici, jamais jugé : le fait « un jeton est lisible sur le domaine web »
 * appartient à l'autre sonde, avec sa propre correction.
 */
export const RENVOI_EXPOSITION =
  "ce n'est pas le refus de la sonde d'exposition du jeton " +
  '(check-token-exposure-production.js, ::error title=Exposition jeton production::) : ce que la page ' +
  'PERSISTE est relevé ici, jamais jugé, et un jeton en stockage ne rougit pas cette sonde.';

/** Libellé du run : la famille, la page jugée, puis l'origine de l'API jugée. */
export const libelleSonde = (base, api) => `${FAMILLE} sur ${base} (API ${api}${AUTH_ME_PATH})`;

/** Compose un refus de prémisse : la marque, le fait, puis le renvoi de famille. */
export const premisse = (fait) => `${MARQUE_PREMISSE} · ${fait} ${RENVOI_EXPOSITION}`;

/**
 * L'origine COMPLÈTE de l'hôte qui porte un cookie de session.
 *
 * Un cookie ne porte NI schéma NI port : son `domain` seul ne refait pas l'URL
 * jugée. L'hôte est donc rapproché des origines que la sonde CONNAÎT (la page
 * servie, l'API) — ce sont elles qui portent le schéma et le port — et
 * `https://<domaine>` ne sert que pour un hôte inconnu, c'est-à-dire l'API de
 * production sur le port par défaut.
 *
 * Sans ce rapprochement, `https://127.0.0.2` remplaçait
 * `http://127.0.0.2:45235` : la sonde interrogeait le port 443 et rendait
 * HTTP 0. Mesuré par `frontend/e2e/session-proxy.spec.js` sur la pile locale.
 *
 * @param {object} cookie Cookie rendu par `context.cookies()`.
 * @param {string[]} originesConnues Origines connues, la plus prioritaire d'abord.
 * @returns {string} Origine complète, ou chaîne vide si le cookie n'en dit rien.
 */
export function origineDuCookie(cookie, originesConnues = []) {
  const domaine = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  if (!domaine) return '';
  const portee = originesConnues.filter(Boolean).find((origine) => {
    let hote = '';
    try {
      hote = new URL(origine).hostname.toLowerCase();
    } catch (_error) {
      // Une origine illisible ne rapproche rien : elle n'est pas candidate.
      return false;
    }
    // Égalité d'hôte, ou cookie de DOMAINE PARENT (`.kojoforafrica.cc.cd`) qui
    // couvre l'hôte (api.kojoforafrica.cc.cd).
    return hote === domaine || hote.endsWith(`.${domaine}`);
  });
  return portee || `https://${domaine}`;
}

/**
 * Lit le cookie de session que Chromium GARDE, y compris HttpOnly, et rend
 * l'URL de /auth/me sur l'hôte qui le porte — c'est là que la page envoie sa
 * session, donc là que la sonde doit juger.
 * Ne renvoie et ne journalise jamais sa valeur, même lors d'un refus.
 *
 * @returns {Promise<{attributes: object|null, url: string}>} Attributs observés
 *   (null si le cookie manque ou est ambigu) et l'URL jugée.
 */
async function checkSessionCookie(context, originesConnues, stage, errors, checked) {
  // LA TOPOLOGIE SE LIT, ELLE NE SE SUPPOSE PAS. `context.cookies()` sans URL
  // rend ce que le navigateur GARDE, domaine compris : le proxy même-origine
  // range kojo_session sur l'origine de la page, une production cross-site
  // (`VITE_USE_SAME_ORIGIN_API=false`, le cas de ce projet) la range sur l'hôte
  // de l'API. Supposer le premier faisait refuser le second sur une PRÉMISSE
  // fausse (« 0 cookie(s) », le 17/10/2026) alors que la session vivait — un
  // rouge qui n'accusait pas la production.
  const cookies = (await context.cookies())
    .filter((cookie) => cookie.name === SESSION_COOKIE_NAME);
  // L'hôte qui porte le cookie EST l'API que la page interroge : c'est lui qui
  // reçoit la session, donc lui que la sonde doit questionner ensuite. Son
  // origine COMPLÈTE (schéma, port) vient des origines connues, jamais du seul
  // `domain` du cookie.
  const porteur = cookies.length === 1 ? origineDuCookie(cookies[0], originesConnues) : '';
  const url = `${porteur || originesConnues.filter(Boolean)[0] || ''}${AUTH_ME_PATH}`;
  const label = `après ${stage} : cookie ${SESSION_COOKIE_NAME}`;
  if (cookies.length !== 1) {
    errors.push(`${label} : ${cookies.length} cookie(s) ${SESSION_COOKIE_NAME} dans le contexte, 1 attendu`);
    return { attributes: null, url };
  }
  const { httpOnly, secure, sameSite } = cookies[0];
  const attributes = { httpOnly, secure, sameSite };
  const labels = { httpOnly: 'HttpOnly', secure: 'Secure', sameSite: 'SameSite' };
  for (const [key, expected] of Object.entries(SESSION_COOKIE_ATTRIBUTES)) {
    if (attributes[key] !== expected) {
      errors.push(`${label} : ${labels[key]}=${attributes[key]} (${expected} attendu)`);
    }
  }
  if (Object.entries(SESSION_COOKIE_ATTRIBUTES).every(([key, expected]) => attributes[key] === expected)) {
    checked.push(`${label} : HttpOnly=${httpOnly}, Secure=${secure}, SameSite=${sameSite}`);
  }
  return { attributes, url };
}

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
 * Jeton de contournement de la protection Vercel, et en-tête qu'elle attend.
 * Le NOM est celui de la convention Vercel, pour que le secret du dépôt n'ait
 * pas à être deviné.
 */
export const BYPASS_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET';
export const BYPASS_HEADER = 'x-vercel-protection-bypass';

/**
 * Options de contexte Chromium pour la surface visée.
 *
 * @param {object} [options]
 * @param {string} [options.bypassToken] Jeton de contournement (préproduction).
 * @returns {object} Options de `browser.newContext()`.
 */
export function contextOptions({ bypassToken = '' } = {}) {
  const token = String(bypassToken || '').trim();
  if (!token) return {};
  return { extraHTTPHeaders: { [BYPASS_HEADER]: token } };
}

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
 * @param {string} context.bypassToken Jeton de contournement (préproduction fermée).
 * @param {boolean} context.directApi   Juger le CROSS-SITE (drapeau même-origine posé avant le rendu).
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
  bypassToken = '',
  directApi = false,
  loginTimeoutMs,
  restoreTimeoutMs,
}) {
  const errors = [];
  const notices = [];
  const checked = [];
  const verdicts = emptyVerdicts();
  let authMeUrl = `${api}${AUTH_ME_PATH}`;

  const browser = await launch();
  try {
    const context = await browser.newContext(contextOptions({ bypassToken }));
    const page = await context.newPage();
    // ── 0 bis. CROSS-SITE ──────────────────────────────────────────────────
    // Posé AVANT le premier rendu : le drapeau est lu par isSameOriginApiProd()
    // (src/utils/backendUrl.js) au moment où le bundle construit ses URLs.
    if (directApi) {
      await page.addInitScript(() => {
        window.__KOJO_USE_SAME_ORIGIN_API__ = false;
      });
      checked.push(`cross-site demandé : la page interroge ${api} directement (proxy même-origine désactivé)`);
    }

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
        premisse(
          `contexte de sonde non vierge : GET ${AUTH_ME_PATH} répond HTTP ${start.status} AVANT toute ` +
            'connexion (401 attendu). Tant que ce contexte porte une session, un rechargement ne prouve rien.'
        )
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
        premisse(
          `connexion du compte CI impossible : la page est restée sur ${LOGIN_PATH} ` +
            `(GET ${AUTH_ME_PATH} → HTTP ${seen.status}). Vérifier LHCI_CI_EMAIL / LHCI_CI_PASSWORD ` +
            '(repli LHCI_TEST_*).'
        )
      );
      return { ok: false, errors, notices, checked, verdicts };
    }

    // L'hôte lu REMPLACE l'hypothèse : la sonde juge ensuite l'API que la
    // page interroge réellement (proxy même-origine ou API directe).
    // Origines CONNUES, l'API jugée d'abord : c'est elle que la sonde
    // interroge, et la page n'est qu'une candidate (proxy même-origine).
    const connexion = await checkSessionCookie(
      context, [api, base], 'connexion', errors, checked
    );
    if (connexion.url !== authMeUrl) {
      checked.push(
        `topologie lue : le cookie de session est rangé sur ${new URL(connexion.url).origin} ` +
          '— les appels de la page partent de là (aucun hôte supposé)'
      );
    }
    authMeUrl = connexion.url;
    verdicts.sessionCookies = { afterLogin: connexion.attributes, afterReload: null };
    const opened = await pageState(page, authMeUrl);
    verdicts.beforeReload = opened.status;
    if (opened.status !== 200) {
      errors.push(
        premisse(
          `session non ouverte après la connexion : GET ${AUTH_ME_PATH} → HTTP ${opened.status} (200 attendu). ` +
            'Un rechargement ne peut pas être jugé sur une session déjà absente.'
        )
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
    verdicts.sessionCookies.afterReload = (
      await checkSessionCookie(context, [api, base], 'rechargement', errors, checked)
    ).attributes;
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
            'encore dans le navigateur (200 depuis la page) mais la page ne la restaure pas. La garde ' +
            "d'amorçage (AuthContext.loadUser) juge UNE SEULE trace locale : hasSessionTrace — le jeton du " +
            "shell natif ou le profil en cache (hasSessionArtifact). Jamais la lisibilité d'un cookie : " +
            "elle dépend de l'hôte qui l'a posé et n'existe pas en cross-site. Vérifier que le build web a " +
            "laissé cette trace (le profil est écrit au login), que la garde déclenche bien /auth/me au " +
            'rechargement, et que le rewrite /api transmet les deux Set-Cookie.'
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
 * @param {string} [options.api]     Origine du proxy (base par défaut), ou API directe pour diagnostic.
 * @param {string} [options.email]   Compte CI (LHCI_CI_EMAIL, repli LHCI_TEST_EMAIL).
 * @param {string} [options.password] Mot de passe du compte CI.
 * @param {string} [options.bypassToken] Jeton de contournement Vercel (env BYPASS_ENV).
 * @param {boolean} [options.directApi] Juger le cross-site (proxy même-origine désactivé).
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
  api = base,
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  bypassToken = process.env[BYPASS_ENV] || '',
  directApi = false,
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
    // Le libellé est posé ICI AUSSI : ce refus ne passe pas par la boucle, donc
    // pas par le préfixe des tentatives — sans lui, il serait le seul message de
    // la sonde à ne pas nommer sa famille, et il est justement celui que les deux
    // sondes prononcent avec les mêmes mots (le compte CI manque).
    const fait =
      'compte CI absent : LHCI_CI_EMAIL / LHCI_CI_PASSWORD (repli LHCI_TEST_*) ne sont pas définis — ' +
      'sans session ouverte, aucun rechargement ne peut être jugé.';
    return {
      ok: false,
      errors: [`${libelleSonde(cleanBase, cleanApi)} : ${premisse(fait)}`],
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
        bypassToken,
        directApi,
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

  const label = libelleSonde(cleanBase, cleanApi);
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
 * `--cross-site <origine API>` est le seul drapeau qui en pose DEUX (voir le
 * docstring) : il ne peut pas être confondu avec `--api`, qui garde son sens de
 * « origine du proxy » — deux gestes différents, deux drapeaux différents.
 *
 * @param {string[]} argv Arguments après `node script`.
 * @returns {{base?: string, api?: string, directApi?: boolean, attempts?: number, delayMs?: number}}
 */
export function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--base' && next) options.base = next;
    else if (flag === '--api' && next) options.api = next;
    else if (flag === '--cross-site' && next) {
      options.api = next;
      options.directApi = true;
    } else if (flag === '--tentatives' && next) options.attempts = Number(next);
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
