#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — LA FICHE `/jobs/:id` DEVIENT-ELLE INTERACTIVE ?
 *
 * ── Le fait que cette sonde juge, et pourquoi la sonde voisine ne le peut pas ─
 * `check-job-page-production.js` juge le DOCUMENT servi : point d'entrée présent
 * une fois, feuille avant le module, bloc `kojo-job-data` lisible et accordé au
 * `<h1>`. C'est nécessaire, et ce n'est pas suffisant : un document parfait peut
 * charger un module qui ne s'exécute pas (404 sur l'entrée hachée, erreur au
 * premier rendu, point d'entrée neutralisé). Le crawler, lui, ne s'en aperçoit
 * jamais — il lit le HTML. Le SEUL arrivant d'un lien partagé, lui, reçoit une
 * fiche statique, sans châssis ni bouton : une page morte qui passe tous les
 * verts.
 *
 * Cette sonde ouvre donc la fiche dans un vrai Chromium, en production, avec un
 * contexte VIERGE (aucune session), et juge trois faits :
 *
 *   1. LE MONTAGE — `#root` ne porte plus la coquille statique (la barre vide et
 *      le `<h1>` écrits par `backend/kojo_job_og.py`) mais le châssis de
 *      l'application (`#root nav`, rendu par `Navbar`). La coquille n'a ni
 *      `nav` ni `#root` peuplé par React : le sélecteur ne peut pas être vrai
 *      avant le montage.
 *   2. LA FICHE PEINTE — le `<h1>` de `#root` est celui du bloc
 *      `kojo-job-data` : React a consommé la vue publique que le serveur vient
 *      de rendre, il n'affiche pas un squelette ni une autre mission.
 *   3. LE GESTE — un clic réel sur l'action de la carte, et la navigation qui
 *      en découle est CLIENTE : un marqueur posé dans `window` avant le clic
 *      survit (le document n'a pas été rechargé), l'adresse attendue est
 *      atteinte, et `#root` porte encore le châssis. Un bouton mort ne change
 *      pas d'adresse ; un `<a href>` sans routeur recharge le document et perd
 *      le marqueur — les deux sont refusés, nommément.
 *
 * L'action cliquée est choisie dans l'état RENDU, jamais dans une position du
 * DOM : `[data-sonde="postuler-anonyme"]` (l'invitation à se connecter, posée
 * par `JobDetails` pour cette sonde) pour une mission OUVERTE ; à défaut, le
 * lien de confiance `/how-it-works` du bandeau de séquestre, présent sur toute
 * fiche. Une mission `in_progress` n'a pas d'invitation à postuler — la sonde
 * le lit dans le bloc, elle ne suppose pas une mission ouverte.
 *
 * ── Ce qu'elle ne fait PAS, et qui est écrit ─────────────────────────────
 *   • aucune ÉCRITURE : le geste ouvre une page (`/login` ou `/how-it-works`),
 *     il ne soumet rien, ne propose rien, ne crée aucun compte ;
 *   • elle ne rejuge pas le DOCUMENT (point d'entrée, feuille, ordre, bloc
 *     accordé) : c'est `check-job-page-production.js`, et deux gardes qui
 *     recopient la même règle divergent un jour. Ce qu'elle lit du bloc lui sert
 *     à choisir l'action, pas à rendre un verdict sur le document ;
 *   • elle ne juge pas le RENDU VISUEL (géométrie, contraste, CLS) : c'est la
 *     suite e2e, sur une pile locale ;
 *   • elle ne juge qu'un navigateur, Chromium, et une seule fiche par passage.
 *     La matrice des moteurs est un autre sujet et un autre coût.
 *
 * ── Trois sorties, jamais deux ────────────────────────────────────────────
 * 0 = la fiche a monté, peint la mission du bloc et répondu au geste ;
 * 1 = refus nommé (montage, titre, action, navigation ou marqueur) ;
 * 2 = prémisse : aucune fiche `/jobs/:id` au sitemap (rien à juger), ou
 *     navigateur indisponible (outillage) — une prémisse n'est jamais un vert.
 *
 * Usage :
 *   node scripts/check-job-interactive-production.js                    # production
 *   node scripts/check-job-interactive-production.js --base https://…   # une preview
 *   node scripts/check-job-interactive-production.js --job <id|url>     # une fiche précise
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { POINT_ENTREE_MISSION, SITE_ORIGIN } from './site-meta.js';
import { BYPASS_ENV, BYPASS_HEADER } from './preview-vercel.js';
import { cheminFiche, resoudreJob } from './check-job-page-production.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'fiche mission interactive';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Fiche mission interactive production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/**
 * Le châssis de l'application, dans `#root`.
 *
 * La coquille statique du backend ne porte NI `nav` NI aucun élément React :
 * ce sélecteur est donc faux avant le montage, et vrai après — ce qui en fait
 * une preuve de montage, pas une convention de mise en page. `state: attached`
 * (et non « visible ») : un châssis monté mais masqué par une media query reste
 * un châssis monté, et une sonde ne doit pas rougir sur une largeur de fenêtre.
 */
export const SELECTEUR_MONTAGE = '#root nav';

/**
 * L'action de la carte qui n'existe QUE dans l'application : l'invitation à se
 * connecter pour postuler (`JobDetails`, visiteur anonyme, mission ouverte).
 * L'attribut est stable par construction — ni le libellé (cinq langues) ni une
 * classe de peinture ne peuvent servir d'ancre.
 */
export const ANCRE_POSTULER = '[data-sonde="postuler-anonyme"]';

/** Le lien de confiance du bandeau de séquestre, présent sur toute fiche. */
export const LIEN_CONFIANCE = 'a[href="/how-it-works"]';

/** Les deux actions possibles, pour l'attente bornée qui suit le montage. */
export const SELECTEUR_ACTION = `${ANCRE_POSTULER}, #root ${LIEN_CONFIANCE}`;

/** Les chemins atteints par chaque action — lus dans le routeur, pas devinés. */
export const CHEMIN_CONNEXION = '/login';
export const CHEMIN_CONFIANCE = '/how-it-works';

/**
 * Bornes d'attente de CONDITION (jamais de pause de stabilisation).
 *
 * Le montage d'une application à froid (démarrage de l'hébergeur, module
 * différé, relecture de l'API quand le bloc manque) prend quelques secondes ;
 * 30 s absorbent cette fenêtre sans transformer une panne réelle en vert.
 */
export const MONTAGE_TIMEOUT_MS = 30000;
export const ACTION_TIMEOUT_MS = 15000;
export const NAVIGATION_TIMEOUT_MS = 15000;

/**
 * La clé du marqueur de vie posé dans `window` avant le clic.
 *
 * Elle n'est PAS lue par l'application : elle sert à distinguer une navigation
 * CLIENTE (le routeur réécrit l'historique, `window` survit) d'un rechargement
 * complet (le document est remplacé, `window` repart à zéro). C'est la seule
 * façon de le mesurer depuis la page, et c'est exactement ce qui distingue une
 * application interactive d'un document qui recharge.
 */
export const MARQUEUR = '__kojo_sonde_interactive__';

const TIMEOUT_RECEPTION_MS = 20000;

const strip = (value) => String(value ?? '').trim().replace(/\/+$/, '');

/**
 * Le libellé qui préfixe chaque refus : la famille, et la surface jugée.
 *
 * @param {string} base Origine servie.
 * @returns {string}
 */
export const libelleSonde = (base) =>
  `${FAMILLE} — le démarrage RÉEL de ${strip(base)}/jobs/:id dans un navigateur`;

/**
 * Options de contexte Chromium.
 *
 * La preview Vercel est fermée par défaut : le jeton de contournement part en
 * en-tête du CONTEXTE (donc sur le document, le module et les actifs), et
 * jamais dans une URL. Sans jeton, aucun en-tête — une valeur vide n'est pas un
 * contournement.
 *
 * @param {object} [options]
 * @param {string} [options.bypassToken] Jeton de contournement (preview).
 * @returns {object} Options de `browser.newContext()`.
 */
export function contextOptions({ bypassToken = '' } = {}) {
  const token = String(bypassToken || '').trim();
  if (!token) return {};
  return { extraHTTPHeaders: { [BYPASS_HEADER]: token } };
}

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
 * L'état de la fiche, relevé DANS la page : ce que React a réellement rendu.
 *
 * Un seul aller-retour pour que tous les faits décrivent le même instant : le
 * châssis, le titre peint, le bloc de données (statut + titre attendu), et les
 * deux ancres d'action. Le bloc est HORS de `#root` (`backend/kojo_job_og.py`),
 * donc il survit au montage — le relire ici ne dépend pas de React.
 *
 * @param {object} page Page Playwright (ou doublure de test).
 * @returns {Promise<object>} Relevé de l'instant.
 */
export async function etatDeLaFiche(page) {
  return page.evaluate(() => {
    const racine = document.getElementById('root');
    const bloc = document.getElementById('kojo-job-data');
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
      titre: normaliser(titrePeint ? titrePeint.textContent : ''),
      blocLisible: lisible,
      titreBloc: lisible ? normaliser(donnees.title) : '',
      statut: lisible ? String(donnees.status || '') : '',
      ancrePostuler: Boolean(racine && racine.querySelector('[data-sonde="postuler-anonyme"]')),
      lienConfiance: Boolean(racine && racine.querySelector('a[href="/how-it-works"]')),
    };
  });
}

/**
 * Le refus de MONTAGE, avec le diagnostic que la page permet de lire.
 *
 * Le message nomme le côté fautif : un document servi mais une application
 * absente n'a pas la même correction qu'un module 404 — et la sonde voisine
 * (`check-job-page-production.js`) a déjà dit, elle, si le document chargeait
 * bien le point d'entrée.
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
        : '#root porte encore la coquille statique (barre vide et <h1>, aucun châssis)'
    : '#root n’a pas pu être relu';
  return (
    `la fiche ${url} n'a pas monté en ${Math.round(timeoutMs / 1000)} s : ${forme} — ` +
    `${POINT_ENTREE_MISSION.script} n'a pas exécuté l'application. Vérifier que le point ` +
    `d'entrée répond 200, que son import pointe une entrée /assets/ réellement servie ` +
    `(manifeste d'actifs), et qu'aucune erreur d'exécution n'arrête le premier rendu. ` +
    `Le DOCUMENT, lui, est jugé par check-job-page-production.js : une fiche peut le passer ` +
    `et rester morte dans un navigateur.`
  );
}

/**
 * Choisit l'action à cliquer dans l'état RENDU.
 *
 * Une mission OUVERTE doit montrer l'invitation à se connecter ; c'est un fait
 * du produit, donc son absence est un refus. Une mission `in_progress` n'en a
 * pas (le visiteur anonyme ne peut plus postuler) : la sonde clique alors le
 * lien de confiance, présent partout, pour éprouver le routeur.
 *
 * @param {object} etat Relevé de la page.
 * @returns {{selecteur: string, chemin: string, quoi: string}|null}
 */
export function choisirAction(etat) {
  if (etat.ancrePostuler) {
    return {
      selecteur: ANCRE_POSTULER,
      chemin: CHEMIN_CONNEXION,
      quoi: 'l’action « se connecter pour postuler »',
    };
  }
  if (etat.lienConfiance) {
    return {
      selecteur: `#root ${LIEN_CONFIANCE}`,
      chemin: CHEMIN_CONFIANCE,
      quoi: 'le lien de confiance du bandeau de séquestre',
    };
  }
  return null;
}

/**
 * Éprouve le GESTE : un clic réel, une navigation cliente, un châssis intact.
 *
 * @param {object} options
 * @param {object} options.page Page Playwright (ou doublure).
 * @param {{selecteur: string, chemin: string, quoi: string}} options.cible Action choisie.
 * @param {string} options.base Origine servie (pour résoudre une URL relative).
 * @param {number} options.timeoutMs Borne d'attente de l'adresse.
 * @returns {Promise<{erreurs: string[], cheminAtterri: string}>}
 */
export async function eprouverLeGeste({ page, cible, base, timeoutMs = NAVIGATION_TIMEOUT_MS }) {
  const erreurs = [];
  let cheminAtterri = '';

  // Posé AVANT le clic, dans la page : si le document est rechargé, il disparaît.
  await page.evaluate((cle) => {
    window[cle] = 'vivante';
  }, MARQUEUR);

  try {
    await page.click(cible.selecteur);
  } catch (error) {
    return {
      erreurs: [
        `le geste « ${cible.quoi} » n'a pas pu être cliqué (${error.message}) : l'action ` +
          `n'existe pas, ou elle est recouverte — une fiche montée sans action atteignable ` +
          `n'est pas interactive.`,
      ],
      cheminAtterri,
    };
  }

  try {
    await page.waitForURL(
      (url) => {
        try {
          return new URL(String(url)).pathname === cible.chemin;
        } catch (_erreur) {
          return false;
        }
      },
      { timeout: timeoutMs }
    );
  } catch (_erreur) {
    return {
      erreurs: [
        `le geste « ${cible.quoi} » n'a pas conduit à ${cible.chemin} en ` +
          `${Math.round(timeoutMs / 1000)} s : le bouton est peut-être sans gestionnaire, ou la ` +
          `route refusée. Une fiche qui ne réagit pas à un clic est une image, pas une application.`,
      ],
      cheminAtterri,
    };
  }

  try {
    cheminAtterri = new URL(String(page.url()), base).pathname;
  } catch (_erreur) {
    cheminAtterri = String(page.url());
  }
  if (cheminAtterri !== cible.chemin) {
    erreurs.push(
      `le geste « ${cible.quoi} » a conduit à ${cheminAtterri || '(adresse illisible)'} au lieu de ` +
        `${cible.chemin} : l'action ne fait pas ce que la fiche annonce.`
    );
  }

  const apres = await page.evaluate((cle) => {
    const racine = document.getElementById('root');
    return {
      marqueur: window[cle] === 'vivante',
      chassis: Boolean(racine && racine.querySelector('nav')),
    };
  }, MARQUEUR);

  if (!apres.marqueur) {
    erreurs.push(
      `la navigation vers ${cible.chemin} a RECHARGÉ le document (le marqueur de vie de ` +
        `window a disparu) : le geste n'est pas traité par l'application — lien natif sans ` +
        `routeur, ou gestionnaire qui assigne location.href. Une application se reconnaît à ` +
        `ce que le document ne se recharge pas.`
    );
  }
  if (!apres.chassis) {
    erreurs.push(
      `après le geste vers ${cible.chemin}, #root ne porte plus le châssis (nav) : la page ` +
        `d'arrivée n'a pas monté l'application, donc la navigation mène à un document mort.`
    );
  }

  return { erreurs, cheminAtterri };
}

/**
 * La sonde complète.
 *
 * @param {object} [options]
 * @param {string} [options.base] Origine frontend servie (défaut : production).
 * @param {string} [options.job] Identifiant ou URL de fiche (défaut : sitemap).
 * @param {string} [options.bypassToken] Jeton de contournement Vercel (preview).
 * @param {Function} [options.launch] Fabrique de navigateur (tests).
 * @param {Function} [options.fetchImpl] `fetch` injectable (tests).
 * @param {boolean} [options.quiet] Tait la progression.
 * @param {number} [options.montageTimeoutMs] Borne du montage.
 * @param {number} [options.actionTimeoutMs] Borne de l'action de carte.
 * @param {number} [options.navigationTimeoutMs] Borne de la navigation.
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], jobId: string, source: string}>}
 */
export async function runJobInteractiveProbe({
  base = process.env.KOJO_JOB_BASE_URL || DEFAULT_BASE,
  job = process.env.KOJO_JOB_ID || '',
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
    jobId: '',
    source: '',
  };

  // ── 1. La fiche à juger — la même résolution que la sonde du document ────
  // Le premier `/jobs/:id` du sitemap (la surface par laquelle un crawler la
  // découvre), ou `--job`. Réutiliser le résolveur, c'est n'avoir qu'un lecteur
  // du sitemap : deux copies divergeraient au premier changement de format.
  const resolution = await resoudreJob({ base: BASE, job, fetchImpl });
  result.jobId = resolution.id;
  result.source = resolution.source;
  if (resolution.erreur) {
    errors.push(resolution.erreur);
    return result;
  }
  if (!resolution.id) {
    result.premisse = true;
    const message =
      `${MARQUE_PREMISSE} : aucune fiche /jobs/:id au sitemap de ${BASE} — le démarrage ` +
      `RÉEL d'une fiche (montage, titre peint, action) n'a donc PAS été jugé. Publier une ` +
      `mission, ou passer --job <id|url> pour juger une fiche précise.`;
    notices.push(message);
    log(`⚠️ ${message}`);
    return result;
  }

  const url = `${BASE}${cheminFiche(resolution.id)}`;
  const libelle = libelleSonde(BASE);

  // Le navigateur est l'OUTIL de la sonde, pas la production : son absence (ou
  // une version sans binaire) rend une prémisse nommée avec le remède, jamais
  // un rouge de la fiche — et jamais un vert.
  let browser;
  try {
    browser = await launch();
  } catch (error) {
    result.premisse = true;
    const message =
      `${MARQUE_PREMISSE} : navigateur indisponible (${error.message}) — Chromium n'a pas pu ` +
      `être lancé, donc la fiche ${url} n'a PAS été jugée. Installer le binaire : ` +
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
        `la fiche ${url} n'a pas pu être ouverte (${error.message}) : la page est injoignable, ` +
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
      const etat = await etatDeLaFiche(page).catch(() => null);
      errors.push(refusDeMontage({ url, etat, timeoutMs: montageTimeoutMs }));
      return result;
    }

    // ── 3. L'ACTION DE CARTE ──────────────────────────────────────────────
    // Attendue bornée : quand le bloc de données manque, `JobDetails` relit
    // l'API et la carte se peint après — la sonde attend le fait, elle ne
    // suppose pas un instant. Le refus du BLOC, lui, appartient à la sonde du
    // document : ici, seule l'absence d'action est jugée.
    try {
      await page.waitForSelector(SELECTEUR_ACTION, {
        state: 'attached',
        timeout: actionTimeoutMs,
      });
    } catch (_erreur) {
      // La fiche a monté mais n'a peint aucune action : c'est un refus nommé
      // plus bas, avec le relevé (statut lu, ancres vues).
    }

    const etat = await etatDeLaFiche(page);
    const ouvert = etat.blocLisible ? !etat.statut || etat.statut === 'open' : false;

    if (!etat.titre) {
      errors.push(
        `la fiche ${url} a monté mais ne peint AUCUN titre dans #root : le bloc de données ` +
          `n'a pas été rendu (mission absente, ou état de repli affiché).`
      );
    } else if (etat.blocLisible && etat.titreBloc && etat.titre !== etat.titreBloc) {
      errors.push(
        `<h1> peint « ${etat.titre} » alors que le bloc #${POINT_ENTREE_MISSION.seedId} porte ` +
          `« ${etat.titreBloc} » : la fiche affichée ne parle pas de la mission annoncée.`
      );
    }

    if (ouvert && !etat.ancrePostuler) {
      errors.push(
        `le bloc #${POINT_ENTREE_MISSION.seedId} dit la mission OUVERTE (statut « ` +
          `${etat.statut || 'absent'} ») mais la fiche n'affiche pas ${ANCRE_POSTULER} : ` +
          `l'invitation à se connecter pour postuler a disparu — un visiteur à froid n'a plus ` +
          `aucune action sur la fiche.`
      );
    }

    const cible = choisirAction(etat);
    if (!cible) {
      if (!errors.length) {
        errors.push(
          `la fiche ${url} n'expose AUCUNE action interactive (ni ${ANCRE_POSTULER}, ni ` +
            `${LIEN_CONFIANCE}) : elle a monté sans offrir de geste, donc rien ne prouve que ` +
            `ses gestionnaires sont attachés.`
        );
      }
      return result;
    }

    if (errors.length) return result;

    checked.push(
      `  ✓ ${url} (fiche ${resolution.id}, via ${resolution.source}) : montage réel — #root ` +
        `porte le châssis (nav), pas la coquille statique ; <h1> peint « ${etat.titre} », ` +
        `accordé au bloc #${POINT_ENTREE_MISSION.seedId}`
    );

    // ── 4. LE GESTE ───────────────────────────────────────────────────────
    const geste = await eprouverLeGeste({
      page,
      cible,
      base: BASE,
      timeoutMs: navigationTimeoutMs,
    });
    errors.push(...geste.erreurs);

    if (!geste.erreurs.length) {
      checked.push(
        `  ✓ geste « ${cible.quoi} » : ${cheminFiche(resolution.id)} → ${geste.cheminAtterri} ` +
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

/** Les options de ligne de commande (`--base`, `--job`, `--quiet`). */
export function parseArguments(argv = process.argv.slice(2)) {
  const options = { base: '', job: '', quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[(index += 1)] || '';
    else if (argument === '--job') options.job = argv[(index += 1)] || '';
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
  { run = runJobInteractiveProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run({
    base: options.base || undefined,
    job: options.job || undefined,
    quiet: options.quiet,
  });

  log(`\n${libelleSonde(options.base || DEFAULT_BASE)}`);
  for (const ligne of resultat.checked) log(ligne);

  if (resultat.errors.length) {
    error(`\n❌ ${resultat.errors.length} défaut(s) — ${TITRE_ERREUR} :`);
    for (const erreur of resultat.errors) error(`  • ${erreur}`);
    error(
      `\n   → cette sonde juge l'EXÉCUTION, pas le document : le document et son démarrage ` +
        `sont jugés par scripts/check-job-page-production.js. Un montage absent se corrige ` +
        `dans le build (entrée, feuille, manifeste) ou dans le premier rendu de JobDetails ; ` +
        `une action absente ou morte se corrige dans la fiche (JobDetails.js).`
    );
    error(
      `::error title=${TITRE_ERREUR}::${resultat.errors.length} défaut(s) sur l'exécution de /jobs/:id`
    );
    return 1;
  }

  if (resultat.premisse) {
    error(`::error title=${TITRE_ERREUR}::${resultat.notices.join(' ') || MARQUE_PREMISSE}`);
    return 2;
  }

  log(
    `\n✅ /jobs/:id est interactive : montage réel dans Chromium, fiche ${resultat.jobId} ` +
      `peinte depuis son bloc, et geste de carte menant à une navigation cliente.`
  );
  return 0;
}

export const estAppelDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (estAppelDirect) {
  process.exit(await main());
}
