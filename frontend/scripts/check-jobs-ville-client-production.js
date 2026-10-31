#!/usr/bin/env node
/**
 * SONDE DE PRODUCTION — CE QU'UN CLIENT CONNECTÉ VOIT SUR /jobs, ARRIVÉ D'UNE PAGE VILLE.
 *
 * ── Le fait jugé ────────────────────────────────────────────────────────────
 * Les pages ville (`/emplois/{slug}`) portent un bouton dont le lien est
 * `/jobs?alerte=1&ville=<nom>&origine=ville`. Ce lien est la seule raison d'être
 * de ce bloc, et il dépose le visiteur sur la page la plus visitée du site.
 *
 * Trois présentations d'alerte coexistent sur /jobs, et elles s'excluent :
 *   • le VISITEUR SANS COMPTE voit la promesse (`#alerte-emploi-promesse`) ;
 *   • le TRAVAILLEUR connecté voit la carte interactive (`#alerte-emploi-titre`,
 *     le formulaire qui écrit `PUT /api/job-alerts`) ;
 *   • le CLIENT connecté n'a droit à AUCUNE des deux — une veille lui enverrait
 *     le catalogue qu'il publie lui-même — et voit, quand il vient d'un de ces
 *     liens (`?alerte=1`), la RÈGLE (`#alerte-emploi-reservee`) : ce que l'alerte
 *     fait, pourquoi elle est réservée, et l'action qui le concerne (publier une
 *     mission).
 *
 * Mesuré le 31/10/2026 : le troisième cas n'existait pas. Un client qui suivait
 * le bouton d'une page ville arrivait sur une page où RIEN ne se passait à
 * l'endroit exact où le clic l'avait déposé — le lien mentait sur sa
 * destination, et l'écran se lisait comme une panne. Le bloc a été écrit ; cette
 * sonde est ce qui prouve qu'il est SERVI, avec un vrai compte client.
 *
 * ── Pourquoi une sonde de production, et pas un test ───────────────────────
 * `frontend/src/pages/__tests__/Jobs.test.jsx` prouve le COMPORTEMENT du
 * composant (un client + `?alerte=1` ⇒ la règle ; un travailleur ⇒ la carte
 * interactive). Il ne peut pas dire ce que le DÉPLOIEMENT sert : un bundle en
 * retard, un `?alerte` perdu par un rewrite, une session qui ne se restaure pas
 * sur /jobs et fait peindre la vue ANONYME à un client connecté — dans les trois
 * cas le test unitaire reste vert. Le fait ne se lit qu'avec un compte réel,
 * dans un vrai navigateur, sur l'origine publique.
 *
 * ── Comment elle juge ──────────────────────────────────────────────────────
 * Par le CHEMIN DE L'UTILISATEUR, dans Chromium (`@playwright/test`), avec le
 * COMPTE CLIENT DÉDIÉ de la CI (`LHCI_CI_EMAIL` / `LHCI_CI_PASSWORD`, repli
 * `LHCI_TEST_*` — les mêmes secrets que les sondes de session et d'exposition,
 * provisionnés par `backend/scripts/provision_ci_test_account.py --type client`)
 * :
 *   1. connexion par le FORMULAIRE SERVI (jamais `POST /auth/login` en HTTP) ;
 *   2. le compte est LU (`GET /api/auth/me`) : s'il n'est pas `client`, la sonde
 *      ne peut pas juger ce qu'un client voit — c'est une PRÉMISSE, pas un vert ;
 *   3. la PAGE VILLE est ouverte, et c'est SON lien qui est suivi (un clic) :
 *      une URL tapée à la main ne prouverait pas que le bouton mène où il dit ;
 *   4. sur /jobs, la règle est peinte avec les textes du dictionnaire (la langue
 *      lue dans `<html lang>`, jamais une chaîne recopiée), et les deux autres
 *      cartes sont ABSENTES — présence ET absence, dans le même relevé ;
 *   5. /jobs SANS paramètre : la règle n'est pas peinte. Un client qui n'a rien
 *      demandé n'a pas à recevoir une explication sur une chose qu'il n'a pas
 *      cliquée, et c'est cette absence qui fait de la présence ci-dessus une
 *      réponse au LIEN, pas un bavardage de la page.
 *
 * ── Trois sorties, jamais deux ─────────────────────────────────────────────
 *   0 — la règle est peinte pour un client venu d'une page ville, avec ses
 *       textes, son action, et sans les deux autres cartes ; et elle ne l'est
 *       pas sur une visite ordinaire ;
 *   1 — un refus NOMMÉ (lien disparu de la page ville, mauvais paramètres,
 *       carte de la règle absente ou incomplète, promesse anonyme ou carte
 *       travailleur peinte pour un client, règle peinte sans `?alerte=1`) ;
 *   2 — PRÉMISSE : compte CI absent, connexion impossible, compte qui n'est plus
 *       un client, page ville injoignable (réseau ou 5xx), langue inconnue.
 *       Une prémisse rougit le run et n'est JAMAIS un vert : sans session ni
 *       page, la sonde n'a rien mesuré, et l'écrire « conforme » serait le
 *       silence qu'un corpus vide a déjà coûté ailleurs dans ce dépôt.
 *
 * ── Ce qu'elle ne fait pas ─────────────────────────────────────────────────
 * Aucune ÉCRITURE : elle ne crée ni ne règle de veille (c'est le métier de
 * `backend/scripts/semer_alerte_emploi.py`, dispatchable et séparé), ne publie
 * aucune mission, et jette son contexte à chaque tentative. Aucun identifiant de
 * session, aucun mot de passe, aucune valeur de cookie ne sort : le relevé ne
 * porte que des présences, des textes de page et des chemins.
 *
 * ── Coût ───────────────────────────────────────────────────────────────────
 * Pages ouvertes, navigations, requêtes émises, durée, tentatives : publiés sur
 * le vert COMME sur le rouge (`--summary` ou `$GITHUB_STEP_SUMMARY`), parce
 * qu'une sonde dont on ne voit le coût que le jour où elle échoue dérive en
 * silence.
 *
 * Usage :
 *   node scripts/check-jobs-ville-client-production.js
 *   node scripts/check-jobs-ville-client-production.js --base https://<preview>.vercel.app
 *   node scripts/check-jobs-ville-client-production.js --ville sikasso
 *   node scripts/check-jobs-ville-client-production.js --tentatives 3 --delai 15
 */
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SITE_ORIGIN } from './site-meta.js';
import {
  ATTEMPTS,
  AUTH_ME_PATH,
  BYPASS_ENV,
  EMAIL_SELECTOR,
  LOGIN_PATH,
  PASSWORD_SELECTOR,
  SUBMIT_SELECTOR,
  contextOptions,
} from './check-session-reload-production.js';
import PAGES_SEO from '../src/config/pages-seo.json' with { type: 'json' };
import { makeScopedTranslator } from '../src/utils/pack2PageI18n/jobs.js';

export const DEFAULT_BASE = SITE_ORIGIN;

/**
 * L'origine d'API à juger, quand elle n'est pas celle dérivée du site (`--api`).
 *
 * Une preview vit sur un autre hôte que la production, et son API n'a pas
 * forcément d'`api.` en face : c'est l'entrée qui le dit, jamais une déduction.
 */
export const API_ENV = 'API_A_JUGER';

/** La famille de cette sonde — ce qu'un rouge prononcé ici veut dire. */
export const FAMILLE = 'jobs, client venu d’une page ville';

/** Le seul titre d'annotation que cette sonde publie. */
export const TITRE_ERREUR = 'Jobs client depuis une page ville production';

/** Marque des refus de PRÉMISSE : la sonde n'a pas pu juger — elle ne juge pas. */
export const MARQUE_PREMISSE = 'prémisse (aucun verdict rendu ici)';

/** Le chemin de la page d'arrivée et celui de l'action proposée à un client. */
export const CHEMIN_JOBS = '/jobs';
export const CHEMIN_CREATION = '/create-job';

/**
 * Les trois cartes d'alerte, ancrées sur les `id` que les titres portent DÉJÀ.
 *
 * Aucun attribut n'a été ajouté au produit pour cette sonde : `aria-labelledby`
 * est ce qui rend chaque carte lisible par un lecteur d'écran, et c'est donc une
 * ancre stable par construction — un libellé (cinq langues) ou une classe de
 * peinture ne le seraient pas.
 */
export const SELECTEUR_RESERVEE = '#alerte-emploi-reservee';
export const SELECTEUR_PROMESSE = '#alerte-emploi-promesse';
export const SELECTEUR_TRAVAILLEUR = '#alerte-emploi-titre';

/** Le châssis de l'application dans `#root` : preuve de MONTAGE, pas mise en page. */
export const SELECTEUR_MONTAGE = '#root nav';

/** Bornes d'attente de CONDITION (jamais de pause de stabilisation). */
export const MONTAGE_TIMEOUT_MS = 30000;
export const LOGIN_TIMEOUT_MS = 30000;

/** Les langues que le dictionnaire de la page connaît (`pack2PageI18n/jobs.js`). */
export const LANGUES = ('fr en wo bm mos').split(' ');

const strip = (value) => String(value ?? '').trim().replace(/\/+$/, '');

/**
 * Le libellé qui préfixe chaque refus : la famille, et la surface jugée.
 *
 * @param {string} base Origine servie.
 * @returns {string}
 */
export const libelleSonde = (base) => `${FAMILLE} — le parcours RÉEL de ${strip(base)}/emplois/… vers ${CHEMIN_JOBS}`;

/** Le fait de prémisse, préfixé : jamais un vert, jamais un défaut du code. */
export const premisse = (fait) => `${MARQUE_PREMISSE} · ${fait}`;

/**
 * Les villes que le site publie, lues dans la DÉCLARATION (`pages-seo.json`)
 * relue par le backend : aucune n'est recopiée ici, et une ville ajoutée au
 * référentiel géographique devient jugeable sans toucher à cette sonde.
 *
 * @returns {Array<{slug: string, nom: string}>}
 */
export function villesPubliees() {
  // La DÉCLARATION est IMPORTÉE (attribut JSON, Node 22+ et Vite la lisent
  // toutes deux), jamais relue par un chemin : le fichier est la source, et un
  // chemin calculé depuis `import.meta.url` dépend du lanceur (Node donne une
  // URL `file:`, le runner de test une URL http).
  const villes = Array.isArray(PAGES_SEO.villes) ? PAGES_SEO.villes : [];
  return villes.filter((ville) => ville && ville.slug && ville.nom);
}

/** La ville par défaut : la première de la déclaration (ordre du référentiel). */
export function villeParDefaut() {
  const villes = villesPubliees();
  return villes.length ? villes[0] : { slug: '', nom: '' };
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
 * Le relevé de /jobs, calculé DANS la page (une seule évaluation par instant).
 *
 * Il ne remonte que des présences, des textes et des chemins : ni cookie, ni
 * jeton, ni identifiant. Une carte est décrite par son titre, son premier
 * paragraphe et ses liens — c'est exactement ce que le visiteur lit.
 *
 * @returns {object} Relevé sérialisable.
 */
const LIRE_PAGE = () => {
  const normaliser = (valeur) => String(valeur || '').replace(/\s+/g, ' ').trim();
  const cheminDe = (ancre) => {
    try {
      return new URL(ancre.href, location.origin).pathname;
    } catch (_erreur) {
      return '';
    }
  };
  const carte = (idTitre) => {
    const titre = document.getElementById(idTitre);
    const section = titre ? titre.closest('section') : null;
    if (!section) return null;
    return {
      titre: normaliser(titre.textContent),
      texte: normaliser((section.querySelector('p') || {}).textContent || ''),
      liens: [...section.querySelectorAll('a')].map((ancre) => ({
        texte: normaliser(ancre.textContent),
        chemin: cheminDe(ancre),
      })),
    };
  };
  const racine = document.getElementById('root');
  return {
    url: location.href,
    lang: document.documentElement.lang || '',
    monte: Boolean(racine && racine.querySelector('nav')),
    reservee: carte('alerte-emploi-reservee'),
    promesse: carte('alerte-emploi-promesse'),
    travailleur: carte('alerte-emploi-titre'),
  };
};

/**
 * Le lien d'alerte de la page ville, tel qu'il est SERVI (pas tel qu'on le
 * suppose) : tous les `href` qui portent `alerte=1`, et le statut du document.
 *
 * @returns {object} Relevé sérialisable.
 */
const LIRE_LIENS_VILLE = () => {
  const liens = [...document.querySelectorAll('a[href*="alerte=1"]')].map((ancre) => ({
    href: ancre.getAttribute('href') || '',
    texte: String(ancre.textContent || '').replace(/\s+/g, ' ').trim(),
    absolu: (() => {
      try {
        return new URL(ancre.getAttribute('href') || '', location.origin).href;
      } catch (_erreur) {
        return '';
      }
    })(),
  }));
  const h1 = document.querySelector('h1');
  return {
    url: location.href,
    titre: h1 ? String(h1.textContent || '').replace(/\s+/g, ' ').trim() : '',
    liens,
  };
};

/**
 * L'origine de l'API, DÉRIVÉE du site jugé (`https://api.<hôte>`).
 *
 * Pourquoi deux origines : sur le web la session est UNIQUEMENT le cookie
 * httpOnly posé par le backend, et `vercel.json` proxyie `/api/:path*` vers
 * l'API. Selon que le build parle par ce proxy ou directement à l'API, le
 * cookie vit sur l'origine du SITE ou sur celle de l'API ; une lecture sur la
 * mauvaise origine ne porte aucun cookie et rend 401 alors que la session est
 * parfaitement valide. Les deux sont donc demandées.
 *
 * Une base locale (`localhost`, `127.*`) n'a pas d'`api.` en face : la fonction
 * rend `''` et la sonde ne demande que l'origine du site.
 *
 * @param {string} base Origine du site jugé.
 * @returns {string}
 */
export const origineApi = (base = DEFAULT_BASE) => {
  try {
    const analyse = new URL(base);
    if (/^(localhost|127\.|\[::1\])/i.test(analyse.hostname)) return '';
    return `${analyse.protocol}//api.${analyse.hostname}`;
  } catch (_erreur) {
    return '';
  }
};

/**
 * Les adresses de `/api/auth/me` à interroger, DÉDUPLIQUÉES : d'abord l'origine
 * du site (le proxy de `vercel.json`), puis celle de l'API.
 *
 * @param {string} base Origine du site jugé.
 * @param {string} [api] Origine d'API explicite (`--api`, sinon dérivée).
 * @returns {string[]}
 */
export const cheminsCompte = (base = DEFAULT_BASE, api = '') => {
  const adresses = [`${base}${AUTH_ME_PATH}`];
  const origine = api || origineApi(base);
  if (origine && origine !== base) adresses.push(`${origine}${AUTH_ME_PATH}`);
  return [...new Set(adresses)];
};

/**
 * Le compte connecté, lu par l'API que la page interroge elle-même.
 *
 * CE QUE LES DEUX PREMIÈRES PASSES DE PRODUCTION ONT MESURÉ (31/10/2026) :
 * la première lisait `/api/auth/me` relatif au SITE (`HTTP 401`) ; la seconde,
 * croyant à un jeton porté, cherchait `localStorage['token']` et n'en trouvait
 * aucun. Les deux ont la même cause, écrite dans `AuthContext` : sur le web la
 * session est UNIQUEMENT le cookie httpOnly du backend, et l'application parle
 * à l'API sur `api.<hôte>` — donc une requête relative au site ne porte pas ce
 * cookie. La sonde ne pouvait donc JAMAIS rendre un verdict. Elle demande
 * maintenant les DEUX origines et retient la première qui répond 200.
 *
 * Aucun en-tête `Authorization` : le web n'en envoie pas (seul le shell natif
 * Capacitor en a un), donc en ajouter un ferait juger un canal que le web
 * n'utilise pas.
 *
 * @param {object} page Page Playwright (ou doublure).
 * @param {string[]} chemins Adresses absolues à interroger, dans l'ordre.
 * @returns {Promise<{statut: number, type: string, chemin: string, lus: Array}>}
 */
export const lireLeCompte = (page, chemins = [`${DEFAULT_BASE}${AUTH_ME_PATH}`]) =>
  page.evaluate(async (adresses) => {
    const lus = [];
    for (const chemin of adresses) {
      try {
        const reponse = await fetch(chemin, { credentials: 'include' });
        if (!reponse.ok) {
          lus.push({ chemin, statut: reponse.status });
          continue;
        }
        const corps = await reponse.json();
        const compte = corps && (corps.user || corps);
        return {
          statut: reponse.status,
          type: String((compte && compte.user_type) || ''),
          chemin,
          lus: [...lus, { chemin, statut: reponse.status }],
        };
      } catch (erreur) {
        lus.push({ chemin, statut: 0, erreur: String((erreur && erreur.message) || erreur) });
      }
    }
    return { statut: lus.length ? lus[lus.length - 1].statut : 0, type: '', chemin: '', lus };
  }, chemins);

/**
 * Les paramètres d'arrivée, lus dans l'URL RÉELLE de /jobs.
 *
 * @param {string} url Adresse de la page.
 * @returns {{chemin: string, alerte: string, ville: string, origine: string}}
 */
export function parametresArrivee(url) {
  const analyse = new URL(url);
  return {
    chemin: analyse.pathname,
    alerte: analyse.searchParams.get('alerte') || '',
    ville: analyse.searchParams.get('ville') || '',
    origine: analyse.searchParams.get('origine') || '',
  };
}

/**
 * Le verdict, à partir du relevé — SÉPARÉ de la navigation, donc jugeable sans
 * navigateur, et c'est ce que le test exerce cas par cas.
 *
 * @param {object} options
 * @param {object} options.releve Relevé de `LIRE_PAGE` après le clic.
 * @param {object} options.ville Ville attendue (`{slug, nom}`).
 * @param {string} options.lang Langue lue dans le document.
 * @returns {string[]} Les refus, vides si le fait est conforme.
 */
export function jugerArrivee({ releve, ville, lang }) {
  const erreurs = [];
  const attendus = makeScopedTranslator(lang || 'fr');
  const arrivee = parametresArrivee(releve.url || '');

  if (arrivee.chemin !== CHEMIN_JOBS) {
    erreurs.push(
      `le lien d'alerte de /emplois/${ville.slug} ne mène pas à ${CHEMIN_JOBS} : la page atteinte est ` +
        `« ${arrivee.chemin} » (${releve.url})`
    );
  }
  if (arrivee.alerte !== '1') {
    erreurs.push(
      `le lien arrive sur ${CHEMIN_JOBS} SANS « alerte=1 » : la page ne peut pas savoir que le clic ` +
        'demandait l’alerte, et la règle ne sera pas peinte'
    );
  }
  if (arrivee.origine !== 'ville') {
    erreurs.push(
      `la provenance transmise est « ${arrivee.origine || '(absente)'} » au lieu de « ville » : la veille ` +
        'créée depuis cette page ne serait pas comptée comme une acquisition de page ville'
    );
  }
  if (arrivee.ville !== ville.nom) {
    erreurs.push(
      `la ville transmise est « ${arrivee.ville || '(absente)'} » au lieu de « ${ville.nom} » : la veille ` +
        'porterait un texte qui ne correspond à aucune mission'
    );
  }

  if (!releve.reservee) {
    // Le diagnostic nomme ce que la page a peint À LA PLACE, parce que les
    // remèdes n'ont rien à voir : une vue anonyme dit que la session n'a pas
    // été restaurée sur /jobs, une carte travailleur que le rôle est mal lu.
    const place = releve.promesse
      ? 'la PROMESSE D’UN VISITEUR SANS COMPTE est peinte (`#alerte-emploi-promesse`) : la session du client n’a pas été restaurée sur /jobs'
      : releve.travailleur
        ? 'la CARTE TRAVAILLEUR est peinte (`#alerte-emploi-titre`) : le rôle lu par la page n’est pas celui du compte'
        : releve.monte
          ? 'l’application est montée mais AUCUNE des trois cartes d’alerte n’est peinte à l’endroit où le clic a déposé le visiteur'
          : 'l’application n’a pas monté (`#root nav` absent) : le module de page n’a pas exécuté son premier rendu';
    erreurs.push(
      `un client venu de /emplois/${ville.slug} n’a PAS la carte qui lui dit la règle : ${place}`
    );
    return erreurs;
  }

  const titre = attendus('jobAlertReservedTitle');
  const texte = attendus('jobAlertReservedLead');
  const action = attendus('jobAlertReservedAction');
  if (releve.reservee.titre !== titre) {
    erreurs.push(
      `la carte de la règle porte « ${releve.reservee.titre} » au lieu de « ${titre} » (langue « ${lang} »)`
    );
  }
  if (!releve.reservee.texte.includes(texte.slice(0, 60))) {
    erreurs.push(
      `la carte de la règle ne dit pas le texte attendu (langue « ${lang} ») : lu « ${releve.reservee.texte.slice(0, 120)}… »`
    );
  }
  const lienAction = releve.reservee.liens.find((lien) => lien.chemin === CHEMIN_CREATION);
  if (!lienAction) {
    erreurs.push(
      `la carte de la règle n’offre pas l’action d’un client (aucun lien vers ${CHEMIN_CREATION}) : ` +
        `trouvé ${JSON.stringify(releve.reservee.liens)}`
    );
  } else if (lienAction.texte !== action) {
    erreurs.push(`l’action de la carte porte « ${lienAction.texte} » au lieu de « ${action} »`);
  }

  // Les deux autres cartes, dans le MÊME relevé : une promesse « créez un
  // compte » serait fausse pour quelqu'un qui en a un, et une carte travailleur
  // lui proposerait de régler une veille qui n'existe pas pour lui.
  if (releve.promesse) {
    erreurs.push(
      'un CLIENT connecté voit la promesse d’un visiteur sans compte (`#alerte-emploi-promesse`) : ' +
        '« créez un compte » est faux pour lui'
    );
  }
  if (releve.travailleur) {
    erreurs.push(
      'un CLIENT connecté voit la carte interactive d’un travailleur (`#alerte-emploi-titre`) : ' +
        'une veille lui enverrait le catalogue qu’il publie lui-même'
    );
  }
  return erreurs;
}

/**
 * Le verdict de la visite ORDINAIRE (`/jobs`, sans `?alerte=1`).
 *
 * @param {object} releve Relevé de `LIRE_PAGE`.
 * @returns {string[]} Les refus, vides si la page ne parle pas d'alerte.
 */
export function jugerVisiteOrdinaire(releve) {
  const erreurs = [];
  if (releve.reservee) {
    erreurs.push(
      `sur ${CHEMIN_JOBS} SANS « alerte=1 », un client reçoit quand même « ${releve.reservee.titre} » : ` +
        'la page parle d’une chose qu’il n’a pas demandée, sur sa page la plus visitée'
    );
  }
  if (!releve.monte) {
    erreurs.push(
      `la visite ordinaire de ${CHEMIN_JOBS} n’a pas monté l’application : l’absence de la carte ` +
        'ne prouverait rien sur une page qui n’a pas rendu'
    );
  }
  return erreurs;
}

/**
 * UNE tentative complète : connexion, page ville, clic, /jobs, puis visite
 * ordinaire.
 *
 * @param {object} contexte
 * @param {string} contexte.base
 * @param {{slug: string, nom: string}} contexte.ville
 * @param {string} contexte.email
 * @param {string} contexte.password
 * @param {Function} contexte.launch
 * @param {string} [contexte.bypassToken]
 * @param {number} contexte.loginTimeoutMs
 * @param {number} contexte.montageTimeoutMs
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], cout: object}>}
 */
async function uneTentative({
  base,
  api = '',
  ville,
  email,
  password,
  launch,
  bypassToken = '',
  loginTimeoutMs,
  montageTimeoutMs,
}) {
  const errors = [];
  const notices = [];
  const checked = [];
  const cout = { navigations: 0, requetes: 0, pages: 0 };

  const browser = await launch();
  try {
    const context = await browser.newContext(contextOptions({ bypassToken }));
    const page = await context.newPage();
    if (typeof page.on === 'function') {
      // PLANCHER de lecture : le nombre de requêtes émises est publié, pour que
      // « 0 requête » se lise comme une page qui n'a rien demandé plutôt que
      // comme un compteur débranché.
      page.on('request', () => {
        cout.requetes += 1;
      });
    }

    // ── 1. CONNEXION PAR LE FORMULAIRE SERVI ───────────────────────────────
    await page.goto(`${base}${LOGIN_PATH}`, { waitUntil: 'domcontentloaded' });
    cout.navigations += 1;
    cout.pages += 1;
    await page.fill(EMAIL_SELECTOR, email);
    await page.fill(PASSWORD_SELECTOR, password);
    await page.click(SUBMIT_SELECTOR);
    try {
      await page.waitForURL((current) => !current.pathname.startsWith(LOGIN_PATH), {
        timeout: loginTimeoutMs,
      });
    } catch (_erreur) {
      errors.push(
        premisse(
          `connexion du compte CI impossible : la page est restée sur ${LOGIN_PATH}. Vérifier ` +
            'LHCI_CI_EMAIL / LHCI_CI_PASSWORD (repli LHCI_TEST_*) — sans session, ce qu’un client voit ' +
            'n’est pas mesuré.'
        )
      );
      return { ok: false, premisse: true, errors, notices, checked, cout };
    }
    checked.push(`connexion : formulaire servi ${LOGIN_PATH}, sortie de la page de connexion`);

    // ── 2. LE COMPTE EST-IL BIEN UN CLIENT ? ───────────────────────────────
    const compte = await lireLeCompte(page, cheminsCompte(base, api));
    if (compte.statut !== 200) {
      const detail = (compte.lus || [])
        .map((lu) => `${lu.chemin} → ${lu.statut || 'injoignable'}`)
        .join(', ');
      errors.push(
        premisse(
          `session non lue après connexion : GET ${AUTH_ME_PATH} → ${detail}. Aucune des deux ` +
            'origines (celle du site, celle de l’API) ne porte de session : rien ne peut être dit ' +
            'du rôle du compte, donc rien de ce qu’un client voit.'
        )
      );
      return { ok: false, premisse: true, errors, notices, checked, cout };
    }
    if (compte.type !== 'client') {
      errors.push(
        premisse(
          `le compte CI est de type « ${compte.type || '(vide)'} » et non « client » : cette sonde juge ` +
            'ce qu’un CLIENT voit. Le provisionner avec ' +
            '`backend/scripts/provision_ci_test_account.py --type client`.'
        )
      );
      return { ok: false, premisse: true, errors, notices, checked, cout };
    }
    checked.push(`compte : GET ${compte.chemin || AUTH_ME_PATH} → 200, user_type=client`);

    // ── 3. LA PAGE VILLE, ET SON LIEN ──────────────────────────────────────
    const cheminVille = `/emplois/${ville.slug}`;
    const reponse = await page.goto(`${base}${cheminVille}`, { waitUntil: 'domcontentloaded' });
    cout.navigations += 1;
    cout.pages += 1;
    const statutVille = reponse && typeof reponse.status === 'function' ? reponse.status() : 0;
    if (!statutVille || statutVille >= 500) {
      errors.push(
        premisse(
          `page ville injoignable : ${cheminVille} répond HTTP ${statutVille || 'sans réponse'}. ` +
            'Un déploiement en cours n’est pas un verdict sur le lien.'
        )
      );
      return { ok: false, premisse: true, errors, notices, checked, cout };
    }
    if (statutVille !== 200) {
      errors.push(
        `${cheminVille} répond HTTP ${statutVille} : la page que le lien d’alerte habite n’est pas servie ` +
          '(rewrite `/emplois/(.*)` perdu, ou ville absente du référentiel)'
      );
      return { ok: false, premisse: false, errors, notices, checked, cout };
    }

    const pageVille = await page.evaluate(LIRE_LIENS_VILLE);
    const lien = (pageVille.liens || []).find((candidat) => {
      try {
        const analyse = new URL(candidat.absolu);
        return analyse.pathname === CHEMIN_JOBS && analyse.searchParams.get('alerte') === '1';
      } catch (_erreur) {
        return false;
      }
    });
    if (!lien) {
      errors.push(
        `${cheminVille} ne porte AUCUN lien d’alerte vers ${CHEMIN_JOBS}?alerte=1 ` +
          `(liens vus : ${(pageVille.liens || []).length}) : le bloc d’alerte de la page ville a disparu, ` +
          'ou son lien ne mène plus à /jobs'
      );
      return { ok: false, premisse: false, errors, notices, checked, cout };
    }
    checked.push(
      `page ville ${cheminVille} : lien « ${lien.texte} » → ${lien.href}`
    );

    // ── 4. LE CLIC, PAS L'URL TAPÉE ────────────────────────────────────────
    // Une URL tapée à la main prouverait que la page sait répondre au
    // paramètre ; le CLIC prouve en plus que le bouton mène là où il dit. C'est
    // le lien qui est jugé, donc c'est le lien qui est suivi.
    await page.click(`a[href*="alerte=1"]`);
    // Une NAVIGATION, pas une page de plus : le clic quitte la page ville.
    cout.navigations += 1;
    try {
      await page.waitForURL((current) => current.pathname === CHEMIN_JOBS, {
        timeout: montageTimeoutMs,
      });
    } catch (_erreur) {
      errors.push(
        `le clic sur le lien d’alerte de ${cheminVille} ne mène pas à ${CHEMIN_JOBS} : la page est ` +
          `restée sur « ${new URL(page.url()).pathname} »`
      );
      return { ok: false, premisse: false, errors, notices, checked, cout };
    }

    try {
      await page.waitForSelector(SELECTEUR_RESERVEE, { timeout: montageTimeoutMs });
    } catch (_erreur) {
      // Le relevé reste lu : c'est lui qui nomme la carte peinte à la place.
      checked.push(`attente de ${SELECTEUR_RESERVEE} dépassée (${montageTimeoutMs} ms) — relevé pris quand même`);
    }
    const releve = await page.evaluate(LIRE_PAGE);

    if (!LANGUES.includes(releve.lang)) {
      errors.push(
        premisse(
          `langue du document « ${releve.lang || '(vide)'} » hors des langues servies (${LANGUES.join(', ')}) : ` +
            'les textes attendus ne peuvent pas être lus'
        )
      );
      return { ok: false, premisse: true, errors, notices, checked, cout };
    }

    const verdictArrivee = jugerArrivee({ releve, ville, lang: releve.lang });
    errors.push(...verdictArrivee);
    if (!verdictArrivee.length) {
      checked.push(
        `arrivée depuis ${cheminVille} : carte de la règle peinte (langue « ${releve.lang} »), ` +
          `action ${CHEMIN_CREATION}, ni promesse anonyme ni carte travailleur`
      );
    }

    // ── 5. LA VISITE ORDINAIRE : LA RÈGLE N'EST PAS BAVARDE ────────────────
    await page.goto(`${base}${CHEMIN_JOBS}`, { waitUntil: 'domcontentloaded' });
    cout.navigations += 1;
    cout.pages += 1;
    try {
      await page.waitForSelector(SELECTEUR_MONTAGE, { timeout: montageTimeoutMs });
    } catch (_erreur) {
      checked.push(`attente de ${SELECTEUR_MONTAGE} dépassée sur la visite ordinaire — relevé pris quand même`);
    }
    const ordinaire = await page.evaluate(LIRE_PAGE);
    const verdictOrdinaire = jugerVisiteOrdinaire(ordinaire);
    errors.push(...verdictOrdinaire);
    if (!verdictOrdinaire.length) {
      checked.push(`visite ordinaire de ${CHEMIN_JOBS} : la règle n’est pas peinte (aucune demande, aucune explication)`);
    }

    if (errors.length) return { ok: false, premisse: false, errors, notices, checked, cout };
    notices.push(
      `${libelleSonde(base)} : un client venu de ${cheminVille} lit la règle, et seulement quand il l’a demandée.`
    );
    return { ok: true, premisse: false, errors, notices, checked, cout };
  } finally {
    await browser.close();
  }
}

/**
 * La sonde, avec ses options et ses tentatives.
 *
 * @param {object} [options]
 * @param {string} [options.base]   Origine servie (défaut : production).
 * @param {string} [options.ville]  Slug de ville (défaut : la première publiée).
 * @param {string} [options.email]
 * @param {string} [options.password]
 * @param {Function} [options.launch]
 * @param {string} [options.bypassToken]
 * @param {number} [options.attempts]
 * @param {number} [options.delayMs]
 * @param {number} [options.loginTimeoutMs]
 * @param {number} [options.montageTimeoutMs]
 * @param {boolean} [options.quiet]
 * @param {Function} [options.log]
 * @returns {Promise<{ok: boolean, premisse: boolean, errors: string[], notices: string[],
 *   checked: string[], cout: object, attempts: number}>}
 */
export async function runJobsVilleClientProbe({
  base = DEFAULT_BASE,
  ville = '',
  email = process.env.LHCI_CI_EMAIL || process.env.LHCI_TEST_EMAIL || '',
  password = process.env.LHCI_CI_PASSWORD || process.env.LHCI_TEST_PASSWORD || '',
  api = process.env[API_ENV] || '',
  launch = defaultLaunch,
  bypassToken = process.env[BYPASS_ENV] || '',
  attempts = ATTEMPTS,
  delayMs = 15000,
  loginTimeoutMs = LOGIN_TIMEOUT_MS,
  montageTimeoutMs = MONTAGE_TIMEOUT_MS,
  quiet = false,
  log = console.log,
} = {}) {
  const cleanBase = strip(base);
  const villes = villesPubliees();
  const choisie = ville ? villes.find((candidate) => candidate.slug === ville) : villes[0];
  if (!choisie) {
    return {
      ok: false,
      premisse: true,
      errors: [
        premisse(
          ville
            ? `ville « ${ville} » absente de la déclaration (frontend/src/config/pages-seo.json) : ` +
              `connues ${villes.map((v) => v.slug).join(', ')}`
            : 'aucune ville publiée dans la déclaration : le corpus de la sonde est vide'
        ),
      ],
      notices: [],
      checked: [],
      cout: { navigations: 0, requetes: 0, pages: 0 },
      attempts: 0,
    };
  }

  if (!email || !password) {
    return {
      ok: false,
      premisse: true,
      errors: [
        premisse(
          'compte CI absent : LHCI_CI_EMAIL / LHCI_CI_PASSWORD (repli LHCI_TEST_*) ne sont pas définis — ' +
            'sans compte client réel, ce que /jobs affiche à un client n’est pas mesuré.'
        ),
      ],
      notices: [],
      checked: [],
      cout: { navigations: 0, requetes: 0, pages: 0 },
      attempts: 0,
    };
  }

  let dernier = {
    ok: false,
    premisse: false,
    errors: [],
    notices: [],
    checked: [],
    cout: { navigations: 0, requetes: 0, pages: 0 },
  };
  let utilisee = 0;
  const debut = Date.now();

  for (let tentative = 1; tentative <= attempts; tentative += 1) {
    utilisee = tentative;
    try {
      dernier = await uneTentative({
        base: cleanBase,
        api,
        ville: choisie,
        email,
        password,
        launch,
        bypassToken,
        loginTimeoutMs,
        montageTimeoutMs,
      });
    } catch (erreur) {
      dernier = {
        ok: false,
        premisse: /chromium|playwright|Executable doesn/i.test(erreur.message),
        errors: [
          dernier.premisse || /chromium|playwright|Executable doesn/i.test(erreur.message)
            ? premisse(`navigateur indisponible : ${erreur.message}`)
            : `sonde interrompue (${erreur.message}).`,
        ],
        notices: [],
        checked: [],
        cout: dernier.cout,
      };
    }
    if (dernier.ok) break;
    // Une prémisse ne se réessaie pas : la relancer trois fois ne pose pas les
    // secrets, et trois rouges pour un compte absent sont du bruit.
    if (dernier.premisse) break;
    if (tentative < attempts) {
      if (!quiet) log(`  … tentative ${tentative}/${attempts} sans verdict, nouvel essai dans ${Math.round(delayMs / 1000)} s`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  dernier.cout = { ...dernier.cout, dureeMs: Date.now() - debut, tentatives: utilisee };
  const label = libelleSonde(cleanBase);
  if (dernier.ok) {
    dernier.notices = dernier.notices.map((notice) => `${label} : ${notice}`);
  } else {
    dernier.errors = dernier.errors.map((erreur) => `${label} : ${erreur}`);
  }
  return { ...dernier, attempts: utilisee };
}

/**
 * Le coût de la sonde, en une phrase : publié sur le vert comme sur le rouge.
 *
 * @param {object} cout
 * @returns {string}
 */
export function phraseCout(cout = {}) {
  return (
    `${cout.pages || 0} page(s), ${cout.navigations || 0} navigation(s), ` +
    `${cout.requetes || 0} requête(s), ${cout.tentatives || 0} tentative(s), ` +
    `${Math.round((cout.dureeMs || 0) / 100) / 10} s`
  );
}

/**
 * Le résumé du run (`$GITHUB_STEP_SUMMARY`), écrit dans TOUS les cas.
 *
 * @param {object} resultat
 * @param {string} [cheminFichier]
 * @returns {string} Les lignes écrites.
 */
export function ecrireResume(resultat, cheminFichier = process.env.GITHUB_STEP_SUMMARY) {
  const etat = resultat.ok ? 'conforme' : resultat.premisse ? 'PRÉMISSE' : 'DÉFAUT';
  const lignes = [
    `### ${TITRE_ERREUR} — ${etat}`,
    '',
    `- Coût : ${phraseCout(resultat.cout)}`,
    ...(resultat.ok ? [] : resultat.errors.map((erreur) => `- ${erreur}`)),
    ...resultat.notices.map((notice) => `- ${notice}`),
    '',
  ];
  const texte = `${lignes.join('\n')}\n`;
  if (cheminFichier) {
    try {
      // `appendFileSync` : le résumé du run est PARTAGÉ entre les étapes, et
      // l'écraser retirerait ce que les précédentes y ont écrit.
      appendFileSync(cheminFichier, texte);
    } catch (_erreur) {
      // Un résumé illisible ne change pas le verdict : il est déjà sur stdout.
    }
  }
  return texte;
}

/**
 * Options de ligne de commande. Une valeur absente laisse le défaut.
 *
 * @param {string[]} argv
 * @returns {{base?: string, ville?: string, attempts?: number, delayMs?: number}}
 */
export function parseArguments(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const suivant = argv[index + 1];
    if (flag === '--base' && suivant) options.base = suivant;
    else if (flag === '--api' && suivant) options.api = suivant;
    else if (flag === '--ville' && suivant) options.ville = suivant;
    else if (flag === '--tentatives' && suivant) options.attempts = Number(suivant);
    else if (flag === '--delai' && suivant) options.delayMs = Number(suivant) * 1000;
    else if (flag === '--summary' && suivant) options.summary = suivant;
  }
  return options;
}

/**
 * La ligne de commande — couture INJECTABLE, pour que le CODE DE SORTIE soit
 * jugé sans réseau ni navigateur.
 *
 * @param {string[]} argv
 * @param {object} deps `run`, `log`, `error`
 * @returns {Promise<number>} 0 vert, 1 refus nommé, 2 prémisse (aucun verdict).
 */
export async function main(
  argv = process.argv.slice(2),
  { run = runJobsVilleClientProbe, log = console.log, error = console.error } = {}
) {
  const options = parseArguments(argv);
  const resultat = await run(options);
  const etat = resultat.ok ? 'conforme' : resultat.premisse ? MARQUE_PREMISSE : 'DÉFAUT';
  log(`${TITRE_ERREUR} — ${etat} (${resultat.attempts} tentative(s))`);
  for (const ligne of resultat.checked) log(`  ✓ ${ligne}`);
  for (const notice of resultat.notices) log(`::notice title=${TITRE_ERREUR}::${notice}`);
  for (const message of resultat.errors) error(`::error title=${TITRE_ERREUR}::${message}`);
  log(`ℹ️  Coût de la passe : ${phraseCout(resultat.cout)}`);
  ecrireResume(resultat, options.summary);
  if (resultat.ok) return 0;
  return resultat.premisse ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
